# Joystick Hub — requests to outside owners

Filed rather than acted on. Nobody on this build edits the files below.

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

⚠️ The community cluster is the one worth a second look: thirteen modules including a whole page
is not a stray orphan, it is a feature that reaches no route. `lesson_built_tested_green_and_unreachable`
is exactly this shape, and their own test files will stay green forever.

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
