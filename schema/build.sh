#!/usr/bin/env bash
# Regenerates schema/generated/* from schema/jig.yaml (design D4). Build-time only.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/gen-json-schema ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q "linkml==1.12.1"
fi
mkdir -p generated
.venv/bin/gen-json-schema jig.yaml > generated/jig.schema.json
.venv/bin/gen-jsonld-context jig.yaml > generated/jig.context.jsonld
echo "Generated schema/generated/jig.schema.json and jig.context.jsonld"
