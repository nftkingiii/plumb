import { fetchJson, HttpError, TtlCache, type Ctx } from "./core.ts";

const NVD = "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=";
const CVEORG = "https://cveawg.mitre.org/api/cve/";
const NVD_BUDGET = 4; // NVD allows 5 keyless requests per rolling 30 s
const NVD_WINDOW_MS = 30_000;

export function severityOf(score: number): "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score === 0) return "NONE";
  if (score < 4) return "LOW";
  if (score < 7) return "MEDIUM";
  if (score < 9) return "HIGH";
  return "CRITICAL";
}

interface Metric {
  version: string;
  score: number;
  origin: string;
}

const VERSION_ORDER = ["3.1", "3.0", "4.0", "2.0"];

function nvdMetrics(cve: any): Metric[] {
  const m = cve?.metrics ?? {};
  const out: Metric[] = [];
  const add = (arr: any, version: string) => {
    for (const e of Array.isArray(arr) ? arr : []) {
      const s = e?.cvssData?.baseScore;
      if (typeof s === "number" && e.type === "Primary") out.push({ version, score: s, origin: "nvd-primary" });
    }
  };
  add(m.cvssMetricV31, "3.1");
  add(m.cvssMetricV30, "3.0");
  add(m.cvssMetricV40, "4.0");
  add(m.cvssMetricV2, "2.0");
  return out;
}

function cveOrgMetrics(rec: any): Metric[] {
  const out: Metric[] = [];
  const scan = (container: any, origin: string) => {
    for (const m of Array.isArray(container?.metrics) ? container.metrics : []) {
      for (const [k, v] of Object.entries(m ?? {})) {
        const mm = /^cvssV(\d)_(\d)$/.exec(k);
        const s = (v as any)?.baseScore;
        if (mm && typeof s === "number") out.push({ version: `${mm[1]}.${mm[2]}`, score: s, origin });
      }
    }
  };
  scan(rec?.containers?.cna, "cve.org-cna");
  for (const a of Array.isArray(rec?.containers?.adp) ? rec.containers.adp : []) scan(a, "cve.org-adp");
  return out;
}

const pick = (ms: Metric[]): Metric | undefined => {
  for (const v of VERSION_ORDER) {
    const m = ms.find((x) => x.version === v);
    if (m) return m;
  }
  return undefined;
};

export function createCve(ctx: Ctx) {
  const cache = new TtlCache<Record<string, unknown>>(3_600_000, ctx.now);
  const nvdCalls: number[] = [];

  async function nvd(id: string): Promise<{ cve?: any; absent: boolean; unavailable: boolean }> {
    const now = ctx.now();
    while (nvdCalls.length && now - nvdCalls[0]! > NVD_WINDOW_MS) nvdCalls.shift();
    if (nvdCalls.length >= NVD_BUDGET) return { absent: false, unavailable: true };
    nvdCalls.push(now);
    try {
      const r = await fetchJson(ctx, NVD + id);
      if (r.status !== 200 || !r.json) return { absent: false, unavailable: true };
      const v = r.json.vulnerabilities;
      if (Array.isArray(v) && v.length === 0) return { absent: true, unavailable: false };
      const cve = Array.isArray(v) ? v[0]?.cve : undefined;
      if (!cve || String(cve.id).toUpperCase() !== id) return { absent: false, unavailable: true };
      return { cve, absent: false, unavailable: false };
    } catch {
      return { absent: false, unavailable: true };
    }
  }

  async function cveOrg(id: string): Promise<{ rec?: any; absent: boolean; unavailable: boolean }> {
    try {
      const r = await fetchJson(ctx, CVEORG + id);
      if (r.status === 404) return { absent: true, unavailable: false };
      if (r.status !== 200 || r.json?.cveMetadata?.cveId?.toUpperCase() !== id) return { absent: false, unavailable: true };
      return { rec: r.json, absent: false, unavailable: false };
    } catch {
      return { absent: false, unavailable: true };
    }
  }

  return async function cvss(raw: string): Promise<Record<string, unknown>> {
    const id = (raw ?? "").trim().toUpperCase();
    if (!/^CVE-\d{4}-\d{4,19}$/.test(id)) throw new HttpError(400, "invalid_cve_id");
    const hit = cache.get(id);
    if (hit) return hit;

    const [a, b] = await Promise.all([nvd(id), cveOrg(id)]);
    if (a.absent && b.absent) throw new HttpError(404, "cve_not_found", { cve_id: id });
    if (b.rec?.cveMetadata?.state === "REJECTED") throw new HttpError(404, "cve_rejected", { cve_id: id });
    if (a.unavailable && b.unavailable) throw new HttpError(503, "sources_unavailable", { cve_id: id });

    const orgMs = b.rec ? cveOrgMetrics(b.rec) : [];
    let chosen: Metric | undefined;
    let crossCheck: string;
    if (a.cve) {
      chosen = pick(nvdMetrics(a.cve));
      if (chosen) {
        const same = orgMs.filter((m) => m.version === chosen!.version);
        crossCheck = b.unavailable ? "cve.org_unavailable" : same.length === 0 ? "cve.org_has_no_score_of_this_version" : same.some((m) => m.score === chosen!.score) ? "cve.org_agrees" : "cve.org_differs_nvd_primary_reported";
      } else crossCheck = "";
    } else crossCheck = "";
    if (!chosen) {
      // NVD has no primary score (not analysed yet, or NVD unavailable): accept the CVE record's own scores only when they all agree.
      const best = pick(orgMs);
      const sameVersion = best ? orgMs.filter((m) => m.version === best.version) : [];
      if (!best || sameVersion.some((m) => m.score !== best.score)) {
        if (best) throw new HttpError(502, "sources_disagree", { cve_id: id, detail: "CNA and ADP scores differ and NVD has no primary score" });
        throw new HttpError(404, "cvss_not_published", { cve_id: id });
      }
      chosen = best;
      crossCheck = a.unavailable ? "nvd_unavailable_cve.org_only" : "nvd_has_no_primary_score_cve.org_only";
    }

    const desc = (a.cve?.descriptions ?? b.rec?.containers?.cna?.descriptions ?? []).find((d: any) => d?.lang?.startsWith("en"))?.value;
    const published: string | undefined = a.cve?.published ?? b.rec?.cveMetadata?.datePublished;
    const refs: string[] = (a.cve?.references ?? b.rec?.containers?.cna?.references ?? []).map((r: any) => r?.url).filter((u: unknown) => typeof u === "string");
    const body: Record<string, unknown> = {
      cve_id: id,
      cvss_score: chosen.score,
      severity: severityOf(chosen.score),
      cvss_version: chosen.version,
      score_origin: chosen.origin,
      cross_check: crossCheck,
    };
    if (desc) body.description = desc;
    if (published) body.published = published.slice(0, 10);
    body.references = [...new Set(refs)].slice(0, 20);
    cache.set(id, body);
    return body;
  };
}
