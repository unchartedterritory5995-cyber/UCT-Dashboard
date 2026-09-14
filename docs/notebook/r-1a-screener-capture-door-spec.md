# R-1a — Scanner / Screener capture door · SPECIFICATION

**Track:** Wave R, row **R-1a** (`docs/notebook/PROGRAM-MANIFEST.md` §4 · "R-1 · Import
any chart-page widget into a note").
**Status of this document:** spec only. No product code, no tests, no git was run
while writing it.
**Written:** 2026-09-13, against the working tree of
`C:\Users\Patrick\uct-worktrees\notebook-k`.

---

## §0 ⛔⛔ READ THIS FIRST — THE PREMISE OF R-1a IS HALF FALSE IN THIS TREE

R-1a was written down as *"the Screener has an embed renderer and embed params and
**no capture door**"*. That sentence is **true of one surface and false of the
other**, and the two surfaces are different components with different data.

**Measured from the files in this worktree, not recalled:**

| surface | what it is | door? |
|---|---|---|
| the **`scanner` widget** — `app/src/pages/charts/widgets/ScannerResults.jsx` | the charts-page preset scanner (6 preset scans: `highest-volume-1y`, `highest-volume-ever`, `ipo-1y`, `top-gainers-30d/60d/90d`) | ✅ **A DOOR EXISTS AND IS BUILT**, header action row, one-click + choose-where, gated dark |
| the **`/screener` page** — `app/src/pages/Screener.jsx` → `app/src/pages/screener/shell/ScannerShell.jsx` | the member-authored full-market screen (filters, saved screens, share tokens, CSV export) | 🔴 **NO DOOR OF ANY KIND** |
| the **saved-screen run** — `app/src/components/screener/ScanResults.jsx`, mounted by `app/src/pages/screener/ScreensManager.jsx:688` | the results of running one saved **AST screen** (`RunNowButton` → a four-bucket receipt + the hits, carrying the definition) | 🔴 **NO DOOR OF ANY KIND** |

⚠️ **Three surfaces, not two, and the third was a surprise.** I expected
`app/src/components/screener/` to be dead code; it is not. `ScanResults.jsx`,
`RunNowButton.jsx` and `scanSession.js` are imported by `ScreensManager.jsx`
(lines 8–10) and `StructureProvenance.jsx` by `ScannerShell.jsx:3`. **This spec
scopes Part B to the `/screener` page only** (§3), because that is the surface the
moat sentence names and the one whose payload I traced end to end. The AST-screen
run surface is recorded here as a real, adjacent gap — see UNKNOWN-8.

Proof for the first row, quoted from `ScannerResults.jsx`:

> `// ─── Wave R (R-1a): the Screener's send-to-Journal door ─────────────────` (line 125)

> ```js
> const scanActions = (captureEnabled() && symbols.length > 0) ? (
> ```
> (line 256)

…with `sendCaptureToJournal('scanner', buildScanCapture(), { label: doorLabel })`
at line 263, the `CaptureMenu` picker beside it, a release gate
(`app/src/widgets/captureRelease.js`) and a rail file
(`app/src/pages/charts/widgets/ScannerResults.journalDoor.test.jsx`).

Proof for the second row: `grep -rn "sendCaptureToJournal\|CaptureMenu"` over
`app/src/pages/screener/` and `app/src/components/screener/` returns **nothing**.
The only hit for the word "journal" in those trees is a retirement comment in
`app/src/components/screener/reachable.test.js:334`.

**Two consequences, and both change what should be built:**

1. **Do not re-implement the `scanner` widget door.** It is written, gated and
   railed. Its remaining work is a *release* problem, not a build problem — §2.
2. **The row that is still genuinely open is the `/screener` page**, and that is
   the surface the master-architecture doc actually names. Its sentence is
   *"screener/scanner results … used as the flagship trading-journal-moat
   example"* (`docs/notebook/primary-platform-master-architecture.md`, "Future
   capture sources"). The readiness scorecard says the same thing in the sharper
   form: *"4 major surfaces (Screener, Options Flow, COT Data, Model Book) have no
   capture door"* (`docs/notebook/primary-notebook-readiness-scorecard.md:65`).
   A member who builds a custom screen on `/screener` — the thing the moat example
   is about — still cannot put it in a note. **That is Part B of this spec.**

⚠️ **What I could not determine.** This session was instructed not to run any git
command, so I cannot say *which branch or commit* put the `scanner` widget door in
this worktree, nor whether `docs/notebook/wave-all-RESUME-HERE.md:136` ("R-1a ·
`uct-worktrees/notebook-r4a` · `feat/notebook-wave-r` · `adbcbcdf8` · ⛔ **HELD**")
is describing the same code I am reading here or a different copy of it. **Someone
with git must settle that before merging anything from this spec** —
`git log -1 --format=%H -- app/src/pages/charts/widgets/ScannerResults.jsx` in both
worktrees is the one-line answer. Until then, treat §2 as a description of the
files in front of me and nothing more.

---

## §1 ⛔⛔ THE Q1-F5 FREEZE — WHAT THIS SPEC MAY AND MAY NOT START

### The rule, quoted from the rail that enforces it

`app/src/pages/journal-2-0/lib/offline/f5Freeze.test.js`:

> ⭐ SO THE RULE IS NARROW AND MECHANICAL: until F5's table is green, a branch may
> not change the client call sites of those three doors, nor the drain's
> classification, nor the settle. Everything else in these files is open …

> ⛔ WHY A FREEZE RATHER THAN CARE. **"R-1a extends Send-to-Journal; building on a
> door whose append-only merge isn't proven live is building on sand."**

That second paragraph names **R-1a by id**. This spec is the thing the freeze was
written about.

### The frozen set, verbatim from `FROZEN_CALLS` / `FROZEN_FILES`

The unit of the freeze is **the call, not the file** — the rail matches each door
by the exact URL literal that opens it:

| family | file | the frozen line |
|---|---|---|
| `append_document_excerpt` | `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` | `` `/api/j2/notes/${noteId}/excerpts` `` |
| `append_financial_fact` | `app/src/pages/journal-2-0/lib/captureFinancialFact.js` | `` `/api/j2/notes/${noteId}/facts/${fact.id}/insert` `` |
| `append_widget_embed` | `app/src/pages/journal-2-0/lib/captureTargets.js` | `` `/api/j2/notes/${noteId}/embeds` `` |
| `append_widget_embed` | `app/src/pages/journal-2-0/components/AddPositionModal.jsx` | `` `/api/j2/notes/${noteId}/embeds` `` |
| `append_widget_embed` | `app/src/pages/journal-2-0/lib/importer/enrichment.js` | `` `/api/j2/notes/${noteId}/embeds` `` |

plus two whole files, frozen because the production measurement will be read
against them: `offline/serverChange.js` and `offline/settleNoteWrite.js`.

### ⭐ THE LOAD-BEARING CONSEQUENCE FOR R-1a

**A new capture door does not have to touch any of those five lines.**
`captureTargets.js` is a *destination registry* — it is called with
`(widgetId, attrs)` and knows nothing about which surface produced the capture:

> One registry, so a destination added here is available from every widget's door
> at once, and a widget added later gets every destination for free.
> — `captureTargets.js` header

So a fourth capture **source** is additive at the *caller*, and the frozen call
site is downstream of it, unchanged, byte for byte. **Almost all of R-1a Part B is
FREE to build today.** What is genuinely blocked is narrower than "R-1a": it is
(a) any edit to those five lines, (b) the flag flip that puts either door in front
of a member, and (c) the merge. See §7 for the file-by-file table.

### Why the *merge and the flip* still wait

The held reason is recorded in `docs/notebook/wave-all-RESUME-HERE.md:136`:

> ⛔ **HELD** until F5's route-change question is settled — R-1a's scanner door
> fires from a route change by definition

and the current table state, quoted from the same file, §4:

| | |
|---|---|
| GREEN | `folder × drain-first` |
| RED (unpublished) | `append_widget_embed × drain-first` |
| INCONCLUSIVE | `append_document_excerpt × drain-first` (named rig limitation) |
| N/A, with reason | the three `append_* × settle-first` cells |
| not yet run | the remaining cells of the 7 × 6 |

and the diagnosis, verbatim:

> ⭐ **The document load is ELIMINATED as the cause.** What remains between the
> GREEN cell and the RED one is the **offline route change away from the Notebook
> while work is queued**, and/or **the append door itself** — still confounded.

The "navigation cells" this track is held on are therefore the
`append_widget_embed` rows measured across the return paths named there
(*document-load return*, *SPA return*), against the six orderings enumerated in
`tools/q1_f5_matrix.py::ORDERINGS`.

⛔ A capture door on `/screener` **is** an offline route change away from the
Notebook: the member is on `/screener`, not in the editor, and the capture lands
in a note they are not looking at. R-1a Part B is in the same confounded zone as
the RED cell. **This is why the flip waits even though the code is free to write.**

---

## §2 PART A — THE `scanner` WIDGET DOOR THAT ALREADY EXISTS

This section is a *record*, not a work item. Nothing here should be rebuilt.

**Surface.** Two buttons in the scan header action row, reaching the screen through
`Watchlists`' `scanActions` slot (`app/src/pages/Watchlists.jsx:2535`,
`{scanMode && scanActions}`): a one-click journal icon and a chevron that opens
`CaptureMenu`. The file states why the footer was not used, and it is worth keeping
because it is the one place the owner's earlier ruling is reconciled:

> ⚰️ HISTORY, so this isn't re-litigated: a door existed here once (`2dc852ced`) and
> was removed in `76c5f4a80` — "removed the send-to-Journal button from the results
> FOOTER (owner: not needed)". … The footer icon is what was declined; the door
> itself is required by the program manifest's R-1a …

**Payload.** `buildScanCapture()` (line 230) freezes
`{scanKey, scanName, asOf, rows:[{sym, price, chgPct, extraValue?}]}` — the whole
result list, built **once per interaction** and shared by both buttons so a 30s
poll landing while the member types a comment cannot swap the list underneath them.

**Absent, not disabled, when empty** (line 256, `symbols.length > 0`), because an
empty `rows` fails the registry's own `reconstructable` predicate.

**Release gate.** `app/src/widgets/captureRelease.js` — `WAVE_R_CAPTURE_ON = false`,
per-browser opt-in `localStorage['uct.nb.capture.enabled'] = '1'`, read **at render**
in the two buttons so it follows immediately.

**What is left for Part A**, all of it gated on §1:

1. the F5 navigation cells going green or named;
2. `WAVE_R_CAPTURE_ON = true` in **one** commit, with a member-impact paragraph
   that the code actually honours (that requirement is itself the reason
   `captureRelease.js` exists — read its header);
3. a Q1 real-door canary **after** the merge, per the manifest's per-track standard.

---

## §3 PART B — THE `/screener` PAGE DOOR (the work this spec authorises)

### 3.1 The door's surface

**Where it lives:** a new slot on `ShellToolbar`, beside `reviewBar` and `saveBar`.
The precedent is stated in that component's own comment
(`app/src/pages/screener/shell/ShellToolbar.jsx:195`):

> ⭐ THE REVIEW DOOR SITS WITH THE OTHER ACTIONS ON THE RESULT SET (Columns,
> density, CSV) rather than beside the filters — **it acts on the answer, not on
> the question.** A SLOT for the same reason `saveBar` is one: this toolbar renders
> chrome and must not learn what a review session is.

A capture door acts on the answer. It goes in the same group, to the right of
`CSV`, as a third `journalBar` slot. `ShellToolbar` must not learn what a capture
is, exactly as it does not learn what a review session is.

**What it is called.** Match the other page-level doors byte for byte — the strings
on `Watchlists.jsx` and `ThemeTrackerPage.jsx` are `title`/`aria-label`
`"Send to Journal — choose where"` for the chevron; the one-click button on
`ScannerResults.jsx` uses `"Send this scan to Journal"`. For `/screener`:

- one-click: `aria-label="Send this screen to Journal"`, `<UIcon name="journal" size={13} />`
- chevron: `aria-label="Send to Journal — choose where"`, `<UIcon name="chevronDown" size={13} />`

**Component to match:** `app/src/pages/charts/widgets/ScannerResults.jsx` lines
256–285 — the same four imports (`sendCaptureToJournal`, `captureEnabled`,
`useJournalToast`/`JournalToast`, `CaptureMenu`), the same one-click-plus-chevron
pair, the same `setJournalMsg('sending…')` then `setJournalMsg(await …)` sequence.
Do **not** hand-roll a second flow; the header of `sendToJournal.js` says why
(*"a second hand-rolled copy of this flow is how doors drift"*).

**What a member sees.**

- *Before:* the toolbar reads `3,745 matches · Snapshot 2026-09-12 ⚡ LIVE 10:42 ·
  Columns · ▤ · CSV · Review charts · Screens ▾`. Nothing else.
- *After one click:* the journal icon, then a toast — `<JournalToast>` in the same
  position idiom the other page door uses (`Watchlists.jsx:2477` pins it
  `position: fixed, top: 58, right: 16`) — reading
  `Momentum breakouts sent to "Tuesday plan"`, or
  `Momentum breakouts captured → Notebook inbox` when there is no fresh note.
  The toast lines are produced by `captureTargets.js`, not by this door.
- *After the chevron:* `ContextPopover` titled **"Send to Notebook"** with an
  optional comment box and the destination list — `Current note` / `New entry` /
  `Notebook inbox`. `copyChartLink` does not appear: its `appliesTo` requires
  `widgetId === 'chart'`.
- *Absent, not disabled,* when the scan has returned no rows, and when
  `captureEnabled()` is false. Same rule and same reason as `ScannerResults.jsx`.

### 3.2 The payload — ⭐ SNAPSHOT, and the argument

**RECOMMENDATION: SNAPSHOT.** The note stores the rows as they stood. The screen's
*definition* rides along as provenance and as a re-run affordance, but it is never
what the embed renders.

**Four reasons, each measured rather than argued from taste.**

**① The registry already decided it, in code.** `app/src/widgets/registry.js:242`:

```js
reconstructable: (p) => Array.isArray(p?.rows) && p.rows.length > 0,   // scans are strictly as-of-now, no date parameter
```

`ScannerEmbed` renders `params.rows` through `FrozenList` and reads nothing else.
A reference embed would have to make `reconstructable` mean something new for one
producer — and `isReconstructable` is what decides whether a note shows the embed
or a placeholder chip.

**② A re-run cannot answer the question, because the data underneath it is
replaced nightly.** `app/src/pages/screener/hooks/useScreenerScan.js`, header:

> Debounced POST `/api/screener/scan` whenever the spec changes. A null spec skips
> fetching. **Filtering uses the nightly snapshot** (live prices overlay the result
> rows for display only).

The snapshot is rebuilt at 03:00 ET (`ShellToolbar.jsx` renders the seal as
*"every column on this screen is from the 03:00 build"*). Re-evaluating a March
spec in September screens **September's universe**. The rows would not be stale;
they would be *a different question's answer under March's heading*.

**③ There is no as-of parameter to ask for, so REFERENCE is not merely worse — it
is unimplementable.** `api/routers/screener.py`:

```python
class ScanSpec(BaseModel):
    filters: list[dict] = []
    sort: dict | None = None
    view: str = "overview"
    columns: list[str] | None = None
    page: int = 1
    page_size: int = 50
```

No date. `snapshot_date` is something the server *reports* about the rows it
served, never something a caller can request. Nothing in the screener service
retains prior snapshots to query. A REFERENCE embed would have to invent an
as-of-capable screener API, which is a wave of its own and is **not** what R-1a is.

**④ It is the invariant this codebase already enforces at every other capture.**
`widgetEmbedCore.js`:

> Frozen means ANCHORED. A chart capture arriving with NO `to` … gets the insert
> moment stamped, or the "snapshot" fetches a today-ending window forever under a
> months-old caption.

**Consequence of each choice for a member reading the note six months on:**

| | SNAPSHOT (recommended) | REFERENCE (rejected) |
|---|---|---|
| what the note shows in March, read in September | the tickers that matched **that morning**, with the price and ±% they carried, under `as of 2026-03-13` | today's matches, under a March heading |
| can the member check the trade they took against the screen that produced it | **yes** — the row they bought is in the list, at the price it showed | no — the ticker may not be in the list at all, and there is no way to learn that it once was |
| what happens when a filter is renamed or retired | nothing; the frozen rows are self-contained | the embed either errors or silently screens something else |
| failure mode | the note is honestly old, and says so | **the note silently rewrites its own evidence** — a journal that edits its own history is worse than no journal |

⭐ **The hybrid that keeps the useful half of REFERENCE.** Carry the spec in the
payload as *provenance*, and offer a **"Run this screen now"** action on the embed
that opens `/screener` with the spec restored (`specUrl.js`'s `s=` param, which is
already the codec for exactly this: *"The working screen as a URL: refresh/back/
forward safe. One codec, no second authority"*). Running it produces **a new
capture**, never a re-render of the old one. Snapshot renders; reference re-runs,
on demand, into a new block.

⚠️ Scope note: the "Run this screen now" affordance lives in `ScannerEmbed` and is
**optional for the first cut**. Ship the payload field that makes it possible; the
button can follow.

### 3.3 The payload, concretely

Reuse `widgetId: 'scanner'`. Do **not** mint a new widget id. Rationale: it touches
no renderer, no `WidgetEmbedView` lazy map, no `plainText`, no embed archive, and
no search indexing — every one of which would need its own rail. `ScannerEmbed`
already renders `scanName || scanKey` plus rows and needs no change to display a
screen.

```js
// build ONCE per interaction, shared by the one-click send and the picker
{
  scanKey:  `screen:${defId || specHash}`,  // required by paramsSchema; see UNKNOWN-2
  scanName: screenName || 'Custom screen',  // the saved screen's name, or this
  asOf:     `${snapshotDate}${liveAsOfEt ? ` · live ${liveAsOfEt}` : ''}`,
  rows:     capturedRows,                   // [{sym, price, chgPct, extraValue?}]
  // NEW paramsSchema keys — see §7, registry.js is FREE
  spec:        encodeSpec(workingSpec),     // specUrl.js codec, the `s=` string
  totalMatches: total,                      // what the toolbar said
  capturedRows: capturedRows.length,        // what is actually in this note
}
```

**Row shape** matches `FrozenList`'s reader exactly — `sym`, `note`, `extraValue`,
`price`, `chgPct`. Map `row.ticker` → `sym` (the screener's rows are keyed
`ticker`; `ScannerShell.jsx:111` reads `r.ticker`). Take `price`/`chgPct` from the
live-price overlay the shell already holds, so no new request is made.

⛔ **CAPTURE THE LOADED ROWS, AND PRINT BOTH NUMBERS.** The screener paginates —
`page_size: 50`, `total` can be thousands, and CSV export caps at 5,000. A frozen
list of 3,745 rows inside a note body is not a note. The honest shape is the one
the Review door already uses one line away, in `ScannerShell.jsx:246`:

> ⛔ THE LOADED PAGE, NOT `total`. The toolbar can read "3,745 matches" while 100
> rows have arrived; a review can only walk what the member can see, **so the
> button's own count is the honest number and it deliberately differs from the
> match count beside it.**

So: capture what the member has actually loaded, cap it (see UNKNOWN-1), and have
`ScannerEmbed` render the subtitle as **`N of TOTAL matches`** — never bare `N`,
and never bare `TOTAL`. A note that says `50 stocks` about a 3,745-match screen is
a lie the member will not catch six months later.

### 3.4 Endpoint + storage — unchanged, and that is the point

There is **no new endpoint**. The capture rides the existing append door:

```
POST /api/j2/notes/{note_id}/embeds        body: { attrs }
```

`api/routers/journal_two.py:1808`:

> 'Send to Journal': append one widgetEmbed node (client-built attrs) to a note's
> body, atomically, server-side.

**What the server stores** (`api/services/journal_two/notes.py:2215`,
`append_widget_embed`), in one transaction:

1. appends `{"type": "widgetEmbed", "attrs": attrs}` to `j2_notes.body_json.content`;
2. rewrites `body_plain` via `extract_plain_text` — which is how
   `searchText` (`[scanner: Momentum breakouts]`, from the registry's `plainText`)
   becomes searchable;
3. bumps `updated_at`;
4. rebuilds five sidecars, of which the one this door feeds is `j2_note_embeds`
   (`_sync_note_embeds`, line 245) — delete-and-reinsert, one row per embed,
   columns `(note_id, user_id, position, widget_id, symbol, timeframe, trade_ref,
   trade_ref_type, mode, captured_at)`, PK `(note_id, position)`.

A screener capture therefore lands `widget_id = 'scanner'`, `symbol = NULL`,
`timeframe = NULL`, `mode = 'snapshot'`, `captured_at` = the ISO stamp
`buildWidgetEmbedAttrs` put on the attrs. **Nothing on the server changes.** If a
server change turns out to be needed, that is a finding, not a task — stop and
re-derive, because it would mean the payload is not actually a `widgetEmbed`.

**The other two destinations**, also unchanged: `newNote` (`POST /api/j2/notes`
with the embed as the doc's first block) and `inbox`
(`POST /api/j2/inbox`, which carries `widgetId, params, searchText, capturedAt,
annotations, caption, tradeRef, tradeRefType`).

**Telemetry** is automatic: `sendToJournal.js::_logCaptureSaved` fires
`notebook_capture_saved` with `{widgetId, target, hasTradeRef}` from the one
function every door funnels through. Aggregate metadata only — never the captured
content. A `/screener` door gets this for free and **must not add a second event**.

### 3.5 The offline story

⛔⛔ **STATE THIS PLAINLY, BECAUSE IT IS COUNTER-INTUITIVE: A CAPTURE DOOR IS NOT
QUEUED.** I checked; the outbox has exactly two writers, both in
`offline/useDurableNote.js` (lines 286 and 402, via `putNoteWithIntent`), and both
belong to the **editor's own body save**. Every capture door is a plain `fetch`.

So, fired offline, the door's behaviour is:

1. `fetch('/api/j2/notes/{id}/embeds')` rejects;
2. `appendToNote` returns false → `CAPTURE_TARGETS.note.run` falls through to
   `pushToInbox`, which also fails;
3. the member sees **`Capture failed — try again`**, and **nothing is stored
   anywhere**. The capture is gone.

⛔ **This is a real product gap and this spec does not fix it.** Do not write
"offline capture is queued" into any release note. It is not. Queueing a capture
would mean a fourth outbox intent kind and a new drain classification — squarely
inside the frozen `serverChange.js`/`outboxDrain.js` decision code, and therefore
**forbidden until F5 lifts**, at which point it is its own row (Q2-B/C territory),
not R-1a's.

What R-1a Part B *must* do is fail honestly and loudly: the toast says the words
above, and the member's screen is still on screen, so re-firing after reconnect
costs one click. That is the whole offline contract of this door.

**The conflict shape this door produces: `APPEND_ONLY`.**
`offline/serverChange.js` names the three and explains why the classifier reads the
diff and not the caller:

> `APPEND_ONLY` — the server's body is the last-known body with whole blocks
> appended at the end, and every appended block is one the SERVER appends on its
> own behalf: `widgetEmbed` (Send to Journal), `financialFact` (a saved price),
> `documentExcerpt` (an excerpt capture). ⇒ MERGE those blocks into the queued body
> and send. No fork.

A `/screener` capture appends a `widgetEmbed` node, which is already in
`SERVER_APPENDED_TYPES` with identity
`` `${a?.widgetId}|${a?.capturedAt}|${a?.searchText}` ``. **No new node type, no
new identity function, no change to `serverChange.js`.** That is the single
strongest argument for reusing `widgetId: 'scanner'` rather than minting a new one:
the classifier does not have to learn anything.

⛔ **But the door still has to LAND ITS REVISION.** `settleNoteWrite`'s header is
the incident report for what happens otherwise:

> Exactly ONE of them recorded its landing. The other five advanced the server
> revision and told the drain nothing, so guard 2's `serverCopyIsOurs` answered
> "not ours" about this browser's own write and forked the note.

The landing happens **inside `captureTargets.js`** (`await settleNoteWrite(noteId, res)`),
which the new door reaches without modification. ⭐ **A `/screener` door that routes
through `CAPTURE_TARGETS` inherits the settle. A door that hand-rolls its own
`fetch` to `/embeds` would not, and would fork members' notes.** Do not hand-roll.

⚠️ And the honest caveat: `append_widget_embed × drain-first` is **RED on
production, unpublished** (§1). Part B rides the same wire as the RED cell. It is
not "safe because it reuses a proven path" — it reuses a path that is *under
measurement*. That is what the hold in §1 is for.

---

## §4 RAILS — and the mutation that reddens each

A rail that cannot fail is not a rail. Every row below names the single edit that
must turn it red, and every one of them is an edit to **product code**, never to
the rail.

| # | rail | what it asserts | ⛔ mutation that MUST redden it |
|---|---|---|---|
| R1 | `ScannerShell.journalDoor.test.jsx` — **new**, modelled on `ScannerResults.journalDoor.test.jsx` | with rows loaded and the flag on, the toolbar renders **both** door controls, found by `aria-label` in the real rendered DOM | delete the one-click button; delete the chevron |
| R2 | same file | **CONTROL** — with the scan holding no rows, **neither** control renders | change `rows.length > 0` to `true` |
| R3 | same file | one click POSTs to `/api/j2/notes/*/embeds` with `attrs.widgetId === 'scanner'` and `attrs.params.rows` equal to the loaded rows | make `buildScreenCapture()` read `total` instead of the loaded rows; drop `rows` from the payload |
| R4 | same file | what was frozen satisfies `isReconstructable('scanner', normalizeParams(...))` — the **registry's own predicate**, imported, not re-typed | let `rows` be `[]`; let a row lose `sym` |
| R5 | same file | **FROZEN MEANS ANCHORED** — with the picker open, a scan result that re-ranks underneath does **not** reach the note | re-derive the capture inside the picker's `send()` instead of passing the one built at open |
| R6 | same file | a failed send surfaces `Capture failed — try again`, in words | swallow the rejection and toast success |
| R7 | same file | the picker offers `note`/`newNote`/`inbox` and **not** `copyChartLink` | pass `widgetId="chart"` |
| R8 | same file, `describe('the host actually gives the door a home')` | a **source pin**: `ShellToolbar.jsx` both accepts `journalBar` and renders it — the anti-orphan check `ScannerResults.journalDoor.test.jsx` already carries, with its own non-vacuity assertion that the file was really read | declare the prop and never render it (the "built, tested, green and unreachable" shape) |
| R9 | `captureRelease.test.js` (existing, **extend**) | flag OFF ⇒ no door on `/screener`; flag ON ⇒ both — **both directions**, plus a control proving the absence is the gate and not a crash | remove the `captureEnabled()` read from the door |
| R10 | `offline/doorEnumeration.test.js` (existing, **derives**) | every client write to a revision-advancing route lands a revision before the next `fetch` in that file, or is a NAMED exception | hand-roll a `fetch` to `/embeds` in the screener door and skip `settleNoteWrite` |
| R11 | `offline/f5Freeze.test.js` (existing, **must stay green untouched**) | the five frozen call sites are still exactly where the freeze says, still settle, and `F5_OPEN` is still `true` | any edit to a frozen line — **which is the point**; if this file goes red, the branch is out of bounds |
| R12 | `registry.test.js` (existing, **extend**) | the new `scanner` params (`spec`, `totalMatches`, `capturedRows`) survive `normalizeParams`, and an old stored embed with none of them still passes `validateParams` | mark any new key `required: true` |

⛔ **R12 is not optional and it is the one most likely to be skipped.**
`normalizeParams` is a **whitelist** — it iterates `paramsSchema` and drops
everything else (`registry.js:746-756`). A `spec` key that is not declared is
silently deleted at capture time, and the loss is invisible until a member opens a
six-month-old note. And `required: true` on a new key would invalidate every
`scanner` embed already stored, which `validateParams`' own comment forbids:
*"Unknown keys are tolerated — a doc written by newer code must stay renderable by
older code."*

⚠️ **On mocking the host.** `ScannerResults.journalDoor.test.jsx` documents a
measured OOM when it rendered the real `Watchlists` (*"199s, `tests 0ms`, 'Worker
exited unexpectedly'"*) and mocks it, paying for that with an explicit source pin.
`ShellToolbar` is far smaller and should be rendered for real; if the full
`ScannerShell` proves too heavy, mock the shell and keep R8's source pin — but say
so in the file, in the same words, rather than letting a mock quietly own the
assertion.

---

## §5 FROZEN vs FREE — every file the implementation touches

| file | frozen? | why |
|---|---|---|
| `app/src/pages/screener/shell/ShellToolbar.jsx` | **FREE** | chrome only; adds a `journalBar` slot beside `reviewBar`/`saveBar`. Not a door, not the drain, not the settle. |
| `app/src/pages/screener/shell/ScannerShell.jsx` | **FREE** | builds the capture and passes the slot. Same category as the `reviewBar` it already renders. |
| `app/src/widgets/registry.js` | **FREE** | not in `FROZEN_CALLS` or `FROZEN_FILES`. Adds `spec`/`totalMatches`/`capturedRows` to the `scanner` `paramsSchema`. ⛔ additive only, nothing `required`. |
| `app/src/pages/journal-2-0/components/notebook/ScannerEmbed.jsx` | **FREE** | renderer. Subtitle becomes `N of TOTAL matches`; optional "Run this screen now". Not a write path. |
| `app/src/pages/journal-2-0/components/notebook/FrozenList.jsx` | **FREE**, and *prefer not to touch it* | already renders `sym/note/extraValue/price/chgPct`. Shape the payload to the renderer, not the renderer to the payload. |
| `app/src/widgets/captureRelease.js` | **FREE to read, HELD to flip** | reading `captureEnabled()` at render is free. `WAVE_R_CAPTURE_ON = true` is the release decision and waits for §1 + the owner. |
| `app/src/pages/screener/shell/ScannerShell.journalDoor.test.jsx` (new) | **FREE** | a new rail file. |
| `app/src/widgets/captureRelease.test.js` | **FREE** | extends an existing rail. |
| `app/src/widgets/registry.test.js` | **FREE** | extends an existing rail. |
| `app/src/pages/journal-2-0/lib/sendToJournal.js` | **FREE, but expect to change nothing** | it is generic over `widgetId`. If it needs an edit, the payload is wrong — stop. |
| `app/src/pages/journal-2-0/components/CaptureMenu.jsx` | **FREE, but expect to change nothing** | generic over `widgetId`. |
| **`app/src/pages/journal-2-0/lib/captureTargets.js`** | 🔴 **FROZEN — line 37** | `` `/api/j2/notes/${noteId}/embeds` `` is a `FROZEN_CALLS` entry. **Call it; do not edit it.** A new destination is also an edit to this file and is out of bounds until F5 lifts. |
| **`app/src/pages/journal-2-0/lib/offline/settleNoteWrite.js`** | 🔴 **FROZEN — whole file** | `FROZEN_FILES`. Inherited through `captureTargets`, never called directly by the new door. |
| **`app/src/pages/journal-2-0/lib/offline/serverChange.js`** | 🔴 **FROZEN — whole file** | `FROZEN_FILES`. The door produces an existing node type precisely so this file needs no edit. |
| **`app/src/pages/journal-2-0/lib/offline/outboxDrain.js`** | 🔴 **FROZEN in effect** | the freeze covers *"the drain's classification"*; `ringVouchedPlan` was the one amendment, on an owner ruling. Offline queueing of captures lives here and is **not R-1a**. |
| `app/src/pages/journal-2-0/lib/offline/f5Freeze.test.js` | 🔴 **do not edit** | it is the rail. Amending it requires an owner ruling, recorded in the file, as the 2026-09-13 amendment was. |
| `api/routers/journal_two.py`, `api/services/journal_two/notes.py`, `db.py` | **NO CHANGE EXPECTED** | if the server needs to change, the payload is not a `widgetEmbed` — stop and re-derive. |
| `docs/notebook/PROGRAM-MANIFEST.md` | **FREE**, and **owed** | the R-1a row still reads 🔴 **gap** while a door exists in this tree (§0). The row must be corrected by whoever settles the git question. |

**Start now:** every FREE row — the slot, the capture builder, the registry keys,
the renderer subtitle, and all of R1–R9 and R12.
**Cannot start:** anything in a 🔴 row, the flag flip, and the merge.

---

## §6 NON-GOALS

1. **Not a new endpoint.** No `/api/j2/notes/{id}/screens`, no screener-side
   journal route.
2. **Not a new widget id and not a new renderer.** `scanner` + `ScannerEmbed`
   already carry it.
3. **Not offline queueing of captures.** See §3.5. Real gap, frozen code, different
   row.
4. **Not a live/re-running embed.** `scanner.liveCapable` is `false` and stays
   false. Rejected on the evidence in §3.2, not on preference.
5. **Not a change to the saved-screen object, `/api/user-definitions`, share
   tokens, or `useSavedScreens`.** The door reads the working spec; it never writes
   one. `ScreensManager.jsx` warns that a second write door onto that object is how
   two callers end up disagreeing.
6. **Not a re-implementation of the `scanner` widget door** (§0/§2).
7. **Not the flag flip.** Build dark. `WAVE_R_CAPTURE_ON` stays `false` in every
   commit this spec authorises.
8. **Not Options Flow / COT / Model Book.** Named in the same scorecard row; each
   is its own track.
9. **Not a mobile-specific door.** `ScannerShell` renders `ResultCards` on phone
   via `useIsPhone`; whether the slot reaches the phone layout is UNKNOWN-4, not a
   goal to solve blind.

---

## §7 UNKNOWNS — explicit, and none of them guessed

**UNKNOWN-1 · How many rows may a capture freeze?** The preset scans the existing
door freezes are small; `/screener` can return thousands, and CSV export caps at
5,000. A cap is required, its number is a product judgment, and I did not find one
recorded anywhere. **Owner call.** My recommendation, offered as a recommendation
and not a finding: the loaded page (up to 100 rows), with `N of TOTAL matches`
always rendered.

**UNKNOWN-2 · What is `scanKey` for a screen?** `paramsSchema` marks it
`required: true` with the note *"the WIRE contract (names get re-copywritten)"*. A
saved screen has `def_id` and `ast_hash` (`ScreensManager.door.test.jsx`'s fixture
row carries `def_id: 'u_breakout'`, `ast_hash: 'sha256:aaa'`); an unsaved working
spec has neither. A stable hash of the encoded spec is the obvious candidate — I
did not verify that anything else consumes `scanKey` in a way a synthetic value
would break. **Grep every consumer of `params.scanKey` before choosing.**

**UNKNOWN-3 · Does a `/screener` capture need `caption`/`tradeRef` beyond what
`CaptureMenu` already gives?** The picker carries a comment and the envelope
carries `tradeRef`/`tradeRefType`. Whether a screen capture should offer a trade
link at capture time is unasked. Assume no; do not build it speculatively.

**UNKNOWN-4 · The phone surface.** `ScannerShell` renders `FiltersSheet` and
`ResultCards` under `useIsPhone`. I did not trace whether `ShellToolbar` renders at
phone width, so **I could not determine** where the door appears on a phone. Answer
it by driving the real layout before writing the phone rail — do not infer it.

**UNKNOWN-5 · Does the door count as a "route change away from the Notebook"?**
I believe it does (§1), which is what places Part B behind the RED cell. That is a
reading of the F5 diagnosis, not a measurement. **The F5 owner should confirm it**
before the hold is either lifted or extended on this basis.

**UNKNOWN-6 · The git provenance of the `scanner` widget door** (§0). Unresolvable
in this session by instruction.

**UNKNOWN-7 · Whether the live overlay belongs in the frozen row values.** The
screener serves nightly columns with a live price overlay over *a named subset*,
and the seal is emphatic that *"the wording never implies the whole row is live"*.
A frozen capture mixing 03:00 columns with 10:42 prices must say so in its `asOf`
line. I have specified `asOf` to carry both (§3.3), but **whether that is the right
disclosure wording is a product judgment I did not find recorded.**

**UNKNOWN-8 · Does the saved-screen AST run surface get a door in R-1a?**
`app/src/components/screener/ScanResults.jsx` renders the hits of one saved screen
plus a four-bucket receipt, and it **carries the definition** — its own header
calls that the point: *"the claim 'the formula you charted is the scan you ran' is
only believable when a member SEES it."* On the moat argument that is the *most*
journal-worthy scanner surface in the product, and it has no door either. I did not
trace its payload end to end and I will not spec it blind. **Owner/track call:**
either a second slot in the same wave, or a named follow-on row. ⛔ If it is taken,
note that its four outcomes are not interchangeable — the file is explicit that
*"a dropped or not-computable symbol is not a hit and gets no button"* — so a
capture must freeze the receipt's shape, not flatten it into a list of tickers.

---

## §8 CITATION INDEX — every path in this document, verified present

`app/src/pages/journal-2-0/lib/captureTargets.js` ·
`app/src/pages/journal-2-0/lib/captureFinancialFact.js` ·
`app/src/pages/journal-2-0/lib/sendToJournal.js` ·
`app/src/pages/journal-2-0/lib/widgetEmbedCore.js` ·
`app/src/pages/journal-2-0/components/CaptureMenu.jsx` ·
`app/src/pages/journal-2-0/components/notebook/ScannerEmbed.jsx` ·
`app/src/pages/journal-2-0/components/notebook/FrozenList.jsx` ·
`app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx` ·
`app/src/pages/journal-2-0/lib/offline/f5Freeze.test.js` ·
`app/src/pages/journal-2-0/lib/offline/serverChange.js` ·
`app/src/pages/journal-2-0/lib/offline/settleNoteWrite.js` ·
`app/src/pages/journal-2-0/lib/offline/outboxDrain.js` ·
`app/src/pages/journal-2-0/lib/offline/doorEnumeration.test.js` ·
`app/src/pages/journal-2-0/lib/offline/offlineWordsSurvive.property.test.jsx` ·
`app/src/pages/journal-2-0/lib/offline/useDurableNote.js` ·
`app/src/pages/journal-2-0/lib/offline/offlineFlag.js` ·
`app/src/widgets/registry.js` ·
`app/src/widgets/captureRelease.js` ·
`app/src/pages/charts/widgets/ScannerResults.jsx` ·
`app/src/pages/charts/widgets/ScannerResults.journalDoor.test.jsx` ·
`app/src/pages/Watchlists.jsx` ·
`app/src/pages/ThemeTrackerPage.jsx` ·
`app/src/pages/Screener.jsx` ·
`app/src/pages/screener/shell/ScannerShell.jsx` ·
`app/src/pages/screener/shell/ShellToolbar.jsx` ·
`app/src/pages/screener/shell/csvExport.js` ·
`app/src/pages/screener/shell/specUrl.js` ·
`app/src/pages/screener/hooks/useScreenerScan.js` ·
`app/src/pages/screener/ScreensManager.jsx` ·
`app/src/pages/screener/ScreensManager.door.test.jsx` ·
`app/src/pages/screener/screenShareLink.js` ·
`app/src/components/screener/reachable.test.js` ·
`api/routers/journal_two.py` ·
`api/routers/screener.py` ·
`api/services/journal_two/notes.py` ·
`api/services/journal_two/db.py` ·
`api/services/screener/query.py` ·
`tools/q1_f5_matrix.py` ·
`docs/notebook/PROGRAM-MANIFEST.md` ·
`docs/notebook/wave-all-RESUME-HERE.md` ·
`docs/notebook/primary-platform-master-architecture.md` ·
`docs/notebook/primary-notebook-readiness-scorecard.md`

⛔ **One claim in an earlier draft of this document is STRUCK, and the strike is
left visible on purpose.** I wrote that `app/src/components/screener/**` was
retired, and cited `reachable.test.js:334` for it. **That citation does not say
that.** Line 334 is one entry in a repo-wide retirement map inside a repo-wide
reachability rail that merely *lives* in that directory, and the entry it carries
is about `components/tiles/CompassTodayTile.jsx`. The directory is **live**:
`ScanResults.jsx`, `RunNowButton.jsx` and `scanSession.js` are imported by
`ScreensManager.jsx:8-10`, `StructureProvenance.jsx` by `ScannerShell.jsx:3`.
⚰️ The defect shape is the one this program has paid for repeatedly — *a file's
location read as a claim about its contents*. Recorded rather than quietly fixed.

⚠️ Two smaller navigation facts, for whoever reads the task brief next:
the live Screener **shell** is `app/src/pages/screener/` (which the brief did not
name), and there is **no `screener` widget id** in `WIDGET_REGISTRY` — the id is
`scanner`.
