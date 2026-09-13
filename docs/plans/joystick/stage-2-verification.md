# Stage 2 — post-merge verification

> **Run this unattended, in order, immediately after Patrick merges
> `launch/stage-2-member-preview`.** Every step says what counts as evidence and what counts as a
> stop. ⛔ A step that cannot be performed is recorded as **INCONCLUSIVE with its reason** — never
> as a pass. "Absence recorded as a pass" is the failure this programme has refused five times.

⛔ **H15 applies throughout: if the post-deploy smoke FAILS, roll back FIRST and diagnose second.**
`HUB_PREVIEW_ENABLED=false` removes the hub per request with no redeploy
(`rollback-runbook.md` §1). INCONCLUSIVE is not FAILED and must not trigger a rollback.

---

## 1 · The deploy landed

```sh
railway deployment list --service web --json      # until SUCCESS
curl -s -A "<browser UA>" https://uctintelligence.com/api/health
```

- **PASS:** `web` SUCCESS on a SHA `S`, and `git merge-base --is-ancestor <merge-sha> S` succeeds.
  `/api/health` 200 with a **fresh `uptime_seconds`** (tens of seconds, not thousands).
- ⚠️ **One probe during a swap is not a verdict** — a 502 mid-swap is the old pod going away.
  Re-probe three times before concluding anything.
- ⚠️ `flow-worker` **SKIPPED is expected and correct**: none of its watch paths are touched, so the
  OPRA tape is never bounced. Do not force a redeploy to "make it consistent".
- ⛔ Read `ROLLOUT_STAGE` **from the live SHA**, never from the worktree:
  `git show <live-sha>:app/src/hub/rolloutStage.js | grep ROLLOUT_STAGE` → must be `2`.

## 2 · The exposure rule, at code level

Already proved by the merged gate (`gate-runs/2026-09-13T15-55-29.md`, zero attributable NEW). Re-
assert cheaply on the merged tree:

```sh
cd app && npm run test:hub        # 89 files / 1166 tests; only styles/tapFloor.test.js may fail
```

- **PASS:** only the `tapFloor` baseline entry fails.
- **STOP:** anything else fails → the merge picked up something the branch gate did not see.

## 3 · Live iPhone 15 Pro — the hub reaches a member-shaped account

```sh
python tools/smoke_login_link.py     # 2-minute, single-use, token in the URL FRAGMENT
```

On the Live device: tap the address bar's ⊗ to clear it, type the URL, go.
⛔ **Never `ctrl+a` on the mirror** — it types a literal "a". ⛔ **Never type a password.**

- **PASS:** the hub is visible with **no stored preference** for that account.
- ⛔ **PRESENT IS NOT SHOWING.** `HubRoot` keeps `<div data-testid="hub-root">` in the DOM and sets
  the HTML `hidden` attribute, so a `querySelector` answers "did React render the container", never
  "can a member see it". And `offsetParent === null` is not the signal either — the hub is
  `position: fixed`. Measure the **`hidden` attribute, the computed `display`, and a non-zero box**.

### ⚠️ The member-vs-admin problem, stated before it is hit

The smoke account is **admin** (`ADMIN_EMAILS` promotes it at login, `auth.py:253`), so at stage 1
*and* stage 2 it sees the hub — which means **this step alone cannot distinguish the two stages.**

- **If a synthetic MEMBER can be minted through the same door**, use it: that is the real evidence.
- ⛔ **Signup is closed** (`COMING_SOON_MODE=1` → `auth.py:192` refuses every request), and
  **flipping that flag is refused permanently** — it opens public registration to the internet for
  the length of the window and re-opens Stripe with it. Owner ruling, 2026-09-12.
- **If no member can be minted:** record exactly this, and no more —
  > *"The member default is **verified by test only**: `useHubSettings.test.jsx`
  > (unset-non-admin → enabled at stage 2) and `exposureGate.test.js`'s digest-pinned stage row.
  > The device demonstrates the admin path and the kill switch, not the member default."*
  ⛔ Do **not** write "member preview verified on device" on the strength of an admin session.

## 4 · Kill switch, demonstrated on the device

⭐ **This is the step box 5 actually needs**, and it works identically for an admin account — so it
is the one device demonstration that is *not* weakened by §3's member problem.

> **AUTHORIZED PRODUCTION VARIABLE CHANGE, THIS STEP ONLY.** Set it back to `true` in the same
> sitting. Nothing else in this document changes a production variable.

```sh
railway variables --service web --set "HUB_PREVIEW_ENABLED=false"
# on the device: navigate IN-APP (an authenticated request) — do NOT reload the page
#   -> the hub is gone.  SCREENSHOT.  record the timestamp.
railway variables --service web --set "HUB_PREVIEW_ENABLED=true"
# on the device: navigate in-app again
#   -> the hub returns.   SCREENSHOT.  record the timestamp.
```

- ⛔ **`--kv` shows what the SERVICE is configured with. That is not evidence the running process
  has it.** The device is the evidence; read the flag in-process only as a cross-check.
- ⚠️ `railway variables --set` has been measured **both** ways (staging on `chart-renderer`,
  auto-redeploying on `web`). Watch for a new boot either way; if none appears within ~3 minutes,
  `railway redeploy --service web --yes`.
- ⚠️ An already-open page keeps its hub until its next `/api/auth/me`. That is why the instruction
  is **navigate in-app**, not reload — a reload proves less, not more.
- **Evidence:** two screenshots + two timestamps, filed under `docs/plans/joystick/smoke-runs/`.

## 5 · The preview framing and every way out

On the same device session, for the smoke account:

| # | check | expected |
|---|---|---|
| 5a | chip hint on a preview-less mode | reads the mode's **real** tap hint (`PREVIEW_MODES` is empty at stage 2) |
| 5b | coach mark | appears **once** after clearing `coachMarkSeen` |
| 5c | **Hide** from the Actions sheet → reload | hub returns — the hide is session-only and **writes nothing** |
| 5d | Settings → Charts → JOYSTICK toggle | OFF persists across a reload; ON restores |
| 5e | edge tab | restores a hidden hub |

⛔ **5a is a correction to the original brief.** It said the chip should read *"Preview — more
coming"*. That string is driven by **`PREVIEW_MODES`**, which stage 2 **empties** — so at stage 2
every mode shows its real hint and the string appears nowhere. The `(preview)` suffix on the
**Settings label** is what still carries the preview framing at stage 2 (`JoystickSettingsCard.jsx:139`),
and `joystickSettingsControls.test.jsx` asserts it. Check the label, not the chip.

Clearing the coach mark for 5b — read-modify-write, never a bare POST:

```
GET  /api/auth/preferences            # take joystick_hub
POST /api/auth/preferences            # {key:"joystick_hub", value:"<same JSON, coachMarkSeen:false>"}
```

⛔ **`POST /api/auth/preferences` REPLACES the whole value** (`set_user_preference` writes one TEXT
column). A bare post wipes `handedness` and the rest.

⛔ **Assert by RENDERED TEXT, not by state.** Two toast defects shipped in this feature with every
structural assertion green — one passed `message` where the component reads `msg`, one rendered for
zero frames because its own action unmounted the host.

## 6 · Write the evidence into box 5

`closure.md`, box 5's evidence slot:

> stage 2 shipped on `<merge-sha>`; kill switch demonstrated on device `<date>`
> (screenshots `smoke-runs/<ts>-killswitch-{off,on}.png`); stage 3 `<pending>`.

⛔ Box 5 is **not** tickable on stage 2 alone — it requires stage 3 as well. Fill the stage-2 half
and leave the rest open.

## 7 · Member announcement

Draft from `50-preview-announcement.md` as **ready-to-post text** in a docs commit. ⛔ Do not post
it — `feedback_explicit_ship_gate`: marketing and member-facing copy ship on the owner's explicit
go-ahead, not an agent's.

---

## Then

`rollout.md` §3 b–f: one week of member feedback (`[joystick preview]` prefix to `/support`) →
**D-39 fixed before stage 3, not before stage 2** → the stage-3 PR (Patrick merges) → box 5 → box 6
→ housekeeping, including `railway variables --service web --unset SMOKE_LOGIN_LINK_ENABLED`.
