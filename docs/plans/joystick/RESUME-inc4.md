# RESUME — joystick hub Increment 4

**Created 2026-09-10.** Branched from `feat/joystick-increment-3` @ `a2156f310`, so it carries
B7-B9 and the folded-in deploy watcher. It rebases onto master once Increment 3 merges.

## State

| | |
|---|---|
| Branch | `feat/joystick-increment-4`, from `a2156f310` |
| Worktree | `C:\Users\Patrick\uct-worktrees\joystick-inc4` |
| Depends on | Increment 3 merging first; rebase onto that master before any full gate |
| Gate policy | ⛔ NO full gate on this branch until Increment 3 is merged and this is rebased onto that master. Targeted per-B runs until then. |
| Deploy | ⛔ None. The word for Increment 4 comes later. |

## ⛔ RULE 12 — AMENDED FOR THIS INCREMENT

The observation-window basis is gone: the notebook workstream flipped its flag. Rule 12 now permits
**exactly one** notebook-side edit:

    data-note-card-id={note.id}   on the grid note card's root element

...plus its rail. **Nothing else under `app/src/pages/journal-2-0/**`, and nothing in
`NotebookTab.jsx`.** `rule12Paths.test.js` is updated to allow that one file with that one diff
shape, and mutation-proved in both directions: a second file under the prefix goes red, and a
change to the permitted file that is not the permitted shape goes red.

**H1 is now:** any notebook-side need BEYOND that attribute.

## Order

- **B12** — the attribute + rail. Closes R-18.
- **B13** — Phase 4 settings UI (§8, core item #11): controls for the nine keys already in
  `useHubSettings` defaults — `enabled`, `handedness`, `haptics`, `holdMs`, `travelPx`,
  `doubleTapMs`, `stickyFan`, `highContrast`, `overrides` — inside the existing admin-gated
  `JoystickSettingsCard`, persisted through the existing preferences path. A rail per control:
  render, change, persisted value read back. ⛔ Rule 11 sweep of every render site of the card
  BEFORE touching it. ⭐ This is the item most likely to turn the owner's "it works but it's buggy"
  into tuning rather than defects.
- **B10/B11** — the notebook controller and cursor, exactly as scouted and ruled: hub-side mounted,
  `applyTargetToParams` with push, the Q2/Q4/Q5 rails, the `PREVIEW_MODES` flip with the
  both-directions membership rail, the B4 manifest +1 with four mutation proofs, and the cursor with
  `tapHint: 'tap: next note'` wired to the advance.
- **3.5a and 3.6a scouts** — read-only, reported here with numbered questions and recommendations.
  No code.

## The 3.7a scout — carried forward, still valid

Verified 2026-09-10 against `febe8ee67`; none of these files moved in master's charts program.

- **The read**: `NotebookTab.jsx:62-63` — `const [searchParams, setSearchParams] = useSearchParams()`
  / `const noteId = searchParams.get('note')`. A raw string id; absent or unknown is not handled at
  the read site.
- **`clearNoteParam`**: `NotebookTab.jsx:365-369`, `{ replace: false }` -> **push**. Fires when a
  folder or tag is chosen while a note is open. `closeNote` (`:352-361`) is a different function,
  same shape plus three refreshes. Four `note` writers: `:340` set, `:355`/`:367`/`:387` delete.
- **The seam**: `applyTargetToParams(params, target)` (`journal-2-0/lib/searchNavigation.js:86`),
  pure and exported, DELETES `PARAM_DOC`/`PARAM_PAGE`/`PARAM_EXCERPT`/`PARAM_REVIEW` before setting
  `PARAM_NOTE`. Hand-rolling `params.set('note', id)` would leave a stale `?doc=&page=` pointing
  into a different note.
- **Other readers**: `lib/captureContext.js:26` (`noteIdFromLocation`); `j2tabRedirect` preserves
  the param; tests in `searchNavigation.test.js` and `j2tabRedirect.test.js`.
- **The five actions** (`registry.js:393-447`): `newNote`/`linkTicker`/`templates` are `kind:'run'`
  with no run body; `dailyPlan`/`postMortem` are `kind:'navigate'` to `?new=daily-prep` /
  `?new=trade-review`, both stable template keys (`lib/notebookTemplates.js:19`) that already work.
- **Rulings Q1-Q8 stand**: push; `applyTargetToParams`; `newNote`+`templates` write and the B4
  manifest grows by one `POST /api/j2/notes`, `owner:'app'`, via `lib/noteCreation.js`;
  `linkTicker` deferred (R-17); `paintCursor` with a selector rail; no off-route guard, a rail
  instead; Home needs nothing; flip `PREVIEW_MODES` last.

## Open requests this increment closes or carries

- **R-18** — `NoteCard` renders no note identity. **Closed by B12.**
- **R-17** — `linkTicker` has no symbol source on its route. **Carried**: either the route gains a
  symbol, or the entry is removed with a comment citing R-17. Ring layout if removed: outer 3 -> 2,
  inner stays 4; both legal.

## Open items carried from Increment 3

- the owner's real-glass bug lines from Increment 2 (still pending; file verbatim in `requests.md`)
- the post-deploy check of B9 on production
- R-13 (`scan.scans` ships ABSENT), R-15 (Screener cursor invisible)
- transitive-dataflow rail · `HubActionsButton` haptic on the WCAG path · `scan.flag` §C2 exception
- CI device job · iOS visual escalation · `require.main` guard on the device runner
- BrowserStack Automate quota · server-side preference-key validation · D-35
- core remainder after this increment: 3.5 Chart, 3.6 Catalysts, 3.8 Home scrub, 3.9 Flow verify,
  Calendar (dark, per R-C)

## Concurrency — streams and file ownership

`feat/joystick-increment-4` is the INTEGRATION branch. Streams branch off its tip into their own
worktrees and merge back in the order A -> C -> D -> E. **A stream that needs a file another stream
owns STOPS (H8) rather than editing it.** Full gates run one at a time (CPU); targeted runs are
unlimited.

| Stream | Where | Owns | Scope |
|---|---|---|---|
| **A** (main) | `joystick-inc4` | `hub/sections/notebookSection.js`, `hub/useHubCursor.js` if needed, its rails | B11 — cursor over note cards, Q4 selector rail against the real component, tapHint wired to advance |
| **B** [sub] | `inc4-scout` | **nothing** — reports only | 3.5a Chart + 3.6a Catalysts scouts, read-only |
| **C** [sub] | `inc4-screener` | `hub/sections/screenerSection.js`, `pages/screener/shell/*.jsx`, `components/screener/*.jsx`, its rails | R-13 `scan.scans` picker seam · R-15 the visible cursor |
| **D** [sub] | `inc4-home` | `hub/sections/homeSection.js`, **only** the `home`/`calendar` declarations in `registry.js`, its rails | 3.8 Home scrub + Calendar in the inner ring (R-C) · 3.9 Flow verify-only |
| **E** [sub] | `inc4-sweep` | `hub/HubActionsButton.jsx`, `hooks/useKeyboardVisible.js`, `C:\tools\hub-devicetests\tests\run.js`, its rails | WCAG-path haptic · `require.main` guard · the `useKeyboardVisible` measurement |

⚠️ **`registry.js` is shared** between D (home/calendar) and A (notebook, already committed). D's
diff is bounded to the `home` mode's declaration; anything wider is H8.

⛔ **H8** — a stream needs a file outside its ownership. **H9** — two streams' merges conflict:
resolve nothing, report the conflict.

**Sequencing:** the 15:50 ET Increment 3 window job has absolute priority. Every stream pauses at
its next clean commit when it fires. After Increment 3 is live, the integration branch rebases onto
that master (backup ref) and stream merging resumes. Increment 4's full gate runs on the rebased
integration branch only.

**Evidence:** emulated rows per stream, plus ONE combined three-part glass script at the end
(notebook cursor + tap-advance · screener cursor + scan picker · home scrub) against a seeded
`:8077`, so the owner does one phone session rather than three. That session is Increment 4's
pre-merge requirement — B11, C's cursor and D's scrub are all new consumption paths with no
Increment 1 carrier.

## Stream B — the 3.5a and 3.6a scouts (read-only, 2026-09-10)

### 3.5a — Chart (§3.5, `/charts`)

**Both plan citations drifted by 6 lines; the surfaces are real.** `StockChart.jsx:1992`
`onTfChange = null,` (plan says `:1986`); `StockChart.jsx:2000` `onDateNavApi = null,` (plan says
`:1994`). Publish site `StockChart.jsx:14696` — `onDateNavApi({ goToDate, goToYear, stepBar,
ensureFullHistory, getDateMeta })`, all five defined at `:14636`, `:14646`, `:14656`, `:14666`,
`:14670`.

**⛔ TWO OF WAVE 0's THREE EXTRA SURFACES ARE INVENTED CITATIONS — STRIKE, DON'T SOFTEN.**
`setGroupSymbol` and `scrollPosition` appear **nowhere in `10-wave0-discovery.md`**, and
`setGroupSymbol` appears nowhere in `app/src`. Non-vacuity controls: `setGroupSym` (the real name)
returns 27 non-test files, and grepping that same doc for `stepBar|onTfChange|chartApiById` returns
`:112,:116,:125,:129`. `scrollPosition`'s 15 hits are all lightweight-charts **test mocks**. Only
the comparison write survives (`10-wave0-discovery.md:129`), still desktop-only.

**⭐ THE DRAWING PROGRAM CHANGED NOTHING THE HUB USES — measured.** Across
`a98363cf6..919d4c080`, diff hits for all seven hub-relevant names = **zero**; control: the same
invocation returns 192 changed lines and 53 `drawing` hits. The plan's "~20 new drawing* modules"
is an overcount: **16 files added, 6 non-test drawing modules**.

**The imperative surface today is ChartPane's handle** (`ChartPane.jsx:616`, eleven members incl.
`:633` `stepBar: (dir) => dateNavApiRef.current?.stepBar?.(dir)`), not StockChart's props.
`onBarsReady` is genuinely unwired, but `ChartPane.jsx:890` `{...(stockChartProps || {})}` is a
**zero-edit passthrough**, and `:898` already chains `onDateNavApi` to a host.

**New since Wave 0:** an ordered symbol source exists — `MobileChartsApp.jsx:162`
`useReviewSession(...)` feeding `:385` `review.prev()` + `setGroupSym`.

**Questions + recommendations:** (1) bind to ChartPane's ref, the surface both hosts already hold;
(2) take readiness through the existing `stockChartProps` spread, zero edits; (3) **⛔ `onTfChange`
is a NOTIFICATION, not a setter** — the plan's "next/previous timeframe via `onTfChange`" would be
a silent no-op, so write the host's tf state instead; (4) scrub-vertical needs `setGroupSym` **and**
`useReviewSession`, the only ordered source; (5) strike the two invented rows; (6) downgrade the
⚠️ CRITICAL re-verify block to "measured clean, 2026-09-10"; (7) keep Chart last, but for the real
reason — largest file in the repo, most hosts — since "pending indicators merge" has expired.

### 3.6a — Catalysts (§3.6, in-place on `/dashboard`)

**The plan's warning is TRUE.** `sortKey|tagFilter` return nothing; control: `useState` returns 16
lines. **Three axes replaced two:** `:543` `const [sortBy, setSortBy] = useState(compact ? { col:
'change', dir: 'desc' } : null)` with a three-state toggle (`:549` `return null  // third click
clears`); `:428` `const [activeTags, setActiveTags] = useState(new Set(ALL_TAGS))`; and one the plan
never mentions, `:429` `const [aOnly, setAOnly] = useState(false)`. They compose at `:577`.

**⛔ `catalysts.filter` DESCRIBES A UI THAT DOES NOT EXIST.** The registry says it "opens the tile's
own filter UI" (`registry.js:377-384`), but the chips are **unconditionally inline** whenever rows
exist (`:723-725`, plus the aOnly button `:736`). Nothing to open — the present-and-inert hazard
`screenerSection.js:48` already names.

**⛔ NO SEAM OF ANY KIND.** The whole prop surface is `CatalystTable.jsx:414` —
`{ compact = false, datePicker = false, title = 'STOCK CATALYSTS' }`. No ref, no context, no URL
param, no `window`/`localStorage` (control: the same pattern against `NotebookTab.jsx` returns 5
hits). Rows carry no DOM handle: `:806` `key={r.ticker}` is a React key and the `<tr>` at `:805`
carries only a className, so `data-hub-cursor` cannot land. The one zero-edit seam is **read-only**:
`useCatalysts()` shares the SWR key (`useCatalysts.js:9`).

**⚠️ REACHABILITY — the plan is half right.** `Dashboard.jsx:187` —
`const hero = heroState === 'WEEKEND' ? <TheWeek /> : <CatalystTable />`: on a weekend or holiday it
is **not mounted at all**. `{hero}` mounts **twice** (`:224` desktop, `:247` mobile). And there is a
**second mount on another route** the plan never records: `MorningWire.jsx:381` —
`<CatalystTable compact datePicker title="PRE MARKET MOVERS" />`, with a different default sort.

**Questions + recommendations:** (1) redefine `catalysts.filter` as a tag-set cycle or file it
absent; (2) leave `aOnly` alone — one control, one meaning; (3) file the cursor as the catalysts
twin of R-15; (4) scope to `/dashboard`, declare the MorningWire mount out of scope — one `listId`
over three mounts is one cursor claiming to be three; (5) gate eligibility on `heroState`, not route
alone, or the fan opens over a tile that is not rendered every weekend; (6) **3.6 cannot ship
without editing `CatalystTable.jsx`** — say so and assign ownership before that increment starts;
(7) keep no-scrub; `selectedDate` is a date picker, not a cursor axis.

## ⛔ H8 — 3.8's Home scrub is BLOCKED, and the reason is structural

Stream D stopped rather than shipping it. The diagnosis is worth more than the feature.

**Two of the three premises in that stream's brief were false, and both came from a plan row.**

1. *"Tap -> Screener and double-tap -> Journal already work."* They do not. `onTap` is declared by
   `breadthSection.js:166`, `journalSection.js:607`, `notebookSection.js:117`,
   `screenerSection.js:443`, `wireSection.js:207` — **no `home` entry anywhere** — and
   `pages/Dashboard.jsx` has zero case-insensitive matches for "hub". On `/dashboard` today,
   `useJoystick.js:449` calls `mode?.onTap?.()` against a mode that declares neither, so nothing
   happens. Non-vacuity control: the same grep returns 168 `onScrub` hits.
2. *"Calendar to the inner ring alongside Wire"* contradicts spec §C3:890, which puts Wire OUTER.
   The later 2026-09-09 preview ruling was followed; the cost is recorded in-file.

**Why the scrub cannot ship:** its commit has to navigate, and a registry-declared mode structurally
cannot. `ctx` is `{mode, symbol, timeframe, activeScan, selectedPosition, chartRef, livePrice,
isStreaming, lastSection}` (`HubRoot.jsx:93-96`) — read-only values plus one ref. `App.jsx:321` uses
`BrowserRouter`, not a data router, so there is no `router.navigate` singleton to import. Navigation
exists only inside `runAction` via `useNavigate()`.

**Two ways in, both outside that stream's ownership:**
- `HubRoot.jsx:93-96` — add `navigate` to `ctx`. **One line**, and then the whole feature lives in
  `registry.js` + `homeSection.js`.
- `Layout.jsx:167` — mount a `<HomeHubSection />` beside `<NotebookHubSection />`, the B10 shape.

**What it refused to do, and why each refusal is right:**
- Ship `homeSection.js` unmounted — `reachable.test.js:504-515` judges every tracked module, so it
  would go red, and the only fix is an `AWAITING_A_DECISION` entry in a file it does not own: a
  second H8 to work around the first.
- Ship the working half (scrub + chip readout) without the commit — `registry.js:614` states the
  rule it would break: **"⛔ AN UNWIRED ACTION IS ABSENT, NEVER PRESENT-AND-INERT."** A chip naming
  "Screener" that does nothing on release is a worse lie than today's silence.
- Navigate via `history.pushState` + a synthetic `popstate` — a second navigation authority beside
  `resolveNavTarget`, routing around the one seam that owns it.

**⭐ And the thing this uncovered:** `lastSection` is **built, persisted, threaded into ctx and read
by nobody.** `HubContext.jsx:77` defines `LAST_SECTION_STORAGE_KEY = 'hub.lastSection'`, `:134`
writes it on every section route change, `HubRoot.jsx:95` puts it in ctx — **zero consumers**. It
is the data the scrub needs, already there, unreachable for the same reason.

**Recommendation (mine, not the stream's):** put `navigate` in `ctx`. It is one line in a file I
own, it unblocks Home entirely, it gives `lastSection` its first reader, and it removes the reason
every acting section has to be mounted from a page — which is the same constraint that forced B10's
hub-side mount. It is an architectural change to the ctx contract, so it wants an explicit ruling
rather than a decisions-log entry, and it did not fit before the Increment 3 window.
