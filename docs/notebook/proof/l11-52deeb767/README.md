# L11 proof walk at `52deeb767`: reading, clause by clause

- **Tree:** L11 = L10 `ffed76ec4` + DR-F + LK + FX2 + WK4 + FX3 + WK5.
- **Raw evidence** was committed first, in `a962839da` (R-RAW).
- **Sandbox:** booted from the tip. The shared data root read CLEAN at all four checkpoints (`integrity.md`).
- **Run health:** 0 errors, 0 page errors.
- **Reading:** every number below is read from the JSON files beside this one.

Each sweep's control is the instrument's own test on planted defects. All five are VALID (`run.json` `sweep_status`):

| sweep | control | findings | WK4 (`e1ef47435`) |
|---|---|---|---|
| census (2b) | VALID | 0 | 1 |
| geometry (6c) | VALID | 2437 | 2278 |
| axe (9a) | VALID | 0 | 0 |
| silent (5d) | VALID | 0 | 3 |
| deadclick (2c) | VALID | 1 | control INVALID |

## 9a: accessibility (axe): PASS
- **Result:** 123/123 runs MEASURED, **0 violations**.
- **Control:** color-contrast and button-name were both found on the planted defects.

## 2b: feature census: PASS
- **Verdicts:** WORKS 113, N/A 30, NOT-DRIVEN 22. **NO-DOOR 0, BROKEN 0.**
- **G-171** (the first-run tour and "Add a sample notebook"): now **WORKS on the keyboard door**, as well as desktop and touch.
  - WK4 read NO-DOOR at the pre-fix tip.
  - The fix was the probe race fix `4f31a9075`; FX2 diagnosed the race.
- **G-155** (templates): WORKS on all 3 doors.

## 5d: silent failures: PASS
- **Reads:** 72/72 SENTENCE.
- **Writes:** 28 rows, 24 SENTENCE and 4 EXEMPT. **0 SILENT.**
- **trash-note** `DELETE /api/j2/notes/{id}`: SENTENCE under forced-500 and forced-offline. It was SILENT in WK4 and was fixed by FX3 `3b3ea1b8a`.
- **save-template:** both endpoints are reached and both read SENTENCE.
- **add-tag:** its secondary `PUT /api/j2/notes/{id}` did not fire in this run, so it has no row. FX3's fix (the reconnecting sentence is now visible) is covered by rendered-text unit tests.

## 6c: geometry: VALID; the findings are an inventory, not a verdict
- **Coverage:** 129/129 cells. By kind: occluded 2110, tap 273, overflow 54. WK4 had 1993 / 229 / 56.
- **Where the change is:** +159, concentrated on the collection views: board +38, calendar +37, graph +25, tasks +24, table +20, timeline +19.
- **Seed:** the same shape in both runs (`run.json` `seed`).
- **Likely cause, NOT measured:** the census can now reach "Add a sample notebook" through the keyboard door too, so the account holds one more sample notebook than in WK4's run. That means more rows on exactly these views. This stays a hypothesis until a note count is recorded.

## 2c: dead clicks: control VALID; the first real measurement since WK3
- **Surfaces:** 39 in all. 30 MEASURED, 9 TIMEOUT.
- **Controls:** 1,145 clicked in all. LIVE 973, CURRENT-NO-OP 14, NOT-FOUND 13, OCCLUDED 9, DISABLED 9, NOT-ACTIONABLE 7, **DEAD 3**.

**TIMEOUTs are budget, not hangs.** Each TIMEOUT surface measured many controls before its 360 s kill, at roughly 4-6 s per click:

| surface | mode | controls measured before the kill |
|---|---|---|
| nb-list | desk | 88 |
| nb-list | phone | 90 |
| nb-board | desk | 74 |
| nb-calendar | desk | 56 |
| nb-timeline | desk | 56 |
| nb-tasks | desk | 62 |
| nb-search | desk | 66 |
| nb-bulk | desk | 61 |
| nb-templates | desk | 60 |

- **WK3's nb-bulk "hang" is DISPROVEN:** nb-bulk made steady progress to 61 controls.
- **The real limit** is the per-surface budget against the size of the seeded account. That is an instrument-sizing item, not a product one.

**DEAD, 3 rows:**
- **nb-table (desk), `UPDATED` sort header:** a click produced no DOM change, no request and no URL change; focus stayed on the button. **A candidate product defect**, to be checked in the product.
- **nb-calendar and nb-timeline (desk), `Today`:** a click while the view already shows today. It is a no-op that the page does not mark as current (no `aria-current` or disabled state), so the judge cannot tell it from dead. **A product nit**: mark it as current, or disable it, when already on today.
