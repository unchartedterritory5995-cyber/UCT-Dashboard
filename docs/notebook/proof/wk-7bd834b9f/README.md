# Notebook wave 10 — the proof instruments' evidence (lane WK)

Raw records are committed BEFORE this interpretation (R-RAW, commit `0c405e5fb`). Every
number below cites the raw file it was read from. This lane re-ran `tools/notebook_proof_walk.py`
(unchanged from 10E-1/F5/F7 — no instrument-shape edit shipped with this evidence) against the
**landed tree**, closing the "re-run on the merged tree" gap every prior scorecard row for these
five clauses called OPEN.

## What ran, on what

| | |
|---|---|
| tip measured | `7bd834b9f` (origin/master at dispatch: wave 10 L4 — L2+L3+D3P+D5+R1/R1b+SK) |
| sandbox | `C:\data-w10wk2`, port 8238, booted via `scripts/hub_sandbox_boot.py` through `tools/notebook_perf_harness.Sandbox` |
| sweeps run | census, geometry, axe, silent, deadclick — all five, one run |
| self-check | `python tools/notebook_proof_walk.py --self-check` → **12/12 rows ok, exit 0**, before any browser run |
| record | `docs/notebook/proof/wk-7bd834b9f/{run.json,census.json,geometry.json,axe.json,silent.json,deadclick.json,integrity.md}` |
| sandbox integrity | **CLEAN** at every checkpoint (`run.json:"first_line"`) — pre-boot / post-boot(+15s) / post-prewarm(+120s) / shutdown, 62 db files hashed each time, `C:\data` untouched throughout |

⚠️ **`--tip` was passed as the full 40-char sha** (`7bd834b9f106c45eb6d1dfceb8d6cbc6190c2187`);
`run.json:"tip"` carries that literal, and this README's directory name is the 9-char short form
used consistently elsewhere in this program.

⚠️ **A prior invocation of this same run was invalid and is not part of this evidence.** The
first attempt (PowerShell, relative script path) resolved `tools/notebook_proof_walk.py`'s own
`REPO` against a stuck OS-level working directory (`[Environment]::CurrentDirectory`, which does
not track PowerShell's `$PWD` after `Set-Location` in this harness) and silently measured
`C:\Users\Patrick\uct-worktrees\notebook-l2` instead of this worktree. Caught before any browser
opened (the sandbox-identity line named the wrong repo path); the misdirected run's two partial
files (`census.json`, `run.json`, ~90s of data) were deleted from `notebook-l2`, never committed,
and the corrected run — absolute script path, absolute `--out-dir`/`--artifacts` — is the one
below. Recorded so nobody re-derives "PowerShell + relative paths is safe here."

## Load sampled (shared box; other sessions were active throughout)

| | CPU avg | chrome | chrome-native-host | node | python | total matched |
|---|---|---|---|---|---|---|
| start (before build) | 11% | 15 | 1 | 4 | 3 | 23 |
| end (after teardown) | 18% | 15 | 1 | 2 | 4 | 22 |

No orphan process from this lane's sandboxes (ports 8237–8240, data dirs `C:\data-w10wk*`)
survived teardown — checked by command-line pattern immediately after the run finished; none
found. The chrome/chrome-native-host counts are stable across both samples (another session's
long-lived browser, not this run's Playwright instance, which closes with the sweep).

## Clause by clause

### 9a — zero accessibility violations on Notebook surfaces

**Reading: axe control VALID; 90 of 123 runs MEASURED, 0 violations on all 90; 33 UNREACHED.**
`docs/notebook/proof/wk-7bd834b9f/axe.json`: axe-core 4.13.0 (the repo's pin), tags `wcag2a`,
`wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, 43 surfaces × 3 themes = up to 129 possible runs;
123 were attempted. Control VALID in every theme (planted low-contrast text + planted nameless
button both reported every time).

**Comparison with F5 (`aa2417c2c`, 123 of 123 MEASURED, 0 violations):** this run's *violation*
count matches F5's — nobody who was scanned found anything — but **coverage regressed from full
reachability to 90/123 MEASURED**, and — the more important finding below — at least two of
those 90 "PASS" surfaces almost certainly scanned a near-empty root, not the content F5 scanned.

**Findings, named:**
- **10 editor-popup surfaces read UNREACHED** (root:`None`, all 3 themes each = 30 runs):
  `ed-slash`, `ed-color`, `ed-table`, `ed-emoji`, `ed-note-link`, `ed-link-paste`, `ed-history`,
  `ed-export`, `ed-delete`, `doc-preview`. `nb-bulk` UNREACHED too (root:`None`, 1 run recorded).
  Total UNREACHED = 33.
- **`nb-note` and `nb-note-first-run` read MEASURED / PASS (0 violations), and that PASS is very
  likely hollow.** Both scoped to `root: '[data-proof-root="notebook"]'`. An independent,
  targeted diagnostic (below, under 2c — same `mark_root()` call, same navigation
  `/journal/notebook?note={id}`, run twice on a fresh boot of this exact tree) proved that when a
  note is open, `[data-proof-root="notebook"]` **does not contain `.ProseMirror`** — the editor
  body and its toolbar popups sit outside the marked root entirely. axe-core scans only inside the
  element it is handed; a root that excludes the editor cannot find a violation IN the editor
  because it never looked there. This is not inferred from `axe.json` alone (which records no
  node/pass count) — it is established by the separate DOM-relationship check described under 2c,
  using the identical root-selection code path.

**What this reading does NOT prove:** it does NOT prove the editor body, its toolbar, or any of
the 10 popups that failed to open are free of axe violations — none of them were meaningfully
scanned. It DOES prove every surface axe actually reached (list-type pages, the settings/support
pages, the templates/saved-view/publish-folder popups, and F5's three named panels re-confirmed:
`ed-writing-help`/`ed-outline`/`ed-color`… wait `ed-color` itself is one of the UNREACHED ones
this run — see the fix-direction note below) carried zero violations. It does NOT re-verify F5's
three previously-CONFIRMED accessible names (WritingHelpPanel/NoteOutline/TextColorMenu) on this
tree, because two of those three popups (`ed-color`, and `ed-outline`'s companion `ed-slash`) are
among the UNREACHED set this run.

**Fix direction (instrument, not product — out of this lane's fix scope):** `MARK_ROOT_JS`
(`tools/notebook_proof_walk.py:554`) marks `document.querySelector('a[href="#notebook-pane"]').parentElement`.
F4 (wave-10 keyboard-completeness fix, landed before this tip) portaled the skip link into "the
shell's skip-link slot" via `<SkipLinkPortal>` (`NotebookTab.jsx:1536`) so it is the *second* Tab
stop app-wide — a genuine, deliberate accessibility improvement. That portal decoupled the skip
link's DOM *position* from its semantic *target*: the link's parent is now a generic shell slot
(a bare `<span>`), not the notebook pane. The correct root is the skip link's **target**
(`document.getElementById(skip.getAttribute('href').slice(1))`, i.e. `#notebook-pane` itself),
which does contain `.ProseMirror` (confirmed: its ancestor chain is
`DIV#notebook-pane._main_nzwvp_159 _mainNote_nzwvp_179 → ... → .ProseMirror`). This is a walk-tool
defect, not a product defect — the product's own skip link and landmark are correct. Re-running
the axe sweep after that one-line fix is owed before citing "0 violations" for `nb-note` or any
editor popup as meaningful.

### 2c — no dead clicks

**Reading: INVALID.** `plant-dead: got 'LIVE', must be 'DEAD'`
(`docs/notebook/proof/wk-7bd834b9f/deadclick.json:"controls"`). Per the instrument's own rule,
an instrument whose control did not fail is not evidence — the 71 LIVE / 0 DEAD found across 39
surface×mode records (`nb-list`→`ed-writing-help`, `settings-cards`, etc.) is **not a finding of
"no dead clicks"**; it is exactly the shape a LIVE-inflating control failure would produce whether
or not a real dead click exists among them.

**Root cause, precisely (new, not in F7's fix):** the planted DEAD control's DOM-mutation sample
shows `childList::DIV._orbCluster_15gv2_303` and `attributes:class:DIV._orbCluster_15gv2_303` —
the voice orb cluster (`GlobalVoiceLayer`, app-chrome) mutated its own class/children *inside the
click's observation window*, and `judge_click`'s idle-noise learning did not catch it before
counting it as the click's effect. F7 already fixed the parallel bug for background *network
requests* (a poll's request is excluded via `background_requests`/`bgReqs`); no equivalent
exclusion exists yet for a background element's own DOM churn. Same class of bug (`the page's own
timer sent it`), different channel (DOM mutation vs. network request).

**Comparison with prior runs:** 10E-1 never reached this sweep (stopped by its own time-box).
F7 fixed the network-poll half of this instrument but its own browser run for `--sweeps
deadclick` was refused by the permission layer, so it never got a reading either. **This is the
first deadclick reading this program has ever produced, and it reads INVALID** — an advance from
"never measured" to "measured, and the measurement names a new instrument gap," not a pass.

**Findings that cannot be trusted (informational only, per-surface, not evidence):** 71/71
non-planted controls sampled read LIVE, 0 DEAD, across `capture-dialog`, `doc-preview`, `ed-ask`,
`ed-color`, `ed-delete`, `ed-emoji`, `ed-export`, `ed-find`, `ed-history`, `ed-link-paste`,
`ed-note-link`, `ed-outline`, `ed-palette`, `ed-property`, `ed-share`, `ed-slash`, `ed-table`,
`ed-writing-help`, `nb-board`, `nb-bulk`, `nb-calendar`, `nb-first-run-clicks`, `nb-graph`,
`nb-home`, `nb-import`, `nb-list`, `nb-note`, `nb-publish-folder`, `nb-research`, `nb-saved-view`,
`nb-search`, `nb-table`, `nb-tasks`, `nb-templates`, `nb-timeline`, `nb-trash`, `settings-cards`
(15 SKIPPED, 5 DISABLED, 3 OCCLUDED also recorded, not LIVE/DEAD).

**What this reading does NOT prove:** it does not prove the product has no dead clicks, and it
does not prove it has any either — the instrument cannot currently distinguish "the control did
something" from "the orb animated nearby while the control was clicked." Owed: extend the
idle-noise/background exclusion to DOM mutations from elements outside the clicked control (the
same idiom F7 used for requests), then re-run.

### 5d — no silent failures

**Reading: VALID, and every read and write says something.** `docs/notebook/proof/wk-7bd834b9f/silent.json`:
control VALID (planted swallowed 500/offline → SILENT; planted honest 500/offline → SENTENCE, in
both kinds). **71 reads: 70 SENTENCE, 1 UNREACHED (not SILENT). 21 writes: 12 SENTENCE, 4 EXEMPT,
5 UNREACHED (not SILENT).** Zero SILENT anywhere.

**Comparison with F7's list (28 unique endpoints, `loadFailedConsumers.test.js`):** this run
covers a **superset** — 35 unique read endpoints and 7 unique write endpoints (F7's 28 plus
`/api/j2/accounts/{id}/settings`, `/api/j2/capture/connections`, `/api/j2/note-templates`,
`/api/j2/notebook/home`, `/api/j2/notes/graph`, `/api/j2/notes/tasks`, `/api/j2/shared/{id}`,
`/api/j2/notes/daily` — wave 10 features F7's census predates). Every one of F7's 28 read SENTENCE
or EXEMPT here too; none regressed to SILENT.

**The exempt case, confirmed as designed:** `/api/j2/accounts/comparison` read **SENTENCE** in
this run (not EXEMPT) — correct, per `SILENT_EXEMPT`'s own reasoning: the exemption applies only
to the "All Accounts" state with no comparison value to show; this probe ran with one account
selected, where the balance pill fails visibly. `/api/j2/notes/{id}/opened` (the recents touch)
read **EXEMPT** on both forced-failure kinds, as declared.

**UNREACHED, named (instrument coverage gaps, not silent-failure findings):**
- read: `ed-history`'s "Version history" button — `TimeoutError: Locator.click … waiting for
  get_by_role("button", name="Version history")`.
- writes: `save-body` (`TimeoutError … waiting for locator("[data-proof-root=\"notebook\"] .ProseMirror")`
  — the same root-scoping defect named under 2c/9a), `lock`, `archive`, `save-template`,
  `trash-note` (each a `TimeoutError` waiting for its own menu button — `Lock`, `Archive`, `Save
  as template`, `Delete`). These sit in the editor's "More note actions" overflow menu; whether
  their own timeout traces back to the same `[data-proof-root]` scoping issue or a separate cause
  was not established for all five — `save-body`'s is confirmed, the other four are consistent
  with it but not independently traced.

**What this reading does NOT prove:** it does not cover the 5 write doors and 1 read door that
timed out (above) — those are open, not passing. It does not re-verify silence for any endpoint
outside this run's 35+7; a new endpoint added after this tip carries no reading until named and
walked.

### 6c — no layout regressions at 390/820/1200

**Reading: geometry control VALID; full coverage (129/129 surface×width cells); 1,618 raw
findings, and after triage none of them is a new Notebook-owned defect.**
`docs/notebook/proof/wk-7bd834b9f/geometry.json`: control VALID (planted 1400px element, planted
20px target, planted covered control each found at every applicable width). 43 surfaces × 3
widths = 129 cells, all measured (no UNREACHED cell). Findings by kind: 1,433 occluded, 145 tap
(sub-44px at ≤1024), 40 overflow.

**Comparison with 10E-1 (`fd7d1f42d`) + F5 (`aa2417c2c`):** 10E-1 found (a) the voice first-run
hint covering the editor's toolbar/tag control, (b) the tour card over "Meet Compass," (c) 11
Notebook surfaces with `main` wider than the viewport at 390px, (d) the skip link intercepting
Today/Trades taps at 390px. F5 closed every one of those CONFIRMED findings and F4 moved the skip
link off the tab strip. **This run confirms both closures held on the landed tree**: the
"main wider than viewport" defect is gone (1 residual overflow only, on `support`, see below, not
one of the 11 originally named), and no finding this run traces to the OLD skip-link-on-tab-strip
shape. 10E-1's own instrument could not reach the editor's own toolbar controls at all this time
(0 controls sampled on `nb-note`, all 3 widths — the same root-scoping gap named under 9a/2c), so
this run cannot confirm or deny whether the *editor toolbar* geometry F5 fixed still holds; it can
only confirm the chrome-level fixes.

**Triaged findings, named by surface / element / width:**

- **Genuine, small, Notebook-owned overflow — `support` @390: `main` 406px vs 390px viewport
  (16px), widened by its own `div._header_7lcni_7 "Support"`.** The only non-orb overflow finding
  in the whole run. Not fixed in this lane (Support is not a journal-2-0 surface; flagged for its
  own owner).
- **1,433 occlusion findings, and every single one not exempted by an open modal traces to
  APP-CHROME, never to Notebook's own code**, confirmed by tracing each occluder's CSS module:
  - **The orb cluster** (`GlobalVoiceLayer`, `div._orbCluster..."◉"`) covers "All notes" (390,
    `nb-home`/`nb-list`/`nb-tasks`), "Code block language" (1200, `nb-note`/`ed-outline`/
    `ed-palette`/`ed-ask`), "Find in note"/"Previous match"/"Next match" (390, `ed-find`), and two
    support FAQ rows (390/820, `support`). Same element already named in 10E-1 as "app-chrome, by
    design" for pure overflow; this run shows it also intercepting real controls, which is new.
  - **The app shell's "Skip to main content"** (`div._shell_6uhgd_1`, portaled by F4 — see 9a's
    fix-direction note) covers header/title controls at 390 across `nb-table`, `nb-board`,
    `nb-calendar`, `nb-timeline`, `nb-graph`, `nb-trash`, `nb-search`, `support`, and — on
    `nb-note`/`ed-find`/`ed-property` — **"Add property" and "Suggest values with Compass."**
  - **The Log-Trade FAB** (`div._logFab_z41fg_737`) covers `nb-list`'s "Tasks view," `nb-timeline`'s
    "Week" tab, `ed-find`'s "Show replace," a Census-planted control, and `nb-note`'s "Task item
    checkbox for Review the base," all at 390.
  - **The Settings "Connect" button** (journal-2-0's own `ConnectedAppsCard.jsx`) is occluded at
    390 by `div._wrap_s9jcl_1` hitting an `svg` — traced by CSS-module hash to
    `GlobalVoiceLayer-*.css`, i.e. the voice widget again, not the connectors card's own layout.
  - Verified **none** of these four occluders live under `app/src/pages/journal-2-0/**` — traced
    by grep + CSS-module-hash lookup for each, not assumed. Fixing any of them is a shell/chrome
    change, out of this lane's scope (rule 12 forbids `app/src/hub/`; the shell/voice files carry
    the same "not this lane's to edit" boundary) — reported with this fix direction, not fixed.
- **7 sub-24px tap findings** (the product's own adopted WCAG 2.5.8 floor per
  `targetFloors.test.js`, stricter than nothing but looser than the instrument's own 44px
  `TAP_MIN`): "How do I get my export file?" 195.4×23 (`nb-import`, 390 & 820 — 1px short);
  "Task item checkbox for Review the base" 16×16 (`nb-note` 390, `ed-property` 390 — the
  established accepted checkbox-plus-44px-label pattern, `A2R-10` precedent, not treated as new);
  **"Find in note" 248×18 (`ed-find` 390) and 195×18 (`ed-find` 820)** — genuinely new, fixed in
  this lane (see below); "Close insert panel" 21.8×24 (`ed-palette` 820, width 2.2px short).
- **138 further sub-44px tap findings** (24–44px range): read against the codebase's own already-
  ratified 24px floor (`targetFloors.test.js`'s header: *"Wave 10 follow-up F5: the Notebook's
  small targets, held to WCAG 2.5.8's 24 px"*), these are NOT new defects — most are already-
  accepted controls (the "?" help button, sidebar rows, header selects, sort buttons) sitting
  between the product's adopted 24px floor and the instrument's stricter 44px reading. Not
  triaged individually; none is a Notebook-owned occlusion by an app-chrome element.
- **"Joystick, Notebook" (L3/D3P's named 390px finding) — NOT MEASURED by this instrument; still
  open, status unconfirmed.** Checked directly: this run's geometry sweep sampled zero controls
  whose accessible name contains "Joystick" on any surface at any width. The finding cited in the
  scorecard (`docs/notebook/proof/l3-layout-0e72ad573/r2-after/run.json:"control":"Joystick,
  Notebook"`) comes from a *different*, purpose-built layout probe (the L3/D3P ad-hoc instrument),
  not from `tools/notebook_proof_walk.py`'s standard `notebookSurfaces.js`-driven manifest — this
  walk's geometry sweep does not reach the joystick hub's own controls at all. **Cannot confirm or
  deny from this run.** Re-confirming it needs the L3/D3P-style targeted probe, not this one.

**What this reading does NOT prove:** it does not confirm or deny the pre-existing "joystick hub
covers 'Joystick, Notebook'" finding (see above — out of this instrument's manifest). It does not
re-measure the editor-toolbar-specific findings F5 fixed (the first-run hint over the tag/format
row) because the editor toolbar was unreachable to this sweep's control sampler on `nb-note`
(0 controls at any width — same root cause as 9a/2c). It does not evaluate anything above 1200px
or below 390px.

### 2b — every shipped feature works on every path

**Reading: census control VALID; 55 rows × 3 doors = 165 cells: WORKS 51, N/A 30, NOT-DRIVEN 21,
INCONCLUSIVE 27, NO-DOOR 35, BROKEN 1.** `docs/notebook/proof/wk-7bd834b9f/census.json`: control
VALID (planted no-door read NO-DOOR, planted broken-door read BROKEN, on all 3 doors).
`findings_count` (BROKEN + NO-DOOR only, per the instrument's own definition — INCONCLUSIVE is
explicitly not counted as a finding) = 36.

**Comparison with 10E-1 (`fd7d1f42d`, before #224 and every follow-up): WORKS 110, N/A 30,
NOT-DRIVEN 22, BROKEN 2, NO-DOOR 1.** The N/A and NOT-DRIVEN counts hold almost exactly (30/30,
21/22) — those are by-design and environment-capability rows, unaffected by tree changes. **WORKS
collapsed from 110 to 51 and NO-DOOR rose from 1 to 35**, with a new INCONCLUSIVE bucket (27) that
did not exist in 10E-1's read. This is a real, precisely-diagnosed regression in **instrument
reach**, not 59 newly-broken features — see below.

**Root cause, traced (same defect as 9a/2c/6c, confirmed independently here):** every one of the
27 INCONCLUSIVE cells and the majority of the new NO-DOOR cells belong to features whose probe
must click or tap *inside* the editor body to place a caret (`focus_editor()` →
`{ROOT} .ProseMirror`, `{ROOT}` = `[data-proof-root="notebook"]`) — Syntax highlighting, Math,
Text colour, Callout, Table UI, Drag handles, Find and replace, Emoji picker, @date mentions, Web
embeds, Multi-column, Heading H4-H6, Undo/redo (touch), and OCR/attachment. Rows whose probe
never needs to click inside the editor (Table of contents, Word count, Quick switcher, Bulk
operations, Archive state, Note lock, Split view, Member-made templates, Export formats) read
cleanly (WORKS or a quick, non-timeout NO-DOOR) at the *same* point in the same run. This was
confirmed, not merely inferred, by a **separate two-path diagnostic** (scratch-only, not part of
the committed evidence, run on a fresh boot of this exact tip): navigating to a note both directly
(`/journal/notebook?note={id}`) and via list→click, then asking the DOM directly —
`[data-proof-root="notebook"]` exists in both paths, but `.contains(.ProseMirror)` is **false**
in both. `.ProseMirror`'s own ancestor chain resolves to `DIV#notebook-pane` — the skip link's
*target*, several levels above where `mark_root()` actually marks (the skip link's *parent*, a
bare `<span>` in the app shell's portaled skip-link slot — see 9a's fix-direction note; this is
the identical root cause, not a coincidence). `Locator.click`/`.tap` on `{ROOT} .ProseMirror`
therefore waits the full timeout for a selector that will never attach, which is the literal text
of every INCONCLUSIVE reason recorded.

**Findings, named:**
- **1 BROKEN — OCR/text from images and docx, keyboard door.** "no attachment chip" — a real
  finding, unaffected by the root-scoping issue (this row's probe doesn't reach that far before
  failing).
- **27 INCONCLUSIVE** (listed by row × door above) — not evidence either way, root cause traced
  to the instrument, not asserted as a product regression.
- **35 NO-DOOR**, of which the following are believed genuine (the probe reached the page fine,
  quickly, and simply found no such control — not a timeout): Word count/reading time (desktop,
  touch, keyboard — "no word count visible," 3 cells; this differs from 10E-1's reading and may be
  a real removal or a relocated control, not re-investigated further here), Bulk operations
  (desktop/touch/keyboard — "no select boxes on the list," 3 cells), Archive state (3 cells), Note
  lock (3 cells), Split view (2 of 3; touch reads N/A), Member-made templates (3 cells), Camera
  scan with OCR (touch only), Export formats (3 cells), First-run tour + sample notebook
  (keyboard — "not reached with Tab in 220 presses"). The remaining NO-DOOR cells (syntax
  highlighting/math/etc.'s *keyboard* door, 12 cells) are the known, previously-documented gap:
  toolbar-launched inserts have no keyboard door at all (same class as the already-fixed G-160,
  not new).

**What this reading does NOT prove:** it does not confirm or deny WORKS for the 13 editor-insert
features whose probe could not reach the editor (Syntax highlighting, Math, Text colour, Callout,
Table UI, Drag handles, Find and replace, Emoji picker, @date mentions, Web embeds, Multi-column,
Heading H4-H6, Undo/redo-touch) — 10E-1's own read of most of these (WORKS, before #224) is the
best available evidence and predates this tree by five landed lanes. It does not confirm Word
count/reading time is actually gone from the product — only that this probe, at this point in a
long run, did not find it; a targeted re-check (not a full re-run) would settle it cheaply.

## Fixes (feat/notebook-w10-wkfix, branched from origin/master `0812b5ec3` — master advanced past
`7bd834b9f` to L5 between the evidence run and this branch; the touched files are untouched by L5)

**One fix shipped, matching the task's own worked example ("an untappable target inside
journal-2-0"):**

- **`app/src/pages/journal-2-0/components/notebook/NoteFindBar.module.css`** — the Find-in-note
  input (`aria-label="Find in note"`, measured 248×18 at 390 / 195×18 at 820, under the product's
  own 24px floor) gets the same `min-height: var(--tap-min, 44px)` its row-mates
  (`.navBtn`/`.closeBtn`/`.textBtn`) already carry at the ≤1024px touch tier — it was the one
  control in that bar left out. One declaration, touch-tier only, width untouched (the 640px
  query's `width: 100%` is unaffected).
- **Rail:** a new `describe` block in `app/src/pages/journal-2-0/a11y/targetFloors.test.js`
  (the established CSS-source-parsing pattern this file already uses for every other F5/L3 floor
  — a structural check of the declarations, not a jsdom layout claim, per that file's own header).
  Four cases: the floor matches its siblings; the floor is touch-tier-only (no leak to base/desktop);
  the phone-width `width: 100%` rule is untouched; a CONTROL asserting the pre-fix declaration
  (font-size only) fails the check.
- **Mutation proof:** captured the fixed file's bytes (sha256 `60f3a9ffd0…`), reverted the one
  declaration, ran the rail — **exactly the new floor-matching test reds (1 of 38), the other 37
  (including the leak/width/CONTROL cases) stay green** — then restored the file from the captured
  bytes (`os.replace`, never `git checkout`) and verified the sha matched before committing.
  `npx vitest run src/pages/journal-2-0/a11y/targetFloors.test.js` → 38/38 after restore.
  `NoteFindBar.test.jsx` (the component's own existing 32-test behavioural suite) re-run
  unaffected: 32/32.
- Commit `1e6cdfed2` on `feat/notebook-w10-wkfix`, pushed.

**Everything else this run found that could plausibly be "fixed" was assessed and NOT fixed, with
a reason:**
- The 4 app-chrome occluders (orb cluster, portaled skip link, Log-Trade FAB, and — traced to
  `GlobalVoiceLayer` — the Settings "Connect" occlusion) are not Notebook-owned code; a fix there
  is a shell/voice-widget change, reported above with its cause, not attempted.
- The 138 tap findings in the 24–44px band are not defects by the product's own already-ratified
  floor (`targetFloors.test.js`, F5) — re-litigating that ratified 24px vs. the instrument's
  stricter 44px reading is a product decision, not a bug to silently "fix" in a proof-walk lane.
- The root-scoping defect underlying 9a/2c(control)/5d(5 UNREACHED writes)/6c(editor-toolbar
  reach)/2b(27 INCONCLUSIVE) is a shared-instrument defect (`tools/notebook_proof_walk.py`'s
  `MARK_ROOT_JS`), not product code — reported with its exact fix (above, under 9a) rather than
  patched here; changing the instrument's own shape is a bigger call than this lane's mandate and
  would need its own control-validated re-run.
- The deadclick control's root cause (orb-cluster DOM churn not excluded as background noise) is
  the same category — an instrument gap, named with its mechanism, not patched.

## Sandbox integrity

CLEAN at all four checkpoints (`docs/notebook/proof/wk-7bd834b9f/integrity.md`,
`run.json:"integrity"`): pre-boot (baseline), post-boot (+15s), post-prewarm (+120s), shutdown —
62 db files hashed each time, root `C:\data`, zero diffs. `stop: "graceful (rc 0)"`. The misdirected
first attempt (see above) never reached the boot step for this tip — it measured `notebook-l2`'s
tree under a separate, disposable data dir (`C:\data-w10wk`, never reused) and was torn down before
any sandbox_identity check passed; no shared-root write occurred from it either.

## Refused / not completed

Nothing was refused by a permission layer or tooling gate in this lane (unlike F7's deadclick/silent
browser runs). The one thing this lane could not do is re-confirm the "Joystick, Notebook" 390px
occlusion (6c) — not a refusal, but a genuine instrument-manifest gap: `tools/notebook_proof_walk.py`'s
geometry sweep does not sample that control at all, and re-confirming it needs the L3/D3P-style
targeted layout probe, which is a different tool.
