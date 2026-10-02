# Notebook: beta handoff (2026-10-02)

This is everything the Notebook still needs that a build cannot do. It is meant as the input to
the owner's own beta-testing plan. Each row names what closes it and where the kit already is.

**Where the build stands:** waves 5-12 are built. The parity scorecard reads 41 of 61 clauses
MET and 3 of 16 standards at bar (`docs/notebook/parity-scorecard.md`, re-scored by wave 12 lane
12C phase 2). Under rulings D18, D19 and D20, which stand (`WAVE-12-PLAN.md` §5), 13 of 16 is the
ceiling.

## 1. Switches to turn on (Railway, web service, Variables, then Deploy)

All are read per request; unset means off. Turn on one change at a time, then check the site.

| switch | what members get | status |
|---|---|---|
| `NOTEBOOK_TRADE_CANVAS_ENABLED=1` | trade-plan canvas | ready |
| `NOTEBOOK_AI_ACTIONS_ENABLED=1` | "Ask Notebook to do something" (plan, approve each change, undo) | ready |
| `NOTEBOOK_FORMULAS_ENABLED=1` | formula and rollup properties, the position-tracker template's formulas | after a quiet-box 50k reading (1k/10k done: `docs/notebook/evidence/wave11-11b/scale/run-3-*`) |
| `NOTEBOOK_TEMPLATE_GALLERY_ENABLED=1` | community template gallery (admin approves before listing) | after this wave's PR merges |
| `NOTEBOOK_VOICE_NOTES_ENABLED=1` | voice and meeting notes | HOLD: needs the OpenAI zero-retention letter (row 8a), and the upload-size gap fixed first (census row :254 in `security-review-notebook-routes.md`: an upload with no Content-Length is spooled before the 90 MiB cap) |

## 2. What only real people, devices or vendors can close

| clause | what closes it | kit |
|---|---|---|
| 1c, 5a, 5b, 5c, 16a | a task-based study with 5-8 traders (core tasks unaided, SUS >= 80, first useful note < 2 min) | `docs/notebook/user-study-kit.md` |
| 3a | 30 days with real members and zero data loss | `docs/notebook/soak-30day.md` |
| 8a, 12c, 12d, 13a | zero-retention terms in writing from Anthropic and OpenAI; then arm meaning search | the vendor letters |
| 1a, 1b | the above letter, plus the browser-extension store submission (G-043) | Chrome Web Store |
| 9c | a screen-reader pass by a person, VoiceOver and NVDA | `docs/notebook/a11y-second-review-brief.md` |
| 10a | run the iOS Shortcut on an iPhone (G-044) | the Shortcut docs |
| 10c | a real-device pass per release | BrowserStack Live (Automate is not on the account) |
| 4d | typing under 16 ms: one more quiet-box reading to settle two disagreeing quiet readings | `docs/notebook/perf-runs/ty8/README.md` |
| 7a | the scheduled restore drill, Sunday 2026-10-04 09:00 local (keep the PC on) | `soak-drills/` |

## 3. Rows a beta tester exercises directly (not walked by automation)

The automated production walk was blocked by the agent permission system, so these rows stay
NOT-VERIFIED until a person uses them on the live site:

- G-050 Ask the current note
- G-051 Ask the whole Notebook
- G-165 writing help: summarize, rewrite, continue, translate, property autofill
- G-166 Ask over an attached Word file or image
- G-162 dictation
- G-153 a task reminder at 07:00 or 09:00 ET

## 4. Owner decisions recorded with defaults (change any by saying so)

- Gallery: any admin approves; publishing needs a paid plan; images are dropped; edits go back to
  review; no auto-hide on reports (full list: `docs/notebook/wave12-12a.md`).
- Position tracker: formula fields are set up only from the Notebook's own picker, not from the
  joystick hub's Templates action (owner: fine as is, 2026-10-02).
- Voice notes stay dark until the vendor letter (above).
