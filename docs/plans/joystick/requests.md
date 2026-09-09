# Joystick Hub — requests to outside owners

Filed rather than acted on. Nobody on this build edits the files below.

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
