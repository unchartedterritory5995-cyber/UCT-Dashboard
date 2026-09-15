# DRAFT — `closure.md` as LAUNCHED

> ⛔⛔ **THIS IS A DRAFT AND IT IS NOT `closure.md`.** Nothing here is applied. It exists so that
> when the last box closes, box 6 is a **transcription with citations already sourced**, not an
> essay written at the end of a long day against a document nobody has re-read.
>
> ⛔ **Applying this file before every box below reads FILLED is the one action that makes the whole
> gate a lie** — `closure.md`'s own words for box 6: *"deliberately last and deliberately not
> self-satisfying."* A draft that can be pasted early is a hazard; that is why every slot that is
> not yet evidence carries a **`PENDING-<wall>`** marker instead of prose, and why the markers are
> machine-greppable.

**Drafted 2026-09-15**, against `closure.md` at `79b4b2907` (6 boxes, **2 ticked**) and
`rollout.md` §3 a–f.

---

## The two walls, named once

| wall | what it is | who can clear it | what is blocked behind it |
|---|---|---|---|
| **WALL-GLASS** | a real finger on real glass. BrowserStack **Live** is a screen mirror with a measured **260–427 ms** floor per gesture against a **120 ms** window, and Automate is **not on this account**. No funded product can ask the question. | **Patrick only** | boxes **1**, **2**, and box **5**'s kill-switch demonstration |
| **WALL-MERGE** | a member-facing merge to master. Agents may open and merge docs/tools PRs; a rollout that turns the hub on for every member is the owner's. | **Patrick only** | box **5**'s stage-2 and stage-3 merges |

⭐ **Neither wall is an engineering gap, and that distinction is the point of this table.** Every
instrument behind them exists, self-checks, and has been run against everything it *can* reach. What
is missing is a thumb and a merge button.

---

## Box-by-box state of the draft

| box | what it needs | state of the DRAFT |
|---|---|---|
| 1 | G0 ≥ 8/10, owner, real glass | 🔴 **PENDING-WALL-GLASS** |
| 2 | glass acceptance, ≥1 notched iOS + ≥1 Android | 🔴 **PENDING-WALL-GLASS** |
| 3 | post-deploy client smoke, conclusive | 🟢 **FILLED** |
| 4 | preference-key validation live server-side | 🟢 **FILLED** |
| 5 | rollout at stage 3 + kill switch on glass | 🔴 **PENDING-WALL-MERGE + PENDING-WALL-GLASS** — *the code half is now pre-built and gated* |
| 6 | this document, rewritten | 🟡 **DRAFTED** — this file |

**2 FILLED of 6.** ⛔ That number is the same one `closure.md` carries today, and this draft does
not improve it. Drafting a box is not filling it.

---

## The replacement header — to be pasted over `closure.md`'s `⬜ NOT YET LAUNCHED` block

> ## ✅ LAUNCHED — all six boxes closed on evidence
>
> ### What is live right now — read from Railway on `PENDING-WALL-MERGE: <date>`, not inferred
>
> | | Value | How it was read |
> |---|---|---|
> | `web` deployment | `PENDING-WALL-MERGE: <sha>` — SUCCESS, `PENDING-WALL-MERGE: <timestamp>` | `railway status --json` → production → `web.latestDeployment.meta.commitHash` |
> | Kill switch | **`HUB_PREVIEW_ENABLED=true`** — hub eligible | `railway variables --service web --kv`, then read **in-process**; `--kv` confirms the service's config and is not evidence the running process has it |
> | Rollout stage | **3 — general availability** (`ROLLOUT_STAGE = 3`, `app/src/hub/rolloutStage.js`) | read from the source at the live SHA; a BUILD-time constant, so the deployed bundle is its only authority |
>
> ⭐ **Stage is a build constant and the kill switch is a runtime variable, and that asymmetry is the
> design** (`rolloutStage.js`: *"a stage is a deploy, deliberately"*). So "what stage is live" is
> answered by the SHA, and "is the hub on at all" by the variable. Neither answers the other. **That
> sentence survives launch unchanged** — it was true at stage 1 and it is true at GA.
>
> ⛔⛔ **LAUNCHED IS NOT A CLEAN CLOSE, AND THIS HEADER WILL NOT PRETEND IT IS.**
> `postmortem-nav-freeze.md` stays required reading: on 2026-09-10 this programme shipped a render
> loop that froze navigation app-wide for about four and a half hours, found by a member. The
> defect CLASS is railed (Increment 8, C1–C5, charter rule H14). The incident is not deleted by
> having launched.

---

## Box 1 — G0 resolved · 🔴 PENDING-WALL-GLASS

**Fills with:** the owner's own iPhone 15 Pro-class device, the 7-step top half of
`g0-flick-trace-plan.md`, and `tools/hub_trace_analyze.py` over the resulting trace.

```
Evidence: PENDING-WALL-GLASS
  run record  : traces/<date>-g0-owner-run.md
  flick score : ___ / 10      (tick requires >= 8)
  analyser    : tools/hub_trace_analyze.py  (--self-check PASSES today)
```

⛔ **If it comes in below 8, the box does not get a caveat — the root cause is traced and fixed.**
`closure.md`'s wording: *"not noted, not averaged across devices."*

⭐ **What the 2026-09-12 Live run already eliminated, so the owner's run is narrower than it was:**
the pad renders at the specified pixel; the **press** path fired **10/10** onto the intended
outer-ring action, so Phase 2's *"15 Pro 0/10 on sticky fan"* is **not reproduced** on iOS 17.6;
the flick **branch** fires 6/6 at 76–79 ms when a pointer sequence reaches it inside the window;
`elapsed` and `event.timeStamp` agree to **≤ 8 ms**, eliminating cause A as originally written; and
`getCoalescedEvents()` added 0 rows. ⛔ **None of that is a G0-1 result** — no finger touched glass.
One question is left: *does a real finger's flick on a 15 Pro produce a pointerdown→pointerup pair
under 120 ms?*

## Box 2 — Glass acceptance, ≥ 1 notched iOS + ≥ 1 Android · 🔴 PENDING-WALL-GLASS

**Fills with:** `glass-acceptance.md` run against `glass-acceptance-steps.md` — **96 derived rows**,
regenerated by `node tools/hub_surface_matrix.mjs --glass` and byte-compared by
`surfaceMatrixIsCurrent.test.js`.

```
Evidence: PENDING-WALL-GLASS   (gated behind box 1 — glass-acceptance.md:104,
          "Resolve G0-1 before reading any G1")
  iOS     : device ____________  iOS ____   rows passed ___ / 96
  Android : device ____________  ver ____   rows passed ___ / 96
  §5A     : the post-swap re-judge, Wire-vs-Breadth as its own row
```

⚠️ **Carry owner ruling R2 (2026-09-14) into the filled version verbatim** — a stage-1 G3-16(a)
answer satisfies this box **with the recorded caveat** *"collected at stage 1; re-judge post-swap
via §5A"*. The accent tokens are byte-identical at both stages so D-27's promotion decision
transfers; the **arrangement** does not, because stage 2 moves `home.wire` inner → OUTER and
`home.journal` OUTER → inner. At stage 2 Wire lands beside **Breadth**, D-27's own measured worst
case, and that pairing has never been judged on glass by anybody.

## Box 3 — Post-deploy client smoke · 🟢 FILLED

```
Evidence: smoke-runs/2026-09-12T02-24-24Z.md
  tools/hub_nav_smoke.py --auth   desktop pass  PASS   16 routes, 25 nav entries, live SHA 7fce88bd2
  touch-context pass              OK            2026-09-12T02:54:26Z, live SHA 36596a88a
```

⭐ **Keep the reason this box has two passes rather than one.** `HubRoot.jsx` keeps
`<div data-testid="hub-root">` in the DOM and sets the HTML `hidden` attribute, so a
`querySelector` presence check answers *"did React render the container"*, never *"can the member
see it"* — and the first touch run therefore published a chart-shell defect that did not exist.
`offsetParent === null` is not the signal either, because the hub is `position: fixed`. **PRESENT
IS NOT SHOWING.**

## Box 4 — Preference-key validation live server-side · 🟢 FILLED

```
Evidence: built as L3 item 1 in 60cbe8919, shipped as Deploy B (b9d66e0c3, 11:01 ET)
  live at   : b63cf9775 (web, SUCCESS 2026-09-11T20:58:24Z)
  ancestry  : git merge-base --is-ancestor — verified, not inferred from the push
  rail      : tests/test_preference_key_validation.py — 24 tests, 5 mutation proofs,
              accepted key set RE-DERIVED from app/src/** every run
```

⭐ The tenth field is `coachMarkSeen`, which is **not** in `HUB_SETTINGS_DEFAULTS` — omitting it
would have 400'd the coach-mark dismissal and left that hint on screen with no way to dismiss it.
Unknown **fields** inside a known key stay accepted on purpose: a member's whole stored blob is
spread into every later write, so refusing one stale field from an older build becomes a permanent
400 on all their hub settings.

## Box 5 — Rollout at stage 3, kill switch verified on glass · 🔴 PENDING-WALL-MERGE + PENDING-WALL-GLASS

```
Evidence: (i)   stage 3 DEFINED                      FILLED — owner ruling 2026-09-13, rollout.md
          (ii)  stage 2 merged on ________ by Patrick   PENDING-WALL-MERGE
                stage 3 merged on ________ by Patrick   PENDING-WALL-MERGE
          (iii) kill switch demonstrated ON A DEVICE at each stage, with screenshots
                                                        PENDING-WALL-GLASS
```

⭐ **The code half of (ii) is pre-built and gated as of 2026-09-15**, which is as far as an agent may
take this box:

| | |
|---|---|
| stage 2 | `launch/stage-2-member-preview` @ `2ae7e98aa` — gated, **frozen**, unmerged. `gate-runs/2026-09-13T17-57-36.md`; merge result pre-flighted in `harness/2026-09-15-stage2-merge-preflight.md` |
| stage 3 | `launch/stage-3-ga` @ `3164cccac` — gated, **not opened**. `harness/2026-09-15-stage3-ga-prebuild.md` |

⛔⛔ **ONE OF THIS BOX'S TWO STANDING WARNINGS IS NOW HISTORY, AND THE FILLED VERSION MUST SAY SO
RATHER THAN REPEAT IT.** The box currently warns that *"no new behaviour at stage 3 is **false**
while `PREVIEW_MODES` still holds `home` and `flow`."* That was true of master on 2026-09-13. It is
**not** true of the stage-2 branch: `PREVIEW_MODES` is **empty** there, because stage 2 flipped the
final two in the same change as the widening and stated the one member-visible consequence in its
own diff. So the two fans land with **stage 2**, `rollout.md` §2(b) is answered, and stage 3 really
is copy-only — which is the precondition §3 d names.

⛔ The **first** warning stands and must be carried forward: the ruled ladder is not the one the
code implemented, and `ROLLOUT_STAGE = 2` in *2026-09-13 master* would have shipped the retired
opt-in rung. That is exactly what the stage-2 branch fixes, and it is why the branch is 26 files and
not one line.

⚠️ **And §3 c sits between the two merges.** D-39 (the chip under the Journal FAB, 6 pairs at
360/375/430, measured by `tools/hub_chip_clearance.py`) is ruled *fix before stage 3, not before
stage 2*. It is **held pending Patrick's bug list** so it can be scoped against what he actually
reported. A pre-built stage-3 branch does not satisfy it.

## Box 6 — closure.md rewritten as LAUNCHED · 🟡 DRAFTED

```
Evidence: this draft — drafts/closure-as-LAUNCHED.md, 2026-09-15
          applied on ________ once boxes 1-5 all read FILLED
```

⛔ **The application protocol, because the failure mode here is enthusiasm, not ignorance:**

1. `grep -c "PENDING-" drafts/closure-as-LAUNCHED.md` must be **0** before a single line is copied.
   While it is non-zero, this file names its own blockers.
2. Every citation is re-verified by **quoting the cited line** at application time — a citation that
   cannot be quoted is **struck**, not softened.
3. The `postmortem-nav-freeze.md` paragraph is carried over **unchanged**. Launching does not
   retire an incident.
4. `deferred.md` and `requests.md` verdicts are re-read, not assumed still current.

---

## What this draft deliberately does NOT do

- It does **not** tick anything. Boxes 1, 2 and 5 are empty here for the same reason they are empty
  in `closure.md`: the evidence does not exist.
- It does **not** soften a wall into a caveat. `INCONCLUSIVE-TRANSPORT` is not a low score, and
  writing it as one would convert a missing measurement into a passing one.
- It does **not** pre-write the live SHA, timestamp or screenshots. Those are read at application
  time from Railway and from a device, never predicted.
