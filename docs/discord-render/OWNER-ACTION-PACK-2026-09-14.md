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
