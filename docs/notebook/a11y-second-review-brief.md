# Notebook accessibility — the brief for an independent second reviewer

Wave 9, lane 9B (item B8, ruling D-9B2), written 2026-09-26. **This brief contains no result.**
It is written for a reviewer who did **not** build wave 8 (lanes 8A–8D), so that the Notebook's
accessibility is judged by someone other than the people who made it. Phase 7 item 5 of the
plan (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`) is this review; standard #9's bar is
"WCAG 2.2 AA: axe in CI with zero violations on Notebook surfaces, a full screen-reader pass
(VoiceOver + NVDA), keyboard-complete (incl. graph)".

Who runs what:

| part | who |
|---|---|
| §3 keyboard-only walk, §2 WCAG map, §5 recording | **the second reviewer** (any machine, a sandbox; no production) |
| §4a NVDA pass (Windows) | **OWNER** |
| §4b VoiceOver pass (macOS Safari, iOS Safari; BrowserStack Live only if speech is actually audible) | **OWNER** |

Read first: `docs/notebook/accessibility.md` (what the rails cover, what jsdom cannot see, the
known gaps) and `docs/notebook/screen-reader-pass.md` (the owner's step-by-step screen-reader
script, with the expected announcement quoted from source). This brief does not repeat them; it
tells the reviewer where to push.

---

## 1. What exists today, read at the tip, with `file:line`

Every line below was read on `feat/notebook-w9`. If a line has moved, the quoted text is what to
look for, and a quote that no longer exists is itself a finding.

- **axe-core is exact-pinned** — `app/package.json`:79 `"axe-core": "4.13.0",` (wave-8 ruling
  D-A1: an exact pin, `axe.run` called directly).
- **The tag set is the 10/10 bar's** — `app/src/pages/journal-2-0/a11y/axeHarness.js`:42
  `WCAG_TAGS = Object.freeze(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])`. Best-practice
  rules do not run.
- **The exclusion list is frozen** (ruling D-A5) — `app/src/pages/journal-2-0/a11y/axeHarness.js`:18
  "THE EXCLUSION LIST IS FROZEN (ruling D-A5)"; the list itself at `:59-62`
  (`AXE_EXCLUSIONS`: `component` = `color-contrast` plus the `region` / `landmark-*` family at
  `:45-56`; `page` = `color-contrast` only). jsdom computes no layout, so contrast is measured by
  `app/src/pages/journal-2-0/a11y/notebookContrast.test.js` over the token values and in a real
  browser by the lane browser checks.
- **A known-bad fixture must still fail** — `app/src/pages/journal-2-0/a11y/axeHarness.contract.test.js`:112
  "(b) the known-bad fixture control: each defect MUST produce its violation id" (a nameless button,
  an image with no alt, nested interactive controls, an unlabelled input, an untitled iframe — at
  both levels), and `:138` "expectNoAxeViolations REJECTS on the known-bad fixture". A harness that
  stops reporting turns this red.
- **Every surface is in a manifest** — `app/src/pages/journal-2-0/a11y/notebookSurfaces.js`:18
  `export const SURFACES` (each component a recipe, a covering recipe, another lane's rail, or exempt
  with a reason), held complete by `app/src/pages/journal-2-0/a11y/surfaceCoverage.test.js`.
- **CI** — `.github/workflows/notebook-a11y.yml`:1 "promotion-gate: no — ADVISORY until it has been
  SEEN RED ONCE AND SEEN GREEN ONCE in CI" (ruling D-A2); it runs
  `npx vitest run src/pages/journal-2-0/a11y/` (`:53`). **No CI run URL is recorded yet**, so "axe in
  CI" is not yet evidenced (`docs/notebook/parity-scorecard.md` §B, standard 9).
- **Browser evidence so far** — wave 8's keyboard-only Playwright walk,
  `docs/notebook/evidence/wave8-8a-cfdab8170/run2/summary.json` (164 steps, none failed), and lane
  9B's whole-page axe run in a real browser on the editor and the list only
  (`docs/notebook/evidence/wave9-9b-8a0098029/browser-check.json`, check `B19_axe_editor_and_list`:
  0 violations, no rule excluded). **Neither is independent of the build; that is why this review
  exists.**
- **The rails ran green on this tip** — `docs/notebook/evidence/wave9-9b-8a0098029/rails-vitest-a11y.log`
  ("Test Files 16 passed (16)"). A green rail says the rail's assertions hold, not that a person can
  use the page.

**Known gaps you should expect to reproduce, not rediscover** (`docs/notebook/accessibility.md`:51
onward): three open contrast rulings D-A4-1 (`--loss` as small text in dark/oled), D-A4-2
(`--gain` on its tint in light), D-A4-3 (input edges in `--border`, WCAG 1.4.11); the graph
canvas's fixed colours (hub labels near-invisible in light; the list mode carries the same
information); Tab inside a table moves cell to cell and adds a row at the last cell; deleting a
note opened from All notes lands on Research home; the Support page's focus indication on four
inputs. Record each one you confirm with the known-gap id, and anything else as new.

## 2. WCAG 2.2 AA mapped to Notebook surfaces

Surfaces: **L** the list (`/journal/notebook?view=all`: list, table, board, calendar, graph,
timeline and tasks modes, the bulk bar); **S** the sidebar (folders, tags, saved views, search
tab); **E** the editor (title, toolbar, body, slash / emoji / `[[` / date menus, find and replace,
outline, table toolbar, image bar, block handle, properties); **H** the sheets and dialogs (Share,
Publish, Save view, Templates, Export, Version history, Document preview, Writing help, Ask,
Delete / Restore confirmations, the command palette, the first-run tour); **P** the public pages a
stranger reads (share link, published page).

| SC | what to test | where it bites first |
|---|---|---|
| 1.1.1 Non-text content | every icon-only button has a name; images carry alt or are decorative; the graph canvas has a text alternative | L (graph), E (toolbar, image bar), H |
| 1.3.1 Info and relationships | headings nest; tables in notes have header cells; lists are lists; each form field is programmatically labelled | E (tables, properties), L (table mode), H |
| 1.3.2 Meaningful sequence | reading order in split view and in the two-column editor layout | E (columns), L |
| 1.3.4 Orientation | phone portrait and landscape | all at 390 px |
| 1.3.5 Identify input purpose | sign-in and any personal-data field | P, sign-in |
| 1.4.1 Use of colour | tag colours, board columns, text colour, highlight, callout styles never carry meaning alone | L, E |
| 1.4.3 Contrast (minimum) | the D-A4 rulings; text over images; the three themes | all |
| 1.4.4 Resize text | 200% zoom, nothing clipped | E toolbar, H |
| 1.4.10 Reflow | 320 CSS px, no two-dimensional scrolling except tables | all |
| 1.4.11 Non-text contrast | input edges (D-A4-3), focus rings, the block grip, toggle states | E, S |
| 1.4.12 Text spacing | the user-stylesheet test; nothing overlaps | E, H |
| 1.4.13 Content on hover or focus | link previews, tooltips, the image bar: dismissible, hoverable, persistent | E |
| 2.1.1 Keyboard | every action has a key path: the graph (arrows, Home/End, Enter), board moves (the per-card `<select>`), drag handles (the keys `lib/blockHandle.js` names), split view, folder panel resize | L, E, S |
| 2.1.2 No keyboard trap | tables (Tab adds rows — find the way out), the editor, sheets, the Ask panel | E, H |
| 2.1.4 Character key shortcuts | `/`, `:`, `[[`, `@` fire only inside the editor | E |
| 2.4.1 Bypass blocks | the skip link (`app/src/pages/journal-2-0/tabs/NotebookTab.jsx`:1471 "Skip to notes list") | L |
| 2.4.2 Page titled | the tab title changes per note / view | L, E, P |
| 2.4.3 Focus order | sheet open and close return focus to the opener; delete lands somewhere sensible | H, E |
| 2.4.6 Headings and labels | label text matches the visible label | all |
| 2.4.7 Focus visible | every focusable control in all three themes | all |
| 2.4.11 Focus not obscured (minimum) — new in 2.2 | the sticky toolbar, bottom sheets on touch, the Compass tip | E, H |
| 2.5.1 Pointer gestures / 2.5.2 Pointer cancellation | pinch, swipe and long-press have single-pointer alternatives | touch |
| 2.5.3 Label in name | the accessible name starts with the visible text | all |
| 2.5.7 Dragging movements — new in 2.2 | board drag, block drag, image resize, panel resize each have a single-pointer non-drag path | L, E, S |
| 2.5.8 Target size (minimum) — new in 2.2 | 24 x 24 CSS px or the spacing exception | S (disclosures), E toolbar |
| 3.2.1 On focus / 3.2.2 On input | no navigation on focus; selects do not navigate on change | L, S |
| 3.2.6 Consistent help — new in 2.2 | the help entry sits in the same place on every page | all |
| 3.3.1 Error identification / 3.3.3 Error suggestion | a failed save, a refused upload, a share mint failure name the problem in text | E, H |
| 3.3.2 Labels or instructions | search filters, property forms, the date filter | S, E |
| 3.3.7 Redundant entry — new in 2.2 | a multi-step flow does not ask twice (share, publish, import) | H |
| 3.3.8 Accessible authentication (minimum) — new in 2.2 | sign-in does not require a cognitive test; paste allowed | sign-in |
| 4.1.2 Name, role, value | toggles report pressed; disclosures report expanded; tabs report selected | all |
| 4.1.3 Status messages | save status, toasts, the offline banner, Ask's answer, search result counts are announced without moving focus | E, S, H |

## 3. The keyboard-only walk (the second reviewer)

Set up a sandbox exactly as `docs/notebook/screen-reader-pass.md` "Preconditions" says (a
census-pinned `scripts/hub_sandbox_boot.py` boot, `app/dist` rebuilt from the tip under review, a
paid synthetic account; never production, never `C:\data`). Put the mouse away. For each step
write what happened, not what should have.

1. **List.** Tab from the address bar: the skip link must be first. Walk the sidebar (folders,
   a nested folder, tags, a nested tag, saved views, Trash, Archived). Switch every view mode;
   in the board, move a card with its `<select>`; in the table, reach a row's note; in the
   calendar and timeline, reach a note. Select two notes with the keyboard and open the bulk
   Export panel; close it with Escape and check where focus lands.
2. **Editor.** Open a note from the list with Enter. Reach every toolbar control. In the body:
   the slash menu, the emoji menu (`:`), a `[[` link, an `@` date, find and replace
   (Ctrl+F / Ctrl+H), the outline, text colour, a table (create, add a row and a column, leave
   the table — note the documented Tab behaviour), an image (select it, align it, add a caption),
   move a block with the keys, a property (add, set, a relation), the Ask panel open and closed,
   Writing help open and closed, History open and closed, Lock and Unlock, Archive, Open beside.
3. **Graph.** Graph view: reach the canvas; Home, End, the arrows, Enter to open; then
   "Show as list" and back. Check that a key press does not reset the layout.
4. **Sheets and dialogs.** Share (create a link, copy it, revoke), Publish, Save view, Templates,
   the note Export menu, the Delete confirmation, the Restore-version confirmation, the command
   palette (Ctrl+K), the first-run tour (a fresh account). For each: focus goes in on open, stays
   in while open, Escape closes, focus returns to the opener.
5. **Public pages.** Open a share link and a published page signed out; walk them by keyboard.
6. **Touch tier.** Repeat 1–2 at 390 px with touch emulation for 2.5.7 and 2.5.8, then at
   820 px; zoom to 200% and to 320 CSS px wide (1.4.4, 1.4.10).

## 4. The screen-reader passes (OWNER)

### 4a. NVDA on Windows — OWNER

NVDA is not installed on this box (recorded in `docs/notebook/screen-reader-pass.md`
"Preconditions"). Install the current stable release and write its version at the top of the
results. Run `docs/notebook/screen-reader-pass.md` steps 1–27 in Chrome **and** Firefox, browse mode
unless a step says focus mode. Then add, for the second review:

- the public share page and the published page, signed out (heading structure, the page title,
  whether the body reads in order);
- the Ask answer while typing continues (4.1.3: announced politely, focus not moved);
- the offline banner ("Viewing an earlier saved copy") appearing without a reload;
- the version-history list and its restore confirmation;
- the Trash: a trashed card's Restore button and what is announced after restoring.

### 4b. VoiceOver on macOS Safari and iOS Safari — OWNER

Run the same 27 steps with VoiceOver (Cmd+F5) in Safari on macOS, then the touch steps on an
iPhone in Safari (rotor, swipe navigation, double-tap to activate), plus the additions in 4a.
Appendix A of the screen-reader script covers the Mac-only chords, Appendix B the touch grip.
**BrowserStack Live:** whether VoiceOver speech reaches the operator through a Live mirror is
not verified (screen-reader script, "Preconditions"); record "not verifiable on Live" rather than
a result you did not hear. Sign a device in with `python tools/smoke_login_link.py` only, never a
typed password on a mirrored phone.

## 5. How to record findings

Write results under `docs/notebook/evidence/a11y-second-review-<YYYY-MM-DD>/` and commit the raw
notes, screenshots and any recordings **before** writing a summary (the R-RAW rule). One findings
table, one row per finding:

| id | WCAG SC | surface | steps (keys) | expected | heard / seen | severity | known gap? | evidence |
|---|---|---|---|---|---|---|---|---|
| A2R-01 | e.g. 2.1.2 | e.g. E, a table | exact keys from a known start | what the SC requires | verbatim | blocker / major / minor | D-A4-n or "new" | file under the evidence dir |

- **Severity:** *blocker* = a task cannot be completed by keyboard or screen reader; *major* = it
  can, with a workaround a member would not find; *minor* = everything else.
- **Versions** at the top: browser, OS, NVDA or VoiceOver, the tip SHA, the sandbox URL.
- **A PASS row is recorded too**, per walk step, so the pass is a census and not a list of
  complaints; "not run" is written as NOT RUN with the reason, never left blank.
- **Nothing is fixed during the review.** Findings go to the controller, who files each one
  against a ledger row (G-168 for accessibility) or opens a new row; the reviewer does not edit
  product code, the gap ledger or this brief's §1 facts.
