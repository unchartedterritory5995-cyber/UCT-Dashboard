# Joystick Hub — requests to outside owners

Filed rather than acted on. Nobody on this build edits the files below.

---

## FINAL STATE — Increment 7 (BACKLOG ZERO)

Every request gets a verdict. **These were MEASURED against shipped code, not read off the
status lines below** — most of those lines are stale, because the request was resolved in a
later increment and nobody came back to amend the section. Where a section's `Status:` and
this table disagree, **this table is the authority and the section is history**.

| # | Final state | Evidence |
|---|---|---|
| R-01 | **CLOSED — OUTSIDE OWNER.** Options Flow's `of-tip` hook, Ravi's file. Its own line says "**Blocking the hub:** no", and `OptionsFlow.jsx` is a hard no for this build. | section header |
| R-02 | **CLOSED — resolved, no request needed.** | its own status line |
| R-03 | **CLOSED — RESOLVED.** Orb gated, hub owns the corner. | `App.jsx:207`, `hub/useHubActive.js` |
| R-04 (suite failures) | **CLOSED — SUPERSEDED.** "Seven standing suite failures" is now owned by `gate-baseline.json`, which is re-measured every run, carries its own provenance caveat, and has since both ADDED a row master introduced and REMOVED two master fixed. A frozen list of seven was the wrong instrument; the living baseline is the right one. | `docs/plans/joystick/gate-baseline.json` |
| R-04 (reachable) | **CLOSED — RESOLVED.** | `reachable.test.js` AWAITING_A_DECISION |
| R-05 | **CLOSED — RESOLVED.** `onScrub(ctx, scrub)` is the one mounted shape, and the arity is pinned by a rail that reads the real call site. | `hub/contractArity.test.js` |
| R-06 | **CLOSED — RESOLVED.** `scrubReadout` is a real `useMemo` and is passed to the chip; it is no longer hard-coded `null`, so every section's `readout()` reaches a member. | `HubRoot.jsx:299`, `:481` |
| R-07 | **CLOSED — RESOLVED.** The hub's two `AWAITING_A_DECISION` entries are gone; the entries remaining in that file are the cockpit-retirement set and belong to another workstream. | `reachable.test.js:279+` |
| R-08 | **CLOSED — BLOCKED.** `PUT /api/j2/positions/{id}` is an `api/` file. The Railway `worker` service's live watch list is `['/api/**', …]`, so any `api/` edit redeploys `worker`. Not this increment's to touch. | `railway status --json` |
| R-09 | **CLOSED — RESOLVED.** `run` and `confirm` are dispatched. | `HubRoot.jsx:171`, `:186` |
| R-11 | **CLOSED — BLOCKED + OUTSIDE OWNER.** `OptionsBoard.jsx` lives under `app/src/pages/journal-2-0/**`, which this build does not edit; the request itself names Journal 2.0 as owner and says "**Blocking:** no". | file path; section header |
| R-12 | **CLOSED — informational.** "Owner: none — informational, recorded so the plan line…" | its own header |
| R-13 | **CLOSED — RESOLVED.** The scan picker ships through the page's own seam: `ScannerShell` supplies `onOpenScans`, and `screenerSection` pushes the action **only** when a seam exists — absent, never present-and-inert. | `ScannerShell.jsx:201`, `screenerSection.js:312-318` |
| R-15 | **CLOSED — RESOLVED.** The cursor row is painted in all three renderers. | `VirtualResults.jsx:38`, `ResultCards.jsx:17` |
| R-16 | **CLOSED — RESOLVED.** `planTrade` is `kind:'run'`, so Plan trade opens ONE sheet. | `registry.js:159-172` |
| R-18 | **CLOSED — RESOLVED.** `data-note-card-id` carries note identity, with its own rail. | `hub/noteCardIdentity.test.jsx` |

The remaining rows — **R-10, R-14, R-17, R-19** — were closed by Increment 7's own work; their
verdicts are recorded in the closure report beside the commits that closed them.

---

## R-19 — `notebook.templates` needs a picker, and the confirm sheet cannot carry one

**Status:** ✅ **APPLIED 2026-09-10 on `inc7/p2-linkticker`** — shipped as a `confirm` with a
select, which is this section's own first return condition. · **Owner:** this build.

**What shipped, and what was checked before choosing it.** `HubConfirmPayload` gained
`type: 'select'` with a required `options` list (`contracts.js` + `HubConfirmSheet`), and
`notebook.templates` is back on the outer ring with a payload whose options are DERIVED from
`lib/notebookTemplates.js` — never typed — so a template added tomorrow is in the picker the day
it lands. Ring layout after the return: outer 3, inner 4; both legal.

⛔ **The second return condition is still NOT met, and it was measured rather than assumed.**
"a template-picker route the hub can navigate to" does not exist: `NotebookTab.jsx` renders
`TemplatePicker` behind a private `pickerOpen` useState with no prop, no URL param and no
imperative handle — the R-13 shape exactly — and that file is rule-12. So `navigate` was never
available, and the two remaining shapes were the two this section refuses.

⛔ **A `text` field was considered and rejected**: it would ask the member to TYPE a stable API
key (`daily-prep`), which is worse than the hardcoded key, not better. Rail:
`hub/notebookTemplatesPicker.test.jsx`, which drives a real gesture and asserts that two
different picks produce two different notes — a rail that creates one note from the default
passes against the hardcoded version this section names.

"Templates" means *choose one*. `createNoteFromTemplateViaApi(templateKey, …)`
(`journal-2-0/lib/noteCreation.js:50`) requires a key, and the hub has no surface that can ask for
one: `HubConfirmPayload.fields` is unreachable (**D-35 / R-14** — `HubRoot`'s confirm branch builds
its own payload and never asks the section for one), and there is no other picker.

Shipping it anyway had two bad shapes and no good one. With **no run body** it is a dead bubble —
the fan closes, nothing happens, the exact R-09 defect. With a **hardcoded key** the label lies:
"Templates" that always makes the same one.

**Removed from the fan when §3.7 shipped**, with the reason in the registry beside the removal.
The two template-shaped actions that DO have a seam stayed live — `notebook.dailyPlan` and
`notebook.postMortem` navigate to `?new=daily-prep` / `?new=trade-review`, both stable keys
(`lib/notebookTemplates.js:19`).

**Returns when** either D-35 is closed (the confirm sheet carries fields, and Templates becomes a
`confirm` with a select) or the Notebook gains a template-picker route the hub can navigate to.

---

## R-18 — `NoteCard` renders no note identity, so the hub cannot say WHICH card the cursor is on

**Status:** filed 2026-09-10, blocking Increment 4's §3.7. · **Owner:** the Notebook workstream
(`app/src/pages/journal-2-0/components/notebook/NoteCard.jsx`).

**The ask — one additive attribute on the card root:**

```jsx
data-note-card-id={note.id}
```

⛔ **NOT `data-note-id`.** That name already belongs to TipTap's inline note-LINK node inside note
bodies (`journal-2-0/lib/noteLinkNode.jsx:36-37` renders `{ 'data-note-id': attrs.noteId }` and
parses `span[data-note-id]`). A hub selector on `[data-note-id]` would match every inline link in an
open note as well as every grid card — ambiguous the day it was written, and over-counting on
exactly the screen where the cursor matters.

**Why.** `NoteCard.jsx` renders `<div className={styles.card}>`; the only per-note identity is
`key={n.id}` at `NotebookTab.jsx:848`, and a React key does not reach the DOM. The hub can PAINT a
cursor over cards — `useHubCursor.paintCursor`, the same imperative path Morning Wire uses for
markup the hub does not own — but cannot learn which note a card is. §3.7 requires selection to
write `?note=<id>` through `applyTargetToParams` (`lib/searchNavigation.js:86`), and `useHubCursor`
requires an explicit identity key.

**Rejected alternatives, so this is not re-proposed:** deriving identity from the card's title text
needs a hub-side fetch of the notebook's own list to map back to an id — a second authority over
that list, and titles are not unique. Dispatching a synthetic click on the card works but bypasses
`applyTargetToParams`, which is the thing that ruling exists to guarantee.

**Cost to that side:** one attribute, renders nothing, changes no behaviour, no test should move.

---

## R-17 — `notebook.linkTicker` has no symbol source on `/journal/notebook`

**Status:** ✅ **APPLIED 2026-09-10 on `inc7/p2-linkticker`** — the action is back, and the
decision below ("either the route gains a symbol, or the entry is removed") was answered with a
THIRD option that neither branch anticipated. · **Owner:** this build.

**The symbol comes from the SHEET, not from the route.** `notebook.linkTicker` is now
`kind:'confirm'` with a section-supplied payload carrying one required text field, seeded from
`ctx.symbol` when the hub is holding one and EMPTY otherwise.

⛔⛔ **`requires: ['symbol']` IS GONE, AND THAT IS THE FIX RATHER THAN A SOFTENING.** `requires`
is answered from the CONTEXT before the gesture resolves; the symbol this action needs is one the
member types afterwards — so the precondition disabled the only action whose purpose is to supply
the thing it demanded. The gate moved in two pieces, and neither can be a dimmed bubble or a dead
one: the controller DROPS the action when the grid holds no note at all (absent, never
present-and-inert), and the field is required — an empty or unparseable value writes nothing and
says so in rendered text.

**Ring layout as shipped:** outer 3 (New note · Set ticker · Templates, with R-19 landing in the
same increment), inner 4. Both legal (`OUTER_MAX` 5, `INNER_MAX` 4), proved on the projection
`HubRoot` draws rather than on the declaration alone.

**The write** goes through the Notebook's own client, `useJ2Note(id).update` →
`PUT /api/j2/notes/{id}`, which also invalidates the note's SWR entry and the noteLink title
cache. ⚠️ There is **no note PATCH client anywhere in `app/src`** — the Notebook updates a note
with a partial PUT body (`NoteEditorPage.jsx`'s own ticker control takes the same path). Declared
in `writePaths.test.js` as `owner: 'app'`. Rail: `hub/linkTickerWritesTheNote.test.jsx`.

`notebook.linkTicker` declares `requires: ['symbol']`, and the Notebook route carries no symbol —
`?ticker=` exists only on the `?new=` seed deep link. An action whose `requires` cannot be satisfied
renders DISABLED and never hidden (spec §2e, `HubRoot.jsx:275-278`), so shipping it live would put a
permanently dimmed bubble in the fan.

**Ruled:** deferred, not removed from the registry — Increment 3 dropped 3.7 entirely (H1), so the
notebook fan does not ship live and `linkTicker` stays exactly as it is on master. When Increment 4
wires §3.7, the decision is: **either** the route gains a symbol (and the action ships), **or** the
entry is removed with a comment citing this request. Ring layout if removed: outer 3 → 2, inner
stays 4. Both remain legal (`OUTER_MAX` 5, `INNER_MAX` 4).

---

## R-16 — `scan.planTrade` is `kind:'confirm'`, so Plan trade opens TWO sheets

**Filed by:** the 3.3 Screener integrator. **Not blocking** (`scan` is still in `PREVIEW_MODES`) —
**cosmetic but member-visible the day it is not.** **Owner:** Director (`registry.js`).

`registry.js`'s shared `planTrade(mode)` builder sets `kind: 'confirm'` with
`confirmText: (ctx) => 'Plan ' + ctx.symbol`. Now that R-09 has landed, `HubRoot`'s confirm branch
opens `HubConfirmSheet` with that text and calls `action.run(ctx)` on the primary button — and the
Screener's `run` opens `hub/PlanTradeSheet.jsx`. So the member gets:

> a fan bubble → a sheet saying **"Plan AAA"** with one button → a second sheet with the actual
> entry/stop/size fields and a **Save plan** button.

The first sheet asks the member to confirm something they have not been shown yet. §3.3 of the plan
already calls this action **`run`** (*"`Plan trade` (`run` — see the ⛔ below)"*), and the sheet it
opens carries its own confirm step — that IS the WCAG 2.5.1 equal path, with real fields, so the
generic confirm adds a tap and no safety.

The 3.4 Journal integrator reached the same place from the other side and wired `journal.addTrade`
(`kind:'run'`) instead, so today the two doors onto ONE sheet have different gesture shapes.

Requested — `app/src/hub/registry.js`, the shared builder:

```diff
 const planTrade = (mode) => ({
   id: `${mode}.planTrade`,
   label: 'Plan trade',
   icon: 'equity',
   ring: 0,
   color: '--hub-mode-journal',
-  kind: 'confirm',
+  // The sheet it opens IS the confirm step, with real fields and its own Save plan button; a
+  // generic "Plan AAA?" in front of it asks the member to confirm something they have not seen.
+  kind: 'run',
   requires: ['symbol'],
-  confirmText: (ctx) => `Plan ${ctx?.symbol ?? ''}`.trim(),
 })
```

⚠️ `validateRegistry` requires `confirmText` only on `kind:'confirm'`, so dropping both together is
the whole change. `screenerSection.js` derives its fan from the registry and attaches `run` to this
id either way, so it needs no edit when this lands.

---

## R-15 — no results row is painted `data-hub-cursor`, so the Screener cursor is invisible

**Filed by:** the 3.3 Screener integrator. **The cursor moves, scrolls, and names itself on the
chip — and the member cannot see WHICH ROW it is on.** **Owner:** the screener shell
(`shell/VirtualResults.jsx`, `shell/ResultCards.jsx`).

`useHubCursor` offers two ways to mark the selected row — `itemProps(i)` (spread onto a React
element) and `paintCursor(nodes)` (imperative, for DOM the section does not own). **Neither is
usable from `screenerSection.js`:**

- `itemProps` has to be spread by the component that renders the row, and neither renderer takes a
  prop that could carry it;
- `paintCursor` needs the row nodes in the same order as `items`, and both renderers are
  **virtualized** — about eight rows exist in the DOM at a time, so a node list gathered from
  outside is neither complete nor index-aligned.

The token already exists (`tokens.css:547`, reused by the Journal's three carriers), so this is a
prop and one attribute, not a design.

Requested — `app/src/pages/screener/shell/VirtualResults.jsx`:

```diff
 const VirtualResults = forwardRef(function VirtualResults({ rows, columns, sort, onSort, livePrices,
-  density = 'compact', view, hasMore, onLoadMore, isLoading, virtualOpts }, ref) {
+  density = 'compact', view, hasMore, onLoadMore, isLoading, virtualOpts, itemProps }, ref) {
@@
-              <div role="row" key={row.ticker} className={styles.gridRow}
+              <div role="row" key={row.ticker} className={styles.gridRow}
+                {...(itemProps ? itemProps(vi.index) : null)}
                 style={{ position: 'absolute', top: vi.start, left: 0, right: 0, height: vi.size }}>
```

…and the identical two lines in `ResultCards.jsx` on its `styles.card` div. `ScannerShell` then
passes `itemProps={hub.cursor.itemProps}` beside the `ref` it already passes.

⚠️ **`ChartsGallery` cannot take this** and should not be given a half-version: it is unvirtualized
and paginates internally at 24 with `page` in private state, so a cursor at index 30 is on a page
the member is not looking at. Marking it there would put a highlight on a card that is not the one
the cursor is on. That is R-15's second half and it is a design question, not a diff.

⭐ **Please assert it on RENDERED DOM, not on the cursor's state.** `itemProps` returning the right
object proves nothing about whether an attribute reached a row — that is exactly the severed wire
this hub keeps rediscovering.

---

## R-14 — `HubRoot`'s confirm sheet cannot carry a section's FIELDS, so the accessible path is unreachable

**Status:** ✅ APPLIED 2026-09-10 on `inc7/p1-confirm-fields` — the diff below landed as requested,
plus the contract edit its ⚠️ note demands (`confirmPayload` documented on `HubActionRef`;
`validateSectionConfig` refuses it on a non-function and on any kind but `confirm`) and the
`validateConfirmPayload` call on the section-supplied payload. Railed on the RENDERED sheet in
`app/src/hub/confirmFieldsReachable.test.jsx`, per the ⭐ warning. `screenerSection.js` needed no
wiring — `alertConfirmPayload()` was already attached to `scan.alert`; only its two "cannot reach
the member" comments were corrected.

**Filed by:** the 3.3 Screener integrator. **Blocks the Screener's `Alert` action from being
useful.** **Owner:** Director (`HubRoot.jsx`).

R-09's confirm branch builds the sheet payload itself:

```js
setConfirmPayload({
  title: action.label,
  body: action.confirmText?.(ctx) ?? `${action.label}?`,
  primaryLabel: action.label,
  onConfirm: () => Promise.resolve(action.run?.(ctx)).catch(…),
})
```

That is right for a yes/no write. It cannot express the one thing `HubConfirmSheet` was built for:

> `fields` — *"The EQUAL path, not a fallback: steppers and a numeric input operating on the same
> value the gesture produced, for a member who cannot perform a fine drag. **This is why the sheet
> exists at all** rather than the gesture committing."* — `contracts.js`, `HubConfirmPayload`

`HubConfirmSheet` already renders `fields` with ± steppers, a numeric input, min/max/step clamping
and 2dp rounding. Nothing can reach that code, because `runAction` never asks a section for a
payload — and `onConfirm` is called as `() => action.run(ctx)`, which drops the `values` the sheet
hands it.

**What it costs the Screener right now:** `Alert` is `kind:'confirm'` and the member has no way to
say a price. `screenerSection.js` exports `alertConfirmPayload()` — the correct payload, with the
price field defaulting to the number the table is showing and the direction derived from it — and
that payload reaches nobody, so the shipped behaviour is an alert at the current price, which fires
on the next tick. The section keeps a `run` handler so the action is not inert, but the useful
version is one branch away.

Requested — `app/src/hub/HubRoot.jsx`, inside the `confirm` branch:

```diff
     if (action.kind === 'confirm') {
+      // ⭐ A section may supply its OWN payload — the only way `HubConfirmPayload.fields` (the
+      // WCAG 2.5.1 equal path) can reach the sheet. Generic yes/no confirms keep the fallback.
+      const own = action.confirmPayload?.(ctx)
+      if (own) { setConfirmPayload(own); return }
       setConfirmPayload({
         title: action.label,
         body: action.confirmText?.(ctx) ?? `${action.label}?`,
         primaryLabel: action.label,
-        onConfirm: () => Promise.resolve(action.run?.(ctx)).catch((err) => {
+        onConfirm: (values) => Promise.resolve(action.run?.(ctx, values)).catch((err) => {
           setToastMsg(err?.message || 'That did not work. Try again.')
         }),
       })
       return
     }
```

⚠️ Whoever applies this owns one contract edit with it: `HubSectionConfig`/`HubAction` should
document `confirmPayload(ctx) => HubConfirmPayload|null`, and `validateConfirmPayload` should run on
the section-supplied one (it already runs on render inside `HubConfirmSheet`, so this is belt and
braces). ⭐ **And please rail it on the RENDERED sheet** — a test that `confirmPayload` was called
passes with the wire cut.

---

## R-13 — the Screener's scan picker has no open seam, so `scan.scans` ships ABSENT

**Filed by:** the 3.3 Screener integrator. **Not blocking** — the action is absent, not broken.
**Owner:** the screener shell (`pages/screener/ScreensManager.jsx`).

§3.3's inner ring is `Scans · Why? · Voice · Home`, and `Scans` is specified as *"opens the existing
scan picker"*. The picker is `ScreensManager`'s "Screens ▾" menu (`ScreensManager.jsx:410`), and its
open state is **private**:

```js
const [open, setOpen] = useState(false)
…
<button type="button" className="btn btn-primary" onClick={() => setOpen(o => !o)}>Screens ▾</button>
```

There is no `open`/`onOpenChange` prop, no imperative handle, and no ref. The only way in from
outside is to find that button by its text and click it, which is a text-matched reach into another
component's DOM — the kind of coupling that breaks silently the day the label changes.

So `screenerSection.js` **drops `scan.scans` from the fan** rather than shipping a bubble that does
nothing: *"⛔ AN UNWIRED ACTION IS ABSENT, NEVER PRESENT-AND-INERT"* (`registry.js`). A rail asserts
the registry declares it and the section does not, so it cannot silently reappear inert.

Requested — the smallest thing that would work, mirroring `VirtualResults`'s existing
`useImperativeHandle` seam:

```diff
-export default function ScreensManager({ currentSpec, onApply, onUseScan }) {
+const ScreensManager = forwardRef(function ScreensManager({ currentSpec, onApply, onUseScan }, ref) {
   const [open, setOpen] = useState(false)
+  // The hub's "Scans" action opens this menu; the button above is the other door onto the same
+  // state, so there is exactly one authority for "is the picker open".
+  useImperativeHandle(ref, () => ({ openPicker: () => setOpen(true) }), [])
```

`ScannerShell` then passes a ref through to the section, and `buildScanFan` attaches
`run: () => picker.current?.openPicker()` to the id it already knows. **One line of the section
changes when this lands** — it is the `case 'scan.scans':` that currently breaks.

⚠️ Please do NOT solve this by having the hub click the button: a control reaching into another
component's rendered text is a wire that no test can hold still.

---

## R-09 — `HubRoot.runAction` never dispatches `action.run(ctx)`, so every Phase 3 `run` and `confirm` action is inert

**Filed by:** the 3.4 Journal integrator. **Blocks every write action in Phase 3, in every section.**
**Owner:** Director (`HubRoot.jsx`).

`registry.js`'s own `HubAction` typedef declares the seam:

```js
 * @property {Function}[run]         (ctx) => void|Promise<void>, for kind:'run'.
 * @property {Function}[confirmText] (ctx) => string. REQUIRED when kind === 'confirm'.
```

`HubRoot.jsx`'s `runAction` handles `home`, `navigate`, and exactly one `run` (`*.voice`). Every
other `run` — and every `confirm` — falls through to a DEV `console.warn` and does nothing:

```js
    if (action.kind === 'run' && action.id.endsWith('.voice')) { … }
    // ⛔ UNREACHABLE IN THE PREVIEW, AND THAT IS THE POINT.
    if (import.meta.env?.DEV) console.warn('[hub] preview reached an unwired action:', action.id)
```

That comment is true **only while every mode sits in `PREVIEW_MODES`**. The moment a mode leaves
the preview, its fan ships `run`/`confirm` bubbles that a member can select, that light up, that
fire — and that do nothing at all. ⛔ **The `PREVIEW_MODES` flip is therefore not a one-line
registry change**: without this, flipping `journal` ships four dead bubbles (Move stop, Breakeven,
Close, Add trade) and one dead confirm path.

**Proposed diff** (not applied — `HubRoot.jsx` is Director-owned):

```diff
   const runAction = useCallback((action) => {
     if (!action) return
     if (action.kind === 'home') { goHome(); return }
     if (action.kind === 'navigate') { navigate(resolveNavTarget(action.to)); return }
     if (action.kind === 'run' && action.id.endsWith('.voice')) {
       voiceConnectRef.current?.('compass')
       return
     }
+    // A section attaches its own handler to the registry's action data (see
+    // `sections/journalSection.js`). `confirm` actions open their section's sheet the same way —
+    // the sheet is the write path, so the engine only has to reach the handler.
+    if (typeof action.run === 'function') { action.run(ctx); return }
     if (import.meta.env?.DEV) {
       console.warn('[hub] preview reached an unwired action:', action.id)
     }
-  }, [goHome, navigate, setToastMsg])
+  }, [goHome, navigate, ctx, setToastMsg])
```

⚠️ `setToastMsg` is already in that dep array and is no longer read in the body — unrelated, noted
in passing.

**Meanwhile:** §3.4's fan handlers ARE attached (`journalSection.js` layers `run` onto each
registry action) and are covered by that section's suite by calling them directly. They are
unreachable through the engine until this lands, and `journal` stays in `PREVIEW_MODES`, so
nothing ships half-wired.

---

## R-10 — the Journal fan has no `Plan trade`, and three artifacts name its inner ring differently

**Status:** ✅ **APPLIED 2026-09-10 on `inc7/p2-linkticker`**, but **NOT as the diff below** — see
the ruling under it. **Filed by:** the 3.4 Journal integrator. **Owner:** Director (`registry.js`).

Three documents describe the Journal's inner ring and no two agree:

| Source | Inner ring |
|---|---|
| `registry.js` `modes.journal.fan` (the running code) | Add trade · **Note** · Voice · Home |
| `60-phase3-plan.md` §3.4 | **Set stop** · **Plan trade** · Voice · Home |
| the 3.4 wave brief | Add trade · **Stats** · Voice · Home |

The outer ring is unanimous (Chart · Move stop · Breakeven · Close) and matches the registry
exactly, so only the inner ring is in question.

⛔ **The consequence is not cosmetic.** Gate A5 requires *"From the Journal: the same sheet opens
prefilled from the selected position"*, and **no `journal.planTrade` action exists** for that door
to hang on. `journalSection.js` therefore wires the Plan-trade sheet to **`journal.addTrade`** —
the only unclaimed `run` on the fan — and says so in its own header. That is a placement decision
made by a section about Director-owned data, which is exactly the kind of thing this file exists
to surface rather than bury.

⛔ **THE PROPOSED DIFF WAS EVALUATED AND NOT APPLIED AS WRITTEN.** It replaces
`note('journal', 1)`, which DROPS Note from the Journal fan, and it leaves `journal.addTrade`
declared with no body of its own. Measured against the caps, that trade buys nothing: replacing
**`addTrade`** instead keeps Note, keeps the outer ring at 4 (≤ `OUTER_MAX` 5) and the inner at 4
(≤ `INNER_MAX` 4), and removes the mislabelled action outright rather than leaving an orphan for
someone else to resolve. Nothing is lost by dropping `addTrade`: it never had a body of its own —
the Plan-trade sheet is what it always opened, which is the defect.

The shipped entry is built from the shared `planTrade(mode)` builder, so "Plan trade" still means
one thing everywhere, with exactly two facets overridden and both named beside the override:
`ring: 1` (§3.4's inner ring) and `requires: ['position']` (A5 says PREFILLED FROM THE SELECTED
POSITION — a symbol is not enough, because an option row publishes a symbol and a NULL position
and the sheet would open with no entry, stop or size). Journal inner ring as shipped:
**Plan trade · Note · Voice · Home**. `positionRequiredActionIds()` went 3 → 4 with no edit,
exactly as the note below predicted.

**Proposed diff** (not applied, retained as the record of what was proposed):

```diff
       {
         id: 'journal.addTrade',
         label: 'Add trade',
         icon: 'plus',
         ring: 1,
         color: '--hub-mode-journal',
         kind: 'run',
       },
-      note('journal', 1),
+      {
+        id: 'journal.planTrade',
+        label: 'Plan trade',
+        icon: 'pin',
+        ring: 1,
+        color: '--hub-mode-journal',
+        kind: 'run',
+        requires: ['position'],
+      },
```

⚠️ **Also measured, because the brief assumed otherwise:** the registry carries **THREE**
`requires:['position']` actions on this fan — `journal.moveStop`, `journal.breakeven`,
`journal.close` — not four. The brief's fourth was Plan trade, which does not exist yet.
`journalSection.positionRequiredActionIds()` DERIVES the list from the registry rather than typing
it, so the day the action above lands it is covered without an edit; the section's suite asserts
the derived list rather than a count.

---

## R-11 — in LIST view, option strategies render through `OptionsBoard`, which carries no cursor carrier

**Filed by:** the 3.4 Journal integrator. **Owner:** Journal 2.0. **Blocking:** no.

§3.4 authorised exactly three carrier lines: `HoldingsList` (the list), `PositionsTable`'s `<tr>`
(the table) and its phone card. All three now carry `data-hub-pos`.

But `HoldingsList` renders **only equities** — `buildEquityRows` maps `positions`, and the open
option strategies are handed to a sibling component, `components/OptionsBoard.jsx`. So in the
DEFAULT (list) view the hub cursor walks equity rows only; option rows enter the cursor in TABLE
view, where `optionToRow` merges them into the same array.

That is a coverage gap, not a correctness bug — an option row is a row every `requires:'position'`
action is disabled on anyway — and it is recorded in `journalSection.js`'s header rather than
worked around. **The ask:** one line on `OptionsBoard`'s row element,
`data-hub-pos={String(strategy.id)}`, whenever that file's owner is next in it.

---

## R-12 — the phone-card carrier could not go where §3.4 cited it

**Filed by:** the 3.4 Journal integrator. **Owner:** none — informational, recorded so the plan line
is corrected rather than re-followed.

§3.4 names three carriers: `HoldingsList.jsx:170-175`, `PositionsTable.jsx:278`, `:525-527`. The
first two are DOM elements and took the attribute directly. **`:525-527` is not a DOM element** —
it is the `<PhoneCard key={p.id} position={p} …>` call site, and an attribute there becomes a React
prop that PhoneCard would have to forward. The attribute therefore sits on PhoneCard's own root
`<div className={styles.card}>` (same file, same phone branch, still one line, still nothing but
the carrier). No prop was added and no behaviour changed.

---

## R-07 — `reachable.test.js`: Wave A wired both hooks; their `AWAITING_A_DECISION` entries must go

**Filed by:** the 3.2 Breadth integrator. **Shared with 3.1 Wire** — either wave alone triggers it,
so whichever lands first, this is one edit, not two.

`app/src/components/screener/reachable.test.js` fails its own **`and it cannot excuse something
that is actually wired`** assertion:

```
these are reachable — remove their AWAITING_A_DECISION entries
  app/src/hub/useHubMode.js
  app/src/hub/useHubCursor.js
```

That is the rail working exactly as written. Its own comment says so:

> ⚠️ REMOVAL CONDITION, not a parking space: Phase 3 mounts them. … **When the first page wires
> each one, DELETE ITS ENTRY HERE in the same commit.**

Both conditions are now met, by two different waves:

| Module | First real caller |
|---|---|
| `app/src/hub/useHubMode.js` | `app/src/pages/MorningWire.jsx:12,173` (3.1) **and** `app/src/hub/sections/breadthSection.js:41,224` (3.2) |
| `app/src/hub/useHubCursor.js` | `app/src/hub/sections/wireSection.js:38,174` (3.1) |

`reachable.test.js` is outside this build's owned set, so it is filed rather than applied.

Requested diff — delete lines 280–303 of `app/src/components/screener/reachable.test.js` (the whole
"JOYSTICK HUB, PHASE 1" comment block and both entries):

```diff
 const AWAITING_A_DECISION = {
-  // ── JOYSTICK HUB, PHASE 1 (2026-01) ──────────────────────────────────────
-  //
-  // Two hooks that are BUILT AND TESTED BUT MOUNTED NOWHERE. …
-  'app/src/hub/useHubMode.js':
-    'JOYSTICK HUB PHASE 1 — the per-page mode registration hook. …',
-  'app/src/hub/useHubCursor.js':
-    'JOYSTICK HUB PHASE 1 — the one shared list cursor. …',
   // ── JOYSTICK HUB, PHASE 3 TASK 0 (2026-09-09) ────────────────────────────
```

⛔ **`app/src/hub/HubConfirmSheet.jsx` STAYS.** Its removal condition is "the first section that
opens a confirm sheet", and neither Wave A section proposes a write — Breadth's fan is not wired
this wave and the plan lists no `confirm` action for `breadth` at all. Deleting all three entries
together because they share a map would excuse a genuinely unmounted component.

The `NOT MOUNTED YET` banners inside `useHubMode.js` / `useHubCursor.js` are also false now and
should go in the same commit: they instruct the next reader to treat a mounted module as a design.
Both files are Director-owned.

---

## R-06 — `HubRoot` hard-codes `scrubReadout={null}`, so every section's `readout()` is dead

**Filed by:** the 3.2 Breadth integrator. **Blocks the visible half of every Phase 3 scrub.**

`contracts.js` makes `readout()` mandatory beside `onScrub` for a stated reason:

> a section with onScrub must also supply readout() — **a scrub the chip cannot narrate is invisible**

Breadth supplies one (the resolved tab's label). It reaches nobody: `app/src/hub/HubRoot.jsx:298`
passes the chip a literal `null`, under a comment saying Phase 3 will wire it —

```jsx
        scrubReadout={null}
```

so `HubChip` falls back to the literal word "Scrub" for every section, on every drag. The validator
that exists to prevent an unnarrated scrub passes while the product ships exactly that.

This bites Breadth harder than a cursor section: the tab scrub PREVIEWS and commits on release
(each tab owns a heavy subtree — ECharts, Chart.js, a virtualized grid — which must not be mounted
and torn down at every intermediate index of one drag), so between press and release the chip is
the **only** feedback the member gets. With `null` there, the gesture reads as dead until they let
go.

Requested diff — `app/src/hub/HubRoot.jsx`:

```diff
-      {/* Phase 3 wires a real per-mode scrub readout (e.g. "NVDA · 4H") off
-          `activeModeConfig`; nothing in the registry produces one yet, so this
-          stays null (HubChip falls back to the literal "Scrub" while scrubbing). */}
       <HubChip
         label={activeModeConfig?.label}
@@
-        scrubReadout={null}
+        // Phase 3: the section narrates its own scrub. Called only WHILE scrubbing (the
+        // contract says readout() must be cheap and must not mutate), and defensively —
+        // a section throwing here would take the whole hub down mid-gesture.
+        scrubReadout={state.scrubbing ? safeReadout(activeModeConfig) : null}
```

with, beside `runAction`:

```js
/** A section's readout, or null. Never allowed to throw into HubRoot's render. */
function safeReadout(config) {
  if (typeof config?.readout !== 'function') return null
  try { return validateChipReadout(config.readout(), `${config.id} readout`) } catch { return null }
}
```

⚠️ `HubChip`'s prop is typed `string|null` in `contracts.js` (`HubChipProps.scrubReadout`) while
`ChipReadout` also permits `{label, value}`. **Whoever applies this owns that reconciliation** —
either `HubChip` learns the object form, or `HubSectionConfig.readout` is narrowed to a string.
Breadth returns a bare string either way, so it is unaffected by the choice.

**⭐ Confirmed independently by the 3.1 Wire integrator.** Wire is the section §3.1 specifies a chip
string for by name — *"the segment's own label text, e.g. `"The Board"`"* — so with `null` there the
one piece of copy the spec writes out for this section reaches nobody. `wireSection.js`'s `readout()`
returns a **bare string** (the label, or `Segment N of M` when a rundown renders an empty one), so
it is likewise unaffected by the `string` vs `{label, value}` choice above.

⚠️ **Please add a rail that goes red if the prop returns to `null`, asserted on the chip's RENDERED
TEXT.** A structural test that `readout()` exists, or that `safeReadout` was called, passes with the
wire cut — which is the state this entry is reporting. Both Wave A sections' readouts are unit-tested
today and both are dead in the product; that is precisely the pair of green suites either side of a
severed wire that `contracts.js`'s own header was written about.

---

## R-05 — `onScrub` is documented with two different argument lists, and both are mounted

**Filed by:** the 3.2 Breadth integrator. **Not blocking** (Breadth reads either) — **but it is a
live severed-wire hazard for every later section.**

Two authorities disagree about what a section's `onScrub` is called with:

| Caller | Signature |
|---|---|
| `app/src/hub/HubRoot.jsx:147` — the MOUNTED path | `activeModeConfig?.onScrub?.(ctx, scrub)` |
| `app/src/hub/registry.js:49` — `HubMode` JSDoc | `(ctx, delta) => void` |
| `app/src/hub/contracts.js:261` — `HubSectionConfig` typedef | `(scrub: {delta, axis}) => void` |
| `app/src/hub/phase3Contracts.test.jsx` — `EngineHarness` | `onScrub: config.onScrub` → the engine calls `(scrub)` |

An integrator who builds against `contracts.js` — which is what the Phase 3 brief instructs, and
what the contract test drives — writes `onScrub({delta, axis})`. On the real page that parameter is
`ctx`, `ctx.delta` is `undefined`, and the scrub does nothing, **while the section's own suite stays
green, because the harness calls it the other way.** That is the Phase 2 defect shape verbatim, and
`contracts.js` cannot catch it: `validateSectionConfig` only checks that `onScrub` is a function.

`breadthSection.js` sidesteps it by identifying the payload rather than positioning it
(`scrubPayloadOf` — the argument carrying a finite numeric `delta`), and its suite asserts that BOTH
call shapes land. That is a defensive read, not a fix: the seam still has two answers.

**⭐ Confirmed independently by the 3.1 Wire integrator, which had not seen this entry when it hit
the same wall** — two waves reaching the identical conclusion from opposite ends of the seam is the
strongest evidence available that this is real and not a misreading. `wireSection.js` carries the
same shim under a different name (`readScrubPayload`), and `wireSection.test.jsx` asserts both call
shapes with a mutation check (collapsing it to "first argument wins" turns the `HubRoot` case red).
**Whichever direction is chosen, please delete BOTH shims in that commit** — `readScrubPayload` in
`hub/sections/wireSection.js` and `scrubPayloadOf` in `hub/sections/breadthSection.js`. Each is a
workaround for a disagreement; left behind after the fix, they become two more places that quietly
tolerate a signature nothing should be sending.

⚠️ 3.1 has no preference between the two directions and is not relitigating the recommendation
above — it only asks that the losing signature stop being documented anywhere, so the next
integrator cannot read the wrong one first.

### ✅ RESOLVED (Director) — and the WIRE shim is deleted

`contracts.js` now documents `(ctx, scrub)`, `HubRoot.jsx` has always called it that way, and
`contractArity.test.js` DERIVES the argument list from the call site rather than restating it, so
the three cannot drift apart again.

⭐ **`readScrubPayload` is gone from `hub/sections/wireSection.js`** (3.3 Screener integrator,
2026-09-09), and `wireSection.test.jsx` now RAILS it out: a behavioural case asserting a
one-ARGUMENT call is inert, plus a source rail matching the shim's SHAPE (a rest-parameter
handler, a loop searching `args` for a numeric `delta`, the helper's name, `arguments`) with
comments stripped and a non-vacuity control that runs those matchers against the deleted source
verbatim. A defensive read against a bug that no longer exists teaches the next reader the seam is
still ambiguous — which is how two integrators each came to write one.

⚠️ **`scrubPayloadOf` in `hub/sections/breadthSection.js` is STILL THERE.** That file belongs to
the 3.2 Breadth integrator; this entry's own request was that BOTH shims go in the fix commit.

⚠️ **Separately, and NOT fixed here: `wireSection.js` treats `scrub.delta` as an absolute
position.** `useJoystick.js:301-306` emits `delta: (thisMove - lastMove) / travelPx` — a per-move
STEP — while `useHubCursor.scrubTo(delta)` reads 0..1 as an ABSOLUTE position, so
`scrubTo(scrub.delta)` makes one small drag jump to the first or last segment and a long one pin
at an end. `breadthSection.js` and `screenerSection.js` both accumulate the steps in a ref;
`wireSection.js` does not. Left alone deliberately: the shim deletion was the instructed change,
and altering the wire's scrub behaviour is a 3.1 decision, not a side effect of a cleanup.

Requested — pick one and make the other match. The cheaper direction is to align the typedef with
the mounted caller, since `HubRoot` and `registry.js` already agree:

```diff
--- a/app/src/hub/contracts.js
+++ b/app/src/hub/contracts.js
- * @property {(scrub: {delta: number, axis: 'x'|'y'}) => void} [onScrub]
+ * @property {(ctx: object, scrub: {delta: number, axis: 'x'|'y'}) => void} [onScrub]
+ *   ⚠️ ctx FIRST. `HubRoot.jsx` calls `onScrub(ctx, scrub)` and `onScrubCommit(ctx)`; a section
+ *   written to the one-argument form silently receives `ctx` and reads `undefined.delta`.
```

…and, in the same commit, `phase3Contracts.test.jsx`'s `EngineHarness` should pass
`onScrub={(scrub) => config.onScrub(ctxStub, scrub)}` so the harness models `HubRoot` rather than a
second wiring — otherwise the file that exists to test the join keeps testing a shape nothing
mounted uses.

If the one-argument form is preferred instead, `HubRoot.jsx:147,151` and `registry.js:49-50` are the
two edits, and a section wanting `ctx` reads it from `useHub()` at its own mount point — Breadth
already does, and needs no `ctx` at all.

---

## R-08 — `PUT /api/j2/positions/{id}` stop validation has three holes

**Status:** filed, not acted on. Found by the §3.4 citation pass, 2026-09-09, and **verified from
source by the Director**. A3 requires the hub's confirm sheet to refuse a side-flipping stop AND
requires the backend to reject the same; it mostly does (`positions.py:343-355`), but three inputs
get past it. ⛔ **Not ours to fix** — the hub cannot reach any of them, and a hub-side patch would
be a second authority over j2's own validation.

1. **`stopPrice: 0` skips the side check entirely.** The guard is `if sp is not None and sp > 0`
   (`positions.py:347`), so zero never reaches the Long/Short comparison, and the only floor is
   `stopPrice >= 0` (`:340-341`). Worse, the client then reads that zero as **no stop at all** —
   `calculations.js:103-108`'s `realStop` returns `null` for `s <= 0`. So `{"stopPrice": 0}` is an
   **undocumented stop-removal path** that no validation names and no UI offers.
2. **A patch containing `entryPrice` but neither `stopPrice` nor `side` never runs the check.**
   The outer `if "stopPrice" in updates or "side" in updates` (`:344`) means the entry can be moved
   across an existing stop, leaving a Long whose stop is above its entry.
3. **`isinstance(True, int)` is `True` in Python.** `_UPDATABLE_FIELDS["shares"] = (int, float)`
   (`positions.py:291`), so `{"shares": true}` passes the type gate, passes `shares <= 0`, and
   writes `shares = 1`.

⚠️ Asymmetry worth knowing: the CREATE path has no `> 0` escape (`positions.py:199-210`), so a
Short created with `stopPrice: 0` is **rejected** while the same value via PUT is **accepted**.

⛔ **Separately, and the reason the hub's contract test is strict:** `_UPDATABLE_FIELDS` accepts
**ten** keys including **`symbol`** (`positions.py:286-297`). A stray key on this PUT does not
merely overwrite a stop — it can **retag the position to a different ticker**, or rewrite the
member's `shares`/`entryPrice` basis. The existing `EditPositionModal` never sends `stopPrice`
alone (`EditPositionModal.jsx:77,81-87` always appends `raiseToBreakeven` and `breakevenStop`), so
the hub's "exactly one PUT carrying only `stopPrice`" is a NEW contract the hub introduces, not one
the page already honours.

---

## R-04 — Seven standing suite failures, for their owners

**Status:** filed, not acted on. **Measured on `origin/master` @ `75ca5c2ed`**, 2026-09-09 — a
detached worktree at that SHA, `node_modules` junctioned, full `npx vitest run`. The joystick
branch gates its Phase 3 waves on "no new failures relative to this baseline", so these are
recorded rather than fixed by us. Full table + method: `60-phase3-plan.md`.

⛔ **Not on this list, deliberately:** `chart/engine/__tests__/enumerationSites.test.js` failed
the full run on a **15 s timeout** and passes in isolation in **1461 ms**. Load-sensitive, not
broken. If you see it red, re-run it alone before filing anything.

⛔ **Also not on this list:** four rows the baseline turned up were HUB-owned and are fixed on
`feat/joystick-hub` (`--color-text-muted`; a raw 0x01 byte in `hub/useHubCursor.js`; the three
`--hub-*` glass tokens missing from the research modal's theme island) or are Task 0's
(`hub/contracts.js` reading as unreachable). We are not asking anyone else to fix those.

| Test | What it names | Suggested owner |
|---|---|---|
| `hooks/pollingSites.rail.test.js` | `floor2/hooks/useFloor.js` has 5 bare `useSWR(..., {refreshInterval})` sites and `hooks/useWatchlistIntelligence.js` 1, none in the 2026-08-09 census. The rail wants a decision (`useMobileSWR` vs bare) and a row with a reason — **not** a row added to silence it. | floor2 / watchlists |
| `styles/tapFloor.test.js` | `journal-2-0/…/notebook/CaptureDialog.module.css: .actions` declares a finger target at ≤640px but not at ≤1024px. **The touch tier is ≤1024** — a floor restored only at ≤640 leaves tablet broken. | notebook |
| `pages/ThemeTrackerPage.chartmount.test.jsx` | 2 tests: selecting a holding mounts ChartPane with that symbol/timeframe, and `stored=null` with no `onStore` keeps symbol retargeting enabled. | charts |
| `__tests__/sourcesAreText.test.js` | `pages/optionsFlow/wiring.guard.test.js:339` holds two raw `0x08` bytes. A control byte makes the file **binary to git and ripgrep** — its diff reads "Binary files … differ" and a grep for any symbol in it finds nothing. Write it as an escape; the runtime string is identical. | optionsFlow |
| `screener/reachable.test.js` | 18 modules reachable from no entry point: **13 under `pages/community/`** (`CommunityPage`, `ChatView`, `ThreadView`, `Composer`, `AckGate`, 5 components, 4 lib), `floor2/main.jsx`, `lib/chatStreamManager.js`, `charts/widgets/DockFundamentals.jsx`, `pages/optionsFlow/flowBootstrap.js`. Mount them, delete them, or record the decision with a reason. | community · floor2 · charts · optionsFlow |
| `chart/builder/ImportBox.thinkscript.test.jsx` · `chart/engine/ast/manifestProse.test.js` · `chart/engine/ast/pine.blindCorpus.test.js` | The thinkscript import offer declines while the box is one keystroke behind; a manifest key the product reads does not survive the strip; the accepted floor moved. | **the indicators session** |

### ⚰️ Correction — the community cluster is NOT an unrouted feature

This request first described the thirteen `pages/community/` modules as "a whole feature that
reaches no route". **That was wrong, and the route table says so.** Evidence, read rather than
inferred:

- `App.jsx:630-631` routes `/community` and `/community/:threadId`.
- `App.jsx:124` binds them to `./pages/community/CommunityRedesign`.
- `CommunityRedesign.jsx` is a one-line wrapper: `import Floor2 from '../../floor2/Floor2'`.
- `App.jsx:122-123` states the intent outright: *"LOCAL REDESIGN PROTOTYPE — /community points
  at the new Floor design. To revert: swap back to './pages/community/CommunityPage'. Old page
  untouched."*
- `NavBar.jsx:37` carries the nav entry, and it is dark-launch gated on `/api/community/status`.

So the route exists, the nav entry exists, and members reach the **floor2** implementation. The
thirteen modules are the **parked predecessor, deliberately kept as the documented revert path**,
and `floor2/main.jsx` is the standalone prototype entry (`floor2.html`) that `floor2/standalone.css`
exists to serve. That is a decision someone made on purpose, not an accident.

**What is still worth an owner's minute** is narrower: the reachability rail cannot tell a parked
revert path from an orphan, so it will report these every run forever. Its own message offers the
remedy — record the decision in `AWAITING_A_DECISION` with the reason. Doing that turns six
recurring rows into a documented choice and stops them masking a real orphan that lands later.
Not ours to write; the reason belongs to whoever owns the swap-back plan.

---

## R-03 — ✅ RESOLVED: the orb is gated, the hub owns the corner

**Status:** RESOLVED (Phase 2 gate, approved as spec v1.5 exception (h)) · **Applied at:** `app/src/App.jsx:207` (`const hubActive = useHubActive()`) guarding `<GlobalVoiceGate/>`; the shared predicate lives in `app/src/hub/useHubActive.js` so `App.jsx`, `Layout.jsx` and `HubRoot.jsx` cannot drift. Committed separately for a clean rebase against the indicators branch.

**Original report follows.**

`<GlobalVoiceGate/>` — which lazily mounts `GlobalVoiceLayer` → `FloatingOrb` — sits at
`app/src/App.jsx:630`, **outside** the `<Route element={<Layout/>}>` block that begins at
`App.jsx:498`. It is a sibling of the entire routed Layout tree, never a descendant.

**`Layout.jsx` therefore cannot gate it, and the spec assumed it could.** The feedback FAB *is*
gated (`Layout.jsx:159`, `{!hubActive && <FeedbackWidget />}`) because it lives inside Layout. The
orb does not, so on a touch viewport with the hub enabled **both the hub and the orb render in the
bottom-right** — the exact collision Wave 0 measured: the hub's box overlaps the orb cluster's
AgentPicker and VisionAttach satellites by 36–42px horizontally and 42px vertically.

Requested diff — one line, in a file outside exceptions (a)–(g):

```diff
--- a/app/src/App.jsx
+++ b/app/src/App.jsx
@@ -630 +630 @@
-        <GlobalVoiceGate />
+        {!hubActive && <GlobalVoiceGate />}
```

with `hubActive` read from `useHubActive()` (`app/src/hub/HubRoot.jsx`) — the same single authority
`Layout.jsx` already uses, so the two gates cannot drift.

⚠️ `App.jsx` is the app's root and is touched by several concurrent workstreams, which is why this
is filed rather than applied. **Until it is applied, the hub does NOT own the corner**, and any
device testing of the resting-state screenshot will show two floating controls, not one.

---

## R-04 — ✅ RESOLVED: both modules declared in AWAITING_A_DECISION

**Status:** RESOLVED (Phase 2 gate, approved as spec v1.5 exception (i)). Both entries added in the rail's own comment format, each naming its Phase 3 mount point as the removal condition. The rail is back to the exact 18-module `origin/master` baseline.

**Original report follows.**

`app/src/components/screener/reachable.test.js` now names `hub/useHubCursor.js` and
`hub/useHubMode.js` as unreachable. Both are deliberately unwired until Phase 3 (each carries a
"NOT MOUNTED YET" banner naming its Phase 3 wiring), and both are reached today only by their own
tests. At the Phase 1 gate the rail matched the `origin/master` baseline exactly; Phase 2 made
`HubContext.jsx` genuinely reachable, which shrank the unreachable island down to these two.

The rail's own failure message asks for exactly this: *"record the decision in
AWAITING_A_DECISION above with a reason; do not leave them looking shipped."* Doing so means editing
`reachable.test.js`, which is **outside exceptions (a)–(g)**, so it is filed rather than applied.

Requested: add both paths to that file's `AWAITING_A_DECISION` map with the reason
"joystick hub Phase 1 — wired to pages in Phase 3 (`useHubMode` per-page registration,
`useHubCursor` section list binding); delete if Phase 3 is cancelled."

---

## R-01 — Options Flow: `of-tip` className hook no longer exists (Ravi)

**Status:** open · **Owner:** Options Flow collaborator · **Blocking the hub:** no

`CLAUDE.md` documents a rebase-safe className hook on `OptionsFlow.jsx`:

> `of-tip` (theme-help ⓘ, tap-toggled via a `data-pin` flag so the touch mouseenter→click ordering
> doesn't cancel it)

Measured on `origin/master@42daef020`:

- `className="of-tip"` does **not** appear anywhere in `app/src/pages/OptionsFlow.jsx`.
- `data-pin` appears nowhere in the source tree — only inside a comment in
  `components/research-kit/InfoTip.jsx:17-18`.
- The actual theme-help ⓘ wrapper (`OptionsFlow.jsx:7426-7430`) is hover-only: `onMouseEnter` /
  `onMouseLeave`, no `onClick`, no `className`.
- Consequently the `.of-mroot .of-tip` rule in `OptionsFlow.mobile.css:172-175` is a live no-op, and
  **the tooltip has no tap-toggle on touch** — on a phone there is no way to open it.

**The ask:** either restore the `of-tip` hook and the `data-pin` tap-toggle, or confirm the tooltip is
intentionally hover-only now so the dead CSS rule and the `CLAUDE.md` line can be removed.

**Proceeding on the assumption of approval** for the documentation correction only. No Options Flow
source is touched by this build; Flow mode is navigate-only with the fan `[Voice, Home]`.

---

## R-02 — Voice orb mount condition on touch viewports (no outside owner — informational)

**Status:** resolved, no request needed

The gate decision asked for a request to be filed if the orb cluster is owned by someone other than
Patrick. It is not: `app/src/components/voice/` is in-house. Only Options Flow
(`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`) is collaborator-owned.

Recorded so the assumption is not silently inherited: the hub changes **where the orb mounts on touch**
(a media query) and nothing about how it works. `FloatingOrb.jsx`'s internals and its desktop rendering
are untouched, and the hub's "Voice" action calls the orb's own handler,
`useRealtimeSession().connect(context)`.
