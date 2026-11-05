VERDICT: GO-WITH-NOTES @a561fc12ba

Spike `spike/pine-w4-t13-candle`. Own diff `git diff 09453ca1a3 a561fc12ba`: `docs/pine/evidence/2026-11-04-w4-t13-spike/SPIKE.md` and `probe.mjs` only. No app/src, no engine, no flag. Merge-tree against master is clean. No engine bump.

Notes:
- N1 Its answer ("NO today; re-scope as a renderer task owned outside W4") is SUPERSEDED: the owner delegated the ruling and W4-T13 built the renderer in-lane. A second, contradicting T13 spike write-up lives on the T17 branch (`docs/pine/evidence/2026-11-03-w4-t17-t13/EVIDENCE.md` section "T13 spike": "not a renderer task owned outside W4"). If this spike merges, add one line to SPIKE.md that points at the W4-T13 build and the T17 section, so two contradicting answers do not sit unannotated in docs/.
- N2 `probe.mjs` header says "Run from repo root: node ...", but SPIKE.md says run from `app/` with `npx vite-node`. Make them the same.
- The factual findings (feed is symbol-only via `ohlcBarsForPlot`; per-point colours absent from `toOhlcPoints`; declared candles with no payload is an empty-series edge) match the code and are what T13 closed (`validateOhlc`, `computedOhlcPayload`).
