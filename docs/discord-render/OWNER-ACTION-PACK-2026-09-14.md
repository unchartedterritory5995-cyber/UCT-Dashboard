# D-03 Part 4 — OWNER ACTION PACK

> ⛔ **NOTHING IN THIS FILE WAS EXECUTED.** Every env change is yours.
> ⛔⛔ **DO NOT SET `DISCORD_RENDER_V2_ENABLED`.** That is the canary flip and it is gated on the
> flip packet. It is not in this checklist and it must not be added to it.
>
> **[DASHBOARD]** = Railway web dashboard · **[KEYBOARD]** = a terminal.
> You are on mobile: steps 1 and 4 are **[DASHBOARD]** and doable from a phone browser. Steps 3 and
> 5 are **[KEYBOARD]** and need a laptop — or ask me to run them.

---

## 4.1 · The value to set

```
DISCORD_RENDER_V2_CHANNELS = 1549129739048853544
```

**That id is `#render-smoke`.** Provenance, quoted rather than retyped from memory:

- `docs/discord-render/evidence/smoke-2026-09-14/INDEX.md:3` —
  *"**Channel:** `#render-smoke` = `1549129739048853544`, created today under ADMIN CHAT."*
- It is already the **second** entry of the live `CHART_FLOW_CHANNEL_ID`
  (`1546563720702853280,1549129739048853544`, read live 2026-09-14), so `/chart` can already run
  there. **Organic members exposed: 0** — the only non-bot readers are the 5 `ADMIN` members and the
  server owner, who see it through `ADMINISTRATOR`, not through an overwrite.

---

## 4.2 · `FLOW_CMD_CHANNEL_ID` — what it gates, and why it matters here

**Current live values**

| variable | value |
|---|---|
| `CHART_FLOW_CHANNEL_ID` | `1546563720702853280,1549129739048853544` ← the allowlist in force |
| `FLOW_CMD_CHANNEL_ID` | `1546563720702853280` ← **narrower: one id, no `#render-smoke`** |

**The consumer** — `api/services/discord_interactions.py:342-359`:

```python
raw = (os.environ.get("CHART_FLOW_CHANNEL_ID")
       or os.environ.get("FLOW_CMD_CHANNEL_ID") or "")
```

`CHART_FLOW_CHANNEL_ID` wins; `FLOW_CMD_CHANNEL_ID` is the **fallback**. Today the allowlist is
correct.

⚠️ **THE TRAP:** if `CHART_FLOW_CHANNEL_ID` is ever blanked or unset, the fallback silently narrows
the allowlist back to **one** channel, `/chart` stops answering in `#render-smoke` **mid-canary**,
and the symptom reads as *"the canary channel went quiet"* — which looks like a render fault, not a
config one. Two variables holding different answers to one question.

⭐ **RECOMMENDED: ALIGN, do not blank.** Set `FLOW_CMD_CHANNEL_ID` to the same two ids. Blanking it
also works today but removes the safety net entirely; aligning makes the fallback harmless.

```
FLOW_CMD_CHANNEL_ID = 1546563720702853280,1549129739048853544
```

⛔ **Order is meaningful and must not change.** `cmd_channel_id()` (`:361-370`) returns the **first**
entry as the member-facing channel, and the "please use <#…>" nudge names it. Putting
`#render-smoke` first would tell every member in the guild to use a channel they cannot see — a
member-visible regression produced entirely by a test-only addition.

---

## 4.3 · The ordered checklist

| # | flag | step |
|---|---|---|
| **1** | **[DASHBOARD]** | On service **`web`**, set `DISCORD_RENDER_V2_CHANNELS` = `1549129739048853544`. **Leave `DISCORD_RENDER_V2_ENABLED` UNSET.** |
| **2** | — | **Wait for the `web` redeploy. OUTSIDE 09:25–16:05 ET ONLY.** This restarts `web` and costs every in-flight render. ⚠️ `railway variables --set` has been measured BOTH staging-only and auto-redeploying — do not assume which you got; watch for a new boot. |
| **3** | **[KEYBOARD]** | Verify **in the running process** (below). A `--kv` read is **not** evidence. |
| **4** | **[DASHBOARD]** | Set `FLOW_CMD_CHANNEL_ID` = `1546563720702853280,1549129739048853544` (4.2). Same redeploy rules as step 2. |
| **5** | **[KEYBOARD]** | Verify in-process again. |
| **6** | — | **STOP.** Do not set `DISCORD_RENDER_V2_ENABLED`. |

### Step 3 / 5 — the in-process verification

```sh
python docs/discord-render/instruments/canary_scope_readback.py
```

It reads `commands.v2_channels()` **inside the running web pod** and writes
`docs/discord-render/evidence/canary-scope.json`. A **correct** read after step 1 looks like:

```json
{ "v2_enabled": false,
  "v2_channels": ["1549129739048853544"],
  "unrestricted": false,
  "source": "in-process (railway ssh, web pod)" }
```

**What each field has to say, and why:**

- `"v2_channels": ["1549129739048853544"]` — exactly one id, the canary.
- `"unrestricted": false` — ⛔⛔ **this is the field that matters most.** OI-35 defines an **empty**
  `DISCORD_RENDER_V2_CHANNELS` as **EVERY CHANNEL**, so `unrestricted: true` means the scope is not
  narrowed at all. Today it reads `true` (`canary-scope.json`, 2026-09-14), which is why the gate
  row `canary scope narrowed to the declared ids` is **NOT MET**.
- `"v2_enabled": false` — V2 is still off. It must stay false through every step here.

⚠️ **If the readback still shows `unrestricted: true` after a completed redeploy**, the variable did
not reach the running process. Do **not** proceed to step 4; re-check step 1 and the boot.

---

## 4.4 · Abort, per step

| step | abort | the read that proves it |
|---|---|---|
| **1** | **[DASHBOARD]** delete `DISCORD_RENDER_V2_CHANNELS` (delete, do not blank — blank and unset are the same to the code, but a blank value reads to a human as "someone set this deliberately") | `canary_scope_readback.py` → `unrestricted: true`, `v2_channels: []` |
| **4** | **[DASHBOARD]** set `FLOW_CMD_CHANNEL_ID` back to `1546563720702853280` | `python -c "from api.services import discord_interactions as di; print(di.cmd_channel_ids())"` in the pod → `('1546563720702853280', '1549129739048853544')` — unchanged, because `CHART_FLOW_CHANNEL_ID` still wins |

⭐ **Step 4 has no blast radius while `CHART_FLOW_CHANNEL_ID` is set** — it only changes a fallback
nothing is currently reading. That is exactly why it is worth doing: it is free now and it is the
difference between a quiet mid-canary outage and none.

---

## 4.5 · Flip-packet delta

⛔ **NOT APPLIED — attached as a diff.** `06-flip-packet.md` is Tier 1 (docs), but its §0 table is
**generated** from `flip_preconditions --json`, and the S5/S5b/S5c sub-verdicts landed in this same
pass. Regenerating it inside the same change would mix a content edit with a generated one and make
the diff unreviewable.

**The delta, for when the packet is next regenerated:**

1. **§1 states the ORDER as a numbered sequence**, not two variables in a table: narrow → verify
   **in-process** → enable. Setting `_ENABLED` while `_CHANNELS` is unset is the member flip.
2. **§2.1's verification reads the PROCESS.** `--kv` answers a question the packet is not asking.
3. **A new §1b: the two concurrency ceilings.** A flip moves the canary channel from the pre-V2
   path's `DISCORD_CHART_MAX_CONCURRENT=8` to the V2 pool's `DISCORD_RENDER_WORKERS=6` — **and they
   share the same `RENDER_SLOTS` semaphore** (`discord_interactions.py:67`). OI-40's producer 3 is
   exactly a V2 job losing that race and telling the member *"we're at capacity right now"*.
4. **A new prerequisite: align `FLOW_CMD_CHANNEL_ID`** (4.2).
5. **§0's S2 row now carries four sub-verdicts** (latency · S5 · S5b · S5c) and the row takes the
   worst. The generator must print all four, because a row that reports only its worst hides the
   three that were measured.

---

# OWNER PACK v2 — appended 2026-09-14 (D-04). One pack, not two.

> **§4.1–4.5 above are unchanged and still current.** Do them first; everything below is additive.
> ⛔⛔ **`DISCORD_RENDER_V2_ENABLED` is still never set by a session, and is not in any checklist here.**

---

## 5.1 · OI-13 — rotate the render token and the renderer secret

**Which services redeploy, PROVEN rather than assumed:**

| variable | read by | redeploys on change |
|---|---|---|
| `CHART_RENDERER_SECRET` | `web` (`discord_chart_house.py:296`) **and** `chart-renderer` (`app.py:76`) | **`web` yes** (a Railway variable change on `web`) · **`chart-renderer` yes**, separately |
| `CHART_RENDER_TOKEN` | `web` only — `render_panels.py:71-76`; it rides to the renderer as a **header**, never in the renderer's env | **`web` yes** |
| `VITE_CHART_RENDER_TOKEN` | **baked into the React bundle at BUILD time** | **`web` yes — and only a REBUILD changes it**, not a restart |

⛔ **THEREFORE: OUTSIDE 09:25–16:05 ET ONLY.** Every variant restarts `web`.

⭐ **AND THE ORDER MATTERS, because there is a window where a sender holds the old value and a
receiver the new.** OI-19 already built the escape: **both sides accept `…_TOKEN` or
`…_TOKEN_PREVIOUS`**. So:

| # | flag | step |
|---|---|---|
| 1 | **[DASHBOARD]** | On `web`: set `CHART_RENDER_TOKEN_PREVIOUS` = the CURRENT token value, and `VITE_CHART_RENDER_TOKEN_PREVIOUS` likewise. Change nothing else. |
| 2 | — | wait for the `web` rebuild (outside RTH) |
| 3 | **[DASHBOARD]** | On `web`: set `CHART_RENDER_TOKEN` **and** `VITE_CHART_RENDER_TOKEN` to the NEW value. Both, in one edit — the bundle and the API gate must agree. |
| 4 | — | wait for the `web` rebuild. **Both old and new are accepted throughout**, so there is no rejection window. |
| 5 | **[KEYBOARD]** | On `chart-renderer`: `railway variables --service chart-renderer --set "CHART_RENDERER_SECRET=<new>"` then `railway redeploy --service chart-renderer --yes`. ⚠️ `--set`'s restart behaviour has been measured BOTH ways in this repo — watch for a new boot, do not assume. |
| 6 | **[KEYBOARD]** | Verify **in-process on both sides**, not from `--kv` (below). |
| 7 | **[DASHBOARD]** | Only once step 6 is green on both: clear `CHART_RENDER_TOKEN_PREVIOUS` and `VITE_CHART_RENDER_TOKEN_PREVIOUS`. ⛔ An uncleared `_PREVIOUS` means the old credential still works — the rotation has not finished until this is done. |

**Step 6, the in-process reads:**

```sh
# web: the values the RUNNING process holds
railway ssh --service web -- /opt/venv/bin/python -c \
  "import os;print('tok', bool(os.environ.get('CHART_RENDER_TOKEN')), \
   'prev', bool(os.environ.get('CHART_RENDER_TOKEN_PREVIOUS')))"
# ⛔ PRINTS PRESENCE, NEVER THE VALUE. A rotation that logs the credential it is rotating has
# rotated nothing (C-13's whole subject).
```

**Abort, per step:** steps 1–4 are additive and reversible by setting the variable back; step 5's
abort is the same `--set` with the old secret plus a redeploy; **step 7 has no abort** — once
`_PREVIOUS` is cleared the old credential is dead, which is the point.

**What the C-13 row will then require to close** — stated now so it is not negotiated later:
1. the rotation completed, with `_PREVIOUS` **cleared** on both variables (step 7);
2. `c13_token_sweep.py` green against the renderer source, **with its control still finding 33
   leaks when redaction is disabled** — a green sweep whose control has gone quiet proves nothing;
3. the old token value absent from the running env on both services, read in-process as above.

---

## 5.2 · Flip-packet entry: OI-41 (producer 3)

> **The V1 render semaphore is a second concurrency ceiling, and V2 shares it.**
> `RENDER_SLOTS` (`discord_interactions.py:67`, `DISCORD_CHART_MAX_CONCURRENT`, **8** in production)
> gates every call to the renderer from *both* paths. The V2 queue admits on its own ceiling
> (`DISCORD_RENDER_WORKERS` **6**, depth **48**), so a V2 job can be admitted and then wait on a slot
> a pre-V2 member is holding.
>
> **Before D-04 that job was told `queue_full` — "we're at capacity right now" — the ADMISSION
> refusal, about a queue it was already inside.** Fixed: a V2 job now waits for a slot up to its own
> remaining budget and, if that expires, is told `deadline` ("the chart service took too long"),
> which is true. V1 is byte-identical (`slot_wait_s` defaults to 0.0; the mapping is inside the
> `fail_fn` branch only V2 supplies).
>
> ⚠️ **Canary consequence:** during a canary both paths are live and share those 8 slots. 6 V2
> workers + pre-V2 members can exceed 8, so waiting — not refusing — is what members will experience
> under contention. Watch `deadline` counts, not `queue_full`, as the canary's capacity signal.

---

## 5.3 · Flip-packet entry: the S2 instrument ruling and its limits

> **S2 is measured against production, off-hours, at real-traffic rates only** (ruling R1, entered by
> Claude (chat) 14 Sep 2026, owner-delegated — **not an owner ruling on the merits**).
> Limits, all of them: market closed, never 09:25–16:05 ET; tiers **busiest-60s, busiest-10s and the
> design burst ONLY** — the 3× tier and every overload tier are **permanently excluded from
> production**; concurrency ≤ `RENDER_MAX_CONCURRENT − 1` (**= 1** at the default of 2); ≤ 400 offers
> and ≤ 15 minutes per run; an organic-arrival tripwire that pauses on the first and aborts on a
> second within 60 s; an S1 tripwire that aborts on any harness ack over 3 s; every request tagged
> in band so it can never be counted as organic.
>
> **The S2 row accepts only `renderer=production` artifacts**, or organic canary-channel samples
> labelled `source=canary`, and **refuses to judge below N = 120 judged deliveries per tier**,
> reporting NOT MEASURABLE instead.
>
> ⛔ **NOT YET RUN.** GO/NO-GO failed on one item: the branch carrying the tripwires, the harness tag
> and the `refusal_reach_ms` column **is not merged**, so production has none of the machinery the
> ruling requires. See `S2-RUN-GONOGO-2026-09-14.md`.

---

## 5.4 · The narrowing checklist — unchanged, re-issued

Exactly as §4.3 above. Do not treat this as a second version; it is the same list:

1. **[DASHBOARD]** `DISCORD_RENDER_V2_CHANNELS` = `1549129739048853544` (`#render-smoke`).
   **`DISCORD_RENDER_V2_ENABLED` stays UNSET.**
2. Wait for the `web` redeploy — **outside 09:25–16:05 ET only**.
3. **[KEYBOARD]** `python docs/discord-render/instruments/canary_scope_readback.py` — a correct read
   is `v2_channels: ["1549129739048853544"]`, **`unrestricted: false`**, `v2_enabled: false`.
   A `--kv` read is not evidence.
4. **[DASHBOARD]** `FLOW_CMD_CHANNEL_ID` = `1546563720702853280,1549129739048853544`.
5. **[KEYBOARD]** verify in-process again.
6. **STOP.**

---

## ⛔ The one decision blocking everything else

**Merge `discord-render-hardening` (20 commits) to `master`?** It is the only remaining blocker for
the S2 run, and it is the act that changes what members' `web` pod executes. Measured: **no
member-visible behaviour change with V2 off**, but it **does restart `web`**, so outside RTH only,
and another deploy was in flight 3 minutes before this was written — that one must be SUCCESS first.
**Not done. Yours.**

---

# OWNER PACK v3 — appended 2026-09-15 (D-05). Still one pack.

> **§4.x and §5.x above are unchanged.** Nothing here was executed.
> ⛔⛔ **`DISCORD_RENDER_V2_ENABLED` is still never set by a session.**

---

## ⛔ 6.0 · THE ONE DECISION EVERYTHING ELSE WAITS ON

**Merge `discord-render-hardening` (22 commits) to master — yes or no?**

I did **not** merge, and the reason is not the branch. Measured at 04:07 UTC:

- the branch **merges clean** (`merge-tree` exit 0, tree `e540e391f0`) with **zero file overlap**
  across 114 commits of other people's work;
- but **six `web` deploys landed in 57 minutes and five were `REMOVED`** — the signature of stacked
  pushes, and the documented cause of the 2026-09-12 and 2026-09-14 502 incidents;
- master took **28 commits in two hours** from at least four other workstreams.

⭐ **Every technical precondition I could reach is green. What is missing is the one thing a session
cannot supply for itself: somebody who can see all four workstreams and say "go now."** That is you.

**When you want it:** confirm nobody else is mid-merge → `git fetch && git merge-tree --write-tree
origin/master discord-render-hardening` (expect exit 0) → merge **once**, outside 09:25–16:05 ET →
watch `web` to **SUCCESS**, not "building" → verify in-process (running SHA, `v2_channels() == ()`,
`house_enabled() == False`, `/api/health` 200).
**Rollback:** `git revert -m 1 <merge-sha>`; one more restart; the new column is inert on old code.

---

## 6.1 · OI-13 rotation — and WHEN to do it

Steps are unchanged from §5.1. The new question D-05 can answer:

> **Do the rotation in the SAME off-hours window as the D-06 merge, rotation FIRST.**

**Why (recommended, not decided):** both restart `web`, and the rotation's dual-accept window
(`…_TOKEN_PREVIOUS` set, then the new value, then cleared) already spans two `web` rebuilds. Folding
the merge in between makes **three** restarts one night instead of four across two, and the merge is
the one you most want to verify on a quiet pod. ⚠️ The counter-argument, stated because it is real:
if the merge misbehaves you will be rolling back a pod that is also mid-credential-rotation, and two
moving parts is how a simple revert becomes an incident. **If you prefer one variable at a time, do
the merge first, verify it, and rotate a night later.**

---

## 6.2 · The narrowing checklist — re-verified, unchanged

§4.3 stands exactly as written (`DISCORD_RENDER_V2_CHANNELS` = `1549129739048853544`, then
`FLOW_CMD_CHANNEL_ID` alignment, each with an in-process readback and an abort line).
⚠️ **Re-verified against the merged SHA? No — there is no merged SHA.** The checklist targets
runtime environment variables, not code, so it is unaffected by the merge either way.

---

## 6.3 · C-09 — the race results, and the V1 behaviour change to approve

> **A member render now beats a warm render for the last free slot, on the pre-V2 path too.**
>
> Measured, 60 races each, with the warm render deliberately queued **first** (the realistic case —
> the warm cycle waits 25 s, so it is essentially always there already):
>
> | gate | member wins | background wins |
> |---|---|---|
> | today's plain semaphore | **0** | **60** |
> | the new `RenderGate` | **60** | 0 |
>
> Background is **not** starved: under 1.2 s of continuous member load against a 0.3 s fairness
> bound, members took 270 slots and the warm waiter was still served once — by the bound, while
> members were still queued.
>
> ⛔⛔ **AND THE HONEST HEADLINE: THIS IS NOT YET A FIX IN THE PRODUCT.** `RenderGate` is written and
> proved, and **no production file imports it** — the live semaphore is still the plain one. So the
> table above is what the gate DOES, not what members get today. Wiring it is two threaded
> parameters plus a rail, and that is D-06 work, not something to assume happened.
>
> ⚠️ **What you are being asked to approve is the member-visible V1 change**, because the gate sits
> on the shared semaphore: once wired, it changes who wins on the current path, **not only under
> V2**. It is on `feat/member-priority-render-gate`, not merged.
>
> ⛔ **What it deliberately does NOT do:** preempt a warm render that is already holding a slot.
> `chart-renderer` exposes no cancellation, so a "cancelled" render keeps running and still occupies
> a renderer slot while we stop waiting for its result — we would pay the cost and lose the result.
> A member's wait is therefore bounded by **one** in-flight render rather than by the warm queue
> behind it, which was the part that actually hurt.

---

## 6.4 · Flip-packet updates outstanding

1. **Merged SHA** — none yet (6.0).
2. **OI-41** — entry written in §5.2; still accurate.
3. **S2 instrument** — §5.3's entry stands, and the **NO-GO reason has changed**: D-04's blocker was
   the unmerged branch; D-05's is the merge storm. ⭐ Also recorded: the corrected R1 tripwire **does**
   have a production-readable signal needing no second merge — **Discord channel-history snowflakes**,
   which the arrival census already proved readable through the bot token.
4. **C-09** — 6.3 above.
5. **A sizing note, with the arithmetic** — 6.5.

### ⛔ 6.5 · Does "change nothing" still hold with two renderer slots and six workers?

The constants inventory concluded **change nothing**. That was about the **V2 queue** (workers 6,
depth 48 against a derived need of c=4, depth ≥6). It said nothing about the renderer.

**`RENDER_MAX_CONCURRENT` defaults to 2** (`services/chart_renderer/app.py:79`) — *the renderer's own
ceiling*, downstream of both `DISCORD_CHART_MAX_CONCURRENT=8` (web-side) and `DISCORD_RENDER_WORKERS=6`.

The arithmetic, at the design burst:

- design burst **0.6 arrivals/second**; measured service ~**2.4 s** per house chart;
- Little's Law: **L = 0.6 × 2.4 = 1.44** renders in flight on average;
- two renderer slots serve 1.44 with headroom — **so "change nothing" still holds at real load.**

⚠️ **Where it stops holding:** the busiest 10 s observed is 2 arrivals and the design burst is 3× that
— **6 arrivals in 10 s**, i.e. 0.6/s but arriving in a clump. Two slots drain a 6-chart clump in
~7.2 s, inside the 15 s deadline but with **no margin for a slow bars fetch**. And 6 V2 workers
feeding 2 renderer slots means **four workers are always waiting** — which after OI-41 is a *wait*,
not a refusal, but it is why the renderer, not the queue, is the real ceiling.

⭐ **Recommendation (not a decision): leave the constants alone and raise `RENDER_MAX_CONCURRENT`
only if a real S2 measurement shows queueing at the renderer.** That measurement is exactly what
Part 2 could not run tonight — so the sizing question is **INCONCLUSIVE pending the S2 run**, and
saying so is better than tuning on arithmetic alone.

---

# OWNER PACK v4 — appended 2026-09-15 (D-06). Still one pack.

> **§4.x–§6.x above are unchanged.** Nothing here was executed.
> ⛔⛔ **`DISCORD_RENDER_V2_ENABLED` is still never set by a session.**

---

## ⛔⛔ 7.0 · THE FREEZE DID NOT HOLD, AND THAT IS THE HEADLINE

You paused master pushes in the other workstreams. **Four commits from three workstreams landed
on master after that**, the last one **349 seconds** before I measured:

| when (CT) | commit | workstream |
|---|---|---|
| 23:49 | `52a178a34` | **Top Flow / OptionsFlow** |
| 23:55 | `102c5b39a` | **docs/session8-record** (Breadth) |
| 00:07 | `1571e2f87` | **Breadth** — H1 page-cache experiment |
| 00:10 | `6b606990c` | **Top Flow / OptionsFlow** |

Master took **14 commits in 90 minutes** from four workstreams. Part 1.2 requires master
unchanged for 30 minutes and zero deploys in 30 minutes; it measured **5.8 minutes** and **four**,
twice, an interval apart. **NO-GO, and not a close call.**

⭐ **None of those sessions did anything wrong.** The freeze reached you and it reached this
directive. It did not reach the tool those sessions run before they push — which is 7.2.

---

## 7.1 · The merge — unchanged, and now with a working precondition

§6.0's steps stand. What is new is that you no longer have to eyeball "is master quiet": **the
push guard now answers it**, and on the night in question it says no.

**When you want the merge:** ask the other sessions to stop, wait until
`python tools/pre_push_guard.py` prints **OK** from the `discord-render` worktree, then merge
once, outside 09:25–16:05 ET, and watch `web` to SUCCESS.

---

## ⛔ 7.2 · FREEZE PROTOCOL — one paragraph to paste into the other sessions

> **Master push freeze, effective now until I say otherwise.** Do not push or merge to `master`
> for any reason — docs included. Finish what you are doing, commit it, push your BRANCH, and
> stop there; branch pushes are unaffected. If your pre-push guard refuses a master push saying a
> deploy landed recently or that there have been three deploys in an hour, **that is the freeze
> working — do not use `UCT_SKIP_PREPUSH_GUARD`, and never `--no-verify`.** A single 22-commit
> merge has to land on a quiet queue; every push inside its 3–5 minute build marks it REMOVED
> mid-flight, which is what served members Bad Gateway on 09-12 and 09-14. I will say when it is
> clear.

⚠️ **The guard cannot enforce this for them tonight.** `tools/pre_push_guard.py` is repo-tracked,
but the installed hook resolves it from **the pushing worktree's own checkout** — so each session
runs the copy on its own branch. They get the new cadence clause only after this branch merges
*and* their branches pick master up. Tonight the paragraph is the whole mechanism.

---

## 7.3 · R5 — the C-09 gate's V1 change, for you to confirm before D-08

> **Approve, or don't:** once wired, a member's `/chart` will beat the warm-cache cycle to the
> last free render slot — on the **pre-V2 path**, i.e. for every member today, not only under V2.
> Measured: with today's plain semaphore the warm cycle wins **60 of 60** races for the last slot;
> with the gate the member wins **60 of 60**. The warm cycle is not starved — under 1.2 s of
> continuous member load against a 0.3 s fairness bound it was still served, by the bound, while
> members were queued. The cost is that cache warming yields, so some members will occasionally
> pay a cold render that a warm one would have covered. ⛔ **Not yet wired** — `RenderGate` is
> imported by no production file, and wiring it is D-08, after the OI-36 merge (R6).

---

## 7.4 · The narrowing checklist — carried forward, still unverified against a merged SHA

§4.3 stands verbatim. It targets **runtime environment variables**, not code, so the missing merge
does not change it. `DISCORD_RENDER_V2_ENABLED` remains unset.

---

## 7.5 · Flip packet — what moved this session

| | |
|---|---|
| **Merged SHA** | still none (7.0) |
| **S2 run** | NO-GO, consequentially — R1 requires a merged SHA live |
| **OI-36** | ✅ **FIXED**, on `fix/oi-36-buzz-defer-first` (`da5aa9da2`), not merged. `/buzz` now acks before it does any work; 3/3 mutations RED on their named case. **D-07.** |
| **C-09 gate** | still **NOT WIRED** — unchanged from v3 |
| **`RENDER_MAX_CONCURRENT`** | still **INCONCLUSIVE pending the S2 run** (§6.5) |
| **Guard rail** | ✅ **NEW** — the push guard now refuses on deploy cadence, not just on pod state. Proven on live data: at the same instant it said REFUSE from this branch and OK from a branch off master. |
| **Gate snapshot rail** | ✅ **NEW** — every gate run writes a per-row record; "gate impact" is a diff, never a recollection |



---

# OWNER PACK v5 — appended 2026-09-15 (D-07). Still one pack.

## 8.0 · THE MERGE LANDED. That is the headline you were waiting on.

`30fd58aef..8578d375d` pushed to master **09:09 UTC**, web **SUCCESS 09:11:56**
(2m39s). All three guards printed OK on the real push, including the new cadence
rail:

```
[pre-push] 05:09:17 ET is outside the 09:25-16:05 ET window - safe to restart web.
[pre-push] web is SUCCESS on 30fd58aef, 747s settled - safe to push.
[pre-push] 2 web deploy(s) in the last 60 min, none inside 600s - master is quiet.
```

Verified **in-process on the running pod**, not inferred from the push:

| check | reading |
|---|---|
| RUNNING SHA | `8578d375d` |
| `v2_channels()` | `()` — V2 reaches no channel |
| `DISCORD_RENDER_V2_ENABLED` | `None` — unset, as required |
| `RENDER_SLOTS` type | `BoundedSemaphore` — ✅ the C-09 gate is correctly **NOT** on master |
| schema / migration / `recent()` | all True |
| `/api/health` | 200, `uptime_seconds` 70 |

⭐ **One deviation, investigated rather than reported as a pass.** `house_enabled()`
returned **True** where the directive expected False. It is
`bool(os.environ.get("CHART_RENDERER_URL", "").strip())` and **the merge touched
that file zero times** — so the directive's expectation was stale, not a
regression. Nothing to do.

**The post-merge quiet read at 09:16:10** showed our merge SUCCESS at age 407s,
nothing newer, `origin/master` equal to it. **No workstream broke the freeze.**
You can release the other three sessions.

## ⛔ 8.1 · [PASTE INTO EACH OTHER SESSION] — freeze lifted, one new standing line

> The discord-render hardening merge is **done**: master is `8578d375d`, web
> SUCCESS. The freeze is **lifted** — you may push again.
>
> **Before your next push, rebase your branch onto master.** The merge added a
> third pre-push guard (a deploy-cadence rail) that refuses a push when a web
> deploy landed inside the last 600s or when master is deploying too fast. Your
> branch carries the OLD two-guard hook until you rebase, so **today your hook
> cannot see the condition that caused the 2026-09-14 stacked push.** Rebase, and
> your next push runs the cadence rail.
>
> One master merge at a time still stands, and still means: wait for Railway `web`
> to reach SUCCESS, not merely for your own push to return.

## 8.2 · OI-13 — rotate the render token, and WHEN

**Unchanged and still yours (R7).** The timing question is now settled by the merge:

- ⭐ **Rotate NOW rather than waiting for D-08/D-09.** The merge is landed and
  verified, the queue is quiet, and the next two merges are small and
  test-scoped — so this is the widest clear window the programme will have.
- Rotating during a merge window is what you want to avoid: a token rotation and a
  deploy in the same minute make each other unreadable.
- The command block is §5.1 of this pack, unchanged. ⛔ It prints **presence, never
  the value** — a rotation that logs the credential it rotates has rotated nothing.

## 8.3 · R5 — what the C-09 gate costs, in one line

**The decision, restated so you can answer it without re-reading §6.3:**

> The gate makes every `/chart`, `/charts` and V2 render **beat the warm cycle to
> a free slot**, where today they compete as equals. A member waiting on a chart
> gets it sooner; the hot-set warm cycle gets it later, and on a busy minute may
> skip a cycle entirely.

**Cost:** warm coverage degrades under load — the cache is colder for whoever
arrives next, which is a *second-order* member cost paid to remove a *first-order*
one. **Benefit, measured, through the real production functions:** member
**50/50** races won with the gate wired, **0/50** against a class-blind valve, with
controls green at both ends and mutations RED both ways.

⛔ It is **not** a V2-only change, which is the whole reason it needs you: it moves
V1 behaviour for every member on every chart command, and V2 is still dark.

## 8.4 · The narrowing checklist — carried forward

Unchanged from §7.4 and still **unverified against a merged SHA**, because the two
items that would verify it did not run this session (§8.5). Re-issued verbatim so
it does not quietly lapse:

1. one admin `/chart` in `#render-smoke`, confirm image + timing;
2. the 15-command smoke 3.5;
3. the S2 run, once the organic-arrival tripwire exists and its production
   non-vacuity is proven.

## 8.5 · FLIP PACKET — what moved, and what did not

| row | state after D-07 |
|---|---|
| **Merged SHA** | ✅ **`8578d375d`** — web SUCCESS 09:11:56, verified in-process |
| **Cadence rail** | ✅ **LIVE on master**, and it fired correctly on the real push |
| **REMOVED premise** | ⛔ **RETRACTED.** 19 of 20 web deploys are REMOVED, including one superseded 1,990s later. D-05's "five REMOVED = five stacked pushes" was wrong. **The NO-GO was right; its stated reason was not.** The real signal is the deploy RATE, which is what the new rail measures. |
| **S2 run** | ❌ **NOT RUN.** The V1 organic-arrival tripwire was never built; the fallback is snowflake polling, and its production non-vacuity is an explicit stop condition. Not run is the correct outcome, not a slip. |
| **Smoke 3.5** | ❌ **NOT RUN** — needs a browser driving Discord. |
| **OI-36 / D-08** | ✅ branch `fix/oi-36-buzz-defer-first` @ `da5aa9da2`, pushed, **merges master clean (rc=0)**. `/buzz` still FAILS on master until it lands. |
| **C-09 gate / D-09** | ⚠️ wired, raced, mutation-proved; branch `c54066415` pushed, **NOT merged**. 3 reds and one master conflict — all bounded, all named in `D09-PREFLIGHT-DELTA-2026-09-15.md`. **No production caller is broken.** |
| **`RENDER_MAX_CONCURRENT`** | unchanged — still INCONCLUSIVE pending S2 |
| **Gate snapshot** | 6 MET / 3 NOT MET / 2 NOT MEASURABLE; post-merge diff = **NO GATE CHANGE** |
| **Blocked on you** | OI-13 rotation (§8.2) · R5 (§8.3) · C-13 row closure |
