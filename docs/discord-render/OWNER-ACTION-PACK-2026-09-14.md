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
