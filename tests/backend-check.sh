#!/bin/sh
# Optional comprehensive test run. No npm install and no Supabase/API connection.
# Downloads only a pinned, integrity-checked local WASM PostgreSQL test runtime.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
cache=$(mktemp -d "$root/tests/backend-runtime.XXXXXX")
cleanup() {
  rm -f "$cache/index.cjs" "$cache/pglite.cjs" "$cache/pglite.data" "$cache/pglite.wasm"
  rmdir "$cache" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM
for file in index.cjs pglite.cjs pglite.data pglite.wasm; do
  curl --fail --silent --show-error --max-time 60 "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.3.14/dist/$file" -o "$cache/$file"
done
(cd "$cache" && sha256sum -c <<'HASHES'
37ba5965b7042f78b128eaed205ad076153e32468efb2796ddf706feb25e4e06  index.cjs
ba3243e634c77ee9e5f64d46787628d504c8ca7fbde144a2f283eabb5c461a97  pglite.cjs
4703ec26f5710abb62db42acad229478b75c51ef7f3bb037286bb2bac139a930  pglite.data
8140392c5f70c5aecb40f514db242fce4223cfdd5f37a2b101dbdc30208dc49d  pglite.wasm
HASHES
)
PGLITE_MODULE="$cache/index.cjs" BACKEND_PHONE_CDN=1 node --test tests/*.test.js tests/*.test.mjs
