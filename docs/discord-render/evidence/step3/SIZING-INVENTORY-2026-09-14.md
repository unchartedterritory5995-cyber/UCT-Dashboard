# D-02 Part D — the queue-sizing constants, where they live, and what production actually holds

> ⛔ **EVERY ROW BELOW IS A READ, NOT A RECOLLECTION.** Source column is `path:line` in this
> worktree at `41bf6a79c`; the live column is `railway variables --service web --kv`, read
> 2026-09-14.
>
> ⚠️ **`--kv` SHOWS WHAT THE SERVICE IS CONFIGURED WITH, WHICH IS NOT EVIDENCE THE RUNNING PROCESS
> HAS IT.** For every row here the configured value is *unset*, so the code default is what runs —
> and that is a claim about the DEFAULT, which is in the source and cannot drift from it. Where a
> value were ever set, this table would need an in-process read to be worth anything.

---

## D1 · Inventory

| knob | source | default | live on `web` | effective |
|---|---|---|---|---|
| render workers (`c`) | `api/services/discord_render/runtime.py:185` — `_int_env("DISCORD_RENDER_WORKERS", 6, 1, 32)` | **6** | unset | **6** |
| interactive queue depth | `runtime.py:186` — `_int_env("DISCORD_RENDER_QUEUE_MAX", 48, 1, 1000)` | **48** | unset | **48** |
| background lane cap | `runtime.py:187` — `_int_env("DISCORD_RENDER_BG_MAX", 2, 0, 16)` | **2** | unset | **2** |
| per-member IN FLIGHT | `runtime.py:188` — `_int_env("DISCORD_RENDER_PER_USER_MAX", 2, 1, 16)` | **2** | unset | **2** |
| per-member RATE | `api/services/discord_interactions.py:132` — `user_rate(default="12/60")` | **12 per 60 s** | unset | **12/60** |
| V1 render semaphore | `DISCORD_CHART_MAX_CONCURRENT` | — | **8** | **8** |

⚠️ **The last row is a DIFFERENT ceiling on a DIFFERENT path.** `DISCORD_CHART_MAX_CONCURRENT=8`
bounds the pre-V2 chart path; `DISCORD_RENDER_WORKERS=6` bounds the V2 worker pool. They are two
authorities over "how many charts at once", they do not agree, and which one applies depends on
whether V2 is on for the channel. **Neither is wrong today** — they govern different code — but a
flip moves members from the 8 to the 6 without anybody deciding to, and that belongs in the flip
packet rather than in a surprise.

⛔ **`_int_env` SILENTLY FALLS BACK TO THE DEFAULT ON AN OUT-OF-RANGE VALUE** (`runtime.py:38-43`):
`DISCORD_RENDER_QUEUE_MAX=0` or `=abc` both yield **48**, with no log line. An operator who sets a
knob wrong gets the default and no way to tell. Recorded, not changed — it is a real property of the
configuration surface and the flip packet should say so.

---

## D2 · Against the derivation

`arrival_census --analyze` over **19.94 days / 301 arrivals** derived, at the conservative service
basis (p50 taken as the *p95* of an unsaturated run, 1.748 s):

| | derived need | live | verdict |
|---|---|---|---|
| workers `c` | **4** | **6** | ✅ live exceeds the need by 50 % |
| queue depth | **≥ 6** (one whole 3× design burst) | **48** | ✅ live is **8×** the need |
| per-member | "leave as is" — the busiest 10 s held **1** request from any single member | 2 in flight, 12/60 | ✅ no change |

⭐ **THE SIZING WORK'S ANSWER IS "CHANGE NOTHING", AND THAT IS A RESULT.** Every axis is already
above what twenty days of real traffic requires. A recommendation to *raise* c to 4 would have been
a recommendation to lower it from 6.

⛔ **So `queue_full` at the design burst cannot be an undersizing problem, and one was measured.**
A 20-second shake-out at the design burst (0.6 arrivals/second, 13 offers) produced **one
`queue_full`** while the interactive queue held at most **1** item and six workers were idle.
Thirteen offers cannot fill a forty-eight-slot queue, so `q.put_nowait` cannot have raised
`queue.Full` — **that row did not come from `offer`.**

The other producer is `runtime.py:285`, inside `resume_pending`: a job a dead pod left behind that
cannot be re-queued at boot is closed as `queue_full` with `outcome="restart_recovery"`. A member on
that path is told *"we're at capacity right now"* about a restart. **The class is overloaded and the
message is false in one of its two meanings.**

⚠️ **NOT YET CONFIRMED, and deliberately not asserted.** The shake-out's sandbox store is gone, so
the deciding field (`outcome`) could not be read. The B3 sequence is running against a retained
store; the question is answered there or by a dedicated run, not by inference. Filed as **OI-40**.

⚠️ **AND THE GAUGE COULD NOT SEE.** That same run sampled queue depth **4 times in 21 seconds**
against a 0.5 s loop — ~40 expected. The depth figures above are therefore a floor, not a
measurement, and "max depth 1" means *the gauge caught 1*. The arithmetic (13 < 48) is what carries
the conclusion, not the gauge. ⭐ This is D-01's blinded-gauge defect in a second instrument, which
is why Part C's rail is a bound on BOTH sides plus a non-zero-sample control rather than a code
comment saying to keep the loop tight.

---

## D3 · Reaching `chart-renderer` from the operator PC — **INVESTIGATED, NOT EXECUTED**

`CHART_RENDERER_URL=http://chart-renderer.railway.internal:8080` is live on `web`. That hostname
resolves only inside Railway's private network, which is why every local `--real` run measures the
mplfinance fallback (OI-39) and why the D-02 contract rules such an artifact INCONCLUSIVE for S2
latency.

| option | what it would take | why it is NOT proposed |
|---|---|---|
| **A · `railway run` on the web service** | run the harness inside the pod's env | ⛔ It would put synthetic load on the **production** renderer, which every member shares. The directive names this a stop condition and it is the right call. |
| **B · Railway TCP proxy on chart-renderer** | expose the renderer publicly on a generated hostname | ⛔ A public door onto the renderer, guarded only by `CHART_RENDERER_SECRET`, opened for a test. The blast radius is every member's charts. |
| **C · a second chart-renderer service** | deploy a `chart-renderer-canary` from the same image | ⚠️ The honest option, and it is a **deploy**, not a local change. It costs a service and needs its own URL; it is the only path that yields a real S2 number without touching production. |
| **D · run the renderer locally** | it screenshots a page served by `web` | ⚠️ Needs a local Playwright/Chromium renderer plus a local `web` serving `/r/chart`. Measures THIS box's CPU, not the pod's — an S2 number from it would need that caveat attached to every quotation, which is how a caveat gets dropped. |

⭐ **RECOMMENDATION: C, and only when the owner wants a real S2 number badly enough to pay for a
service.** Until then the honest gate row is INCONCLUSIVE with the reason stated, which is what it
now says. **Nothing here was executed.**
