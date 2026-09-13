# Phase 2 — gate record and retro

Spec of record: `00-master-spec-v1.5.md`. Device results: `40-phase2-device.md` (not yet run).

---

## The wave failure — and the rule that now prevents it

**Phase 2 shipped a hub that did not work, with every test suite green.**

The gesture engine, the six presentational components and the integrator were built as three
parallel workstreams. Nobody owned the interface between them, so each side invented one. Every
prop across that seam was wrong:

| Passed | Expected | Result |
|---|---|---|
| `HubFan layout=` | `actions=` | rendered a wedge and **zero bubbles** |
| `HubKnob target=` | `targetColor=` + `offset=` | **never moved, never recoloured** |
| `HubChip mode=` / `hidden=` | `label=` / `tapHint=` / `open=` | **rendered blank** |
| `HubScrim onDismiss=` | `onPointerDown=` | **could not be tapped away** |

Every unit suite on both sides passed throughout, because each half tested its own contract and
nothing tested the join. **Component tests are structurally blind to a severed wire** — the same
defect class this repo already records (`Screener.scanmount.test.jsx` exists for exactly this).
It was found only by reading a DOM dump in the gate evidence and noticing `aria-label="null mode"`.

### The standing rule (spec §D0)

> **Before any wave with more than one agent, the Director writes `hub/contracts.js` first:** JSDoc
> typedefs for every shared prop interface, hook return shape and event payload, plus
> `hubContracts.test.jsx`, which renders each component with the documented props and asserts the
> documented behaviour. Agents build against it and **may not change it** — changes go through
> `requests.md`. Director-owned, like `registry.js`.

Scaffolded from the Phase 2 components and committed with this phase. It earned its keep
immediately: on its first run it caught **`HubFan` marking disabled actions with a CSS class only,
no `aria-disabled`** — dimming visible to sighted users and invisible to every screen reader.

---

## Gate decisions applied

| Item | Resolution |
|---|---|
| **R-03** orb gate | Applied as exception **(h)**. `useHubActive` extracted to its own module so `App.jsx`, `Layout.jsx` and `HubRoot.jsx` share one predicate. Committed separately for a clean rebase against the indicators branch. |
| **R-04** reachability | Applied as exception **(i)**. Both hooks declared in `AWAITING_A_DECISION` with their Phase 3 mount points as the removal condition. Rail is back to the exact 18-module `origin/master` baseline. |
| **A3** `pressing` | Exposed from `useJoystick` state (pointer down, before `openAtPx`) and wired to `HubKnob`. It is the only feedback a slow, careful press gets — which is exactly what a tremor user produces. |
| **A3** `padRef` | `HubPad` now forwards its ref; the ref is on the element the finger touches, not a wrapper standing in for it. Every resolved angle depends on that centre. |
| **A3** Feedback → `/support` | Kept. Device suite verifies it on both platforms. |
| **A4** z-order | `--z-hub-rest` (360) / `--z-hub-open` (401) with an ordering rail. `hub-open` sits above `--z-drawer` (400) because no integer exists between 399 and 400; safe only because the hub hides while a Sheet is open — **that dependency is now a code-level assertion in the same file as the numbers**, not a comment. |
| **A4** tapFloor | Pre-existing. `CaptureDialog.module.css` is byte-identical to `42daef020` once line endings are normalised. (The raw `diff` said "differ" — a CRLF artifact. Checked twice.) |
| **A4** `bs-local.com` | Kept, with the one-line reason: on iOS, `localhost` resolves to the device itself, not through the tunnel. |

---

## Other defects found and fixed this phase

- **A dead zone at 135°** in every 2-action fan — a flat ±30° selection window left the middle of
  the fan selecting nothing, in exactly the shape Flow's `[Voice, Home]` uses. Window is now
  `max(30°, half-spacing)`. Caught by the geometry rail written *before* the agents were dispatched.
- **Four dead constants.** `HAPTIC_*_MS` were unusable: `haptics.js` exposes `tap()/impact()/
  success()/warn()` with fixed patterns and no parameters. Retired with a tombstone naming the real
  mapping.
- **Feedback was about to vanish on mobile.** `Layout` stops mounting `FeedbackWidget` when the hub
  is active and `onFeedback` was unwired — not a deferred feature, a deleted capability.
- **`setState` synchronously in an effect** in `hubViewport.js`, twice. Converted to
  `useSyncExternalStore`, which is the API for this and which the repo already uses elsewhere. The
  lint rule was pointing at a real race: the value can change between the state initializer running
  and the effect attaching, and that window is exactly when a phone finishes its first layout.

---

## Known-open at the close of Phase 2

- **No device result exists.** `40-phase2-device.md` is a script, not a report. Nothing in this
  phase has been seen on a real phone. jsdom lays nothing out — it never resolves `calc()`, never
  applies `env(safe-area-inset-*)`, and reports zero for every box — so "the pad clears the home
  indicator by 68px" is not a claim any suite here can make.
- **BrowserStack credentials are not set on this machine**, so the automated device pipeline
  (Part B) is blocked at its first step.
- `reachable.test.js` still fails on 18 pre-existing modules (community/, optionsFlow/,
  chatStreamManager). Identical to `origin/master`; this branch adds none.
- `npm run lint` already failed repo-wide on test files before this branch (`'process' is not
  defined` in `reachable.test.js`). Hub sources are lint-clean.
