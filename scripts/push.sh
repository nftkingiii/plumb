#!/bin/sh
# Push the working tree to testbench:~/plumb (excludes node_modules and .git).
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -u).tgz
tar --exclude=node_modules --exclude=.git -czf "$T" .
gcloud compute scp --zone us-central1-a "$T" testbench:/tmp/plumb-push.tgz >/dev/null 2>&1
gcloud compute ssh testbench --zone us-central1-a --command 'mkdir -p ~/plumb && tar xzf /tmp/plumb-push.tgz -C ~/plumb && rm /tmp/plumb-push.tgz && echo pushed' 2>&1 | tail -1
rm -f "$T"
