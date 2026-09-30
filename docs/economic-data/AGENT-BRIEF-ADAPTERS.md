# Adapter agent brief (shared)
Worktree C:\w\econ1 (bash /c/w/econ1), branch feat/economic-data-p1. Python: use the project venv
`/c/Users/blake/projects/UCT-Dashboard/.venv/Scripts/python.exe -m pytest tests/econ -q` (has fastapi/requests).

READ: docs/economic-data/PHASE1-DESIGN.md, api/services/econ/model.py, adapters/base.py, adapters/fake.py,
http.py, secrets.py, timeutil.py, validate.py, registry.py + registry/series.json (read-only for you),
Phase 0: C:\Users\blake\uct-econ-phase0\proofs.md, proofs\ (raw samples), licensing.md,
phase1_research_calendar_claims.md, econ_catalog.csv.

RULES
- Never git commit/push/stash. Only create/edit YOUR files (listed in your prompt). Other agents edit other files concurrently.
- DO NOT EDIT registry/series.json. Write needed registry corrections (provider ids, params, units, start dates,
  verification evidence, status changes) as a JSON list of {symbol, field_path, old, new, evidence} to
  docs/economic-data/registry-corrections/<your-adapter>.json. The coordinator applies them.
- All network goes through econ.http.HttpClient (honest UA). Live requests: small, sequential, read-only; never loop-burst.
  No accounts, no API keys (none configured locally) -> implement BOTH keyed and keyless modes; test keyed mode with
  recorded/synthesised fixtures; verify live via keyless mode. Never circumvent a block (403/Akamai): report it.
- No FRED anywhere in code paths (licensing rail). FRED may be read manually for a cross-check only, and never stored.
- Adapters only normalize to RawObs (ISO period_start/period_end, float|None, flag). No store writes, no currentness.
  Missing markers -> None (never 0). Units: return values in the registry's raw units (registry units.scale says how to display).
- Save trimmed real payload fixtures under tests/econ/fixtures/<adapter>/ (keep each < 300 KB; trim history).
  Tests: parsing, period grammar, NA markers, malformed/partial payloads -> MalformedPayload, soft failures
  (empty 200, error redirect, HTML instead of CSV/JSON), keyless-vs-keyed request construction (keys never in request_key),
  history vs latest modes, chunking.
- LIVE VERIFICATION (required): write tools/econ/verify_<adapter>.py that fetches, for every cohort series you own, the full
  available history (history mode) and prints: symbol, count, oldest period, newest period, newest value, units, source
  publication metadata if any. Run it once; save output to docs/economic-data/verification/<adapter>.txt. Compare the newest
  values to Phase 0 proofs.md values (and one secondary reference where possible) and state MATCH/MISMATCH with explanation.
- Report (<=700 words): files, adapter params contract (what `source.params` keys you read), per-series table
  (symbol, provider id confirmed?, count, oldest, newest, newest value, match), registry corrections written, blockers.
