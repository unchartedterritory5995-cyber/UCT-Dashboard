# D-03 Part 1 — a canary chart-renderer: design, blast radius, and the decision it needs

> **NOTHING WAS DEPLOYED. NO LOAD WAS RUN.** This is 1.1–1.5 plus the 1.7 conclusion.
> Every row is `path:line` from this worktree at `c8feca114`, or a live `railway` read.

---

## 1.1 · What the canary would have to copy, and what it must not

| fact | where | consequence for a canary |
|---|---|---|
| `POST /render {url, selector, width, height, scale, settle_ms, ready_js, probe_js}` — **the CALLER supplies the URL** | `services/chart_renderer/app.py:3`, `:205`, `:333` | ⭐ The renderer does not choose what it screenshots. **Whoever calls it does.** This is the single most important fact in this document. |
| `check_url` refuses anything but **https** on an **allowlisted host** | `app.py:231-239` | a canary can only render hosts named in `RENDER_ALLOWED_HOSTS` |
| `RENDER_ALLOWED_HOSTS` default `uctintelligence.com,web-production-05cb6.up.railway.app` | `app.py:77-78` | both entries are **production web** |
| `RENDER_MAX_CONCURRENT` default **2** | `app.py:79` | ⛔ a canary renderer cannot be driven above 2 concurrent renders whatever the harness asks for — the S2 ladder's top rungs are bounded by the renderer, not by the load |
| the render token travels as an **`X-Render-Token` header**, never in `page_url`, never in the JSON body | `api/services/discord_chart_house.py:305-318` | copy the header discipline exactly |
| **C-13 redaction lives in the renderer's own source**: `scrub()` strips every query string and `token=/secret=/key=` pair; `url_path()` logs paths only | `app.py:160-170` | ⭐ **1.1's question answered: yes, the rail covers a second service** — because it is CODE, not configuration. A canary built from this source inherits it. A canary built any other way does not. |
| `CHART_RENDER_BASE_URL` (default `https://uctintelligence.com`) is read by the **caller** | `discord_chart_house.py:299` | which `web` serves `/r/chart` is a **caller** decision, not a renderer one |
| `chart-renderer` has **no repo source**; it deploys by `railway up` from a local directory | OI-12, ledger | ⭐ **1.4 answered: creating a canary renderer cannot redeploy `web` or `flow-worker`** — it is not repo-connected, so no push reaches it and nothing it needs lives in a path `web` watches |
| there is no `.dockerignore` / `.railwayignore`, and nixpacks builds the whole repo | `nixpacks.toml` | `docs/**` — and therefore `load_harness.py` — **is present in the `web`/`worker` image** |

---

## 1.2 · What page would it screenshot, and who pays

⛔ **THE CATCH THE DIRECTIVE NAMES IS REAL AND IT IS WORSE THAN IT LOOKS.** `chart-renderer`
screenshots a page **served by web**. A canary renderer relieves the production *renderer* and moves
none of the *web* cost — and C-02 is precisely "web saturation → acks miss 3 s".

| option | who serves `/r/chart` | web | chart-renderer | flow-worker | members |
|---|---|---|---|---|---|
| **(a)** canary renders production web | **production web** | ⚠️ **one page load + `/api/bars` per render.** Bounded by `RENDER_MAX_CONCURRENT=2`, so ≤2 concurrent page loads — small, but **not zero**, and it is the C-02 path | ✅ zero | ✅ zero | ⚠️ exposed to (a)'s web cost |
| **(b)** canary renders its own `web-canary` | a **second full web service** | ✅ **zero** | ✅ zero | ✅ zero | ✅ zero |
| **(c)** static export of the page | — | ✅ zero | ✅ zero | ✅ zero | ✅ zero |

**(c) is ruled out by the code, not by preference.** `/r/chart` is a live React page that fetches
`/api/bars` and signals readiness through `house_ready_js` (canvas count + `__chartBarCount`). A
static export renders no canvas, so `ready_js` never resolves and every render times out. A screenshot
of a page that fetched nothing is not an S2 measurement of anything.

**(b)'s deploy cost, stated honestly.** A second service running the whole FastAPI app **and** the
React build (`nixpacks.toml` runs `npm run build`), with its own empty `/data`, plus
`RENDER_ALLOWED_HOSTS` extended on the canary renderer to name it.
⛔⛔ **And its env would arm schedulers.** This is the exact hazard `CLAUDE.md` already rejected for
Railway PR environments: *"a booted clone posts to a ~750-member Discord channel, publishes to
YouTube, and emails members via Resend, all on live credentials."* Every flag would have to be
explicitly off, and "explicitly off" is a list nobody has derived for this app. **That derivation is
itself a piece of work, and it is the real cost of (b) — not the compute.**

**Recommendation: (b), and only with the kill-list derived first.** (a) is cheaper and its blast
radius is small but non-zero on the one path C-02 is about; (b) is the only option where production
web sees nothing, and its cost is honest work rather than a risk to members.

---

## 1.3 · Reachability — determined, not assumed

The harness must reach `chart-renderer-canary.railway.internal:8080`. The operator PC cannot resolve
`*.railway.internal` (measured in D-01, unchanged).

| path | inside the private network? | cost | restarts anything? | artifacts back to the repo |
|---|---|---|---|---|
| **`railway run`** | ❌ **no** — it runs the command **locally** with the service's env injected. It does not join the network. | — | no | — |
| **`railway ssh` into `worker` or `bars-api`** | ✅ yes | ⛔ **consumes a production pod's CPU.** `CLAUDE.md`: *"NEVER run the report card / any heavy script on the prod pod — OOM ⇒ member outage (2× 8/28)."* A load harness driving renders is a heavy script. `worker` runs the bars prewarmer. | no restart, but contends | copy/paste out of an ssh session |
| **a dedicated one-off harness service** | ✅ yes | a **third** new service; needs the repo image (it has `load_harness.py`), and a way to return artifacts — it would have to print them to logs or POST them somewhere | no | awkward; logs are the only channel |
| **public exposure of the canary + token** | ✅ | ⛔ **NOT ACCEPTABLE — C-13 class.** The directive says so and so does this programme's own history. | — | — |

⛔⛔ **EVERY PATH EITHER LOADS PRODUCTION WEB, CONSUMES A PRODUCTION POD, OR EXPOSES THE CANARY.**
There is no fourth door that I could establish. `railway ssh` onto a non-web, non-flow-worker
service is the closest to acceptable and it still spends a production pod's CPU on a load harness,
which this repository has an explicit, twice-paid rule against.

---

## 1.4 · Deploy mechanics — would creating it touch web or flow-worker?

**No, and the reason is structural rather than a setting anyone has to remember.** `chart-renderer`
is not repo-connected (OI-12): no push deploys it, and `railway up` targets one service by name. A
canary renderer created the same way is likewise invisible to every push. ⚠️ The **one** thing that
would change that is connecting the canary to the repo for convenience — which would give it watch
patterns and put it in the push path. **Do not.**

⚠️ Option **(b)** is different: a `web-canary` built from the repo WOULD be repo-connected unless
deliberately configured otherwise, and its watch patterns are a **[DASHBOARD]** setting. That is the
step in this design most likely to go wrong quietly.

---

## 1.5 · Runbook — written, deliberately not executed

1. **[KEYBOARD]** `railway up --service chart-renderer-canary` from a clean checkout of the exact
   merged commit, **after hours** (OI-12's discipline). Not repo-connected.
2. **[DASHBOARD]** env, **every secret by reference, never inline**:
   `CHART_RENDERER_SECRET` (same value as production — it gates `POST /render`),
   `RENDER_ALLOWED_HOSTS` (production web only, until (b) exists),
   `RENDER_MAX_CONCURRENT=2` (do not raise — see 1.1).
   ⛔ `CHART_RENDER_TOKEN` is **not** set on the renderer; it belongs to the caller and rides as a
   header.
3. **Verify the running SHA in process**, not from the dashboard: `GET /health` on the canary from
   inside the network and compare its reported build to the commit deployed.
4. **Rollback**: delete the service. Nothing else references it — no `CHART_RENDERER_URL` anywhere
   points at it until a harness is told to, so there is no window in which production can drift onto
   it.

**Charter-executable:** none of it. Step 1 is a deploy; step 2 is the dashboard.

---

## 1.7 · ⛔ THE CONCLUSION: S2 is INCONCLUSIVE — REQUIRES OWNER DECISION

A canary renderer **cannot yield an S2 number** without one of: loading production web, spending a
production pod's CPU on a load harness, or exposing the renderer publicly. Two are stop conditions
and the third is a rule this repository has paid for twice.

**The alternatives, listed and NOT chosen:**

| # | option | what it costs | what it risks |
|---|---|---|---|
| **A** | a **scheduled off-hours bounded run against production chart-renderer** | nothing to build | the market is closed and organic arrivals are **0.92 % of minutes** (census), so the window is genuinely quiet — but it is production, and the directive names it a stop condition unless the owner lifts it |
| **B** | **web-canary + canary renderer** (option (b) above) | two new services **and** a derived scheduler kill-list | the kill-list is the real work; get it wrong and a clone emails members |
| **C** | accept **`#render-smoke` itself** as the S2 instrument | nothing | ⚠️ it measures a **human typing**, so n is small and the percentiles are weak — but it is the only path that is already authorised, already private, and already has 0 organic members |
| **D** | **leave S2 INCONCLUSIVE** and flip the canary without a latency number | nothing | the flip packet's S2 row never goes green; the canary itself becomes the measurement |

⭐ **C and D are the same path a week apart**, and between them they are the only options that need
no deploy and no stop-condition waiver. **I am not picking.**
