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
- **Home mode is the only mode with a real fan** in the preview:
  - outer ring — Screener · Charts · Flow · Catalysts · Breadth
  - inner ring — Journal · Notebook · Calendar · Wire
  - ⚠️ Reconcile against `registry.js` before building: today's Home fan is
    `scan · chart · breadth · wire · flow` (outer) and `journal · notebook · calendar · voice`
    (inner). Catalysts is not in it and Voice is. **Do not hand-edit one and not the other** —
    the registry is the authority and this list must be made to match it, or the ruling
    restated. Flag the difference at the gate rather than silently picking one.
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
- **"Hide joystick"** in the Actions sheet is the member opt-out. Toast: **"Hidden. Re-enable
  in Settings soon"** — Phase 4 adds the real toggle.
- ⚠️ **Until Phase 4, a hidden hub is re-enabled two ways, and BOTH must be documented for
  support:** (1) an admin flips that member's stored `joystick_hub.enabled` preference, or
  (2) the member clears the stored preference themselves, which returns them to the default.
  A member who hides it and is told only "soon" with no path is a support ticket the team
  cannot close.

**Kill switch (both steps)**

- Env flag **`HUB_PREVIEW_ENABLED`**, read **at request time, not at boot**, surfaced through
  the config endpoint the client already polls. False ⇒ the hub does not mount for **anyone**,
  regardless of role or stored preference.
- ⛔ **Test both directions.** A kill switch nobody has watched turn something OFF is not a
  kill switch (`lesson_gate_that_cannot_fail`). Rails: on→mounts, off→absent, and off beats a
  stored `enabled: true`.
- Read at request time so rollback needs no redeploy — see §4.

## 3. Prerequisites before the release commit

- Run 2 **accepted**; sticky fan fixed per the diagnostics ruling; **S24 FPS ≥45**, either
  fixed or explicitly waived by the owner **with the number recorded** in
  `40-phase2-device.md`.
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
