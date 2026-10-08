# Wave 14, lane W14-keys: the onboarding flows on a keyboard

Branch `feat/notebook-w14-keys`, from `9004bd8dac`. Input: `docs/notebook/wave14-w14-q1.md` section 3,
which measured every onboarding flow inside its click budget with a mouse and with taps and OVER it on
keys, and named the cause as app chrome order. Patterns reused: 13Q-3's skip links into key regions
(`wave13-13q3.md`) and 13Q-4's one-Tab-stop roving group (`wave13-13q4.md`, its Journal half; the NavBar
half is HELD for the owner and is **not touched here**).

| commit | what |
|---|---|
| `0374c72347` | the keyboard doors (product + tests first) |
| `509d01bdb4` | the clicks tool taught the doors; raw clicks evidence (R-RAW) |
| `a887ddf07a` | raw onboarding walk evidence (axe, reach, overflow, tap floor) |
| (this commit) | this record |

## 1. What changed (every item is wave-14-switch gated, `checklistEnabled`, and pointer-invisible)

| door | where | why it is the right door |
|---|---|---|
| Closing the AUTO-started base tour lands focus on the first-run heading (`tabIndex -1`, `data-first-run-heading`) | `NotebookTour.jsx` focus-return effect, `ResearchHome.jsx` heading, helper in `onboarding/keyboardDoors.jsx` | An auto-started modal had nothing to hand focus back to (it remembered `<body>`), so Escape dropped a keyboard member at the top of the document. WAI-ARIA dialog guidance: with no invoker, return focus to the logical next place. Only fires after a tour that was open closes, and only while focus is still on `<body>`; a tour opened from a control still returns to that control. Switch off: the wave-8 behaviour exactly. |
| "Skip to getting started" | rendered by `NotebookTab.jsx` in its skip-link portal, before "Skip to notes list"; lands on the checklist heading (fixed id `notebook-getting-started`) | Exists only while the checklist card is on screen: the lazy list announces itself to a tiny presence store (`useMarkGettingStartedShowing`), so the visibility rule keeps ONE authority. Same `.skipLink` class as the Notebook's own link (hidden and pointer-transparent until focused). |
| The checklist's steps are one Tab stop | `GettingStartedList.jsx`: a `role="toolbar" aria-orientation="vertical"` wrapper around the `<ol>`, `useRovingTabIndex` | Hide stays its own stop (header order). The toolbar role is what the held NavBar change lacked: a screen reader announces the composite and that Arrow keys move in it. |
| The offer's two answers are one Tab stop; "Not now" declares `aria-keyshortcuts="Escape"` | `TourOfferPrompt.jsx` (`.actions` gets `role="toolbar"`, labelled by the card title) | Escape-is-Not-now already existed (W14-C2) but was undiscoverable; it is now declared. The offer still never takes focus on arrival (R4, railed). |
| Help: "Skip to Walkthroughs", a focusable Walkthroughs heading (`role="heading" aria-level=2`, `tabIndex -1`, id `walkthroughs`), and `/support#walkthroughs` focusing it on arrival | `Support.jsx` `WalkthroughsSection`, `.skipLink` in `Support.module.css` | The heading's next Tab stop is the first Replay (Notebook basics). Visual unchanged: the heading is the same div and class, semantics only. |
| Palette command "Help: Walkthroughs" -> `/support#walkthroughs` | `CommandPalette.jsx` `NOTEBOOK_COMMANDS` | Ctrl+K is the repo's established, documented keyboard door (wave 13's Q1/Q3/Q4 keys budgets were met through it). Gated by `when` (the switch) and matched ONLY by a >= 5-char prefix of "walkthroughs": command rows LEAD the palette, so the generic `.includes()` rule would have let "ro", "th", "to", "tour" steal Enter from a ticker (railed for each). |
| `useRovingTabIndex`: a moved stop whose item left the group falls back to the default | `hooks/useRovingTabIndex.js` | A checklist step that is done renders as text; before this the group could keep a stop naming a vanished item and drop out of the Tab order entirely. |

Not used: HTML `accesskey` (the repo has none, so none was added). No new global chord.
Not changed: NavBar, its tab model, any visual order, the first-run action row (pre-wave-14).

## 2. Before and after (keys = keystrokes + real Tabs; `tools/notebook_w14q_clicks.py`, real Chromium)

Before = W14-Q1's committed run (`docs/notebook/evidence/wave14-q1/clicks/`, tree `2583c23ee1`).
After = `docs/notebook/evidence/wave14-keys/clicks/clicks.json` (tree `0374c72347` + the tool edits
committed in `509d01bdb4`). Mouse and taps rows are unchanged and all PASS in both runs.

| flow | budget keys | before 1200 | before 390 | after 1200 | after 390 | after path |
|---|---|---|---|---|---|---|
| O1 new member to first note | 3 | 6 OVER | 6 OVER | **3 PASS** | **3 PASS** | Esc, Tab, Enter |
| O2 open the sample notebook | 3 | 10 OVER | 10 OVER | 7 OVER | 7 OVER | Esc, 5 Tabs, Enter |
| O3 dismiss the checklist | 2 | 11 OVER | 11 OVER | 5 OVER | 5 OVER | Tab, Tab (Skip to getting started), Enter, Tab (Hide), Enter |
| O4 replay a walkthrough from Help | 4 | 57 OVER | 36 OVER | **4 PASS** | **4 PASS** | Ctrl+K, "walkthroughs", Enter, Tab (Replay), Enter |
| O4N same, through the nav (new row) | 4 | (57 / 36 above) | | 32 OVER | 30 OVER | 26 / 23 to Support, then Tab, Tab, Enter (Skip to Walkthroughs), Tab, Enter |
| O5 accept an offer | 2 | INCONCLUSIVE | INCONCLUSIVE | 4 OVER | 4 OVER | Tab, Enter (Skip to main content), Tab, Enter |
| O6 decline an offer | 2 | 5 OVER | 5 OVER | 4 OVER | 4 OVER | Tab, Enter, Tab, Escape |

O5 is now measured: a tour opens (W14-C1 `526b8a43fc` fixed Q1 finding 4.1 upstream of this lane);
mouse and taps PASS at 1/1.

## 3. What still misses, by how much, and whether the NavBar decision would change it

The floor for any in-page action from a fresh load is **Tab to "Skip to main content", Enter, Tab,
key = 4** (the shell's skip link is the first Tab stop; nothing lands focus on load, and the offer
must never take it). A budget of 2 is therefore reachable only by a global chord; the repo's chords
(Ctrl+K, Ctrl+Alt+D/B) are for actions and jumps, and a chord whose only job is "hide the checklist"
or "decline the offer" is not a door worth adding.

| flow | after | over by | blocked by the held NavBar decision? |
|---|---|---|---|
| O2 | 7 / 3 | **4** | No. The cost is the first-run row (Start a note, Create a thesis, Import notes, Today) before the sample button; the tour-close landing serves O1 and can serve only one of O1/O2. A one-stop toolbar over that pre-wave-14 row would make it 5 (still +2) and was not done. |
| O3 | 5 / 2 | **3** | No. Floor 4 (the skip link cannot land on Hide: Hide is irreversible). |
| O5 | 4 / 2 | **2** | No. At the floor. |
| O6 | 4 / 2 | **2** | No. At the floor. |
| O4N (nav path only; O4 itself PASSES via the palette) | 32 / 30 | 28 / 26 | **Partly.** Support is the last NavBar entry; 26 (1200) / 23 (390, menu sheet) of the keys are the nav walk. With a one-stop NavBar (13Q-4's held proposal, End reaches Support) the 1200 path is estimated at ~14 (still over by ~10); the 390 path goes through the MoreSheet, which that proposal does not change. Neither path meets 4 with it. |

So **no budget depends on the held NavBar decision**: O1 and O4 now meet theirs without it, and the
four that still miss would still miss with it.

## 4. Real-browser walk and axe

`tools/notebook_w14_onboarding_walk.py` on this tree (`evidence/wave14-keys/walk/walk.json`), its
keyboard-reach check taught to walk a roving toolbar with its declared Arrow key: **128 checks, 122
PASS, 6 FAIL**. axe 4.13.0 (wcag2a/aa, 21aa, 22aa, best-practice): **12 scans, 0 violations** at 1200,
820 and 390. Keyboard reach: 12/12 PASS. Gates-off control: first-run screen is the pre-wave-14 shape
at all widths. The 6 FAILs are one instrument staleness, not this lane: S4's list checks expect
`1 + 2` Walkthroughs and `2` What's-new rows, but since W14-C1 the Task reminders tour (a kill switch
that reads ON when unset) is a third armed tour. `C:\data` CLEAN at every checkpoint of all three
sandboxes (`evidence/wave14-keys/integrity/`).

## 5. Tests

New, written before the code (red first): `a11y/onboardingKeys.test.jsx` (checklist toolbar, skip
link, gating, offer toolbar, Escape, never-takes-focus, two axe scans), `onboarding/NotebookTour.keys.test.jsx`,
`pages/Support.keys.test.jsx` (incl. axe), `components/CommandPalette.walkthroughs.test.jsx`, cases in
`Layout.skipLink.test.jsx` (real Layout + NotebookTab Tab order), `ResearchHome.welcome.test.jsx`,
`useRovingTabIndex.test.jsx`, and Help's `.skipLink` in `a11y/skipLinkUntappable.test.js`. Two existing
keyboard tests (checklist, offer gate) were updated from "Tab reaches every control" to "Tab reaches
the group, Arrow keys walk it" -- the intended behaviour change.

Mutation-proved (bytes captured, restored, sha verified): drop the tour-close fallback -> 2 red; drop
the palette `match` guard -> 5 red; revert the roving stale-key fix -> 1 red.

Scoped suite and byte gate: section 6.

## 6. Gates

Scoped suite, `npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=3` from `app/`,
tree `a887ddf07a` (product identical to `0374c72347`), verbatim totals:

```
 Test Files  1 failed | 639 passed (640)
      Tests  1 failed | 8112 passed | 1 skipped (8114)
   Duration  667.99s
EXIT: 1
```

The one failure, read by name: `lib/iteratorGlobalFloor.test.js > every built asset is clear`,
`Test timed out in 15000ms` -- the load-sensitive scan of `app/dist` that W14-Q1 section 6 and W14-0
section 5 already record (it walks every built chunk). Alone (`--maxWorkers=1`): `Tests 9 passed (9)`,
exit 0. No failure is in a file this lane touches.

Byte gate (`npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`), verbatim:

```
bytes.notebook_first_open: 2,256,221 B across 67 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

(The integration record read 2,254,865 B across 66 chunks on its own tree; the extra chunk is
`keyboardDoors.jsx`, shared by the eager NotebookTab and the lazy checklist.)
`python tools/check_repo_hygiene.py`: clean.

## 7. How to re-run

```
python tools/notebook_w14q_clicks.py --data-dir '<scratch>\w14keys-clicks' --port 8720 `
    --out docs\notebook\evidence\wave14-keys\clicks
python tools/notebook_w14_onboarding_walk.py --data-root '<scratch>\w14keys-walk' --port 8715 `
    --out docs\notebook\evidence\wave14-keys\walk
```

From PowerShell, `app/dist` rebuilt from the tree under test, empty data dirs, free ports.
