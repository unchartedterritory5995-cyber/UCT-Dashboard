# Notebook accessibility -- conformance statement

**Date:** 2026-09-26. **Scope:** the Notebook in Journal 2.0 -- the Notebook tab
(`/journal/notebook`), the note editor and everything it opens, the sidebar, every view
mode, the capture / import / export / template / saved-view dialogs, the three Notebook
Settings cards, and the public share and published pages. The component population is
DERIVED (`app/src/pages/journal-2-0/a11y/population.js`), never typed.
**Target:** WCAG 2.2 AA. **Status: partially conforms** -- every machine-checkable rule
below passes or is recorded against a named ruling, and the parts a machine cannot
judge (speech, real layout, real devices) are scripted for the owner and not yet run.
**Branch:** `feat/notebook-w8`, wave 8 lane 8A.

## What is covered, and by which rail

All rails live in `app/src/pages/journal-2-0/a11y/` unless named otherwise, and run in CI
through `.github/workflows/notebook-a11y.yml` (advisory until it has been seen red once
and green once -- ruling D-A2).

| What | Rail | How it can fail |
|---|---|---|
| **axe-core 4.13.0** (MPL-2.0, exact-pinned, ruling D-A1) with the WCAG 2.0/2.1/2.2 A and AA tags | `axeHarness.js` + `axeHarness.contract.test.js` | the frozen exclusion list (D-A5: `color-contrast` in jsdom, the `region` / landmark best-practice family on component renders) is pinned exactly; known-bad controls must be caught at both levels |
| **Every Notebook surface, zero axe violations** -- 88-entry manifest, each component a recipe, a covering recipe, another lane's rail, or exempt with a reason | `notebookSurfaces.js`, `surfaceCoverage.test.js`, and the rails `notebookTab`, `noteEditor`, `panels`, `dialogs`, `parts`, `settingsCards`, `sharing`, `graph` `.a11y.test.jsx` | a new component with no entry, an entry for a file that is gone, or a recipe id no rail registers fails by name; every recipe proves its screen rendered before axe runs |
| **Aria census** -- a component with no `aria-` or `role=` token must be classified | `ariaCoverage.test.js` | a new unclassified file fails by name |
| **The graph** -- "Show as list" (a real table) and a keyboard canvas (arrows, Home/End, Enter, Escape, a polite live region); a key press costs ONE frame (H14) | `components/notebook/NoteGraphView.test.jsx`, `graph.a11y.test.jsx` | mutation-proved: re-running the simulation on a key press reads "expected 221 to be 1" |
| **No focus ring hidden without a measured replacement** | `focusSuppression.test.js` over `cssAudit.js` | an `outline: none` without a 3:1 replacement in the same rule (all three themes) fails with file:line |
| **Where focus lands** -- open, Back, delete, Ask, find, slash, emoji, colour, outline, a Sheet, the skip link | `focusFlows.test.jsx`; `app/src/components/mobile/Sheet.autoFocus.test.jsx` | 13 flows, each mutation-proved |
| **Colour contrast**, 680 declared pairs x dark / oled / light | `notebookContrast.test.js` over `contrastAudit.js` (one formula: `app/src/styles/__tests__/contrastMath.js`) | a pair under its bar that is not an expected failure with a ruling id; a literal colour on `color:`; a token that does not resolve (by name). Table: `docs/notebook/accessibility-contrast.md` |
| **Keyboard shortcuts are listed once**, in the member's own keyboard's words | `components/ShortcutCheatSheet.test.jsx`, `lib/platform.test.js` | the graph keys and Home/End (Fn + arrow on a Mac) are pinned per platform |
| **Touch targets declared on the whole touch tier** | `app/src/styles/tapFloor.test.js` | a target at 44px on the phone only |

**Aria census, before and after** (method: a population file with neither an `aria-` nor
a `role=` token): 25 of 86 at the plan's commit `a5668a8a8`; **26 of 88** at the lane's
start `09220eedf`; **4 of 88** after A2 (`754040ffd`), all four classified with a reason
(`NotebookFlagGate`, `CaptureHost`, `NoteStats`, and lane 8C's `NoteExportControls`),
0 unclassified. A token proves a file says something, not that it says the right thing --
the axe rails and the screen-reader pass judge the words.

## What jsdom cannot see, and what covers it

| jsdom cannot see | Why | What covers it |
|---|---|---|
| **Layout** -- whether a focus ring is clipped, a control is off-screen, a sticky bar covers the caret | jsdom performs no layout; every box is 0x0 | the browser check (lane 8A P-1): a keyboard-only Playwright pass over a built sandbox with a screenshot per stop, recorded under `docs/notebook/evidence/wave8-8a-<sha>/` |
| **Contrast in context** -- the real colour behind a text run (an image, a gradient, a parent's background) | the CSS rail measures declared pairs; it cannot know what is painted behind an element | the declared pairs are measured against every surface a rule can sit on (worst case), picture overlays against black AND white (`CONTEXTS` in `contrastAudit.js`); axe's `color-contrast` runs in the real browser during the browser check |
| **Target size** (2.5.8) | no boxes | `tapFloor.test.js` checks the declarations; `tools/mobile_audit.py` measures rendered targets at 390 / 820 px |
| **Reflow** (1.4.10) | no viewport | `tools/mobile_audit.py` flags horizontal overflow per route at phone width |
| **What a screen reader says** | no speech engine | the owner's script, `docs/notebook/screen-reader-pass.md` (NVDA, VoiceOver) |
| **Real devices** (a touch grip tap, the Mac-only chords) | no device | the same script's appendices A and B |

## Known gaps (2026-09-26)

- **Three contrast rulings are open** (`a11y/contrastExpectedFailures.js`, 138 pair-theme
  rows): **D-A4-1** `--loss` as small text in dark/oled (3.63-4.30:1); **D-A4-2** `--gain`
  on its tint in light (4.42:1); **D-A4-3** input edges drawn in `--border` (1.18:1 dark,
  WCAG 1.4.11). Each needs a `tokens.css` decision; no Notebook-CSS token switch fixes
  them in all three themes.
- **Two focus rings in lane 8C's files** use the translucent `--focus-ring` (1.72:1 on the
  light theme): `NoteExportControls` `.item:focus-visible` and `ExportDialog`
  `.option:focus-within`. The fix is `box-shadow: 0 0 0 2px var(--ut-gold)`.
- **The graph canvas draws its nodes, edges and hub labels in fixed colours** chosen for a
  dark canvas (`NoteGraphView.jsx` draw()). The selection ring follows the theme and is
  measured; the rest is measured nowhere, and on the light theme the hub labels are
  near-invisible. The list mode carries the same information and is fully accessible.
- **The first-run tour** (lane 8C) was a stub when this was written; it is covered by
  8C's own rail, not audited here.
- **The Support page's stylesheet** has four inputs whose focus ring is replaced only by
  an unchanged background (`app/src/pages/Support.module.css`); it is not Notebook CSS
  and is reported to the controller.
- **Nothing has been run on a real screen reader or a real device yet** -- the script is
  written, the runs are the owner's. Whether BrowserStack Live exposes VoiceOver is not
  verified.
- **The CI workflow has no local proof**; its first run is the proof, and it is advisory
  (`# promotion-gate: no`) until it has been seen red once and green once.
