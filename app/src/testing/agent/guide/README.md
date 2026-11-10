# Visual teaching: browser proof

Proves, in a real headless Chrome on the agent harness, that a "how do I…" walkthrough reaches its last step with the gold ring on the control that step names. This is a dev-only harness with a scripted model: no API key, no backend, synthetic bars and fixture lists and layouts. A pass is not production evidence.

From `app/`:

```
# 0. dev server, started FRESH after any code change (a hot-reloaded module is a different copy from the one the runner reads)
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5302 --strictPort
# 1. cases: the inventory's own words that reach the walkthrough assigned to each row (expected.json)
GUIDE_CASES_OUT=src/testing/agent/guide/cases.inventory.json GUIDE_PROBE_OUT=teach-probe.json npx vitest run src/agent/agentGuideInventory
# 2. the browser run (one Chrome per case, temp profile deleted on close; set TEMP to keep profiles in your scratch folder)
BA_BASE=http://127.0.0.1:5302 node src/testing/agent/guide/teach.mjs --out teach-results.json [--filter 'C1-0|watermark']
# 3. the status file
node src/testing/agent/guide/status.mjs teach-results.json [more-results.json...] teach-probe.json > ../docs/agent/CHARTS_TEACH_STATUS.md
```

- `expected.json` holds the walkthrough a person assigned to each inventory row: the 2026-11-05 matrix's "Guide feature" column, plus catalog controls reviewed by hand on 2026-11-07. A case exists only when the row's own words reach that walkthrough.
- A case passes only on the step's own sentence. A fallback ("this shows once…") is a fail.
