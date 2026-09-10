# Phase 3 — section wiring, plan of record

**Status: PLAN GATE. No section code until the owner approves.**

Spec: `00-master-spec-v1.6.md`. Shipped preview: `2d8373449` (admin, navigation-only plus
Voice). Phase 2a backend: `ee9f3957b`, merged with Increment 2 — a backend with no consumer on
master is dead weight and invites drift.

---

## 0. Prerequisite status — measured now, not assumed

| Prerequisite | State |
|---|---|
| **Indicators branch merged since `2d8373449`?** | **NO.** `git log 2d8373449..origin/master` is **empty** — master is unchanged since our merge. So: proceed, and **Chart (3.5) is wired last** so a later merge lands before it. No chart scout re-run needed yet. |
| **`hub/contracts.js` complete for Phase 3** | ⛔ **NOT YET.** It carries the Phase 2 component props (`HubPadProps`, `HubFanProps`, `ScrubPayload`, …) and nothing for section registration. **This is task 0 below, Director-owned, before any agent is dispatched.** |
| **One shared cursor** | `useHubCursor` exists and is the only cursor. Per-section list bindings and identity keys are specified in §2. |
| **Wave 0 section scouts re-read** | Done for the first three. **Two have drifted — see the ⚠️ rows in §2.** |
| **`fanFor` per-section** | ✅ **Done.** It was a single global `PREVIEW` constant; it is now `PREVIEW_MODES` (a Set of mode ids) with `isPreviewMode(id)`, so each section leaves the preview in its own increment. A rail asserts every mode is accounted for — it caught `calendar` being omitted, which had silently shipped its full five-action fan into a navigation-only preview. |

### Task 0 — `contracts.js` (Director, before any dispatch)

Add typedefs **and a contract test for each**, in `hubContracts.test.jsx`:

- `HubSectionRegistration` — the `useHubMode(config)` shape: `{ id, fan, onTap, onDoubleTap, onScrub, onScrubCommit, chipReadout, cursor }`.
- `CursorListAdapter` — `{ listId, length, getIdAt(index), scrollToIndex(index), onSelect(index) }`.
- `ScrubPayload` — extend the existing one to `{ delta, axis, commit }`; `commit` is what
  separates a live drag from the released value.
- `ChipReadoutProvider` — `(ctx, state) => string | null`. Null means "show the mode hint".
- `ConfirmPayload` — `{ actionId, confirmText, onConfirm, onCancel }`.
- `PlanTradeSheetProps` — `{ symbol, entry, stop, size, rValue, onChange, onConfirm, onCancel }`.

⛔ **Written before the agents, not alongside them.** Phase 2 shipped a hub where every prop
across the components/wiring seam was wrong while both sides' suites stayed green, because
nobody owned the interface. That is the whole reason for the §D0 contracts-first rule.

---

## 1. Order, and why

Ordered by discovered ease × value, not by section importance:

**3.1 Wire → 3.2 Breadth → 3.3 Screener → 3.4 Journal → 3.5 Chart → 3.6 Catalysts →
3.7 Notebook → 3.8 Home → 3.9 Flow.**

Wire and Breadth are near-pure navigation over state that already exists. Screener introduces
the cursor. Journal introduces writes and the Plan-trade sheet — the single most valuable
feature in the plan, and the Phase 2a consumer. Chart is last of the risky ones because it is
the only section whose surface a concurrent branch can move.

---

## 1b. A1 — drift scouts run BEFORE their section, and replace the Wave 0 lines

Three Wave 0 bindings have already been measured as moved or gone (3.3a, 3.5a, 3.6a below). A
scout is not a formality before those sections; **it is the thing that decides what they bind
to**, and a section brief written from a Wave 0 line that no longer resolves is a brief for code
that does not exist.

| Scout | Runs | The state Wave 0 named |
|---|---|---|
| **3.3a** Screener | **now**, inside Task 0's wave | `Screener.jsx`'s `activeTab` |
| **3.5a** Chart | start of **Increment 3** | `setGroupSymbol`, a comparison write, `scrollPosition` |
| **3.6a** Catalysts | start of **Increment 3** | `CatalystTable.jsx`'s `sortKey` / `tagFilter` |

**Every scout is a READ-ONLY agent** — no edits, no git, report only. (Incident #4 in this
project's memory is a fork told exactly that which implemented a feature and committed it anyway;
verify `git status` and `git log` after every dispatch regardless of the brief.)

**Each scout answers ONE question, in these words: did the state MOVE, or was it DELETED?**

- **Moved** → report the new home as `file:line`, and the section binds there.
- **Deleted** → the section binds to **what the page actually uses now**, reported as `file:line`.
  ⛔ It does **not** bind to a reconstruction of the old state, and it does not ask for the old
  state to be re-added so the hub can drive it. The hub is a shortcut over a page, not a reason
  for the page to grow a control surface it had already discarded.

⭐ **The scout's report REPLACES the Wave 0 line in this document** — the stale line is struck,
not left beside the new one. Two readings of one binding is how the Wave 0 lines came to be
trusted six weeks after they stopped being true.

---

## 2. The sections

Every `file:line` below was **read from source during this planning pass**, not carried from
Wave 0. Rows marked ⚠️ are ones where the page has **changed since `42daef020`** and the Wave 0
scout no longer describes it — those need a fresh scout **at their increment**, and the plan
says so rather than inventing a binding.

### 3.1 Morning Wire (`wire`) — route `/morning-wire`

| | |
|---|---|
| **Primary (tap)** | Next segment. Reads/writes the segment cursor over `section.rd-seg[data-seg]` — `MorningWire.jsx:183,200`. The rundown is `dangerouslySetInnerHTML`, so segments are **DOM nodes, not React state**: the cursor holds an index into `root.querySelectorAll('section.rd-seg[data-seg]')` and scrolls with `scrollIntoView({block:'start'})`. |
| **Reverse (double-tap)** | Previous segment, same cursor. |
| **Scrub** | Segment index, vertical. Chip reads the segment's own label text (`.rd-seg-label`, `MorningWire.jsx:183`). |
| **Fan — outer (4)** | `Top 5` (navigate to the picks segment) · `Breadth` · `Chart` · `Journal`. All `kind:'navigate'`. |
| **Fan — inner (3 + Home)** | `Flag segment` (`run`, thumbs-up via the existing `POST /api/wire-feedback`) · `Note` (`run`, opens Notebook prefilled) · `Voice` · `Home`. |
| **confirmText** | None — no `confirm` action in this section. |
| **Chip during scrub** | The segment label, e.g. `"The Board"`. Source: the `.rd-seg-label` text node. |
| **Mount point** | `MorningWire.jsx`, top-level component, `useHubMode(wireConfig)`. |
| **Cursor identity key** | `` `wire:${wireDate}` `` — the wire's own date. A new wire is a new list and the cursor **must** reset; keying on the route alone would leave yesterday's index pointing into today's segments. |
| **Preview exit** | Remove `'wire'` from `PREVIEW_MODES`. |
| **Tests** | Unit: tap advances, double-tap retreats, both clamp at the ends. Contract: registration matches `HubSectionRegistration`. Device: tap ×10 advances exactly one segment each time; chip text matches the visible heading. |

### 3.2 Breadth (`breadth`) — route `/breadth`

| | |
|---|---|
| **Primary (tap)** | Next tab. Reads/writes `activeTab` — `Breadth.jsx:560` (`useState`), verified by the 3.2 integrator. ⚰️ **`BreadthTabs` has FIVE call sites, not four.** This listed `894/914/925/936`; all four are real, but there is a fifth at **`:1010`** — the main Monitor/Views branch, the one a member sees most. A hand-typed enumeration beside the source it describes, the same shape as the writer-index `FOUR`. Nothing broke, because 3.2's change is inside `BreadthTabs` rather than at its call sites — but count them before binding to them. |
| **Reverse** | Previous tab. |
| **Scrub** | Tab index, horizontal. Tab list now resolves through `resolveBreadthTabs(isAdmin)` in `hub/sections/breadthSection.js` (moved there by 3.2 so the page's own strip and the hub cannot drift); it is `BREADTH_TAB_ITEMS` **plus `analogues` for admins only** — ⛔ the fan and the scrub range must both read the *resolved* list, not the constant, or an admin and a member get different behaviour from the same code. |
| **Fan — outer (4)** | `Monitor` · `Daily` · `Views` · `COT` — each `kind:'navigate'` in the sense of setting `activeTab` (in-place, no route change). |
| **Fan — inner (3 + Home)** | `Drill` (`run`, opens the drill modal for the focused cell) · `Chart` (navigate) · `Voice` · `Home`. |
| **confirmText** | None. |
| **Chip during scrub** | The tab label from the resolved list. |
| **Mount point** | `Breadth.jsx`, inside the component that owns `activeTab` (`:560`). |
| **Cursor identity key** | `` `breadth:${activeTab}` `` — each tab is its own list. |
| **Preview exit** | Remove `'breadth'`. |
| **Tests** | Unit: tab cycling clamps; the admin-only tab is present for an admin and absent for a member. Contract. Device: tap ×10 lands on the intended tab each time. |

### 3.3 Screener (`scan`) — route `/screener` · **bindings settled by the 3.3a scout, 2026-09-09**

⚰️ **`activeTab` was DELETED, not moved — and Wave 0 never named it.** `Screener.jsx` is 92 lines
and holds one piece of state, `shellKey` (`Screener.jsx:69`), an ErrorBoundary remount counter.
The page's own header says why: *"THIS PAGE IS THE SCANNER NOW — there is no tab strip, because
there is nothing to switch between"* (`Screener.jsx:50-54`), and `Screener.test.jsx:19-25` is the
standing rail on that removal.

⛔ **The stale line was worse than stale: it was an invented citation.** This plan said "the Wave 0
scout described one". The string `activeTab` appears **nowhere** in `10-wave0-discovery.md`; the
only `activeTab` in the plan set is Breadth's. A binding was attributed to a document that never
made the claim, and it survived because nobody re-opened the source it named. Per A1 the scout's
report replaces it — the speculation that it "moved into the shell" is struck, not annotated.

**What the page uses now** is `view` (`useScreenSpec.js:18`, writer `setView` `:80`, default
`'overview'` from `specUrl.js:7`, URL-encoded at `specUrl.js:22`), surfaced as a `role="tablist"`
labelled "Column views" (`ShellToolbar.jsx:166-172`) whose tabs come from the SERVER
(`api/services/screener/filters.py:790-880`). ⚠️ **It is not a renamed `activeTab` and §3.3 must
not treat it as one** — `view` selects a COLUMN SET; only `'charts'` changes the renderer
(`ScannerShell.jsx:219`). No page-level tab needs to exist for the hub, and the hub must not ask
the page to grow one.

| | |
|---|---|
| **Primary (tap)** | Next result. **Verified seams:** `VirtualResults.jsx:65-67` and `ResultCards.jsx:30-32`, both `useImperativeHandle(ref, () => ({ scrollToIndex: (index, options) => … }))`. ⚠️ **Nothing consumes either today** — `ScannerShell.jsx:230/233` pass no `ref`. Wiring them is Increment 2 work; Phase 1 built the seam and stopped. |
| **Reverse** | Previous result. |
| **Scrub** | Result index, vertical. |
| **Fan — outer (5)** | `Chart` · `Flag` (`run`) · `Journal` · `Breadth` · `Notebook`. |
| **Fan — inner (3 + Home)** | `Alert` (**`confirm`**) · `Plan trade` (`run` — see the ⛔ below) · `Voice` · `Home`. |
| **confirmText** | `Alert` → **"Create alert for {symbol}?"**. |
| **Chip during scrub** | `` `${symbol} · ${index + 1}/${displayRows.length}` `` — ⚰️ **NOT `total`.** `total` is the server's match count (`ScannerShell.jsx:65`, `query.py:1318`) while `PAGE_SIZE` is 100 (`useScreenSpec.js:5`), so the old line would read `3/3,745` with 100 rows loaded. The precedent is already in that file: *"THE LOADED PAGE, NOT `total`"* (`ScannerShell.jsx:158-161`). Either denominate by the loaded length or have `next` call `s.loadMore` (`useScreenSpec.js:92`) at the tail, as `VirtualResults.jsx:71-74` already does. |
| **Mount point** | **`ScannerShell.jsx:43`**, registering **`displayRows`** (`:133-135`) — never `rows` (`:61`). `displayRows` is the array AS RENDERED (the live re-sort was lifted into the shell for exactly this reason, `ScannerShell.jsx:122-132`); registering `rows` makes the cursor and the phone list disagree the moment the live toggle is on. |
| **Cursor identity key** | 🔴 **`useHubCursor('scan', displayRows, { key: r => r.ticker })` — the explicit key is REQUIRED.** See below. |
| **Preview exit** | Remove `'scan'`. |
| **Tests** | Unit: cursor clamps; `scrollToIndex` called with the new index; `requires:['symbol']` disables Chart when nothing is selected; **a re-scan returning different rows resets the cursor**. Contract. Device: 10× tap advances exactly one row; the chip's symbol matches the highlighted row. |

#### 🔴 The identity-key bug this scout found before it shipped

`useHubCursor`'s `defaultKey` (`useHubCursor.js:88-99`) probes `id`, `sym`, `symbol`, `date`,
`key` — **not `ticker`** — then falls through to a positional `__pos_<index>` key (`:98`). **No
screener row carries `sym` or `symbol`**; the identity is `ticker`, unique by construction
(`screener_rows` is `ticker TEXT PRIMARY KEY`, `snapshot_db.py:416-417`; forced first into every
projection, `query.py:1131`; already the React key at `VirtualResults.jsx:145`,
`ResultCards.jsx:43`, `ChartsGallery.jsx:32`).

So registering `displayRows` without an explicit key yields an identity string made only of
positions, **which changes only when the LENGTH changes** — a re-scan returning a completely
different 100 rows reads as "the same list", and the cursor holds an index onto a symbol the
member never selected. That is precisely the failure `reconcile` (`:127-141`) exists to prevent,
defeated by its own default.

⛔ **And `useHubCursor.js:81`'s docstring asserts the false half out loud** — *"Screener/Catalysts
rows carry `sym`/`symbol`"*. Left standing it will send the next reader to the same wrong place.
**Director fixes that comment; the call site passes `opts.key`.** Changing `defaultKey` itself is
shared-infra behaviour and is NOT done from a section.

⚰️ The old identity key `` `scan:${scanDefinitionId}:${resultsFingerprint}` `` is struck twice
over: `listId` is a key into a module-level `Map` that is never pruned (`useHubCursor.js:45`), so
a per-result fingerprint there leaks a store entry per scan — and the fingerprint is what
`computeIdentity` already derives from the item keys. `scanDefinitionId` also does not generally
exist: only a saved *scan* has one (the opaque `def_hash` at `ScannerShell.jsx:180-184`), and most
screens have no scan filter. **The `listId` is the constant `'scan'`.**

#### ⛔ "Plan trade" from the Screener is NOT buildable as A5 assumes — read before Increment 2

A5 gates Increment 2 on a Screener → sheet → `POST /api/hub/planned-trades` → row-in-`GET` path.
The scout measured what the Screener can actually supply, and it is not entry/stop/size:

- **Entry and stop exist only as DISTANCES** — `pattern_entry_dist_pct` / `pattern_stop_dist_pct`
  (`columnDefs.js:386-389`, derived server-side at `snapshot_builder.py:546-551`). Absolute levels
  are `price × (1 + dist/100)`, and the live tier already performs that inversion
  (`live_tier.py:576-577`, `:619-621`) — so deriving it client-side would be a **second authority
  over the same number**. Ask the backend for the absolute levels instead.
- ⚠️ **They are only present if the member asked for them.** The scan selects
  `REQUIRED_COLS ∪ visibleColumns` (`useScreenSpec.js:97-99`) and both columns live in exactly one
  view, `patterns` (`filters.py:837-841`). **The default view is `overview`, which carries
  neither** — so on a default screener the sheet opens with no entry and no stop.
- ⚠️ **Deliberately blank on stale rows and names with no qualifying detection**
  (`snapshot_builder.py:94-107`; non-null on 2,889 of 3,714 rows — the `_stale_price` guard
  withholds rather than divide across two clocks). The sheet must render an **honest absence**,
  never a fabricated level.
- ⛔ **`size` does not exist on the Screener at all** — no shares, no risk-dollars, no
  position-size column in `COLUMN_DEFS`, and no account context on the page. Size comes from the
  **Journal** side (`settings.defaultSizePct` → `computeDefaultShares`), which means the A5
  end-to-end gate is a **3.4 Journal** deliverable that the Screener feeds, not a Screener one.

**✅ RULED (owner, 2026-09-09) — option 1: the gate moves to 3.4.** The Screener's "Plan trade"
supplies **symbol only, plus the last price from the stream store as the default entry when one is
available** — nothing else. It opens the Plan-trade sheet, which **3.4 Journal owns**.

Sheet fields and their defaults: `symbol` fixed · `entry` = last price if streaming, else blank ·
`stop` = from the Journal 2.0 stop-placement mode in effect, **computed by importing the existing
j2 logic** (if that logic needs a pattern level the Screener did not supply, the stop stays blank)
· `size` = the member's sizing rule if present, else blank · `R` computed live by the calc module
**only when entry, stop and size are all present**.

⛔ **Blank means blank.** The sheet renders "—" and **disables Save plan** until entry, stop and
size are filled. It never fabricates a level. ⚠️ Do **not** request the `patterns` columns
unconditionally and do **not** add a backend endpoint for absolute levels in this increment —
that is **D-32**.

**Screener `view` is not a hub concern** (owner, same ruling). Primary/Reverse step RESULTS only;
the inner ring's "Scans" opens the existing scan picker; the hub never touches `view`. If the
`'charts'` view changes the renderer such that the adapter's items differ, the adapter reports
*that* list — and `identityKey` stays `ticker` either way.

#### Also reported, not fixed

`ChartsGallery` (the `'charts'` view) has **no imperative seam at all** — it is unvirtualized and
paginates internally (`PAGE = 24`, `ChartsGallery.jsx:13,23`), so a cursor at index 30 points at a
card on a page the member is not looking at. And only the first **300** rows carry live prices
(`LIVE_WINDOW`, `VirtualResults.jsx:14`, applied `ScannerShell.jsx:69`); past that `price` is the
03:00 snapshot.

### 3.4 Journal (`journal`) — route `/journal/trades` · **the Plan-trade sheet and the Phase 2a consumer**

| | |
|---|---|
| **Primary (tap)** | Next open position. Cursor over the Open Positions table rows. |
| **Reverse** | Previous position. |
| **Scrub** | ⭐ **Adjust stop** — the headline feature. Full design in §4. |
| **Fan — outer (4)** | `Add trade` (`run`, opens `AddPositionModal`) · `Chart` · `Screener` · `Notebook`. |
| **Fan — inner (3 + Home)** | `Set stop` (**`confirm`** — the scrub's release path) · `Plan trade` (`run`, Plan-trade sheet → `POST /api/hub/planned-trades`) · `Voice` · `Home`. |
| **confirmText** | `Set stop` → **"Set stop {price}"** (the literal price, e.g. `"Set stop 178.10"`). ⛔ The number is IN the button — a confirm that says only "Confirm" makes the member verify the value somewhere else, and the whole point of the gesture is that they never looked away. |
| **Chip during scrub** | `` `stop ${price} → ${r}R` ``, e.g. `"stop 178.10 → 1.6R"`. R comes from `calculations.trade_r_multiple(side, entry, target, stop)` — the same module Phase 2a uses. |
| **Mount point** | `pages/journal-2-0/tabs/OpenPositionsTab.jsx` (**confirm the exact component in 3.4a**). |
| **Cursor identity key** | `` `journal:${accountId}:positionsRevision}` `` — positions are per-account, and switching accounts must reset. |
| **Preview exit** | Remove `'journal'`. |
| **Tests** | §4. |

#### §3.4 bindings — the citation pass, 2026-09-09 (every line quoted from source)

| # | Binding | Verdict |
|---|---|---|
| 1 | Rendered list | `useJ2Positions.js:12,28` → **list view is the DEFAULT** (`OpenPositionsTab.jsx:171-177`, localStorage must say `'table'`), post-sort array `equityRows` (`HoldingsList.jsx:69-72`) |
| 2 | Selected position state | ⚰️ **NO SUCH STATE.** Rows are `<Link>`s (`HoldingsList.jsx:170-175`) or a TickerPopup open (`PositionsTable.jsx:278`). The hub cursor is the only selection |
| 3 | Stop PUT | `OpenPositionsTab.jsx:213-217` → `journal_two.py:363` → `positions.py:300` |
| 4 | Default stop | ✅ **`disciplineGuards.prefillStop`** — exported by D-33 |
| 5 | Sizing | `defaultSizePct`, percent-of-account ONLY; no mode discriminator (`disciplineGuards.js:12-20`) |
| 6 | R at a candidate stop | ✅ **`calculations.rAtStop`** — added by D-34 |
| 7 | Side | Stored field (`positions.py:39`); backend guard `positions.py:343-355`, **three holes → R-08** |
| 8 | Last price | `useRealtimePrices(symbols)` (`OpenPositionsTab.jsx:150-151`), field **`.price`** (`calculations.js:348-357`) |

⛔ **The cursor key is `row.key`, and the two surfaces DISAGREE — the adapter normalises.**
List rows carry `key: 'e-<uuid>'` and **no `id` field at all** (`holdingsRows.js:28-34`); table rows
use the bare uuid (`PositionsTable.jsx:527,583` `key={p.id}`). The adapter maps both to ONE shape —
the bare position id, which is what the PUT needs anyway — and states which surface it came from.

⛔ **Option/strategy rows carry a STRATEGY id** (`OpenPositionsTab.jsx:112-113`), and sending that
to `PUT /api/j2/positions/{id}` **404s**. The cursor may land on them, but every `requires:'position'`
action (Move stop, Breakeven, Close, Plan trade) is **disabled** there with the chip reading the
row's label.

✅ **Close EXISTS, so it stays in the fan** — verified both ends rather than assumed:
`OpenPositionsTab.jsx:236` (`POST /api/j2/positions/{id}/close`) → `journal_two.py:394`. No
D-number needed.

⚠️ **Painting `data-hub-cursor` is the Journal's job**, on three carriers:
`HoldingsList.jsx:170-175` (list), `PositionsTable.jsx:278` (table), `:525-527` (phone). The token
already exists at `tokens.css:547` — reused, never re-declared.

---

### 3.5 Chart (`chart`) — route `/charts` — **wired LAST**

| | |
|---|---|
| **Ref surface, verified now** | `StockChart.jsx:1994` publishes `onDateNavApi(api)` with **`{goToDate, goToYear, stepBar, ensureFullHistory, getDateMeta}`** — `stepBar` is real and reachable. `onTfChange(tf)` at `:1986`. |
| ⚠️ **Wave 0 drift** | Wave 0 named `setGroupSymbol`, a `comparison write` and `scrollPosition` as part of the surface. **Only `stepBar` and `onTfChange` were confirmed in this pass.** The other three need a fresh scout in 3.5a — and if the indicators branch has merged by then, the whole surface is re-diffed against `10-wave0-discovery.md` before anything is wired. |
| **Primary / Reverse** | Next / previous timeframe via `onTfChange`. |
| **Scrub** | Bar position via `stepBar`, horizontal; symbol via the color group, vertical. |
| **confirmText** | None planned. |
| **Preview exit** | Remove `'chart'` — **last**. |

### 3.6 Catalysts (`catalysts`) — in-place on `/dashboard`, **no route**

⚠️ **`CatalystTable.jsx` no longer has the `sortKey` / `tagFilter` state the Wave 0 scout
described** — a grep returns nothing. Fresh scout required (3.6a). Catalysts stays out of the
Home fan until it ships, because it has no route to navigate to (recorded in
`45-phase2.5-plan.md`).

### 3.7 Notebook (`notebook`) — route `/journal/notebook`

Selection is **URL-driven**: `const noteId = searchParams.get('note')` (`NotebookTab.jsx:63`,
under `const [searchParams, setSearchParams] = useSearchParams()` at `:62`), with
`clearNoteParam()` at `:365-369`. ⭐ That makes the cursor's identity key the search params
themselves, and means the hub must write through the router, not component state — otherwise
the back button and the hub disagree about which note is open.

⚰️ **Citations corrected 2026-09-10 (R-E).** This read `:59` and `:353-366`. Line 59 is the closing
brace of a telemetry `fetch().catch()`; `:353-357` is `closeNote`, a different function with the
same shape plus three refreshes. Both were quote-verified against `febe8ee67` before correction, per
CLAUDE.md's "a citation you cannot quote is struck".

⭐ **The seam is `applyTargetToParams(params, target)`** (`journal-2-0/lib/searchNavigation.js:86`) —
a pure exported builder that deletes `PARAM_DOC`/`PARAM_PAGE`/`PARAM_EXCERPT`/`PARAM_REVIEW` before
setting `PARAM_NOTE`, so a hub-driven note change cannot leave a stale `?doc=&page=` pointing into a
different note. The hub imports it; it does not hand-roll `params.set('note', id)`.

⚠️ **A hub-driven selection also changes what the capture doors see, and that is intended.**
`journal-2-0/lib/captureContext.js:26` (`noteIdFromLocation`) reads the same `?note=` param, so
moving the hub's cursor moves "which note am I looking at" for capture as well. That is the correct
behaviour — one URL, one answer — and it is recorded here so the coupling is a decision rather than
a surprise.

### 3.8 Home (`home`) — route `/dashboard`

Tap → Screener, double-tap → Journal (already true in the preview). Phase 3 adds the scrub
(recent sections) and restores `Calendar` to the inner ring alongside `Wire`.

### 3.9 Flow (`flow`) — route `/options-flow` — **verify only**

Navigate-only, and stays so: `OptionsFlow.jsx` is partner-owned (~7k lines, all inline styles)
and this build touches none of it. Fan stays `[Voice, Home]`. The only Phase 3 work is a device
step confirming the hub mounts and navigates there — **no registration hook is added.**

---

## 3. Increment cadence

| Increment | Contents | Gate |
|---|---|---|
| **2** | Phase 2a + 3.1 Wire + 3.2 Breadth + 3.3 Screener + 3.4 Journal | unit + contract + rails green; **no new failures vs the measured baseline**; **the two A5 end-to-end gates below**; device steps written; **one squash commit**; PR; owner merges |
| **3** | 3.5 Chart + 3.6 Catalysts + 3.7 Notebook + 3.8 Home + 3.9 Flow (verify) | same |

Each increment: one squash commit, PR with device results linked, owner merges. **Nothing
self-deploys.** (Rebase only per the CLAUDE.md rule — master touched a file this branch touches,
or more than five commits behind; otherwise merge clean.)

### A5 — two gates Increment 2 does not pass without

Both exist because component tests are structurally blind to a severed wire — the defect class
that produced "8 features built, tested, green, and connected to nothing" in the 2026-08-08 audit.

1. **Plan-trade sheet, end to end — BOTH doors** (rewritten by the owner's 3.3a ruling; the
   original assumed the Screener could supply entry/stop/size, and it cannot — see §3.3):
   - **From the Screener:** "Plan trade" opens the sheet with **symbol**, plus the last price as
     `entry` when the stream has one → the member fills the rest → `POST /api/hub/planned-trades`
     → **the row comes back in `GET`**.
   - **From the Journal:** the same sheet opens **prefilled from the selected position**.
   - ⭐ **And a third case that is not a happy path:** the Screener door with **no stream price** —
     `entry` blank, **Save plan disabled**. That is the test that stops a future "helpful" default
     from inventing a level, which is the whole reason the ruling put blank-means-blank in writing.
   Both doors are contract-tested, mocking nothing on the path.
2. **Journal scrub, contract-tested against a fake j2 client.** Asserts **exactly one `PUT`**, its
   body carries **`stopPrice` and no other field**, and a release *without* confirm sends nothing.

#### ⛔ The write-path invariant — FOUR paths, and the gate now checks the CALL PATH

⚰️ **Amended by owner ruling B4, 2026-09-09.** Increment 2 was reviewed against an invariant
reading *"exactly two write paths"*. **No such invariant existed anywhere in this repo** — a
repo-wide search found only the review finding that referred to it. Nothing stated it and nothing
checked it, so the disagreement it caused could only ever be settled by hand.

**The accurate statement: the hub has FOUR write paths — two it owns, two it triggers through
pre-existing app clients.**

| Endpoint | Method | Reached through | Owner |
|---|---|---|---|
| `/api/j2/positions/{id}` | `PUT` | `hub/sections/journalSection.js` (body only ever from `stopPatchFor`) | hub |
| `/api/hub/planned-trades` | `POST` | `hub/plannedTradesClient.js` | hub |
| `/api/watchlists/flagged/sync` | `POST` | `hooks/useFlagged.js` — Flag, plan §3.3 | pre-existing app client |
| `/api/watchlist-alerts` | `POST` | `hooks/useWatchlistAlerts.js` — Alert, plan §3.3 | pre-existing app client |

⛔ **A COUNT IS NOT THE INVARIANT — the call path is.** A rogue hub-local client that REPLACES one
of the two app endpoints rather than adding a fifth keeps the total at four, and every count-based
gate passes it while the app's own cache invalidation and optimistic insert are silently bypassed.
So the rail asserts `(endpoint, reached-via-module, owner)` tuples, and the ownership clause —
app-owned paths must resolve OUTSIDE `app/src/hub/` — is a separate assertion so that when it
fails it says OWNERSHIP and nothing else.

**Enforced by `app/src/hub/writePaths.test.js`**, which derives layer 1 exhaustively from every
non-test file under `app/src/hub/**`. ⚠️ Read that file's COVERAGE BOUNDARY header before trusting
it: layer 2 asserts a declared app-client call site EXISTS, and does not claim those clients can
write nothing else.
   ⭐ The "no other field" half is the load-bearing one: `PUT /api/j2/positions/{id}` is a partial
   update over `_UPDATABLE_FIELDS`, so an extra key the hub did not mean to send would silently
   overwrite a field the member set somewhere else, and every assertion about the stop would still
   pass.

---

## 4. Journal scrub-to-adjust-stop — design detail

**The gesture.** Hold on the pad, then drag vertically. Each step moves the focused position's
stop by one tick. Release opens a one-button confirm reading **"Set stop 178.10"**.

**Tick size: `0.01` everywhere.** ⛔ **This app has no tick logic** — I searched for
`tickSize` / `minTick` / `priceStep` and found none; prices are formatted with `.toFixed(2)`
throughout (e.g. `AddPositionModal.jsx:581`). So a cent is the step at every price, and that is
a **stated simplification, not a discovered rule**: a $0.30 stock gets cent granularity that is
coarse relative to its spread, and a $4,000 stock gets 400,000 steps across its range. If that
proves wrong in use, the fix is a real tick table, not a scaling hack — and it belongs beside
the price formatter, not in the hub.

> **A2 (owner, accepted).** `0.01` everywhere is accepted **as a stated simplification**, and the
> eventual fix is recorded as **D-31 — "a real tick table beside the price formatter"**. ⛔ It is
> never a hub-side scaling hack: a second opinion about what a price step means, living in a
> gesture handler, is the second-authority defect this project keeps re-finding, and it would be
> invisible because a wrong step still produces a plausible number.
> **The scrub readout and the sheet's numeric field are both 2dp.**

**The live readout.** Chip shows `` `stop ${price} → ${r}R` `` throughout the drag, recomputed
per step from `calculations.trade_r_multiple` — the same module Phase 2a derives `r_value`
from. ⛔ Not a local formula: a second R authority is exactly the defect Phase 2a's
`r_value` note exists to prevent.

**The write.** Release → confirm → `PUT /api/j2/positions/{position_id}` with
`{"stopPrice": <number>}` (`api/routers/journal_two.py:363` → `positions_service.update_position`,
`api/services/journal_two/positions.py:300`, which reads `stopPrice` at `:172` and writes at
`:200`). ⛔ **The existing path, unchanged** — no new endpoint, so the hub cannot become a
second way to write a stop.

**A3 — the sheet refuses a stop that flips the side, and the backend agrees.**

A scrub is unbounded in principle: drag far enough and a Long's stop crosses its entry, which
does not mean "a very wide stop", it means the position is no longer the trade it was. The
confirm sheet refuses to commit one, in plain English rather than a validation code:

> **Long** — *"A stop at 181.40 is above your entry of 178.10. For a long position the stop goes
> below the entry — that is what makes it a stop."*
> **Short** — *"A stop at 174.90 is below your entry of 178.10. For a short position the stop
> goes above the entry."*

⭐ **VERIFIED, not assumed: the backend rejects the same thing on the same path.**
`api/services/journal_two/positions.py:344-355` re-validates on the MERGED patch —
`Long → stopPrice < entryPrice`, `Short → stopPrice > entryPrice` — whenever `stopPrice` or
`side` is in the patch, raising `PositionValidationError`. So the sheet's refusal is a courtesy
that saves a round trip, **not** the only thing standing between a member and a corrupt row.
No `requests.md` entry is needed; A3's "if not, file it as a j2 defect" branch does not fire.

⚠️ One bound on that claim, recorded rather than acted on: the backend's side check is guarded by
`sp is not None and sp > 0`, so a `stopPrice` of exactly **0** skips it — a Short could be sent
`stopPrice: 0`, which is below its entry. `0` is plausibly the deliberate "no stop" sentinel
(`j2_positions.stop_price` is NOT NULL and broker imports store placeholders), so this is the j2
owner's call, not ours. **The hub cannot reach it**: the scrub starts from an existing stop and
moves in cents, and the sheet refuses a side flip before it can arrive at zero.

**Accessibility — the sheet is the equal path, not the fallback.** The confirm sheet carries
**− / + steppers** and a **numeric input**, both operating on the same value the scrub produced.
A member who cannot perform a fine vertical drag — a tremor, a prosthetic, one hand on a train —
must be able to set the same stop to the same precision. WCAG 2.5.1 makes this required, not
optional, and the steppers are the reason the confirm sheet exists at all rather than the
gesture committing directly.

**Tests.** Unit: one step = 0.01 at three price magnitudes; R recomputes per step and matches
`trade_r_multiple`; release without confirm writes **nothing**; confirm calls `PUT` exactly once
with the shown price. Contract: the scrub payload matches `ScrubPayload` including `commit`.
Device: scrub 10 steps, chip tracks every step, confirm writes once, and the sheet's stepper
reaches the identical value.

---

## 4b. A4 — the PREVIEW_MODES membership rail runs BOTH directions

`PREVIEW_MODES` decides, per section, whether the fan a member sees is the navigation-only
projection or the full Phase 3 fan. A hand-typed Set beside a registry of ten modes is the
enumeration defect this repo keeps paying for — and it has **already fired once here**:
`calendar` was missing from the first draft, so `fanFor` returned its full five-action fan into a
preview sold as navigation-only. Caught by `validatePreview`, not by review.

The rail asserts both directions, because each fails differently:

| Direction | Assertion | The failure it catches |
|---|---|---|
| **In the set** | every mode in `PREVIEW_MODES` has a fan `validatePreview` accepts (navigate / Voice / Home only — no `run`, no `confirm`) | a section left in preview whose fan quietly grew a real action; the member fires a gesture the preview promised was inert |
| **NOT in the set** | every mode absent from `PREVIEW_MODES` has a full fan `validateRegistry` accepts | a section flipped out of preview before its fan was finished — it ships a half-built fan, and the *absence* of a mode is silent by construction |

⛔ **Membership is derived from `modes`, never typed.** The rail enumerates the registry and
partitions it; a mode added tomorrow lands in one bucket or the other on the day it lands. A
mode nobody classified must fail the rail, not default to either side.

---

## 5. Agents — max 4 active

| Role | OWNS (may edit nothing else) |
|---|---|
| **Section integrator** ×1 per section | that page's component, its hub registration file, its tests |
| **Architecture lead** | review only, per batch of two sections |
| **QA** | the rails, no product code |
| **Director (me)** | `contracts.js`, `registry.js` — nobody else touches either |

⛔ **Verify `git status` and `git log` after every dispatch.** Incident #4 in this project's
memory is a fork told "READ-ONLY, no files, no git" that implemented a feature in the active
worktree and committed it anyway; exhaustive MAY-NOT lists alone are proven insufficient three
times over.

---

## 6. What would make me stop and ask

- Any Wave 0 binding that has moved and whose replacement is not obvious (3.3a, 3.5a, 3.6a are
  already known).
- The indicators branch merging mid-increment — Chart's surface gets re-diffed before wiring.
- Any section needing a change outside its OWNS list — that becomes a `requests.md` entry, not
  an edit.

---

## Pre-existing suite baseline — measured on master, not inherited

**Every Increment 2 wave gates on "no NEW failures relative to this baseline."** Not on a green
suite: the repo is not green and this branch cannot make it so.

**Baseline: `origin/master` @ `75ca5c2ed`** ("Wave Q1 gate 1: a 409 stopped overwriting the
server"), measured 2026-09-09. Method: a detached worktree at that SHA with `node_modules`
junctioned in per the CLAUDE.md pattern, then a full `npx vitest run`. **Not** the branch's own
run — the branch was three commits behind, and master had just fixed one of the failures
(`rawErrorSurface.test.js`, by the very commit above). Recording the branch's list as "the
baseline at master" would have licensed a *fixed* test as permitted breakage for every wave.

> **1121 files · 16256 tests · 11 files / 12 tests reported failing — of which the real
> baseline is 10 files / 11 tests.**

⛔ **`chart/engine/__tests__/enumerationSites.test.js` is NOT in the baseline.** It failed the
full run on a **15 s timeout** while AST-walking `api/**`, and passes in isolation on the same
SHA in **1461 ms**. It is load-sensitive, not broken. Banking a timeout as permitted baseline
breakage would let a real failure hide behind it for the rest of Phase 3
(`lesson_a_rail_can_be_green_alone_and_red_in_company`, inverted). If it fails a wave, re-run it
alone before calling it anything.

### The 10, with the offenders each one actually names

| # | Test file | Offenders | Owner |
|---|---|---|---|
| 1 | `hooks/pollingSites.rail.test.js` | `floor2/hooks/useFloor.js` (5), `hooks/useWatchlistIntelligence.js` (1) | floor2 / watchlists |
| 2 | `styles/tapFloor.test.js` | `journal-2-0/…/notebook/CaptureDialog.module.css: .actions` | notebook |
| 3 | `styles/tokens.reachable.test.js` | `--color-text-muted`, ref'd from `hub/hub.module.css` | **HUB — fixed on this branch** |
| 4 | `pages/ThemeTrackerPage.chartmount.test.jsx` (2 tests) | ChartPane mount assertions | charts |
| 5 | `__tests__/sourcesAreText.test.js` | `hub/useHubCursor.js` (0x01) **+** `pages/optionsFlow/wiring.guard.test.js` (0x08 ×2) | **HUB half fixed**; optionsFlow half remains |
| 6 | `research/EarningsResearchModal.themeIsland.test.js` | `--hub-glass-tint`, `--hub-glass-tint-strong`, `--hub-rim` | **HUB — fixed on this branch** |
| 7 | `screener/reachable.test.js` | `community/*` (13), `floor2/main.jsx`, `lib/chatStreamManager.js`, `charts/widgets/DockFundamentals.jsx`, `optionsFlow/flowBootstrap.js`, **`hub/contracts.js`** | mixed; the hub row is **Task 0** |
| 8 | `chart/builder/ImportBox.thinkscript.test.jsx` | thinkscript import offer | indicators |
| 9 | `chart/engine/ast/manifestProse.test.js` | manifest strip | indicators |
| 10 | `chart/engine/ast/pine.blindCorpus.test.js` | accepted-floor corpus | indicators |

### ⚠️ Four of these were HUB-owned, three of them shipped by PR #100

The Phase 3 ruling recorded the remaining failures as "not hub-owned". That was true of the
areas it listed and wrong about the total: rows 3, 5 (half) and 6 are ours, and rows 3 and 6
were *introduced* by the hub — `--color-text-muted` is not a token and never was, and the three
`--hub-*` glass tokens were added to `tokens.css` with `[data-theme]` variants without pinning
them in the research modal's theme island. Row 7's `hub/contracts.js` is ours too and is
resolved by Task 0 making it a runtime module.

**Verification method for "is this mine?"** — `git show HEAD:<file>` (or `git show <sha>:<file>`)
and look for the offending construct in the committed version, rather than reasoning from which
files appear in `git status`. That is what separated "the hub added this" from "this was already
here" on every row above; a `git status`-based argument would have missed all four, because none
of the four offending files were in this branch's working set.

### ✅ MEASURED AT THE MERGE SHA — this is the gate reference for Increment 2

**`d3bf38f44` (PR #101 squash) — 1161 files · 16789 tests · 8 files / 9 tests failing.**
Detached worktree, `node_modules` junctioned, full `npx vitest run`. The prediction was 8; the
measurement is 8, and the measurement is what the gate uses.

| # | Test file | Owner |
|---|---|---|
| 1 | `__tests__/sourcesAreText.test.js` | optionsFlow (`wiring.guard.test.js`, two `0x08` bytes) |
| 2 | `components/chart/builder/ImportBox.thinkscript.test.jsx` | indicators |
| 3 | `components/chart/engine/ast/manifestProse.test.js` | indicators |
| 4 | `components/chart/engine/ast/pine.blindCorpus.test.js` | indicators |
| 5 | `components/screener/reachable.test.js` | mixed — **incl. `hub/contracts.js`, which Task 0 removes** |
| 6 | `hooks/pollingSites.rail.test.js` | floor2 / watchlists |
| 7 | `pages/ThemeTrackerPage.chartmount.test.jsx` (2 tests) | charts |
| 8 | `styles/tapFloor.test.js` | notebook |

**What changed from the 75ca5c2ed baseline of 10, and why — each one accounted for:**
- `styles/tokens.reachable.test.js` — **fixed by us** (`--color-text-muted`).
- `research/EarningsResearchModal.themeIsland.test.js` — **fixed by us** (the three `--hub-*`
  tokens PR #100 never pinned), and now railed by `styles/themeIslands.test.js`.
- `journal-2-0/rawErrorSurface.test.js` — was never in the 75ca5c2ed baseline; master had already
  fixed it. It is not in this one either.
- `chart/engine/__tests__/enumerationSites.test.js` — **passed this run**, confirming the earlier
  15 s failure was load, not breakage. Still never banked.

⛔ **Every Increment 2 wave compares against THESE EIGHT FILES and this SHA. Nothing is carried
forward.** A ninth file, or a second failing test inside one of the eight, is a new failure and
fails the gate — and a timeout is re-run in isolation before it is called anything at all.

⚠️ **The branch base is not the baseline SHA.** `feat/joystick-increment-2` is cut from
`origin/master` @ `32afb1fd8`, which is three commits past `d3bf38f44` (Wave Q1 steps 5–10 and
15). Any failure those commits introduce would read as "new" against this baseline and be
misattributed to the hub. Before the Wave A gate, re-measure at the branch's actual merge-base
and record the delta; the delta IS the other workstreams' contribution, and it is not ours.

### ✅ THE BRANCH-BASE DELTA, MEASURED — the gate baseline is 9, not 8

Promised when the `d3bf38f44` baseline was recorded, and it mattered. `feat/joystick-increment-2`
rebased onto `origin/master` @ **`56a4f1370`**, fourteen commits past the baseline SHA. The Wave B
gate found **9 files / 10 tests** failing where the baseline says 8 / 9 — one new file:
`pages/journal-2-0/components/notebook/NoteEditorPage.durable.test.jsx`.

**It fails identically at `origin/master`** — detached worktree, `node_modules` junctioned, same
test (the "same keystroke DOES reach the store by DEFAULT" case), same assertion
(`expected +0 to be 1`). It is notebook Wave Q1's durable-offline work, arriving in those fourteen
commits, and it is **not the hub's**.

⛔ **"My branch touches no notebook file" would NOT have settled it** — that is the `git status`
provenance method this plan already rules out. The run at master is the evidence.

**Increment 2 therefore gates against 9 files / 10 tests at `56a4f1370`, and the hub adds ZERO.**

⚠️ **A second correction, about the measurement itself.** The first attempt at this gate was run in
directory chunks to survive host memory pressure, and the chunk list did not cover `src/` — 1,016
of 1,178 test files, with `ThemeTrackerPage.chartmount` (a baseline row) among the 162 missed. A
partial suite fails in the flattering direction: fewer files run, fewer failures found. The
complement was run separately and the numbers above are the union. **If a gate is ever chunked,
the chunks must be diffed against the full test-file list before the total is quoted.**

### Two rules this measurement earned

> **A TIMEOUT IS NEVER BANKED AS PERMITTED BREAKAGE.** A test that fails a full run on a timeout
> and passes in isolation is load-sensitive, not broken. `enumerationSites.test.js`: 15 000 ms
> timeout under the full suite, **1461 ms** alone on the same SHA. Banking it would leave a slot
> in the baseline that a genuine failure can occupy unnoticed for the rest of Phase 3. Re-run
> alone before classifying any timeout.

> **`git status` IS NOT A PROVENANCE METHOD. `git show <sha>:<file>` IS.** Every one of the four
> hub-owned rows was in a file this branch had NOT modified, so a "did I touch it?" argument from
> the working set would have cleared all four — including the theme-island token pins that PR
> #100 actually broke. Ask the committed version whether the offending construct is present;
> never infer authorship from what happens to be dirty.

Filed for the other owners as **R-04** in `requests.md`. ⚰️ Its community paragraph has since
been **corrected**: `/community` IS routed (`App.jsx:630`) to `CommunityRedesign` → `floor2/Floor2`,
and the thirteen `pages/community/` modules are the documented revert path, not an unrouted
feature. The first reading of that rail's output was wrong; the route table settled it.

### The theme-island defect is now railed

`app/src/styles/themeIslands.test.js` derives the required token set from `tokens.css` every run
and fails BY NAME when a block marked `--theme-island: <name>;` is missing one. Mutation-proved
both ways: removing `--hub-rim` from the research modal's island goes red naming that token;
restoring it goes green. It carries two non-vacuity controls (the required set must be non-empty,
and at least one island must be discovered) plus an internal probe that appends a throwaway
themed token to the parsed tokens text and asserts every island reports it missing.

⭐ Islands are **self-declaring** rather than guessed from a coverage threshold, because two
blocks in this repo look like islands to a naive scan and are not: `floor2/standalone.css`
substitutes for `tokens.css` on a page that never loads it (27/50, correctly partial), and
`ChartsWorkspace.module.css` pins 38/50 *under* `[data-theme='light']` — a theme-specific
re-assertion whose whole purpose would be inverted by forcing default-theme values into it.
