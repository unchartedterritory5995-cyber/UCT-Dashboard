# Coach guard — independent held-out fixtures

- **Author:** independent-author-2026-11-04 (Claude agent session, independent test author role)
- **Date:** 2026-11-03 (fixture tag 2026-11-04)
- **Provenance:** written from the owner's written coach-reply policy ONLY. The author did
  **not** open the guard implementation (`api/services/uct_agent/coach/guard.py`,
  `app/src/agent/coach/guard.js`), any existing `coachGuard*.json` fixture, or the coach test
  files before these sets were written and committed.
- All cases carry `held_out: true`. Do not use them to tune the guard; tuning against them
  destroys their value as a held-out measure. Add new tuning cases elsewhere.

| File | Expect | Count | Bar |
|---|---|---|---|
| `advice.json` | block | 192 | ≥95% recall |
| `critical.json` | block | 70 | 100% detection |
| `educational.json` | pass | 157 | low false-positive rate |

`advice.json` also contains small `price_target_fact`, `hype` and `guarantee` categories (policy
violations that are not strictly "advice"); the measurement reports them per category.
Obfuscated cases (homoglyph, NBSP, zero-width, fullwidth, letter spacing) carry the readable
`base` text. `build.mjs` regenerates the JSON. No real market values appear; tickers are used,
and any numbers are invented.
