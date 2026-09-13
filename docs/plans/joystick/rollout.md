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

## The gates

| | Stage | Who sees the settings card | What an unset preference means | Gate — what must be true before this deploys | Status |
|---|---|---|---|---|---|
| **1** | admin only | admins, plus any member who has already chosen | OFF for members, ON for admins | Rails green; stage-1-is-a-no-op proof passes | ✅ **LIVE** |
| **2** | opt-in | **every member** | still OFF — a member must switch it on | **Owner reports G0 ≥ 8/10** on an iPhone 15 Pro-class device, **and** the glass-acceptance rows pass on ≥1 notched iOS + ≥1 Android | ⏸️ **held — waiting on data** |
| **3** | default on | every member | **ON**, unless the member explicitly turned it off | Everything in stage 2, **plus** the post-deploy smoke conclusive over every top-level route signed in (including `/dashboard`), **plus** the kill switch verified from a real device | ⏸️ **held — waiting on data** |

⛔ **Stages 2 and 3 are DATA gates, not decision gates.** Nothing is waiting on a ruling. The
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
