# Batch 2 guarded release — 2026-10-09

- **Master:** `0693b529fc` (merge `94272f38b2` + fixes `8affe428d4`, `0693b529fc`). Guard rc=0 on both pushes
  (one burst refusal waited out, never attested). Gate + promote green for both.
- **Railway web:** `3ae971d9` (94272f38b, 12:09 UTC) → `19917290` (0693b529f, 12:46 UTC). An externally
  triggered redeploy `18a59272` (13:03 UTC, same commit) caused a ~2 min 502 (OPEN-FINDINGS §14).
- **Live check:** the production bundle carries the expansion-cap refusal; the server plans "momentum" as a term.
- **Real model (admin, drill board):** 6 calls, **$0.523** — momentum histogram ×2 ($0.145 refused by the
  slot defect → fixed and redeployed → $0.144 first-pass), bare-"relative strength" table → clarify ($0.026),
  "SPY" → table ($0.052), one-state follow-up ($0.028), three-state candles ($0.128, one repair).
- **Production checks passed:** four-state histogram (save, receipt, reload), conditional table + merged title +
  cross-symbol cell after reload, follow-up changes one state + local Undo, Pine `plotshape` markers draw and
  are removed with their indicator, saved `sym()` indicator repopulates after reload, 12-deep nesting refused
  in 22 ms, CSS colour refused 422 `presentation:colour` (nothing stored), linreg + correlation previews,
  Batch 1 draft recovery + receipts.
- **Not verified in production:** marker size/colour via conversation (budget — verified locally and via the
  Pine path), Paper theme on the drill board (not applied, to avoid restyling the board; fix verified by test
  and the saved table stores `chart.fg_color`), green/red candle states on PTC (all bars yellow in view).
- **Main Trading:** `c683e423…34058397` (2180 bytes) before and after — unchanged.
- **Cleanup:** `u_868299cd6d93`, `u_8374090b129e` soft-deleted (owned, no share token, no alert, not in any
  layout or Main Trading). New scratch definitions left: `u_0c269011bfe2` (Pine marker check, removed from the
  chart), `u_f93786a57c02` (histogram), `u_b0727af36318` (Dashboard table).
- **Cohort OFF, budgets unchanged, no Railway variable or flag changed.**
