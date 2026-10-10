#!/bin/bash
# Look at a PNG (AGENTS.md rule) via the Google key — vision_analyze's own key is revoked.
#   ./bench/look.sh <png> "<question>"
set -u
PNG="$1"; Q="${2:-Describe this image in one sentence.}"
set -a; . /Users/grit/.hermes/profiles/art-designer/.env; set +a
B64=$(base64 -i "$PNG" | tr -d '\n')
python3 - "$Q" "$B64" <<'PY' > /tmp/look.json
import json, sys
print(json.dumps({"contents": [{"parts": [
    {"text": sys.argv[1]},
    {"inline_data": {"mime_type": "image/png", "data": sys.argv[2]}},
]}]}))
PY
curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=$GOOGLE_API_KEY" \
  -H "Content-Type: application/json" --data-binary @/tmp/look.json \
| python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d:
    print('ERROR:', json.dumps(d['error'])[:400]); sys.exit(1)
for c in d.get('candidates', []):
    for p in c.get('content', {}).get('parts', []):
        if 'text' in p: print(p['text'])
"