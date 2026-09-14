# R-1a — THE SCANNER CAPTURE DOOR · FLIP PACKET

**Track:** Wave R, row **R-1a**. Companion to `docs/notebook/r-1a-screener-capture-door-spec.md`
— that document specifies the `/screener` page door that is still to be BUILT (its Part B);
**this document is about the door that already exists and is dark** (its Part A, §2).
**Written:** 2026-09-13 ET / 2026-09-14 UTC — the session crossed midnight UTC, which is why the
F5 evidence quoted below carries a stamp a day later than this line. Against the working tree of
`C:\Users\Patrick\uct-worktrees\notebook-k`.
**Document only.** No code was written, no test was run, and no git command was run while
writing it.

⛔⛔ **NOTHING HERE IS FLIPPED, AND THIS PACKET DOES NOT AUTHORISE A FLIP.** It is what the
owner needs in order to decide whether one happens. `PROGRAM-MANIFEST.md` §11 criterion
**C-2** sets the required fields:

> | C-2 | Every SHIPPED-DARK row has a **flip packet** delivered to the owner | key · railway command · preconditions TRUE with evidence · window + verdict rule · rollback · member-impact paragraph |

⛔ **THE "RAILWAY COMMAND" FIELD OF C-2 IS ANSWERED "THERE IS NONE, AND HERE IS WHY."**
That is §2, and it is the single most important thing in this file.

---

## 1. WHAT FLIPS

### 1.1 The switch is a COMPILED-IN CONSTANT. Flipping it is a DEPLOY.

`app/src/widgets/captureRelease.js`, **line 46**, quoted from the file:

```js
/** The release switch. Flip to `true` in ONE commit when the wave is cleared. */
export const WAVE_R_CAPTURE_ON = false
```

This is a JavaScript module constant. It is bundled into the frontend build. **There is no
Railway variable behind it, and there is no server half.** Flipping it means: edit the
constant, merge to `master`, wait for the `web` rebuild, and — this is the part that is
easy to forget — **every member with an open tab keeps the OLD bundle until they reload.**
There is no service worker and no new-version prompt, by charter.

⛔⛔ **DO NOT WRITE A `railway variables --set` COMMAND FOR THIS.** A variable named
`WAVE_R_CAPTURE_ON` (or `VITE_WAVE_R_CAPTURE_ON`, or anything else) set on any service
**reaches nothing**, is read by nothing, and will look exactly like a successful flip:
the CLI accepts it, `--kv` reads it back, the service redeploys, and not one member's
browser behaves differently. This repo has the sentence written down already, in
`CLAUDE.md`'s Notebook rollback section, about the sibling constant:

> a variable named after the constant (`OFFLINE_DEFAULT_ON=0`) still reaches nothing and
> still looks like it worked.

The same is true here, and it is worse here, because Wave K taught the programme that a
Notebook flag *can* be a variable. `NOTEBOOK_OFFLINE_DEFAULT_ON` is; `WAVE_R_CAPTURE_ON`
is **not**. K added four keys to the auth payload and deliberately added no fifth for
Wave R.

### 1.2 The second mechanism — `CAPTURE_FLAG_KEY` — and exactly what it can and cannot do

The same module, **line 48**:

```js
export const CAPTURE_FLAG_KEY = 'uct.nb.capture.enabled'
```

read by `captureEnabled()`, **lines 58–65**, quoted whole because the precedence is the
whole point:

```js
export function captureEnabled(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(CAPTURE_FLAG_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* private mode: fall through to the default */ }
  return WAVE_R_CAPTURE_ON
}
```

| mechanism | what it CAN do | what it CANNOT do |
|---|---|---|
| `WAVE_R_CAPTURE_ON` (the constant) | change the default for **every** browser that loads a new bundle | change anything without a rebuild and a page load; reach a tab that is already open |
| `localStorage['uct.nb.capture.enabled']` | turn the doors **on** (`'1'`) or **off** (`'0'`) **for one browser**, with no deploy — and it is **terminal in both directions**, so it survives a later flip either way | reach any other member, any other browser, or any other device. It is not a cohort, not a rollout, and not an ops lever — it is a per-browser override typed into one DevTools console |

⚠️ **And the two halves of the blast radius follow the key at different speeds.** The
module's own header says so:

> ⚠️ The menu arrays are derived once at module import, so a localStorage change reaches
> the menus on the NEXT PAGE LOAD, not the current one. The two buttons call
> `captureEnabled()` at render and so follow immediately. That asymmetry is deliberate and
> stated rather than papered over.

So the per-browser key is the **rehearsal instrument** (arm one browser, drive the real
production build, see the real door) and the **per-member escape hatch** after a flip
(`'0'` + reload). It is not a substitute for the flip and it is not a rollback for anybody
but the person who types it.

### 1.3 ⛔⛔ THE FLIP IS NOT R-1a-SCOPED. IT RELEASES FOUR DOORS AT ONCE.

This is the thing most likely to be got wrong by someone reading only the R-1a row. The
constant is the **whole wave's** release decision — the module says so in its own header
(*"the release decision lives in ONE file and a reader can see the whole blast radius at
once"*). Measured from the source in this worktree, `captureEnabled()` / `releasedTypes()`
gate all of the following:

| # | surface | where the gate is read | wave row |
|---|---|---|---|
| 1 | `/charts` **scanner widget** header — a one-click journal button (`aria-label="Send this scan to Journal"`, `ScannerResults.jsx:266`) and a chevron that opens the destination picker (`aria-label="Send to Journal — choose where"`, `:275`) | `ScannerResults.jsx:256` — `const scanActions = (captureEnabled() && symbols.length > 0) ? (` | **R-1a** |
| 2 | the **ticker right-click menu**, everywhere it appears in the app — `Send {sym} chart to note` (`TickerActions.jsx:332`) | `TickerActions.jsx:148` — `const captureOn = captureEnabled()` | **R-2e** |
| 3 | the `indexes` widget appearing in the add-widget, add-tab, phone and journal menus | `registry.js:621-624` — `WORKSPACE_MENU_TYPES = releasedTypes(WORKSPACE_MENU_TYPES_ALL)` and its three siblings | **R-3b** |
| 4 | the `marketcontext` widget, same four menus, same line | same | **R-3c** |

Rows 3 and 4 are named in the module as `UNRELEASED_CAPTURE_WIDGETS` (line 56):

```js
export const UNRELEASED_CAPTURE_WIDGETS = Object.freeze(['indexes', 'marketcontext'])
```

⛔ **There is no per-door flip today.** Releasing R-1a alone would be a CODE change (a
second predicate, or a per-widget gate), not a flip of this switch — and it would be a
change to a file the R spec lists as `FREE to read, HELD to flip`, made for release
convenience rather than for a product reason. **This packet covers the switch as built:
one constant, four doors.** If the owner wants R-1a alone, that is a different piece of
work and a different packet.

### 1.4 ⛔ THE FLIP IS NOT A ONE-LINE DIFF — five assertions pin the OFF state

Every one of these is a rail asserting the *current* state, deliberately, so a flip cannot
happen unnoticed. **Each will go RED the moment the constant changes**, and the amendments
must ride the SAME commit or the next gate reports NEW failures that are the flip's own.

| # | rail | the assertion that reddens | why it exists (quoted) |
|---|---|---|---|
| 1 | `app/src/widgets/captureRelease.test.js:36` | `expect(WAVE_R_CAPTURE_ON).toBe(false)` | *"Pinning the VALUE and not just the behaviour is deliberate: a flip is a release decision that must show up as a diff on this line, not as a test someone 'fixed' to match."* |
| 2 | `app/src/widgets/captureRelease.test.js:37` | `expect(captureEnabled(store(null))).toBe(false)` | same test — the default with no key set |
| 3 | `app/src/widgets/captureRelease.test.js:66-85` — `⛔ no add-widget menu, no add-tab menu, no phone sheet, no slash menu, no palette` and the `menuGroups()` case | the four gated menus would then CONTAIN `indexes` / `marketcontext` | the two widgets' "door" is menu membership |
| 4 | `app/src/widgets/registry.test.js` — `⛔ and what THIS RELEASE offers is that set minus the Wave R capture widgets` | `WORKSPACE_MENU_TYPES` would equal `WORKSPACE_MENU_TYPES_ALL`, and `.toBeLessThan(...)` fails | *"the pin that the registry's own exported menus are the GATED ones"* |
| 5 | `ScannerResults.journalDoor.test.jsx` — `with the flag OFF the header carries NO door`, and `TickerActions.sendNote.test.jsx` — `⛔ WITH THE WAVE R FLAG OFF THE DOOR DOES NOT EXIST` | both do `localStorage.clear()` and then assert absence, i.e. they assert **the module default**, which is the thing being flipped | *"`localStorage.clear()` drops the arming the other tests rely on, so the module default decides — which is exactly what a member's browser does."* |

⭐ **Every one of these is the rail working, not a rail to route around.** The amendment
each needs is the same shape: invert the pinned literal, and drive the OFF direction with
`localStorage.setItem(key, '0')` instead of `localStorage.clear()`, since after the flip
*unset* means ON. **Do not delete an assertion to make a flip green.** The both-directions
property is what makes these gates and not decoration, and `captureRelease.test.js` says so:
*"a gate proved one way is not a gate"*.

⚠️ **UNKNOWN:** whether that is the complete set. I searched `app/src` for
`WAVE_R_CAPTURE_ON`, `CAPTURE_FLAG_KEY`, `captureEnabled` and `releasedTypes` /
`UNRELEASED_CAPTURE_WIDGETS`, and the five above are what those searches return. A rail that
asserts the OFF state **behaviourally without naming any of those symbols** would not appear
in that search. The authority is a gate run on the flipped tree, not this list.

---

## 2. THE COMMANDS

### 2.1 The flip itself

```sh
# ⛔ THERE IS NO RAILWAY COMMAND. This is a DEPLOY. See §1.1.
#
# (1) the edit — ONE constant, in ONE commit, app/src/widgets/captureRelease.js:46
#     -export const WAVE_R_CAPTURE_ON = false
#     +export const WAVE_R_CAPTURE_ON = true
#
# (2) the five rail amendments of §1.4, IN THE SAME COMMIT.
#
# (3) the gate, on a clean tree, in its OWN tool call — never chained to the commit
python scripts/gate_shards.py --shards 6
#     assert the totals line and the file reconciliation BEFORE reading the exit code
#
# (4) push to master — ONE master merge at a time, Railway `web` SUCCESS before the next
#
# (5) verify by the ARTIFACT, never by the diff
#     /api/health `uptime_seconds` RESETS on a fresh boot (browser UA — Cloudflare
#     1010-blocks curl UAs)
#
# (6) B2, within the first ten minutes — see §4, row P-8
python tools/postdeploy_client_smoke.py --reset-keys
```

⛔ **NOT A COMMAND, and it must not appear in any runbook, checklist or release note:**

```sh
railway variables --service web --set "WAVE_R_CAPTURE_ON=1"      # ⛔ reaches NOTHING
railway variables --service web --set "VITE_WAVE_R_CAPTURE_ON=1" # ⛔ reaches NOTHING
```

Both succeed at the CLI, both read back through `--kv`, and both change no member's product.

### 2.2 The per-browser lever (rehearsal, and per-member opt-out)

```js
// in ONE browser's DevTools console, on uctintelligence.com — reaches nobody else
localStorage.setItem('uct.nb.capture.enabled', '1')   // this browser: doors ON
localStorage.setItem('uct.nb.capture.enabled', '0')   // this browser: doors OFF
localStorage.removeItem('uct.nb.capture.enabled')     // back to whatever the constant says
```

⚠️ The buttons follow immediately (read at render); the **widget menus** follow on the next
page load (derived at module import). §1.2.

### 2.3 ⛔ How the flag's live state would actually be verified — and it is NOT a bundle scan

**Never state this flag's state from the constant in the repo or from this document.**

- **A source read answers the wrong question.** `git show origin/master:app/src/widgets/captureRelease.js`
  says what master holds; it does not say what the pod is serving, and it says nothing about
  a member who has not reloaded.
- **⛔ A bundle scan cannot answer this one at all.** `PROGRAM-MANIFEST.md` §10.18 records the
  right way to scan a served artifact (*"A BUNDLE SCAN THAT DOES NOT WALK THE GRAPH ANSWERS A
  DIFFERENT QUESTION"* — a transitive walk over all served chunks, not the lazy entry points).
  That method is correct and is still useless here: **the door's strings are compiled into the
  bundle whether the flag is on or off.** `captureEnabled()` is a function call at the JSX
  site, so nothing is dead-code-eliminated; `aria-label="Send this scan to Journal"` is in the
  chunk either way. A scan that finds it proves only that Wave R shipped.
- ✅ **The only honest verification is BEHAVIOURAL, on the deployed origin, in a browser whose
  profile has NO `uct.nb.capture.enabled` key** (⛔ *unset*, not `'0'` — after a flip `'0'`
  means opted-OUT, a product no member has; `tools/postdeploy_client_smoke.py --reset-keys`
  exists for exactly this and already knows the key, `postdeploy_client_smoke.py:163`):
  open `/charts`, mount a scanner widget on a preset that has rows, and read whether the two
  controls are in the DOM by their `aria-label`s. Absent ⇒ off. Present ⇒ on.

⚠️ **There is no flag-ledger row to update, and that is correct rather than an omission.**
`docs/feature_flags.json` is derived by AST from Python env reads
(`api/services/feature_flag_index.py`: *"this walks the AST for `os.getenv("X")`,
`os.environ.get("X")`, `os.environ["X"]`"*). `WAVE_R_CAPTURE_ON` is a JS constant and is
invisible to that index **by construction**. The ledger therefore carries no Wave R entry and
`tools/flag_ledger_audit.py` will never mention this flip. ⛔ Do not "fix" that by inventing
an env var to make the ledger notice — that is §1.1's failure mode wearing a compliance
costume. The record of this flip belongs in `docs/notebook/deploy-checklist.md`'s Runs table
and in the manifest's R-1a row (§4, P-9).

---

## 3. REACH — who sees a flip, and when

**A flip reaches a member on their next page load of a new bundle. It does not reach an open
tab, and there is no mechanism by which it could.**

- No service worker, so no stale cached bundle survives the deploy — and no update prompt
  either. `CLAUDE.md` is precise about why that sentence is stated exactly: `main.jsx`
  registers `/sw.js` only as a self-uninstalling kill switch for browsers that still carry
  the legacy worker.
- The per-browser key (§1.2) is read live by the two BUTTONS and at import by the MENUS, so
  even for a member who types it, half of the blast radius waits for a reload.
- ⛔ **Consequence for rollback, stated here so it is not discovered during one:** after a
  revert, a member already running the flipped bundle keeps the doors until they reload.
  "Rolled back" means "no NEW page load gets it". Same sentence as Wave Q1's §5b step 4.

---

## 4. PRECONDITIONS — each TRUE with its evidence, or marked NOT YET MET

⛔ Nothing in this table is satisfied by intent. Where I could not measure something from this
worktree without git or a test run, the row says so rather than guessing.

| # | precondition | state | evidence / what is missing |
|---|---|---|---|
| **P-1** | The **F5 navigation controls** are GREEN — navigation alone, and navigation plus a genuine second writer, do not cost the member their words | ✅ **TRUE** | `docs/notebook/f5-second-writer-while-away.md`, stamped `2026-09-14T03:53:58Z`: *"`navigate-no-door` came back GREEN, so leaving a note and coming back with work queued does not cost the member their words"*, and this cell's own verdict: **"GREEN — offline sentence in the server body `True`"**, with the non-vacuity control passing (`server_before … server_after … via select.change`) and the wire tail `PUT → 409` (stale baseline refused) → `PUT → 200` (rebased, carrying the words). Trail `(0, False, 'None', True)` — **byte-identical to the GREEN baseline** |
| **P-2** | `append_widget_embed × drain-first` is GREEN — **the cell that IS this door** | 🔴 **NOT MET** | `wave-all-RESUME-HERE.md` §4 F5 table state: `RED (unpublished)`, measured *"on production, same ordering, same account, sentinel-timestamped and orphan-checked"*, **RED ×4 on document-load return and RED on SPA return**. The trail contains a transition neither GREEN control ever reaches: *"`sentence-in-record` goes **True → False while the entry is STILL QUEUED and the record is STILL DIRTY**"*. ⛔ And the RED cell's remaining difference from the two GREEN controls is *"that the RED cell fires an **append door in the FIRST context**"* — which is precisely what this flip puts in front of members |
| **P-3** | The append-only merge is reachable for a door **this browser fired** | ⚠️ **FIXED IN SOURCE, UNVERIFIED AGAINST THE RED CELL** | The defect: `docs/notebook/wave-q1-f5-append-merge-finding.md` — *"`outboxDrain.js:452` — the ring-vouched rebase runs first … re-sends **the member's body unchanged** … **The node is gone.**"* and its member sentence: *"They press Send to Journal on a chart, see it confirmed, and a moment later — when a queued edit drains — the widget is gone from the note."* The fix is in this worktree: `outboxDrain.js:171` `ringVouchedPlan` classifies FIRST (`:180-182`, `APPEND_ONLY ⇒ merge`) and is consulted at both vouch sites (`:440`, `:532`). `deploy-checklist.md` records it shipped as `54393f890`, 2026-09-13, *"1306 runnable files, 19,329 passed, 0 NEW attributable"*. ⛔ **What is missing is the production re-measurement**: the finding's own H14 row 3 (*"check the live build"*) reads **"⛔ OPEN — this is what the F5 production driver must now measure first"*, and P-2's RED cell has not been re-run against the fix. A unit fix plus a docs row is not a production reading |
| **P-4** | The **F5 freeze** permits the flip commit | ⚠️ **PARTLY — and the hold is a separate ruling, not the freeze** | `f5Freeze.test.js:74` reads `const F5_OPEN = true` in this worktree. Mechanically the freeze covers `FROZEN_CALLS` (five append call sites) and `FROZEN_FILES` (`serverChange.js`, `settleNoteWrite.js`) — `captureRelease.js` is in **neither**, so the flip commit does not break the freeze. The hold comes from elsewhere and is explicit: the R spec §5 marks `captureRelease.js` **"FREE to read, HELD to flip"**, and `wave-all-RESUME-HERE.md:136` reads *"⛔ **HELD** until F5's route-change question is settled — R-1a's scanner door fires from a route change by definition"*. ⛔ **Verify `F5_OPEN` by reading the file at flip time, not from this row** |
| **P-5** | The freeze's **arming condition** is met — *"every cell of the seven-family × six-ordering table is GREEN or NAMED"* | 🔴 **NOT MET** | `f5Freeze.test.js`, the constant's own note: *"⛔ Flip to false only when every cell of F5's table is GREEN or NAMED"*, with the 2026-09-13 amendment's limit: *"'Named' is not a synonym for 'unmeasured'. A cell may only be counted as named if a limitation is written down for it [in `q1-product-followups.md`]; an INCONCLUSIVE row with no named limitation still blocks."* The table today: GREEN `folder × drain-first`; RED `append_widget_embed × drain-first`; INCONCLUSIVE `append_document_excerpt × drain-first` (named — `q1-product-followups.md` **L-1**, the pdf.js caret); N/A with reason, the three `append_* × settle-first`; **"not yet run"** for the remaining cells. ⛔⛔ **AND P-1 DOES NOT MOVE THIS ROW.** `navigate-no-door` and `second-writer-while-away` are **diagnostic controls, not cells of the 7×6** — `tools/q1_f5_matrix.py` declares `FAMILIES = METADATA + APPEND` and six `ORDERINGS`, and exposes those two only as command-line flags (`--navigate-no-door` `:1497`, `--second-writer` `:1501`). Two GREEN controls are evidence about a cause; they are not table cells |
| **P-6** | The **Q1 observation window** has closed | 🔴 **NOT MET** | `PROGRAM-MANIFEST.md` C-8: *"⏳ **FALSE — the window is still open**"*, *"the window runs to **2026-09-19 00:45 ET**; one clean reading inside it is not the window closing"*. ⛔ And the interaction is not incidental: the manifest states *"⛔⛔ **R IS THE SECOND WRITER THE MANIFEST WARNED ABOUT.** §2: 'a second writer to the note save path is exactly what Wave R's capture work would add.'"* The Q1 gate's **trigger 2** is *"a fork not attributable to a genuine second writer"* — flipping four capture doors ON mid-window adds append writes to the population that trigger is measuring. ⚠️ Whether that formally blocks the flip or merely contaminates the read is **an owner call, not mine**; I record the mechanism, not a verdict |
| **P-7** | **T-12**, the pre-launch authenticated smoke, PASSES | 🔴 **NOT MET** | `PROGRAM-MANIFEST.md` C-7: *"⏳ **FALSE — 7 of 9 steps PASS**"*; steps 7 and 8 INCONCLUSIVE with named runner limitations, *"the `owner-rig` identity run has not happened"*, *"Seven of nine is not a gate that passed."* §6 calls T-12 *"the gate that outranks every row above"* and states *"the charter's goal — 'on for members' — is gated on something no amount of building moves."* ⛔ It also carries one **unexplained product finding**: *"the member's first action … returned `POST /api/j2/notes` **500 twice**"*, with no deploy in flight |
| **P-8** | The **R-27 flag-on deploy rows (B1–B6)** are satisfiable and planned | ⏳ **PROCEDURE EXISTS, NOT YET RUN** | `docs/notebook/deploy-checklist.md` §B names this flip by name: *"A flag-on deploy is any deploy that turns a feature ON for members: the offline flip, **Wave R's flag**, and every later wave's."* Rows: **B1** the feature's own canary; **B2** `python tools/postdeploy_client_smoke.py`, app-wide, exit 0, within ten minutes (the tool is on disk); **B3** run with the opt-in key UNSET — ⛔ *"`'0'` is NOT unset"*; **B4** every top-level route navigated by CLICKING; **B5** render stability, React commits stable across 5s idle; **B6** ledger/manifest row updated with the flip time and the SHA. ⛔ **B2 is H4: a failure means roll back first, diagnose second** |
| **P-9** | The manifest's R-1a row tells the truth about the door | 🔴 **NOT MET — owed, and it rides the flip** | `PROGRAM-MANIFEST.md:204` still reads `🔴 **gap**` for R-1a, while §10.28 of the same file says *"⛔⛔ **R-1a IS NOT A GAP. THE DOOR IS BUILT, MERGED TO MASTER, AND DARK**"* and calls the contradiction *"this programme's single most-repeated defect"*. The row must be corrected in the same push that records the flip (B6), together with a Runs row in `deploy-checklist.md` |
| **P-10** | The **git provenance** of the door is settled | 🔴 **UNKNOWN — must be settled before merging toward it** | `PROGRAM-MANIFEST.md` §10.28: *"⚠️ One thing still unsettled and NOT to be assumed: `wave-all-RESUME-HERE.md` places R-1a in a different worktree at `adbcbcdf8`. That commit exists and the door file exists there too. Whether that line describes this same code or a second implementation is **UNKNOWN** and must be settled before anything is merged toward it."* ⛔ This session was instructed to run no git command, so it is unresolved here. One line settles it: `git log -1 --format=%H -- app/src/pages/charts/widgets/ScannerResults.jsx` in both worktrees |
| **P-11** | The **flip commit's own rails** are amended and the gate is clean | ⏳ **NOT YET DONE — it cannot be, before the flip exists** | §1.4's five assertions. `deploy-checklist.md` A3: *"full sharded gate, **0 NEW failures** vs the named baseline"*; A4: the gate ran on a clean tree, hash identical at start and end. ⛔ And the standing rule: run the suite in its OWN tool call, **before** `git commit`, never chained |
| **P-12** | An explicit owner **"deploy"** plus a member-impact paragraph they have read | 🔴 **NOT MET** | `deploy-checklist.md` A1/A2, and A2's history is this exact wave: *"⚰️ R-25's paragraph said the Wave R capture tools were 'switched off' when no gate existed at all — found on 2026-09-11 by doing exactly this."* The paragraph is §7 below and must be checked clause by clause against the tree being pushed, not against this document |

### 4.1 The one-line reading of the table

**P-2 is the row that matters, and P-3 is why it might now be a different colour than it
was.** The fix for the mechanism that plausibly caused the RED cell is in the tree and
recorded as shipped; the RED cell itself has not been re-run against it. ⛔ **A shipped fix
is not a re-measurement, and the finding's own H14 row 3 is still open.** Until
`append_widget_embed × drain-first` is re-driven on production and comes back GREEN, this
packet's honest state is: *the door is built, the instrument that would clear it exists, and
the reading has not been taken.*

### 4.2 Conflict recorded rather than resolved silently — the push window

`deploy-checklist.md` A6 reads *"push window: **NOT Mon–Fri 09:00–16:00 ET**"*.
`PROGRAM-MANIFEST.md` §12 (later, 2026-09-12) reads *"⭐ **The Notebook program is `app/**`
web-only and has no deploy window.** It never touches flow-worker's watch list"*, and
`docs/runbooks/deploy-windows.md` Tier 1 covers *"Docs, markdown, `tests/**`, `tools/**`,
`scripts/**`, and frontend (`app/**`)"* as **push any time**. Later-wins gives the runbook
and §12. ⚠️ **The residual cost A6 names is real and survives**: a `web` restart can lose an
APScheduler slot outright, so do not land this in the minute before a scheduled job. And §12's
rule is not a window but a queue: *"⛔ **Merges serialize: one at a time, Railway web SUCCESS
before the next.**"*

---

## 5. OBSERVATION WINDOW + VERDICT RULE

**Window: 7 days from the `web` SUCCESS that carries the flip**, matching Wave Q1's idiom
(`wave-q1-sunday-gate.md` §5a: *"The 7-day window continues from the flip timestamp … Nothing
to do but let the sampler run."*).

⛔ **The first ten minutes are a separate, harder gate, and they come first**: B2, the
app-wide client smoke, exit 0 required. `deploy-checklist.md`: *"⛔⛔ B2 IS H4: A FAILURE
MEANS ROLL BACK FIRST, DIAGNOSE SECOND."* Its three exit codes are three different facts —
`0` PASS, `1` a MEASURED failure, `2` INCONCLUSIVE. **INCONCLUSIVE is not a pass, and it is
not a rollback trigger either.**

### 5.1 What is watched

| # | signal | where it is read | what counts |
|---|---|---|---|
| **1** | **A capture that does not survive a drain** — the P-2/P-3 loss mode, and the reason this window exists | a member report, or the F5 driver's own trail on the rig (`tools/q1_f5_matrix.py`, the `append_widget_embed` row) | the member presses Send to Journal, sees it confirmed, and the embed is later absent from the note. ⛔ This is content loss and it is a **REVERT**, not a bug report |
| **2** | `(conflicted copy)` notes not attributable to a genuine second writer | notes tagged `sync-conflict`; the Q1 sampler's `sync-conflict notes` column | the Q1 gate's trigger 2 verbatim, and §3 of `wave-q1-sunday-gate.md` owns the attribution rules. ⛔ **A capture door IS a second writer to the save path**, so after this flip that attribution list needs one more entry — *"a capture door fired in this browser"* — or every real forked note reads as unattributable. Adding it is part of the flip, not an afterthought |
| **3** | Members discovering the door at all | `GET /api/j2/notebook-validation-report` (admin session **or** `Authorization: Bearer $PUSH_SECRET`), field `multipleMembersDiscoveredSaveToNotebookUnprompted` — *"distinct non-admin members with a `notebook_capture_saved` event"* | the numerator for "did this reach anybody". ⚠️ **It does not split by door**: `sendToJournal.js:26` sends `props: { widgetId, target, hasTradeRef }`, and the report counts distinct users for the event regardless of `widgetId`. The props ARE persisted (`journal_two.py:114-127` → `log_activity(user_id, "j2:notebook_capture_saved", json.dumps(props)[:500])` into `activity_log`), so a per-door split is available **from the pod's database and from no endpoint** |
| **4** | Any unexplained red in the Q1 sampler, and any offline-layer console error | `docs/notebook/wave-q1-observation-log.md` via `tools/nb_observe.py` | triggers 1 and 4 of the Q1 gate, unchanged — the flip does not get its own definition of "red" |
| **5** | The app-wide health the flip could break without touching | `tools/postdeploy_client_smoke.py`, re-run at least once inside the window | ⭐ the 2026-09-10 navigation freeze is why: *"A green suite, a 200 and a rising uptime are all compatible with a browser that cannot change pages."* |

### 5.2 The verdict rule

Write `docs/notebook/r-1a-flip-verdict.md` at the end of the window, in the Q1 shape:

```
VERDICT: KEEP | REVERT
at:      <timestamp ET>
flip SHA / web SUCCESS at: <...>
rows read: <n> rows, <first> .. <last>
B2 post-deploy smoke:                PASS/FAIL/INCONCLUSIVE  <exit code, artifact>
signal 1 (capture lost after drain): PASS/FAIL  <evidence>
signal 2 (unattributable fork):      PASS/FAIL  <evidence>
signal 3 (discovery):                <count>    <a reading, not a pass/fail>
signal 4 (unexplained red/console):  PASS/FAIL  <evidence>
signal 5 (app-wide smoke in-window): PASS/FAIL  <exit code>
```

- **REVERT** on: **any** instance of signal 1 (a capture that did not survive); a fork under
  signal 2 that is not attributable to a genuine second writer; B2 or signal 5 exiting `1`;
  an unexplained red under signal 4.
- **KEEP** on: none of the above, over a window that actually ran.
- ⛔ **INCOMPLETE, never REVERT**, when a row could not be read. *"'I could not parse it' and
  'it is bad' are different facts, and this wave has now conflated them three times."*
- ⛔⛔ **A KEEP over zero members who ever saw the door is what clean looks like over an
  EMPTY SET.** C-8 already records this trap for Q1 (*"a KEEP over **zero organic members**
  is what clean looks like over an EMPTY SET"*). Signal 3 is the denominator; if it reads
  zero, the verdict line must say **KEEP (empty set)** — the window has then proved that the
  flip broke nothing, not that the door works.
- ⛔ **This gate does not deploy.** A REVERT verdict is written to the file for a person to
  act on.

---

## 6. ROLLBACK

**There is ONE lever, and it is a deploy. State the latency honestly.**

| step | action | how long |
|---|---|---|
| 1 | Revert the flip commit — `WAVE_R_CAPTURE_ON` back to `false`, **and the five rail amendments back with it**. The rails and the constant are one unit; reverting half of them leaves a red gate | the revert commit |
| 2 | Push to `master` — **one master merge at a time**, and this one jumps the queue | — |
| 3 | Wait for the `web` rebuild | **103–138 s measured** (`kill-switch-flip-packet.md` §6, for the sibling frontend revert). ⚠️ One measurement range, taken on a different commit; treat it as an expectation, not a guarantee |
| 4 | Verify **by the artifact**: `railway deployment list --service web --json` shows the revert SHA **SUCCESS**, and `/api/health` `uptime_seconds` has RESET on a fresh boot. ⛔ Re-probe — right after a swap the old pod can still answer | ~1 min |
| 5 | Verify **the product**, not the source: on a clean profile with the key unset, the two `aria-label`s are absent from `/charts` (§2.3) | ~1 min |

⛔⛔ **STEPS 1–5 DO NOT REACH AN OPEN TAB.** Every member already running the flipped bundle
keeps the doors until they reload. There is no service worker and no version prompt.
**"Rolled back" means "no NEW page load gets it."**

⛔ **For one member who needs it off NOW**, in their own browser console:
`localStorage.setItem('uct.nb.capture.enabled','0')` then reload. That is the only
faster-than-a-deploy lever that exists, it is per browser, and it is not an ops action.

⚠️ **There is no pre-authored rollback branch for this flip**, unlike Q1's
`rollback/notebook-offline-default-off` @ `3db89e205`. ⭐ **Author one before flipping** — a
prepared revert, gated green with the constant back at `false`, is the difference between a
three-minute rollback and a three-minute rollback that starts with writing a diff under
pressure. That is a recommendation, and it has not been done.

⛔ **Rolling back the DOORS does not remove the DATA, and must not.** An embed a member
already captured stays in their note and keeps rendering — `captureRelease.test.js`:
*"⛔⛔ OFF IS NOT DELETED — a note that already stores such an embed still renders"*, asserted
by the registry still describing the type with its params schema intact.
*"Turning a door off has never been permission to stop honouring what a member already
saved."*

---

## 7. MEMBER IMPACT

**Required by the standing owner ruling for anything touching master, and by
`deploy-checklist.md` A1/A2 — which requires it to be checked clause by clause against the
tree being pushed.**

**Today, before any flip, a member cannot put a scan, a chart or a market-context view into a
note from anywhere outside the Notebook.** The tools exist in the product they are using and
are switched off: on `/charts` the scanner's header carries its columns, density and refresh
controls and nothing else; right-clicking a ticker anywhere in the app offers Flag, tags, Add
to list, Compare and Set alert, and no way to send that chart to a note; the add-widget,
add-tab, phone and journal-slash menus do not list the Indexes or Market Context widgets at
all. If they want a scan in their trading journal, they retype it.

**The moment this flips, on their next page load, four things become possible that were not:**

1. **On `/charts`, a member looking at one of the six preset scans can put the whole list into
   a note in one click.** A journal icon appears in the scan header; pressing it freezes the
   scan as it stands — each ticker with its price and its ±% at that moment — into their most
   recent note, or into the Notebook inbox when there is no fresh one, and tells them which
   happened. The chevron beside it opens a small panel where they can type a comment and
   choose the destination: the note they are working in, a new entry, or the inbox.
2. **Right-clicking any ticker anywhere in the app offers "Send {TICKER} chart to note"** — a
   daily chart, frozen at that moment, with the same three destinations.
3. **Two new widgets, Indexes and Market Context, become available** in the add-widget,
   add-tab, phone and journal menus — index levels and the day's move, and phase, exposure and
   breadth in one read. They exist to be captured into a note.
4. **What they capture is a SNAPSHOT and it stays one.** A scan sent to a note in March still
   shows March's tickers at March's prices when it is opened in September. It never silently
   re-runs and never quietly changes what it says.

**What does NOT change:** nothing a member already wrote, saved or captured is touched. No
note is migrated, no stored embed renders differently, no existing menu item moves, and the
Notebook's own behaviour — how it saves, what happens offline, what happens on a conflict —
is exactly what it was. A member who never opens `/charts` and never right-clicks a ticker
sees no difference at all.

⛔⛔ **THE HONEST WARNING THAT MUST TRAVEL WITH THIS PARAGRAPH, AND WHICH IS WHY THE FLIP IS
HELD:** a capture fired from `/charts` is not queued when the member is offline. The R spec is
blunt about it — *"⛔⛔ STATE THIS PLAINLY, BECAUSE IT IS COUNTER-INTUITIVE: A CAPTURE DOOR IS
NOT QUEUED"* — the member sees **"Capture failed — try again"**, and nothing is stored
anywhere. That is a real gap, it is honest and loud, and it costs one click after reconnect.
**The gap that is NOT honest is P-2/P-3**: a capture that reports success and is then removed
from the note when a queued edit drains. Until that cell is re-measured GREEN on production,
**no release note may say that captures are safe**, and this paragraph may not be shortened to
the four cheerful bullets above.

---

## 8. ⛔ UNKNOWN — explicitly, and none of it guessed

**U-1 · Is `append_widget_embed × drain-first` still RED?** The mechanism traced in
`wave-q1-f5-append-merge-finding.md` has a fix in this worktree (`outboxDrain.js:171`) that
`deploy-checklist.md` records as shipped (`54393f890`). **Nobody has re-driven the RED cell
against it.** Its own H14 row 3 — *"check the live build"* — reads **"⛔ OPEN"**. This is the
single measurement that would move this packet, and I did not take it.

**U-2 · Is the fix on `origin/master` and in the served bundle?** I was instructed to run no
git command, so I read the working tree and a docs row — and a docs row is the artifact most
likely to be stale. Settle it with
`git show origin/master:app/src/pages/journal-2-0/lib/offline/outboxDrain.js` plus the
transitive served-chunk walk of `PROGRAM-MANIFEST.md` §10.18; `ringVouchedPlan` has
distinctive strings, unlike the boolean in §2.3.

**U-3 · Which commit put the door in THIS worktree.** `PROGRAM-MANIFEST.md` §10.28 names
`9666842d0` and `046214a82` as ancestors of `origin/master`; `wave-all-RESUME-HERE.md:136`
places R-1a in `uct-worktrees/notebook-r4a` at `adbcbcdf8`. Whether those describe one
implementation or two is **UNKNOWN** (§10.28 says so in the same words) and I cannot settle it
without git. Same fact as P-10.

**U-4 · Is §1.4's list of OFF-state rails complete?** Derived by searching `app/src` for the
four symbols the gate is expressed in. A rail asserting the OFF state behaviourally, naming
none of them, would not be found that way. The authority is a gate run on the flipped tree.

**U-5 · Does a `/charts` capture count as F5's "offline route change away from the Notebook"?**
The R spec's UNKNOWN-5 says the same thing and marks it as *"a reading of the F5 diagnosis, not
a measurement"*. ⭐ Since that spec was written, P-1's two GREEN controls have narrowed it
considerably — navigation alone is not sufficient, and navigation plus a server-side move is
not sufficient — which points at the door itself rather than the route change. **That
reasoning is mine and is not a measurement either.** The F5 owner confirms it.

**U-6 · Whether the flip may land inside the Q1 observation window.** P-6 records the mechanism
(R is the second writer Q1 went first to protect against; the window closes 2026-09-19 00:45
ET; trigger 2 counts forks). **Whether that is a block, or a contamination the owner accepts,
is an owner decision and I did not make it.**

**U-7 · The scanner door's phone surface.** I did not trace whether the scanner widget's header
action row renders at phone width, nor whether the phone shell reaches it at all. The R spec's
UNKNOWN-4 records the same gap for the `/screener` shell and says to answer it by driving the
real layout. **Unmeasured here.**

**U-8 · Whether anything outside `app/src` reads `WAVE_R_CAPTURE_ON`.** I searched `app/src`. A
tool, script or doc generator that reads the constant's text would not appear in that search.

**U-9 · The exact web rebuild latency for THIS commit.** §6 step 3 borrows Q1's 103–138 s
measurement. It was taken on a different commit, and one range is not a rate.

---

## 9. WHAT THIS PACKET DOES NOT AUTHORISE

- **It does not flip anything.** `PROGRAM-MANIFEST.md` C-10: *"No capability is member-visible
  that the owner has not flipped"*.
- **It does not authorise a per-door release.** The switch as built is one constant and four
  doors (§1.3). Splitting it is a code change and its own packet.
- **It does not authorise the `/screener` page door.** That is Part B of
  `r-1a-screener-capture-door-spec.md` — still to be built — and that spec's §6 non-goal 7
  stands: *"Not the flag flip. Build dark. `WAVE_R_CAPTURE_ON` stays `false` in every commit
  this spec authorises."*
- **It does not lift the F5 freeze**, and it does not change `F5_OPEN`.
- **It does not claim the capture path is proved safe on production.** Read §4.1 and U-1
  again.
