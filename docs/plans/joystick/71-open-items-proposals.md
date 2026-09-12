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

### ✅ RESOLVED — BUILT 2026-09-11 (`60cbe8919`, L3 of the member-launch charter)

The owner waived `api/` for `api/routers/auth.py` **on proof**, as a maintenance deploy, and
directed the allow-list this section argued against. It was built. **This section's objections were
not waved away, and two of the three were right — so they shaped the build. Read them as the design
rationale, not as a superseded opinion.**

**Objection 1 — "an allowlist becomes a second authority over 'what settings exist', maintained by
hand… the hand-typed-list defect this repo has paid for four times."** Correct, and answered by
construction: `tests/test_preference_key_validation.py` **re-derives the key set from `app/src/**`
on every run** — every literal handed to `setPref`/`setPrefMerged`/`deletePref`, with local and
imported `const` names resolved, plus `WIDGET_GLOBAL_PREF_KEYS` for the one dynamic call site. The
list in `auth.py` is still typed by hand; what changed is that **nothing can drift away from it
silently.**

**Objection 2 — "it would break the moment a feature ships a new key — a failure whose symptom is
'my layout stopped saving', reported by a member, days later."** This is the defect the rail is
built to catch, and it was mutation-proved by exactly that scenario: deleting `charts_layout_dock`
from the allow-list turns the rail RED **naming the key**, before the push, instead of a member
reporting it later.

**Objection 3 — "it buys nothing against the actual risk… the risk is *known keys carrying values
nobody checked*."** Right, and the build agrees with it: **every key except `joystick_hub` is
`_PREF_OPAQUE` — any string, exactly the behaviour it has always had.** Re-describing forty blob
shapes here would be the second authority this section warns about. Only `joystick_hub` — the key
this program owns — got a real schema. The allow-list's own contribution is narrower than this
section feared and narrower than the task implied: **it bounds the key space**, which is proposal
(A)'s own abuse story ("today one member can write unbounded text into `auth.db`, repeatedly").

**⛔ WHAT WAS NOT BUILT, AND WHY — proposal (A)'s SIZE ceiling is still open.** A key allow-list
bounds *how many* keys a member can mint; it does nothing about *how large* a value on an
allow-listed key may be. That half was deliberately left: picking "say 256 KB" requires knowing how
big a real `charts_workspace_layout` or `chart_settings` blob gets, there is **no code-derived
authority for that number**, and production data is not an admissible source here. A guessed bound
whose failure mode is "my layout stopped saving" is precisely the defect objection 2 names — so
guessing it would have undone the reason the rail exists. **It needs one measurement (the largest
blob the app itself can produce, from the app's own defaults) and then it is a two-line change.**

**⛔ A CORRECTION TO THIS SECTION.** The key list above cites `uct.j2.analytics.section.*` as a
preference key. **It is not one — it is `localStorage`** (`journal-2-0/components/CollapsibleSection.jsx:13`,
`KEY_PREFIX = 'uct.j2.analytics.section.'`, read and written through `window.localStorage`; and
`localStorageMigrate.js` never touches this endpoint). That matters more than a footnote: had it
been a real server key, it is a **dotted wildcard family**, and no allow-list of fixed names could
have admitted it without a pattern rule. It was checked before the list was written, not after.

**⭐ AND THE FINDING THIS SECTION COULD NOT HAVE HAD.** Proposal (B) suggests validating
`joystick_hub` by rejecting "a non-object or **an unknown field**". Rejecting unknown fields would
have shipped a defect: `coachMarkSeen` is **not** in `HUB_SETTINGS_DEFAULTS` — `HubRoot.jsx:356`
writes it and `:479` reads it — so a schema built from the defaults alone 400s the coach-mark
dismissal and leaves that card on screen forever. Worse in general: `withDefaults` spreads a
member's whole stored blob into every later write, so **one stale field from an older build would
become a permanent 400 on all of that member's hub settings.** Unknown fields are therefore
accepted on purpose; known ones are checked. Mutation-proved both ways.

**Proposal (C) — the docstring — SHIPPED**, and it is the part this section was right to call the
most valuable half. The endpoint now says in its own comment: "⚠️ IT IS STILL AN EXPOSURE DEFAULT,
NOT A SECURITY BOUNDARY, and nothing here changes that. `joystick_hub.enabled: true` is a VALID
value — a member who posts it still turns the hub on for themselves."

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

---

## 4. THE QUEUE — ranked, and NOT started. Owner ruling, 2026-09-12.

> **None of these begins until the six LAUNCHED boxes in `closure.md` close.** They are listed in
> the order they should be picked up, with what each actually costs, so the ranking is a decision
> already made rather than one re-argued on the day.

⭐ **Why a ranking and not a backlog:** every row below is small enough to look like "while I'm in
there" work, and three of the four touch `useJoystick.js`, the most safety-critical file in the
feature. A list without an order invites batching, and batching is what makes a regression
un-attributable — the reason §3 gave for not shipping the iOS cue on the night the Peek came out.

| Rank | Item | Where it is written up | The honest cost |
|---|---|---|---|
| **1** | **`escalateCue(action)` — one authority, plus the JS-timed visual for the missing-vibrate case** | §3 above | The escalate branch exists TWICE today (`useJoystick.js` for the gesture door, `HubActionsButton.jsx` for the sheet door). This is the only row that FIXES something members can feel the absence of: `haptics.warn()` returns false wherever `navigator.vibrate` is missing, which is **every iPhone**, so the commit cue for destructive actions is silently absent on iOS. ⛔ Must be a JS-timed static class, never a CSS animation: `tokens.css` zeroes `animation-duration` and `transition-duration` app-wide under `prefers-reduced-motion`, which would delete the cue for exactly the members most likely to need a non-haptic one. |
| **2** | **A haptic on `HubActionsButton`'s WCAG 2.5.1 path** | this file | Pre-existing, and it rides rank 1 for free: once both doors call one `escalateCue`, the sheet door's missing cue is a call site, not a second implementation. Doing it FIRST would mean writing the third copy of a branch that already exists twice. |
| **3** | **`scan.flag` commits with no sheet — an undocumented §C2 exception** | this file | ⭐ **Decide before building.** It is either a documentation fix (flag is reversible, one tap, and a sheet would be friction on the most-used action) or a product change (§C2 says a commit gets a sheet). The wrong half of this is cheap to build and expensive to ship — it would put a confirmation in front of a gesture members use constantly. Bring the ruling, not a patch. |
| **4** | **The CI device job** | §2 above | The largest single item in the programme and **mostly not hub code**: CI plumbing plus a paid BrowserStack **Automate** decision (a Live seat does not fund it, and the account's Automate allowance was exhausted at the Phase-2 run). ⛔ Nightly + manual dispatch, never per-push — a per-push device job exhausts the quota inside a week and then gets disabled, which is worse than not having one. |

### Not in this queue, and not this programme's

**D-30 — one `data_root()` helper.** Stays **CLOSED-BLOCKED** as a separate production task: 72
environment variables name paths inside the shared data root and each resolves independently of
`DATA_DIR`, across ~68 call sites under `api/**`. ⛔ It is a **production** risk rather than a
testing inconvenience, and it must not ride along with hub work — recorded here only so it is not
lost when this programme closes.

### The two rows that are already done, so nobody re-opens them

- **P6 — preference-key validation.** §1's own RESOLVED note: built `60cbe8919`, shipped as Deploy
  B (`b9d66e0c3`), and **live** — `b9d66e0c3` is an ancestor of the deployed `web` SHA.
- **The transitive write-path rail.** Shipped as `writePathsTransitive.test.js`; it was the fourth
  item of the standing order's idle-capacity clause and is the reason this file names three.

### Housekeeping, noted and deliberately NOT done today

**`.gitattributes` has no `*.js` rule**, so `core.autocrlf=true` on this box governs JS line
endings: LF in the object store, CRLF in the working tree. That is working correctly — it is why
`tools/hub_surface_matrix.mjs` writes LF while the checked-out docs are CRLF, and why
`surfaceMatrixIsCurrent.test.js` normalises both sides before comparing.

⛔ **Do not "fix" this by adding a rule now.** Owner ruling, 2026-09-12. Adding `*.js text eol=lf`
renormalises every JS file in the repo on the next checkout — a diff across the whole frontend,
landing on top of other people's branches, in exchange for nothing a normaliser in one test does
not already handle. If it is ever done it wants its own commit, on a quiet tree, with nothing else
in it.
