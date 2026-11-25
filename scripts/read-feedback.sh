#!/bin/zsh
# Prints reader feedback from Mangit Web and the Chrome extension (Firestore
# `feedback` in project mangit-lens), oldest first. uid is left out.
# Usage: scripts/read-feedback.sh [since-ISO-date]   e.g. scripts/read-feedback.sh 2026-11-25
# Needs gcloud logged in as an owner of mangit-lens.
SINCE=${1:-2000-01-01}
T=$(CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14 CLOUDSDK_CORE_ACCOUNT=measifyapps@gmail.com gcloud auth print-access-token)
curl -4 -s -H "Authorization: Bearer $T" \
  "https://firestore.googleapis.com/v1/projects/mangit-lens/databases/(default)/documents/feedback?pageSize=500" |
python3 -c '
import json, sys
since = sys.argv[1]
j = json.load(sys.stdin)
if "error" in j: sys.exit("ERROR " + j["error"]["message"])
docs = sorted((d for d in j.get("documents", []) if d["createTime"] >= since), key=lambda d: d["createTime"])
up = sum(1 for d in docs if d["fields"].get("rating", {}).get("stringValue") == "up")
down = sum(1 for d in docs if d["fields"].get("rating", {}).get("stringValue") == "down")
msgs = [d for d in docs if d["fields"].get("kind", {}).get("stringValue") != "rating"]
print(f"{len(docs)} entries since {since}: {len(msgs)} messages, ratings {up} up / {down} down\n")
for d in msgs:
    f = {k: list(v.values())[0] for k, v in d["fields"].items()}
    print(d["createTime"][:16], "[%s/%s] %s" % (f.get("kind"), f.get("rating"), f.get("surface")), f.get("email") or "")
    print("  ", f.get("message", "").replace("\n", "\n   "))
    if f.get("context"): print("   context:", f["context"])
    print()
' "$SINCE"
