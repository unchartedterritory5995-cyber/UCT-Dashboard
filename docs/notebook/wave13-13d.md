# Wave 13, lane 13D: resurfacing -- "here's what you thought then"

Branch `feat/notebook-w13d`, from `feat/notebook-w13-landing` at `2e3b10ce41`. Spec:
`docs/notebook/WAVE-13-PLAN.md` Appendix A.13D. Flag `AWARENESS_NOTE_RESURFACE_ENABLED`, unset =
OFF (an enablement gate, `docs/feature_flags.json` status `dark`). In-app only; no email, no
Discord, no new HTTP route.

## What it is

The Awareness Engine (M1) already scans the market every cycle. Three new rules (R7-R9,
appended after R1-R6) watch a member's own **notes**: when a researched ticker touches a price a
note named, moves 8% or more on the day, or reaches a date the note carries (Review Date, or a
catalyst/event/earnings date property), an in-app notice appears -- "NVDA reached 100.00, the
stop you named" -- and its door opens the note at the **version that first named the level**,
read-only, beside the live note.

| Piece | Where |
|---|---|
| Rules R7-R9 | `api/services/awareness/rules.py` (appended after R1-R6, which stay byte-identical) |
| Index + ledger | `api/services/journal_two/note_levels.py` -- `j2_note_levels` (projection) + `j2_note_resurface_fires` (one-per-level-per-day ledger, insight -> note/version door) |
| The pass | `api/services/awareness/engine.py` -- `_run_resurface_pass` / `_fire_resurface`, run after R1-R6's delivering pass, no delivery branch of its own |
| Sub-cap + link | `api/services/voice_proactive_service.py` -- `RESURFACE_KINDS` under their own `MAX_RESURFACE_PER_USER_PER_DAY=2`, excluded from the shared 8/day count both ways; `list_history` attaches `link` via `_attach_resurface_links` |
| Purge | `api/services/journal_two/account_purge.py` -- both tables are direct-user tables |
| The door | `app/src/components/voice/VoiceInsightsPanel.jsx` -- the live in-app list of `/api/voice/insights` (Settings > Compass > Voice Insights Inbox); resurfacing kinds read "Your notes"; a `link` renders "Open what you wrote" |
| The sheet | `app/src/pages/journal-2-0/components/notebook/ResurfaceVersionSheet.jsx` (+`.module.css`) -- lazy, mounted by `NoteEditorPage.jsx` only while the flag is latched on and only by the editor the `?note=` door opened |
| a11y | `app/src/pages/journal-2-0/a11y/notebookSurfaces.js` entry + `resurfaceVersion.a11y.test.jsx` |
| Flag | `AWARENESS_NOTE_RESURFACE_ENABLED` -- `NOTEBOOK_FLAGS` row in `api/routers/auth.py`, `lib/offline/notebookFlags.js` `FLAG_FALLBACKS`, `tests/test_notebook_flags.py`, `tests/test_notebook_flag_parse.py`, `tools/notebook_switch_rehearsal.py`, `docs/feature_flags.json` (`dark`) |

**Tables** (both self-ensured in `auth.db`, no name/title column, purged with the account):
`j2_note_levels` (one row per level or date a live note names, rebuilt by watermark inside the
scan cycle, never in the save path, never a writer into notes), `j2_note_resurface_fires` (the
ledger). **Routes:** none new -- the feature reuses `GET /api/voice/insights`, `PUT /api/j2/notes/
{id}`, `GET /api/j2/notes/{id}/versions[/{id}]`, so no new census row in
`docs/notebook/security-review-notebook-routes.md` was needed (no route's auth/gate
classification changed).

## Decisions and findings

1. **The door lives in the Voice Insights Inbox (Settings > Compass), not the Dashboard tile.**
   `CompassTodayTile.jsx` is built but **unmounted** (`Dashboard.jsx` keeps it only as a rollback
   backup, though CLAUDE.md's Awareness Engine section still calls it live). Walk run 1 found no
   door there at all. Fixed by routing the feature's "Open what you wrote" link through
   `VoiceInsightsPanel.jsx` instead, which does render (`ccf61e227e`); `CompassTodayTile.jsx` was
   restored byte-for-byte to the landing base and its resurface test removed.
2. **A level the note's history never held has no version to open, by design, not by defect.**
   `_versions_naming` (`note_levels.py`) finds the version that named a level by scanning saved
   checkpoints -- and a checkpoint captures the **pre-edit** row. When a date property (Review
   Date) is set in the very save that also creates the resurfacing condition, no prior checkpoint
   ever held that date, so `version_id` is `None` and `note_link()` omits `resurfaceVersion`; the
   door still renders ("Open what you wrote") but opens the live note, which is the content that
   named it. This is stated in `note_levels.py`'s own module docstring, not inferred here.
3. **R7 names the ET calendar day, not a UTC slice.** An evening edit's UTC timestamp sliced to a
   date would have named "tomorrow". Fixed in `ccf61e227e`, with R1-R6 still byte-identical.

## Mutation proof

`docs/notebook/evidence/wave13-13d/mutation-f1a25da473.json` -- **PASS: control green, 10 of 10
killed.** Restored by writing back captured bytes, verified against `git cat-file`, never
`git checkout`.

| id | claim | file |
|---|---|---|
| M1 | R1-R6 stay byte-identical (S7 is absorbing them) | `awareness/rules.py` |
| M2 | a full shared 8/day budget never blocks a resurfacing | `voice_proactive_service.py` |
| M3 | resurfacing rows never spend a shared slot | `voice_proactive_service.py` |
| M4 | R7 fires inside the 0.5% band, not just off it | `awareness/rules.py` |
| M5 | R8 fires at 8%, not just under | `awareness/rules.py` |
| M6 | no `deliver_alert_payload` is reachable from resurfacing | `awareness/engine.py` |
| M7 | one per level per day (a second same-day cross is silent) | `awareness/engine.py` |
| M8 | account purge covers `j2_note_levels` | `account_purge.py` |
| M9 | inert while the flag is off | `awareness/engine.py` |
| M10 | levels are read only through `plan_extract` | `note_levels.py` |

## Unit + a11y tests

```
python -m pytest tests/test_awareness_resurface.py -q
  27 passed, 1515 warnings in 25.42s

npx vitest run src/components/voice/VoiceInsightsPanel.resurface.test.jsx \
  src/pages/journal-2-0/a11y/resurfaceVersion.a11y.test.jsx \
  src/pages/journal-2-0/components/notebook/NoteEditorPage.resurface.test.jsx --maxWorkers=1
  Test Files  3 passed (3)
       Tests  8 passed (8)
```

## The real-browser walk

Instrument: `tools/notebook_w13d_walk.py` (own sandbox, ports 8620-8624, Playwright Chromium).
Four runs, every raw record under `docs/notebook/evidence/wave13-13d/` (R-RAW: committed before
reading):

| Run | Tip | Raw | What it showed |
|---|---|---|---|
| 1 | `8864a2a66d` | `walk-8864a2a66d/walk.json` | W4/W5 FAIL: no door on `/dashboard` -- `CompassTodayTile` is unmounted. W6/W7 PASS. W8-W11 not reached (no door on that route either -- the walk raised there and the run recorded `failure` rather than a row). Sandbox CLEAN. Fixed by `ccf61e227e` (decision 1 above). |
| 2 | `ccf61e227e` | `walk-ccf61e227e/walk.json` | W4 FAIL: the inbox's kind label renders `YOUR NOTES` (CSS `text-transform`; Playwright's `inner_text` returns the transformed text) against an exact-case check. W5 PASS (the door and sheet work by mouse). W6 onward not reached: scan 3's child process hit `MemoryError` (box memory, `scan-3-at-103.log`) -- an environment result, not a product one. Sandbox CLEAN. Fixed by `af47f5cebe`. |
| 3 | `af47f5cebe` | `walk-af47f5cebe/walk.json` | W0-W7, W10-W12 PASS. **W8 (keyboard) and W9 (touch) FAIL**, both on the same timeout: `waiting for get_by_role("dialog", name="What you wrote then") to be visible`. Sandbox CLEAN. Root cause and fix below. |
| 4 | `9ddfbef58d` | `walk-9ddfbef58d/walk.json` | **All 13 rows PASS.** Sandbox CLEAN at all four checkpoints (62 db files hashed). |

### Run 3's W8/W9 failure: an instrument defect, not a product one

By the time W8 runs, **two** insights carry an "Open what you wrote" door: NVDA's
`note_level_touch` (from W1-W3) and AMD's `note_date_due` (from W7, whose Review Date was set in
the same PUT that created it -- decision 2 above, so its link carries no `resurfaceVersion`).
`list_history` orders `created_at DESC`, so AMD's door -- which opens no sheet by design -- renders
**above** NVDA's. W8's keyboard-Tab predicate and W9's `get_by_role("link", name=...).first` both
matched by label text alone, so Tab/tap landed on the AMD door first and timed out waiting for a
sheet the product never promised there. Confirmed from the raw scan dump
(`walk-af47f5cebe/scan-4-review-date.json`): the AMD `review_date@2026-10-02` level and its fire
row both carry `"version_id": null`.

This is a **test-targeting bug**, not a product defect -- the same shape as the W4 fixes above
(`ccf61e227e`, `af47f5cebe`), not a weakening of the walk: W8 and W9 now locate the door by its
exact `href` (the same value W4 already asserts), the one W5 already proved opens the sheet with a
mouse, so keyboard and touch exercise that same, specific door rather than whichever "Open what
you wrote" link sorts first. Fixed in `9ddfbef58d`; re-walked clean (run 4). No guarded product
file changed, so the mutation proof above was not re-run.

Run 4, row by row (from `walk-9ddfbef58d/walk.json`):

* **W0** `/api/auth/me` carries `awareness_note_resurface_enabled: true`.
* **W1** a note named "NVDA swing plan (walk)" with "Stop: 100", then edited to add "Target: 130":
  one version exists holding the stop and not the target; the live note holds both.
* **W2** scan at 104 (4% away, first sighting): silent: the side is recorded.
* **W3** scan at 98 (crossed the stop): exactly one notice, `note_level_touch`, importance 7,
  `deliver_alert_payload` never called.
* **W4** the inbox (`/settings?section=compass`) shows it under "Your notes" with "Open what you
  wrote", `href=/journal/notebook?note=<id>&resurfaceVersion=<vid>`.
* **W5** clicking opens the sheet "What you wrote then" holding the version (Stop: 100, no
  target); closing drops `resurfaceVersion` and shows the live note's target.
* **W6** scan at 103 (crossed back, same day): silent, still one notice.
* **W7** a Review Date of today on a second note (AMD): one `note_date_due` notice fires.
* **W8** keyboard: 69 Tab presses reach the NVDA door; Enter opens the sheet; Escape closes it.
* **W9** 390px touch: no sideways scroll, the door is 44px tall and within the viewport, a tap
  opens the sheet, its close button is 44px tall.
* **W10** flag OFF in the client (the auth payload answered false): the same URL opens no sheet
  and sends no version request.
* **W11** zero unforced page errors.
* **W12** the driver's own `sys.modules` carries no `api.*` module.

## Not done here, on purpose

* R8 (`note_big_move`, an 8%+ day on a ticker a note mentions) is built and mutation-proved (M5)
  but not exercised in the browser walk -- the walk's narrative is stop-touch and date-due only,
  per the Appendix's own walk line ("Cross a canvas stop: one notice; open it at the right
  version; a second cross is silent; a Review Date of today"). Its rail coverage is
  `tests/test_awareness_resurface.py`.
* No new editor node type and no new HTTP route, so nothing joins the never-revert list
  (`docs/notebook/wave5-rollback.md`) and no new row was needed in
  `docs/notebook/security-review-notebook-routes.md`.
