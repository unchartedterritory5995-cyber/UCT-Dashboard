# Stage 2 — post-merge verification

> **Run this unattended, in order, immediately after Patrick merges
> `launch/stage-2-member-preview`.** Every step says what counts as evidence and what counts as a
> stop. ⛔ A step that cannot be performed is recorded as **INCONCLUSIVE with its reason** — never
> as a pass. "Absence recorded as a pass" is the failure this programme has refused five times.

⛔ **H15 applies throughout: if the post-deploy smoke FAILS, roll back FIRST and diagnose second.**
`HUB_PREVIEW_ENABLED=false` removes the hub per request with no redeploy
(`rollback-runbook.md` §1). INCONCLUSIVE is not FAILED and must not trigger a rollback.

---

## 0 · Reset the smoke account to a control

```sh
python tools/smoke_reset.py          # --self-check proves the verifier can fail
```

> **Owner ruling, 2026-09-13: this runs as step 0 AND as the final step.** A smoke account
> that accumulates state stops being a control — the next run cannot tell a product change
> from its own leftovers.

Control state: `joystick_hub` **unset** · `coachMarkSeen` unset · `handedness` right ·
`traceGestures` false · no notes, flags or positions. The last three follow from the first.

⚰️ **Why, in one sentence:** the §3.2 dry run found the account carrying a stored
`enabled:true` from an earlier run, so the hub's visibility had **two** available
explanations — *admin* and *stored true* — and the device could not tell them apart.

⭐ **With the reset applied, the account exercises the UNSET-DEFAULT path — the path the
stage ladder actually decides.** At stage 1 that means **the hub is visible ONLY because the
account is admin.** Write it that way; never let the two explanations merge again.

⛔ "Unset" is written as `{}`: there is no product path to delete a preference key
(`delete_user_preference` is imported at `api/routers/auth.py:75` and bound to no route).
`{}` is equivalent for the resolver — `stored.enabled` is `undefined`, so `everChose` is
false and `unsetDefault()` decides. Detail: `HARNESS-NOTES.md`.

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

⭐ **Step 0 removes the SECOND confound, not this one.** With `joystick_hub` unset the account
no longer carries a stored `enabled:true`, so "the hub is visible" has exactly one remaining
explanation instead of two: **it is admin.** That is a real gain — it is what makes the
sentence below honest — but it does not turn an admin into a member.

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

## 5A · The Home fan's ring swap, checked on glass after it lands

> **Owner ruling R3, 2026-09-14: this is a real step.** It was drafted a day earlier because steps
> 0–9 contain **no check of the fan's geometry at all**, and stage 2 moves two bubbles between
> rings. Numbered 5A deliberately: steps 0–9 are **not renumbered**.

⛔ **Scored by hand, not by a tool.** `hub_owner_intake.py` reads `owner-run.md` and produces box 1
and box 2 verdicts only; **no tool reads this document**. 5A's results are written into a record
under `docs/plans/joystick/smoke-runs/` and then into `closure.md` box 5's evidence slot, by the
operator who ran it.

### Why 5a–5e do not cover this

They check the chip hint, the coach mark, the session hide, the Settings toggle and the edge tab.
None looks at the fan. Yet stage 2 empties `PREVIEW_MODES`, and for `home` that is **not** a no-op:

| | stage 1 (projected) | stage 2 (projected) |
|---|---|---|
| ring 0 — OUTER | scan · chart · flow · breadth · **journal** | scan · chart · **breadth** · **wire** · flow |
| ring 1 — inner | notebook · **wire** · calendar · voice | **journal** · notebook · calendar · voice |

**Nine bubbles either way. None added, none removed. Calendar survives.** `home.wire` and
`home.journal` trade rings.

⛔ **And the neighbour the colour evidence actually worries about does not exist until this ships.**
Ledger **D-27** names Wire's worst dE00 neighbour as **Breadth** (`#5dcaa5`), *"which shares ring 0
with Wire"* — true of the **declared** fan, i.e. **stage 2**. At stage 1 Wire sits in the **inner**
ring and never shares a ring with Breadth at all. The measurement and the human eye have been
pointed at two different arrangements. That is why 5A-2 below is a **new row** and not folded into
G3-16 (owner ruling R2).

### The rows

| # | check | expected |
|---|---|---|
| 5A-1 | Open Home's fan. Count the bubbles and read the rings. | **Nine** bubbles. Outer: Scan · Chart · Breadth · **Wire** · Flow. Inner: **Journal** · Notebook · Calendar · Voice. **Calendar present.** |
| 5A-2 | **NEW.** Cover the labels. Can you tell **Wire** from **Breadth**, now that they share the outer ring? | ☐ DISTINGUISHABLE ☐ CONFUSABLE |
| 5A-3 | Cover the labels. Can you still tell **Wire** from **Journal**, now that they have traded rings? | ☐ DISTINGUISHABLE ☐ CONFUSABLE |

### The probe, and its control

```
1. Sign in with tools/smoke_login_link.py. Dashboard. Open Home's fan.
2. FRAME A — screenshot the fan with the labels legible.        <- the CONTROL
3. FRAME B — screenshot it again with the labels covered
             (thumb, tape, or a redaction pass over the text).
4. Answering from FRAME B ALONE, record 5A-2 and 5A-3.
5. Re-read FRAME A and confirm which bubble was which.
```

⭐ **Frame A is the control and it is not decoration.** A judgement made from a covered frame is
evidence only if the uncovered frame proves both bubbles were actually rendered, in the positions
claimed. Without it, *"I could tell them apart"* is unfalsifiable — it reads identically if one of
them never drew.

⭐ **And the control is what lets the probe return CONFUSABLE.** If Frame A and your Frame-B answer
**disagree about which bubble is which, that disagreement IS the CONFUSABLE result** — it is the
only way this check can come back negative, and a probe that cannot come back negative is not a
probe. Record the disagreement verbatim, do not resolve it from memory.

⛔ **Assert the user-facing result, never structural state.** The recorded answer is the **human
judgement plus the two frames**. Reading `--hub-mode-wire` back out of the DOM proves nothing: the
tokens are byte-identical at both stages, so a token read would return "unchanged" whatever a
person can or cannot see. Likewise 5A-1 is answered by **looking at the fan**, not by querying
`registry.js` — the registry is what we changed, so asking it whether we changed it is circular.

### ⛔ REAL GLASS ONLY — the mirror transport caveat, inline

A BrowserStack Live mirror has a **measured floor of 260–427 ms per gesture**, against the flick
window declared in **`app/src/hub/constants.js`** (`FLICK_MS` — read it there; it is not restated
here, and a hand-typed constant beside its source is the drift this feature has already paid for).
On a mirror, flick, hold and scrub are **INCONCLUSIVE-TRANSPORT by construction**.

**Opening a fan is untimed, so a mirror *can* do it** — but ⚠️ **a mirror re-encodes the image, so
a colour judgement through a mirror is not a colour judgement of the device.** 5A-2 and 5A-3 are
**real glass only**. A mirror answer is recorded as **INCONCLUSIVE-TRANSPORT**, which is neither a
pass nor a failure and **must never trigger a rollback**.

### If CONFUSABLE

Do not act unilaterally. `glass-acceptance.md`'s decision table (`:285`) already rules what each
combination of G3-16(a) and G3-16(b) means, and its CONFUSABLE branches change a shipped colour
token. **That is an owner decision.** Record the answer, attach both frames, and stop.

---

## 6 · Write the evidence into box 5

⛔ **Box 5's evidence slot is filled from THIS run and only this run.** The stage-1 dry run
(`smoke-runs/2026-09-13T23-19Z-stage2-dryrun.md`) recorded the chip hint as
**"Preview — more coming"**, which is correct at stage 1 and **wrong at stage 2** — stage 2
empties `PREVIEW_MODES`, so each mode shows its real tap hint and the `(preview)` suffix on
the Settings label carries the framing instead. Copying the 5a reading forward would put a
stage-1 string in a stage-2 record. Owner ruling, 2026-09-13.

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

## 8 · Reset the smoke account again — the final step

```sh
python tools/smoke_reset.py
```

⛔ **The run is not finished until this exits 0.** Whatever this run created, this run
removes; the next run must start from a control, not from our leftovers. Record the exit
line in the evidence file.

---

## 9 · The first post-merge commit carries R-29 into the baseline

⛔ **`gate-baseline.json` is NOT amended while the stage-2 PR is frozen.** Owner ruling,
2026-09-13: adding R-29 now would put a 27th file on a frozen PR and invalidate the gate
already run against it.

**After Patrick merges stage 2, the first docs/tool commit adds it**, with this reason
recorded verbatim beside the entry:

> *orphan at `origin/master`; S4-owned; not attributable to any hub branch; passes when S4
> records its AWAITING_A_DECISION entry*

⛔ **And it is REMOVED the moment `reachable.test.js` is green on master again.** A baseline
entry that outlives its defect is a slot a real failure can occupy unnoticed — which is the
whole reason a timeout is never banked as permitted breakage.

The row is `src/components/screener/reachable.test.js > 🔴 every module under app/src is
REACHABLE from an entry point > and nothing committed is connected to nothing`. Direction was
proved twice: `focusDivergence.js` is orphaned at `origin/master` (its only non-test mention
in `HubContext.jsx` sits inside a **comment**, zero real imports), and no hub branch diff has
touched that file, `reachable.test.js`, or `HubContext.jsx`.

---

## Then

`rollout.md` §3 b–f: one week of member feedback (`[joystick preview]` prefix to `/support`) →
**D-39 fixed before stage 3, not before stage 2** → the stage-3 PR (Patrick merges) → box 5 → box 6
→ housekeeping, including `railway variables --service web --unset SMOKE_LOGIN_LINK_ENABLED`.
