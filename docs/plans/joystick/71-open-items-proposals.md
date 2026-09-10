# Three open items, proposed — R-auto

The standing order's idle-capacity clause names four items inside hub ownership. One shipped
(`writePathsTransitive.test.js`). These are the other three: two the order asks for **as a doc**,
and one that is code and is scoped here before it is written.

---

## 1. Preference-key validation — proposal only

### The finding, stated plainly

`POST /api/auth/preferences` takes `{key: str, value: str}` and writes it. **It validates neither.**
Any authenticated member can create any preference key with any string value, and
`set_user_preference` writes one TEXT column.

⛔ **This is why B6 is an exposure DEFAULT and not a security boundary, and that distinction is
already load-bearing in this program.** The hub's admin-only gate resolves an unset
`joystick_hub.enabled` to `isAdmin` — but a non-admin can simply POST `joystick_hub` with
`{"enabled": true}` and turn the hub on for themselves. That is *fine*: the hub is a preview, not a
privilege, and the owner ruled the card admin-only as a default rather than a gate. **It stops
being fine the moment any preference key gates something that matters.**

### What is NOT proposed

⛔ **Do not add an allowlist of known keys.** Three reasons, in order of how much they cost:

1. The app writes preference keys from many places (`chart_settings`, `charts_workspace_layout`,
   `calendar_view_v3`, `calendar_event_types_v2`, `multichart_state`, `joystick_hub`,
   `uct.j2.analytics.section.*`, …). An allowlist becomes a second authority over "what settings
   exist", maintained by hand, in a file none of those features import. That is the
   hand-typed-list defect this repo has paid for four times.
2. It would break the moment a feature ships a new key — a failure whose symptom is "my layout
   stopped saving", reported by a member, days later.
3. It buys nothing against the actual risk, because the risk is not *unknown keys*. It is *known
   keys carrying values nobody checked*.

### What IS proposed

**A) A size and shape ceiling, not a key list.** Reject a `value` over some generous bound (say
256 KB) and a `key` that is not `[A-Za-z0-9_.:-]{1,128}`. This is the only part with a real abuse
story: today one member can write unbounded text into `auth.db`, repeatedly, and nothing stops
them. ⚠️ Note the existing precedent for the failure mode — `project_notebook_migration_wave0`
records that a single ~210 KB note silently destroyed an import batch while reporting `ok`.

**B) Per-key validation where a key GATES something, declared by the feature that owns it.** Not a
central registry: a small optional validator a router can register for its own key, so the check
lives beside the code that depends on it. Today exactly one hub key would use it (`joystick_hub`,
to reject a non-object or an unknown field), and it would document rather than change behaviour —
the hub's gate is a default by design.

**C) ⛔ Say out loud, in the endpoint's own docstring, that this endpoint is not an authorisation
boundary.** The most valuable half of this item is not code. Someone will eventually gate a real
capability on a preference, and the thing that stops them is a sentence at the write site saying
members control this value.

### Why it is a proposal and not a commit
`api/**` is outside this program's scope — **zero `api/` files have been touched by the joystick
hub, ever**, and that is one of the standing deploy conditions. This is handed over, not taken.

---

## 2. CI device job — design, not implementation

### The problem it solves
Real-glass evidence is the ONE thing this program cannot produce for itself. Every device claim
here is gathered by a human on BrowserStack Live and recorded by hand in
`docs/plans/joystick/*-device.md`. That means device coverage is a person's attention, and it has
already failed twice in recorded ways: a template came back blank four times and was nearly read as
a pass, and a Phase 2 run died mid-session leaving the PREVIOUS run's JSON on disk looking current.

### The shape

**Trigger:** manual dispatch plus a nightly schedule. ⛔ **Never on every push.** BrowserStack
Automate is a metered quota (and is a different product from the Live seat this program uses — a
distinction already recorded as a trap), and a per-push device job would exhaust it inside a week
and then be disabled, which is worse than not having it.

**What it drives:** the deployed origin, never a local sandbox. A local shake-out is explicitly not
certification evidence and must not be able to overwrite any.

**The device set:** the same three the program already measures — a Pixel 8, a Galaxy S24 and an
iPhone 15 Pro. Each is there for a reason worth keeping: the S24 is an Exynos/Xclipse part under
ANGLE-on-Vulkan whose IDLE baseline is 30.1 fps against the Pixel's 60.3, which is why the fps gate
is **a ratio against that device's own idle baseline, never an absolute number**.

**The four rails it must carry**, each of which exists because the manual process failed without it:
- a per-run NONCE minted before anything binds, served by the target and re-checked through the
  tunnel, because a port assignment is not a server identity;
- a results file CLAIMED (truncated and timestamped) BEFORE the session opens, so a run that dies
  leaves an explicit INCOMPLETE rather than a stale pass;
- seven distinct outcomes, so infrastructure failure never collapses into "the browser cannot do
  it";
- the snapshot-compare result reported as the FIRST line, before any health check.

**What it must NOT do:** install a BrowserStack SDK or MCP. That would be a new repo dependency;
the binary is an operator tool on the owner's machine and appears in no manifest.

### Honest cost
This is the largest single item left in the program and it is mostly not hub code — it is CI
plumbing plus a paid quota decision. It is written down here so the decision is the owner's with
the constraints visible, rather than being discovered halfway through building it.

---

## 3. iOS visual escalation — scoped, not yet written

### The finding
`haptics.warn()` returns **false** where `navigator.vibrate` does not exist, which is iOS Safari
and every desktop. So §C2's escalation cue — the differentiated buzz that says *this action leads
somewhere you must commit* — is **silently absent on iPhone**, for the destructive actions it was
added for.

### The proposed shape
A **JS-timed static class**, not a CSS animation. ⛔ This matters more than it looks: `tokens.css`
zeroes `animation-duration` and `transition-duration` app-wide with `!important` under
`prefers-reduced-motion`, so an animated flash would be removed for exactly the members most likely
to need a non-haptic cue. A class held for ~220 ms by a timer, changing a static colour, survives
that reset because it is neither a transition nor an animation.

⭐ **And it must be ONE authority.** The escalate branch already exists TWICE — once in
`useJoystick.js` for the gesture door (`if (target?.action?.escalate) haptics.warn()`) and once in
`HubActionsButton.jsx` for the sheet door (`if (action?.escalate) haptics.warn()`) — kept honest
only by `actionsSheetHaptic.test.jsx` deriving the expected cue from the registry. A third copy is
the guard-repeated defect. The right move is a shared `escalateCue(action)` that both doors call,
firing the haptic and falling back to the visual when it reports false.

⚰️ **Cited by CONSTRUCT, not by line, and here is why:** `HubActionsButton.jsx`'s own comment
points at "`useJoystick.js:197-198`" for that branch. Measured today, it is at **line 219** — the
comment drifted 22 lines while remaining perfectly plausible. That is the stale-line-number defect
this repo records against the single-writer index and the setup catalog, caught here only because
the claim was re-measured before being repeated. Whoever builds this should fix that citation in
passing.

### Why it is not in tonight's ship
It touches `useJoystick.js` — the most delicate file in the hub, and one that already took a
change tonight (the two-finger Peek). Batching a second gesture-engine change into the same
unshipped set trades a real accessibility improvement against the ability to say which change
caused a regression. It goes in its own increment, with its own gate.
