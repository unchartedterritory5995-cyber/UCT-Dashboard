# D-02 Part E — the canary prerequisite audit (READ-ONLY; nothing was flipped, nothing was set)

> Read 2026-09-14 from `railway variables --service web --kv`, the in-process canary-scope readback,
> and `flip_preconditions --json` at `41bf6a79c`.
>
> ⚠️ `--kv` reports what the SERVICE is configured with. It is not evidence that the running process
> holds it. Every row below that matters is *unset*, so the code default runs — and a default lives
> in source and cannot drift from itself. The moment any of these is set, this table needs an
> in-process read to be worth anything.

---

## E1 · The prerequisite table

### The two variables, and the order they must be set in

| | live | what it means |
|---|---|---|
| `DISCORD_RENDER_V2_ENABLED` | **unset** | V2 is OFF. Every member is on the pre-V2 path. ✅ correct today |
| `DISCORD_RENDER_V2_CHANNELS` | **unset** | ⛔ **empty means EVERY CHANNEL** (`commands.v2_channels()` / OI-35) |

⛔⛔ **SETTING `DISCORD_RENDER_V2_ENABLED=1` TODAY IS THE MEMBER FLIP, NOT A CANARY.** With the
scope variable unset, `channel_allowed()` returns True everywhere. The two must be set in this
order, and the packet must name both in one breath:

```sh
# 1. narrow FIRST — while V2 is still off, so an empty scope can never be live
railway variables --service web --set "DISCORD_RENDER_V2_CHANNELS=1549129739048853544"
# 2. verify the RUNNING process narrowed (canary_scope_readback reads it in-process, not from --kv)
python docs/discord-render/instruments/canary_scope_readback.py
# 3. only then enable
railway variables --service web --set "DISCORD_RENDER_V2_ENABLED=1"
```

⭐ **The gate already refuses this.** `canary scope narrowed to the declared ids` reads **NOT MET**
with: *"the running process narrows to NOTHING — and OI-35 defines an empty
`DISCORD_RENDER_V2_CHANNELS` as EVERY CHANNEL, so this is the member flip, not a canary."*

### What is already in place

| prerequisite | state | evidence |
|---|---|---|
| a private canary channel exists | ✅ | `#render-smoke` = `1549129739048853544`, created under ADMIN CHAT; bot role allow `VIEW_CHANNEL`, `@everyone` deny |
| **organic members exposed** | ✅ **0** | only the 5 `ADMIN` members and the owner, via `ADMINISTRATOR` rather than an overwrite |
| `/chart` can run in that channel | ✅ | `CHART_FLOW_CHANNEL_ID` = `1546563720702853280,1549129739048853544` — the OI-34 allowlist is LIVE and holds both |
| the bot can write there | ✅ | 3.5 run 2 delivered a real chart into it |
| `chart-renderer` reachable from `web` | ✅ | `CHART_RENDERER_URL=http://chart-renderer.railway.internal:8080` |

⚠️ **ONE LATENT TRAP IN THE LIVE CONFIG.** `FLOW_CMD_CHANNEL_ID` = `1546563720702853280` — the
**narrower** value, one id. `cmd_channel_ids()` reads `CHART_FLOW_CHANNEL_ID` **first** and only
falls back to `FLOW_CMD_CHANNEL_ID`, so the allowlist is the two-id one today. But if
`CHART_FLOW_CHANNEL_ID` were ever unset or blanked, the allowlist would **silently narrow back to
one channel** and `/chart` would stop answering in `#render-smoke` — mid-canary, with no error, and
the symptom would be "the canary channel went quiet", which reads as a render problem. Two
variables holding different answers to one question is the second-authority shape; the safe fix is
to blank `FLOW_CMD_CHANNEL_ID` or bring it into step. **Not changed here — this is a read-only
audit.**

### The gate, row by row

`flip_preconditions --json`, 2026-09-14: **5 MET · 4 NOT MET · 2 NOT MEASURABLE**.

| row | state | what it is waiting for |
|---|---|---|
| zero xfails in the forensics suite | ✅ MET | — |
| the artifact cache is wired to the hot path | ✅ MET | — |
| `/chart` is shadowed (structural) | ✅ MET | — |
| chaos passed in `--real` mode | ✅ MET | 7 passed for real, 6 refused by name |
| `#render-alerts` locked to admins | ✅ MET | — |
| **canary scope narrowed to the declared ids** | 🔴 NOT MET | `DISCORD_RENDER_V2_CHANNELS` unset ⇒ every channel. **This is the flip-order blocker above.** |
| **every forensics class closed with a commit** | 🔴 NOT MET | 11/14 — **C-02, C-09, C-13** still open |
| **S2 measured in `--real` mode and within SLO** | 🔴 NOT MET | S5 **96.4 %** < 99.5 % on the one admissible closed-loop run; **latency INCONCLUSIVE** — every local run is the mplfinance fallback (OI-39), so no artifact can speak to delivery latency |
| **3.5 real-Discord smoke** | 🔴 NOT MET | **2/15 PASS, 1 FAIL (`/buzz`), 1 PARTIAL, 12 rows no mark speaks for** |
| soak clean for ≥ 24 h | ⚪ NOT MEASURABLE | 70 clean ticks; 90 needed |
| mutation NOT-APPLIED = 0 | ⚪ NOT MEASURABLE | 12 harnesses, 3 answer `--dry-check`; needs `--run-mutations` |

⛔ **THE FLIP IS NOT AUTHORISED, AND THE REASONS ARE NOT COSMETIC.** Three of the four reds are
about evidence that does not exist yet (a real-renderer S2 number, a finished smoke, three open
forensics classes); the fourth is a live misconfiguration that would turn the canary into the
member flip.

---

## E2 · Proposed flip-packet delta — **PROPOSED, NOT APPLIED**

Four changes to `06-flip-packet.md`. None is written into the file by this pass.

**1 · §1 states the ORDER as a numbered sequence, not two variables in a table.** The packet names
both variables; it does not say that setting them in the wrong order is the member flip. The
sequence above (narrow → verify in-process → enable) replaces the table rows.

**2 · §2.1's verification step reads the PROCESS, never `--kv`.** `railway variables --kv` answers a
question the packet is not asking. `canary_scope_readback.py` reads `commands.v2_channels()`
in-process and writes `evidence/canary-scope.json`; that artifact, not the CLI, is what the gate row
consumes.

**3 · A new §1b: the two concurrency ceilings.** A flip moves the canary channel from the pre-V2
path's `DISCORD_CHART_MAX_CONCURRENT=8` to the V2 worker pool's `DISCORD_RENDER_WORKERS=6`. Both are
live, neither is wrong, and today nothing tells whoever flips that the ceiling changes underneath
them. One sentence, with both `path:line`s (`SIZING-INVENTORY-2026-09-14.md` D1).

**4 · §0's generated table gains the renderer caveat in the row itself.** The S2 row can now read
NOT MET for a **measured admission breach** while its latency half is INCONCLUSIVE for a **structural**
reason (no local artifact can ever speak to the production renderer). Those are different facts and
the one-line row currently renders them as one. The gate already emits both halves; the packet's
generator needs to print the second.

⚠️ **AND A PREREQUISITE THE PACKET DOES NOT CURRENTLY NAME:** blank or align `FLOW_CMD_CHANNEL_ID`
before the flip, for the reason in E1. A canary that can silently lose its own channel is not a
canary.
