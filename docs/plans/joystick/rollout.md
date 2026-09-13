# Joystick hub — the staged member rollout

> ## ⛔⛔ READ THIS FIRST — THE SESSION MEMORY ABOUT THIS PROGRAMME IS STALE
>
> The persistent memory index still records this programme as
> **"CLOSED 9/11 — COMPLETE *WITH ONE INCIDENT*, NO MORE DEPLOYS."**
>
> **That was true for about six hours and is now wrong.** On 2026-09-11 the owner issued the
> MEMBER LAUNCH CHARTER and **deploy authorization was RE-OPENED** for the launch sequence
> (Deploy A onward). A session that reads the memory line and refuses to deploy is refusing work
> it is authorized to do.
>
> ⭐ The memory line is being left alone deliberately until LAUNCHED resolves, so this file is
> the correction. It is here because this is the first file that memory's own joystick pointer
> leads to — the stale claim and its correction should not be more than one hop apart.
>
> **What is actually true right now:** the programme is closed to further FEATURE work; the
> launch sequence is authorized; the rollout is at **stage 1**; and LAUNCHED is defined by the six
> boxes in `closure.md`, **one of which is now ticked** (preference-key validation, shipped as
> Deploy B).
>
> **Last verified against Railway: 2026-09-11, 21:0x UTC** — `web` serving **`b63cf9775`**
> (SUCCESS 2026-09-11T20:58:24Z), **`HUB_PREVIEW_ENABLED=true`**, `ROLLOUT_STAGE = 1` in the
> deployed source. ⛔ Re-read all three before quoting them: the deployment moves on every master
> push (including docs-only), and this line is a SNAPSHOT, not an authority. The authorities are
> `railway status --json`, `railway variables --service web --kv`, and
> `app/src/hub/rolloutStage.js` at the live SHA — in that order, one per question.

**One question this file answers: who can see the joystick today, and what has to be true
before more people can.**

The three stages are a single build-time constant, `ROLLOUT_STAGE` in
`app/src/hub/rolloutStage.js`. Advancing it is a deploy — deliberately, so every widening of
the audience arrives with a member-impact paragraph, a smoke run and a rollback beside it,
rather than drifting between what is deployed and what is configured somewhere else.

> 🟢 **Shipped state: STAGE 1.** Stages 2 and 3 are built, railed, and dark.

---

## ⛔⛔ THE STAGE DEFINITIONS — OWNER RULING, 2026-09-13. THIS IS THE PLAN OF RECORD.

> Written down now so it is not rediscovered later. Everything in §3 is **frozen** until Patrick's
> marked-up `owner-run.md` and trace are in and boxes 1 and 2 are ticked on evidence.

### 1. What each stage MEANS

| stage | unset preference resolves to | framing | name |
|---|---|---|---|
| **1** *(current)* | `isAdmin` | preview | **Admin preview** |
| **2** | **`true` for every authenticated user** | preview | **Member preview** |
| **3** | `true` for every authenticated user | **removed** | **General availability** |

**Stage 2 — member preview.** An unset preference resolves to `true` for every authenticated user.
**A stored preference always wins**, in both directions. The kill switch applies. The member keeps
the preview framing and all three ways out:

- the chip hint reads **"Preview — more coming"** (`HubRoot.jsx:581`, per-mode via `PREVIEW_MODES`);
- the coach mark shows on first mount (`HubCoachMark.jsx`);
- **Hide** from the Actions sheet (session-only, writes nothing), the **Settings toggle**
  (persistent) and the **edge tab** (`HubEdgeTab.jsx`) are the opt-out, and the Settings label still
  carries the **"(preview)"** suffix (`JoystickSettingsCard.jsx:139`).

**Stage 3 — general availability.** Identical exposure to stage 2 with the preview framing removed:
the chip hint becomes the mode's real `tapHint`, the `(preview)` suffix leaves the Settings label,
the Discord announcement moves from "preview" to "launched", and the feature is listed in whatever
member-facing changelog exists. **The kill switch stays forever.**

### 2. ⛔⛔ TWO THINGS THIS RULING COLLIDES WITH IN THE CODE. READ BEFORE ESTIMATING STAGE 2.

**(a) The ruled ladder is not the ladder the code implements, and the numbers do not line up.**

`rolloutStage.js` today defines: 1 admin only · 2 *card visible to members, default still **OFF*** ·
3 *unset resolves to ON*. `unsetDefault()` is literally `return stage >= 3`.

| ruled stage | behaviour the code already has | where it lives today |
|---|---|---|
| ruled **1** | code stage 1 | ✅ identical |
| ruled **2** | **code stage 3** | `unsetDefault: stage >= 3` |
| ruled **3** | **nothing** — the code has no presentation-only rung | — |
| *(retired)* | code stage 2, the **opt-in** rung: card visible, default OFF | dropped by this ruling |

⛔ **So "the one-line constant change" in §3a is not one line, and setting `ROLLOUT_STAGE = 2` in
today's source would ship the RETIRED opt-in rung — the hub still OFF for every member — while the
member-impact paragraph said "member preview".** The stage-2 PR must move, together:
`ROLLOUT_STAGE`, `STAGE_NAMES`, `unsetDefault()`, the `STAGE_TABLE` row in `exposureGate.test.js`
**and that row's entry in `ROW_DIGESTS`** — digests exist precisely so a row cannot be edited to
match a product change instead of the other way round — plus `rolloutStages.test.js:63`, which
asserts the stage has not moved and is *meant* to go red when it does.

**(b) "No new behaviour" at stage 3 is not true while two modes are still teasers.**

The preview chip hint is driven by **`PREVIEW_MODES`**, not by `ROLLOUT_STAGE`. Measured on master
2026-09-13, that Set still contains **`home` and `flow`** — 8 of 10 modes have shipped their real
fans. ⛔ `registry.js` states the consequence in its own words: *"a mode removed from this set gets
its FULL fan the same render"*. Emptying it at stage 3 would expose two fans, which **is** new
member-visible behaviour.

⭐ **Recommended resolution, and it needs one word from the owner:** `home` and `flow` ship their
real fans on their own increments *before* stage 3, each with regenerated artifacts in the same
commit. Then emptying `PREVIEW_MODES` at stage 3 really is copy-only and the ruling's "no new
behaviour" holds exactly as written. The alternative is to drop that clause and accept two fans
landing with the GA flip. **Until that is answered, stage 3 cannot be written as a PR.**

### 3. Sequencing — nothing here starts until boxes 1 and 2 are ticked on evidence

**a. Stage 2 PR.** The constant change **plus** everything in §2(a), the `rollout.md` and
code-comment text, and the gate. ⛔ **Patrick merges** — a member-facing rollout is his call, not an
agent's. Kill switch demonstrated on a **Live device** via the smoke account; because that account
is admin, also demonstrate with a synthetic member if one can be minted through the same door — and
if not, the smoke account **plus a code-level test for the member default** is the evidence, stated
as that rather than implied.

**b. One week of member feedback**, via the Actions sheet → `/support` with a **`[joystick preview]`**
prefix, triaged into `71-open-items-proposals.md`. **D-47** (per-mode editor) and **D-38** (Undo
duration) reopen **only** from that feedback.

**c. D-39** — the chip under the Journal FAB, **6 pairs** (`journal` and `notebook` at 360/375/430).
Fix **before stage 3, not before stage 2**. The hub-side "chip yields to page furniture" approach is
already specified in `deferred.md`; the 6 pairs are its acceptance test, measured by
`tools/hub_chip_clearance.py`. ⚠️ The non-blocking ruling was scoped to **stages 1 and 2** — this
step is what honours that scope instead of silently inheriting it at GA.

**d. Stage 3 PR** per §1, once §2(b) is answered. Patrick merges; kill switch demonstrated again;
**box 5 ticked**.

**e. Box 6** — rewrite `closure.md` as LAUNCHED, citing every box's evidence.

**f. Post-close housekeeping.** `railway variables --service web --unset SMOKE_LOGIN_LINK_ENABLED`
(**and record that it was done**); **keep** the smoke account, clean; **keep** the Live-device
policy; hand **D-40 / D-41** to the Notebook workstream, **R-29** to S4, and **D-30** to its own
production task.

---

---

## The gates

| | Stage | Who sees the settings card | What an unset preference means | Gate — what must be true before this deploys | Status |
|---|---|---|---|---|---|
| **1** | admin only | admins, plus any member who has already chosen | OFF for members, ON for admins | Rails green; stage-1-is-a-no-op proof passes | ✅ **LIVE** |
| **2** | opt-in | **every member** | still OFF — a member must switch it on | **Owner reports G0 ≥ 8/10** on an iPhone 15 Pro-class device, **and** the glass-acceptance rows pass on ≥1 notched iOS + ≥1 Android | ⏸️ **held — waiting on data** |
| **3** | default on | every member | **ON**, unless the member explicitly turned it off | Everything in stage 2, **plus** the post-deploy smoke conclusive over every top-level route signed in (including `/dashboard`), **plus** the kill switch verified from a real device | ⏸️ **held — waiting on data** |

⚰️ **THE TABLE ABOVE IS THE OLD LADDER, kept for history.** Its stage 2 ("opt-in") is
RETIRED by the 2026-09-13 ruling, and its stage 3 is that ruling's stage 2. Read the ruling
section above for what the stages mean now; read this table only for what the code says TODAY.

⚰️ ~~**Stages 2 and 3 are DATA gates, not decision gates.** Nothing is waiting on a ruling.~~
— **superseded 2026-09-13.** Stage 2 is still a data gate. **Stage 3 now waits on one decision**
(§2(b) above: whether `home` and `flow` ship their fans first, or the "no new behaviour" clause
is dropped). The
numbers land in `glass-acceptance.md` and the resume file; the stage advances when they do.
There is nothing to ask about.

### 2026-09-12 — stage 2's data was chased on a real device. It did not land, and there are now TWO reasons.

`g0-1-live-device-run-2026-09-12.md` is the run. Stage 2 stays **⏸️ held**, and stage 3 with it.

| stage-2 condition | state after the run |
|---|---|
| *"Owner reports G0 ≥ 8/10 on an iPhone 15 Pro-class device"* | ⬜ **not measured.** `INCONCLUSIVE-TRANSPORT` — a BrowserStack Live mirror cannot deliver a gesture inside the 120 ms window (measured floor 260–427 ms over ten gestures, and the shortest drag it accepts is *slower*). Not a score of 0; **no score at all.** |
| *"the glass-acceptance rows pass on ≥1 notched iOS + ≥1 Android"* | ⛔ **now a SECOND blocker, and it is independent of G0.** `G3-15` was run and **FAILS** on iOS (a constant 40 × 28 px chip/Actions-button overlap on every mode). `G2-3`/`G2-4` are **BLOCKED** — Live's Screen Reader is unsupported on this device. No Android row has been run at all. |

⭐ **The second row is the one to notice.** Before today it was reasonable to read stage 2 as
"held behind one number". It is not: even a clean G0 score would leave a failing iOS glass row in
front of it. G3-15's fix is a geometry change to a shipped control and therefore **the owner's
ruling**, not a data point that arrives on its own — so *this* half of the gate does now want a
decision, which is a change to the paragraph above and is why it is written here rather than
edited into it.


### 2026-09-12, later — the SECOND blocker is GONE. Stage 2 is back to being held behind ONE number.

⭐ **G3-15 is fixed, merged and verified on glass.** PR #109 merged as `9b51eaf1a` and deployed;
`tools/hub_chip_clearance.py` against the deployed build reports **27 of 27 (mode × width) pairs
clear of the Actions button**, and a real iPhone 15 Pro / iOS 17.6 measures the chip **8px** clear
on three modes with **0 of 51** sampled points covered. The instrument was proved able to print
both verdicts before the run (`--self-check` + `--fixture-control`).

So the row that was *"a SECOND blocker, independent of G0"* is now **PASS**. The paragraph above
stands as the record of why it was written; it is no longer the state.

| stage-2 condition | state, 2026-09-12 end of day |
|---|---|
| *"Owner reports G0 ≥ 8/10 on an iPhone 15 Pro-class device"* | ⬜ **still the only open condition.** `INCONCLUSIVE-TRANSPORT` stands; the measurement needs a real finger. The protocol and the analyser are ready and self-checked — see `owner-run.md` section A. |
| *"the glass-acceptance rows pass on ≥1 notched iOS + ≥1 Android"* | ⚠️ **PARTIAL, and the remainder is transport-bound, not product-bound.** Every row a mirror could answer is answered: G3-1 PASS, G3-15 PASS, G3-17 FINE, G3-16(b) BETTER, G3-2's mechanism confirmed armed. The rest is collected in `owner-run.md` with a stated reason per row. ⛔ Android specifically could not even be signed in (`pixel8-run-2026-09-12.md`). |

⛔ **G3-18 does NOT block either stage.** Owner ruling, 2026-09-12: the chip being partly covered by
page-level fixed furniture (the Journal's own "Log a trade" FAB at 360/375/430, a Breadth span at
360) is **cosmetic-plus** — the covering element stays on top and remains tappable, so nothing is
unreachable; the chip's readout is partly hidden at max width. It is recorded as a known glass gap
with a deferred hub-side fix (D-39), not as a gate.

🔒 **ROLLOUT_STAGE stays 1.** Nothing in today's work advances it, and nothing in today's work
should: the one remaining condition is a measurement only the owner can take.

---

## What does NOT change at any stage

Four things are deliberately stage-independent. Each is a rail in
`app/src/hub/rolloutStages.test.js`, and each was mutation-proved by breaking it on purpose.

| | Why it cannot be a stage's business |
|---|---|
| **`HUB_PREVIEW_ENABLED=false` removes the hub for everyone** | It is the kill switch, read per request in `api/routers/auth.py`, and takes effect on a member's next authenticated request with **no redeploy**. It is checked before anything else in `useHubActive.js`. A stage that could re-enable a killed hub would make the no-redeploy rollback a fiction. |
| **A member who already chose keeps the settings card** | The card shipped ungated in PR #101, so members turned the hub on with it. A stage that hid it from them would take away their only way off — the same defect as the "Hide joystick" toast that pointed at a Settings screen which did not exist yet. |
| **An explicit `false` is honoured at stage 3** | Stage 3 sets a *default*, never an override. It is consulted only when the preference is unset. Turning the hub back on for someone who switched it off is not a rollout, it is ignoring them. |
| **Coarse-pointer eligibility is decided once** | Stage 3 returns a flat `true` and does **not** re-test the pointer — `useHubEligible` already gates that, and every caller passes through it. A second opinion about "is this a touch device" beside the one that already decides is the defect this repo keeps re-finding. |

---

## Rolling back

| Situation | Do this | Cost |
|---|---|---|
| The hub is misbehaving for members, any stage | Set `HUB_PREVIEW_ENABLED=false` in Railway | No redeploy. Takes effect on each member's next authenticated request — in practice a reload or route change, not a background poll. |
| A stage went too far, but the hub itself is fine | Lower `ROLLOUT_STAGE` and deploy | A deploy. There is no push window (ruling 2026-09-11) — ship it when it is ready. |
| A member wants it off for themselves | They already can, at Settings → Joystick | Nothing. This is the point of stage 2 existing at all. |

⚠️ **Lowering the stage does not reach a member who already opted in**, by design — their
preference is an explicit `true` and no stage overrides an explicit choice. The kill switch is
what reaches everyone.

---

## Advancing a stage — the checklist

1. Confirm the gate's data has actually arrived, in the file that owns it. Absence is not a pass.
2. Change `ROLLOUT_STAGE` in `app/src/hub/rolloutStage.js`. The pin in
   `rolloutStages.test.js` will go red — that is the rail doing its job. Move it in the **same
   commit**, never separately.
3. Write the member-impact paragraph. Stage 2's is *"the joystick's settings card is now
   visible to everyone; it stays off until you turn it on."* Stage 3's is *"the joystick is now
   on by default on touch devices; if you turned it off, it stays off."*
4. Deploy. ⚰️ This step used to read *"Deploy outside the no-push window"*; deploy windows were retired 2026-09-11 and there is nothing to wait for.
5. Run `tools/hub_nav_smoke.py` against production, signed in. A stage that widens the audience
   and an inconclusive smoke do not go together.
