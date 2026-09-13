# Phase 2.5 — preview release (navigation-only), inserted before Phase 3

**Status:** PLANNED. Execute only after the run 2 diagnostics are ruled on and the
sticky-fan / S24 FPS decisions are accepted. Phase 3 continues behind this.

⛔ **THERE IS NO FOUNDER TIER AND NO TIER LADDER.** Owner correction, and it is the second
time it has had to be given — one product, one price, and the only roles are **`admin`** and
**`member`**. This plan is written in those two roles throughout. If you find a `tier` field,
gate or comment anywhere in hub code, delete it; the one place the word may appear is
`registry.test.js`'s negative rail, which asserts a `tier` key is REJECTED (`'there are no
tiers'`) — that is the protection, not a survival, and it stays.

---

## 1. What ships

- Everything Phase 2 built: pad, knob, fan, chip, scrim, Actions button, Voice and Feedback
  fold-in, **reach-mode selection** (spec §C1.1), sticky fan, handedness through the existing
  settings blob (no settings UI yet — default right-handed).
- **Home mode is the only mode with a real fan** in the preview (owner ruling, 2026-09-09 —
  the REGISTRY is the authority):
  - **outer ring — Screener · Charts · Flow · Breadth**
  - **inner ring — Journal · Notebook · Calendar · Voice**
  - **Catalysts is NOT in the fan.** Wave 0 found it has no route — it is an in-place
    dashboard tile mode, and it becomes reachable in Phase 3, not here.
  - **Wire is dropped from the preview**, though `/morning-wire` is a perfectly real route
    and Wire sits on Home's outer ring in `registry.js` today. That is a scope choice, not a
    routing problem; removing it from the preview means editing the Home fan, so state it in
    the commit rather than letting a reader assume the registry changed by accident.
  - ⚠️ **Voice is the one entry that is NOT a navigation.** `registry.js`'s `voice()` helper
    builds `{ ring: 1, kind: 'run' }` — it has no `to` and no route; it calls the orb's own
    `useRealtimeSession().connect(context)`. It stays on the inner ring per the ruling, but
    it is the single preview action that does something rather than going somewhere, and
    "navigation-only preview" is therefore *nearly* true rather than exactly true. Worth one
    line in the announcement so nobody is surprised.
  - Every other listed entry IS a real route, verified against the registry:
    Screener `/screener` · Charts `/charts` · Flow `/options-flow` · Breadth `/breadth` ·
    Journal `/journal/trades` · Notebook `/journal/notebook` · Calendar `/calendar`.

- Every other mode's fan is `[Voice, Home]` until Phase 3.
- Tap / double-tap do nothing except on Home (tap → Screener, double-tap → Journal).
  Hold → Home everywhere.
- Chip reads the mode name with **"Preview — more coming"** as the hint.
- ⛔ **No "Phase 3" toasts anywhere.** An unwired action is ABSENT from the fan, not present
  and inert. A control that answers a deliberate gesture with "not yet" teaches the user the
  product is unfinished; one that is not there teaches them nothing false.
- Minimal coach mark on first mount: one glass tooltip, **"Drag for shortcuts · hold to go
  home"**, dismissed permanently through the settings blob.

## 2. Gating and kill switch — the two-step rollout

**Step 1 — ADMIN PREVIEW** (immediately after run 2 closes)

- `hub.enabled` default: **true for `role === 'admin'`, false for `member`**; an explicit
  stored preference always wins. ⭐ **This is exactly what Phase 1 already built** — see
  `useHubSettings.js`'s `resolveEnabled`. No new logic, no new field. The work here is
  deleting tier residue, not adding a gate.
- Ship to master. The two admins run it on production for a few days.
- Feedback via Actions sheet → `/support`, message prefixed **`[joystick preview]`**.

**Step 2 — MEMBER PREVIEW** (owner's call after Step 1, same branch)

- **One change:** `hub.enabled` default becomes **true for every authenticated user**. Stored
  preference still wins; the kill switch still applies.
- **"Hide joystick"** in the Actions sheet is the member opt-out. It is **SESSION-ONLY** and
  writes nothing. Toast: **"Hidden for now. Reload to bring it back."**
- **Settings → Joystick** ("Joystick shortcuts (preview)") is the permanent switch, **pulled
  forward from Phase 4**. It is the only control that writes a persistent hide.
- **A discreet 12×36px glass edge tab** sits at the hub's resting position whenever the hub is
  hidden — either way — and restores it for the session.
- ⚰️ **THIS SHIPPED AS A ONE-WAY DOOR AND HAD TO BE FIXED IN PRODUCTION.** It read: *toast
  "Hidden. Re-enable in Settings soon" — Phase 4 adds the real toggle*, with the two documented
  routes back being **an admin editing the database** or **the member pasting a `fetch()` into
  a devtools console**. Neither is a path a member has. The owner hit it on the live admin
  preview the day it shipped. **A control that can be dismissed and not recovered is a defect
  no matter how good the toast copy is** — and "we documented the workaround for support" is
  not a recovery path, it is a record of one being missing. See `47-hide-recovery.md`.

**Kill switch (both steps)**

- ✅ **BUILT** (ahead of run 3, so run 3 verifies it). Env flag **`HUB_PREVIEW_ENABLED`**,
  read **at request time** in `api/routers/auth.py::_access_payload`. False ⇒ the hub does not
  mount for **anyone**, regardless of role or stored preference.
- ⚠️ **THERE WAS NO "EXISTING CONFIG ENDPOINT".** The plan assumed one; a search found none —
  no `/api/config`, no feature-flag route the client polls. Rather than add an endpoint (this
  release ships zero new hub endpoints), the flag rides `_access_payload`, the block already
  shared by **signup, login and `/api/auth/me`**. So it is present the moment a session
  exists, with no extra round trip, and a user who just signed up never sees the hub for one
  render before a poll corrects them.
- Client half: `AuthContext` stores it and `useHubActive` returns false on it — the ONE
  predicate `App.jsx`, `Layout.jsx` and `HubRoot.jsx` all read, so the switch cannot reach two
  of the three and miss the other.
- ⛔ **`=== false`, never truthiness.** `undefined` means an older backend or a payload that
  did not parse; treating that as a shutdown would hide the feature the first time
  `/api/auth/me` hiccuped. Default is ON — it is a KILL switch, so unset means "not killed".
- ⛔ **Test both directions.** A kill switch nobody has watched turn something OFF is not a
  kill switch (`lesson_gate_that_cannot_fail`). Rails: on→mounts, off→absent, and off beats a
  stored `enabled: true`.
- Read at request time so rollback needs no redeploy — see §4.

## 3. Prerequisites before the release commit

- ✅ Run 2 ruled **VOID** (port collision) — superseded by **run 3**.
- ✅ Sticky fan **CLEARED**: harness defect, not product (10/10 both devices). The old
  element-handle / split-`perform()` path is **deleted**, not left beside the working one.
- ✅ S24 FPS **WAIVED** at 29.9 against a measured 30.1 idle baseline. The gate criterion is
  now relative: **fan-open fps ≥ 0.9 × idle baseline on the same device**, recorded in
  `40-phase2-device.md` and `CLAUDE.md`.
- Rebase `feat/joystick-hub` onto master. If the indicators branch has merged, re-run the
  chart scout and the `/charts` device steps; if not, ship anyway — the preview touches no
  chart internals.
- Full hub suite green; all rails green; `reachable` / tapFloor pre-existing failures
  documented as **unchanged from `origin/master`**, not as passing.
- One final BrowserStack run on the four devices with role gating verified:
  **Step 1** — an admin account sees the hub, a member account does **not**;
  **Step 2** — both see it; kill switch hides it for both in either step.

## 4. Release mechanics

- Squash to one commit on master: **`hub: preview — navigation-only joystick hub (mobile,
  gated)`**. PR with device results and screenshots linked. Owner merges; Railway deploys on
  push to master.
- **Post-deploy verification on production, READ-ONLY.** Load the site on BrowserStack as an
  admin account; confirm mount, fan, navigation, kill switch. **No writes.**
  ⚠️ The snapshot rail does not apply to production — it hashes the local shared root. The
  equivalent check here is that **this release introduces no hub endpoints at all** (it does
  not), so confirm that rather than claiming an integrity check that did not run.
- **Rollback:** set `HUB_PREVIEW_ENABLED=false` in Railway. Because the flag is read per
  request, no redeploy is needed. ⚠️ `railway variables --set` **stages** — confirm the live
  value with `railway variables --service web --kv` afterwards; the read form does not
  redeploy. Document under Deploy in `CLAUDE.md`.

## 5. Feedback loop

- The Actions sheet's Feedback button already reaches `/support`.
- Add mode id and app version to the feedback payload **if the support form accepts extra
  fields**; otherwise prefill the message with `[joystick preview]`. Check before building —
  do not add fields the endpoint drops.
- Owner posts the preview note to members (not a founder channel — there isn't one). Draft:
  `docs/plans/joystick/50-preview-announcement.md`.

## 6. After release

- Phase 2a (planned-trades backend), then Phase 3, continue on `feat/joystick-hub` rebased
  onto the released master.
- Phase 3's first section ships as a **second preview increment** when the Journal
  scrub-to-adjust-stop is done — the single most valuable feature in the plan.
