# V2c2 — fresh single-vintage cache procedure (run IMMEDIATELY before the final grind)

Nothing here launches the grind. Every step is refused-by-construction if skipped.

1. **Pick the tag and last session.** `TAG=v<YYYYMMDD>c` (never reuse a tag: every writer opens
   `open(..., "x")`). `LAST` = the last completed NYSE session.
2. **Acquire in ONE window, after the close, before the next open** (on breadth-v2-runner):
   `launch.py acquire_all.py $TAG $LAST` → `/data/grouped_closes_$TAG` (adjusted + raw per session)
   and `/data/_audit/v2cc/inputs_$TAG/` holding `grouped_vintage_manifest.json`, `splits_ledger.json`,
   `dividends_ledger.json`, the identity ledger + change points + `uct_identity_table_v3.json`,
   `pit_uct_ledger.json` (copied, live_from 2026-03-23) and `INPUT_MANIFEST.json` (fetch window +
   sha256 of every object). The dividend ledger is the long pole (full history, 1000/page).
   An empty grouped file fails the acquisition.
3. **Build the derived tables once** (before any concurrent pass): `build_inputs2.py $TAG` →
   `adjusted_guard_table.json` (adj-guard-v3) and `dividend_basis_table.json` (div-basis-v1), both
   keyed by the hash of their inputs, plus the dividend census.
4. **Preflight** (`python -m api.services.breadth_corrected_pass --preflight` via the supervisor with
   `BREADTH_V2_PASS=v2c2 BREADTH_V2C2_INPUTS=.../inputs_$TAG`). It REFUSES on:
   production-writing flags set; module digests ≠ `breadth_v2c2_pins.json`; a research universe
   (`uct_backtest`) in `breadth_universes.UNIVERSES`; universe/metric registry digest ≠ pins;
   methodology / guard / dividend-basis version ≠ pins; any input sha ≠ INPUT_MANIFEST; a grouped
   dir ≠ the manifest's; a fetch window spanning a market open; a cache older than the next open
   after its window (stale); PIT `live_from` ≠ 2026-03-23.
5. **Re-pin only if code changed** (it must not have, after acceptance): digests are re-measured,
   never hand-edited, and the bounded proof is re-run on the new pins.
6. Only then, with explicit owner authorization, start the supervisor (`BREADTH_V2_PASS=v2c2`).
