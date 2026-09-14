# 06 — Flip packet: turning Discord render V2 ON

**Read this alone.** It is written so the flip can be done with no other document open. Where it
names a number or a sentence it also names the file that owns it, so anything here can be checked
without trusting the packet.

Audience: the owner, or whoever is holding the pager. Everything below is one service (`web`), one
variable, and three commands.

---

## 0. ⛔⛔ THE GATE — and it is a COMMAND, not a checklist in this file

```sh
python docs/discord-render/instruments/flip_preconditions.py
```

**Exit 0 = every precondition MET · 1 = at least one NOT MET · 2 = at least one NOT MEASURABLE.**

⛔⛔ **A CHECKLIST TYPED INTO A DOCUMENT IS A CHECKLIST THAT DRIFTS, AND THIS PROGRAMME HAS THE
RECEIPT.** `docs/feature_flags.json` described an unreleased surface *while members were using it*
for a full day, because a ledger records INTENT and cannot see the world. So the table below is
**generated output pasted in with its date**, and the command is the authority. If they disagree,
the command is right and this section is what drifted.

### Authority

| Flip | Who | When |
|---|---|---|
| `DISCORD_RENDER_V2_CHANNELS=<canary id>` **then** `DISCORD_RENDER_V2_ENABLED=1` | pre-authorised to the integrating session | **only** when the command prints `ALL MET` |
| the **member-channel** flip | **the owner, and only the owner** | after reading the canary evidence |

⛔ **NOT MEASURABLE blocks the flip exactly as NOT MET does.** They are kept apart because what you
*do* about them differs — one is a defect to fix, the other is evidence to go and get — but neither
is a pass. Collapsing them is the defect `CoverageLine` exists to avoid.

### Reading as of 2026-09-14 16:32 ET — **organic members exposed to V2: 0**

⛔⛔ **THIS TABLE WAS LYING ON ITS MOST IMPORTANT ROW UNTIL 16:30 TONIGHT.** `check_s2_measured`
was `MET if the --real files exist`; it never opened them. The first `--real` runs in this
programme's history all printed `TOTALS load_harness FAIL`, and the row flipped to **MET** because
five files now sat on disk. **Producing failing evidence made the gate greener.** Three rows had
that shape (S2, chaos, 3.5) and all three now read verdicts. The reading below is the fixed tool.

| Precondition | State | Evidence |
|---|---|---|
| zero xfails in the forensics suite | ✅ MET | 0 `@pytest.mark.xfail` decorators |
| every forensics class closed with a commit | 🔴 **NOT MET** | 11/14. Open: **C-02**, **C-09**, **C-13** |
| the artifact cache is wired to the hot path | ✅ MET | `bindings` imports `artifact_cache` ⚠️ but see OI-38 — it did **not engage** under `--real` |
| soak clean for ≥ 24 h | ⚪ NOT MEASURABLE | **61** clean ticks of the 90 a 24 h window needs |
| `/chart` is shadowed (structural) | ✅ MET | and now **empirically** — the first `/chart` shadow records ever, 2026-09-14 19:58Z |
| **S2** measured in `--real` and within SLO | 🔴 **NOT MET** | 3 runs judged, **9 breaches**. Worst: `p50 14,855 ms > 2,500 ms`, `S5 35.7% (queue_full×81)` — **at 30 arrivals/second**. ⭐ At **1/s** (3.1c) S2 is **MET on all three percentiles**: p50 3.5 ms · p95 1,748 ms · p99 6,692 ms, 593 charts delivered |
| chaos passed in `--real` | ✅ MET | 7 scenarios passed for real, **6 refused by name** (refused ≠ passed) |
| 3.5 real-Discord smoke | 🔴 **NOT MET** | **only 2/15 rows PASS.** A partial smoke is not a smoke |
| `#render-alerts` locked to admins | ✅ MET | no `Contributor` allow overwrite — fixed 2026-09-14 |
| mutation NOT-APPLIED = 0 | ⚪ NOT MEASURABLE | pass `--run-mutations`. ⭐ `anchor_check` reads **316/316 ok, stale=0, ambiguous=0** |

**VERDICT: NOT MET — do not flip.** Four rows NOT MET, three NOT MEASURABLE.

⭐ **The S2 row is the one to read carefully, because its headline and its meaning differ.** Every
failure in every load phase was **`queue_full`** — never a timeout, never a render error, never a
breaker trip. `acks_over_3s` was **0 in all three phases**, so S1 held at 30 arrivals/second. The
bounded queue refusing excess work with an immediate named refusal is the design working; the SLO
counts those refusals as failures because the member got no chart, which is also correct.

⚠️ **And 3.1a's load is ~15× what the brief asked for (OI-37):** "30 concurrent" was implemented as
`--rate 30` = 30 arrivals **per second**. Both numbers are real; only one of them is the test that
was specified.

### ⛔ THE ROW THAT MATTERS MOST, STATED PLAINLY

**S2 HAS NOT BEEN MEASURED.** Every load figure this programme has produced ran `--symbols stub`
through a zero-cost handler: no symbol resolved, no bars fetched, no chart rendered, no PATCH sent.
Those numbers are real and they are about **S1, the acknowledgement path, and nothing else.**
⛔ Do not read them in a row labelled S2, and do not let the ack-path p99 stand in for a delivery
number — they are measurements of different things that happen to share a unit.

---

## 0b. State at the time of writing — measured, not remembered

Read **2026-09-13 20:44 ET / 2026-09-14 00:44 UTC**, from the running production process:

| Fact | Value | How it was read |
|---|---|---|
| `web` newest deployment | **SUCCESS** on `cda883387887…`, created `2026-09-14T00:41:31Z` | `railway deployment list --service web --json` |
| Running commit, in-process | `cda883387887` | `railway ssh` probe (§2.3) |
| `DISCORD_RENDER_V2_ENABLED` | **absent** from the running process | same probe |
| `RENDER_V2_SHADOW` | **`'1'`** — shadow mode is live | same probe |
| `DISCORD_RENDER_V2_ADAPTERS_ENABLED` · `DISCORD_RENDER_LOOPWATCH_ENABLED` | absent (= ON, and dormant while the master is off) | same probe |
| `/data/discord_render_jobs.db` | **does not exist** — V2 has never run in production | same probe |
| `DISCORD_RENDER_ALERT_WEBHOOK` | configured on `web` (private `#render-alerts`) | `railway variables --service web --kv`, key only |
| `RENDER_POOL_ENABLED` on chart-renderer | `1` | `railway variables --service chart-renderer --kv` |

⭐ **The absent jobs database is the proof that nothing has run**, and it is a better proof than a
zero job count — a zero count is also what a wrong query returns.

⚠️ **The two SHA rows are stamped readings, not standing facts.** Five workstreams push to this
repository and `web` deployed twice in the twenty minutes this packet took to write. §2.2 and §2.3
re-derive them in under a minute; the flag rows are what matter and they are what you re-check.

---

## 1. The one variable

```sh
DISCORD_RENDER_V2_ENABLED=1        # service: web.  Nothing else has to change.
```

With it unset, `api/services/discord_render/commands.py:49` returns `False` and the interactions
endpoint runs the pre-V2 path exactly. With it set, the V2 branch owns `/chart`, `/c`, `/charts`,
`/flow`, `/buzz` and the chart-message controls: a bounded queue on dedicated workers, durable job
leases that survive a `web` restart, a 15 s deadline that always tells the member something, and one
failure-message contract with a Retry button.

⛔ **Accepted OFF values are `0`, `false`, `off`, `no`, and the empty string**
(`commands.py:45`). Anything else — including `1`, `true`, `yes` — is ON. **An empty value is OFF**,
so "set it to blank" is a rollback, not a no-op.

---

## 2. The flip — set, wait for a NEW BOOT, then read it in the process

⛔⛔ **`railway variables --kv` shows what the service is CONFIGURED with. That is not evidence the
running process has it.** Measured on this project 2026-09-12: `--kv` reported a variable the running
pod still returned `None` for, because its redeploy had not swapped yet
(`docs/runbooks/deploy-windows.md`, "Verify a deploy by the ARTIFACT, never the config").

⛔⛔ **And `railway variables --set` has been measured behaving BOTH ways on this project** — staged
only on `chart-renderer` (2026-08-30), auto-redeploying on `web` (2026-09-09), with an explicit
`railway redeploy` 16 s later REFUSED as "currently building". Do not assume which one you got.

### 2.1 Set it — **the narrowing variable FIRST, and in its own command**

```sh
# 1. narrow V2 to the canary channel BEFORE the master flag exists.
railway variables --service web --set "DISCORD_RENDER_V2_CHANNELS=1549129739048853544"
# 2. only then arm the master flag.
railway variables --service web --set "DISCORD_RENDER_V2_ENABLED=1"
```

⛔⛔ **ORDER IS LOAD-BEARING AND THIS SECTION USED TO GET IT WRONG.** Until 2026-09-14 this step
set `DISCORD_RENDER_V2_ENABLED=1` **alone** and called the result an admin-only canary, while §4.0
below said in capitals that the canary is the admin channel. Both cannot be true:
`commands.enabled()` was one global boolean with **no channel dimension at all**, so that single
command sends every member's `/chart` in `#chart-flow-requests` to V2 in the same instant. It is
the member-channel flip — the one decision reserved to the owner — arrived at by following a
section headed "canary". `DISCORD_RENDER_V2_CHANNELS` (OI-35) is what makes the narrowing real.

⚠️ **Setting the master flag first, even for the seconds between two commands, is a member flip.**
`--set` has been measured auto-redeploying on `web`, so the window is a real boot, not a race.

⛔ **UNSET `DISCORD_RENDER_V2_CHANNELS` MEANS EVERY CHANNEL.** It narrows; it is not a second kill
switch. Do not read its absence as "the canary is off" — read it as "there is no canary."

**Verify the narrowing in the running process, not from `--kv`:**

```sh
railway run --service web -- python -c "from api.services.discord_render import commands as c; print(c.v2_channels(), c.enabled())"
```

### 2.2 Watch for a NEW BOOT — by timestamp, not by the command's exit code

```sh
railway deployment list --service web --json | head -40
```

You are looking for a deployment whose `createdAt` is **after** the `--set`, reaching `SUCCESS`.
Typical on this service: BUILDING → DEPLOYING → SUCCESS in about **2 minutes** (measured across
merges 1–5, `docs/discord-render/05-progress.md`).

**If no new deployment appears within ~3 minutes**, the `--set` staged instead of redeploying:

```sh
railway redeploy --service web --yes
```

A second, independent boot signal — `uptime_seconds` resets:

```sh
curl -s -A "Mozilla/5.0" https://uctintelligence.com/api/health
```

⚠️ Send a browser `User-Agent`. Cloudflare 1010-blocks raw `curl`/`python` agents on this domain.

### 2.3 Read the value **in the running process**

This is the only step that proves the flip. It is the recipe recorded in `LEDGER.md` (merge 2's loop
log) and it was re-run successfully while writing this packet:

```sh
# 1) build the probe payload (Git Bash)
printf '%s' 'import os;print("SHA="+(os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "")[:12]);print("V2="+repr(os.environ.get("DISCORD_RENDER_V2_ENABLED")));print("JOBSDB="+str(os.path.exists("/data/discord_render_jobs.db")))' | base64 -w0

# 2) run it in the pod (paste the base64 from step 1 where <B64> is)
MSYS_NO_PATHCONV=1 railway ssh -s web echo <B64> "|" base64 -d "|" /opt/venv/bin/python
```

Expected after the flip:

```
SHA=<the commit you expect>
V2='1'
JOBSDB=False        # until the first V2 job runs; True from then on
```

⛔ `MSYS_NO_PATHCONV=1` and the quoted `"|"` are both load-bearing. Without the first, MSYS rewrites
`/opt/venv/bin/python` and the probe prints nothing; without the second, `cmd.exe` reads the pipe
locally and reports "The system cannot find the path specified". Both failures look like a broken
pod rather than a broken command line.

⛔ **`python3` in that pod is the Nix system python and has none of the app's dependencies.** Use
`/opt/venv/bin/python`.

### 2.4 A third signal, if you want one without `ssh`

```sh
railway logs --service web | grep "discord-render V2 runtime up"
```

The lifespan prints `[startup] discord-render V2 runtime up: resumed=… abandoned=… loopwatch=…`
only when the flag is on (`api/main.py:7707-7717`). Absent line, no V2.

---

## 3. The switches UNDER the master

All of these already exist on the deployed code and **none of them needs to be set to flip**. They
are there so one thing can be sent back without sending everything back.

| Variable | Service | Scope | Unset means | Source |
|---|---|---|---|---|
| `DISCORD_RENDER_V2_CHART_ENABLED` | web | the chart commands (`:300`), the multi-chart command (`:316`), and **autocomplete for both chart and `/flow`** (`:266`) | **ON** | `commands.py:52-56` |
| `DISCORD_RENDER_V2_FLOW_ENABLED` | web | `/flow` | **ON** | `commands.py:332` |
| `DISCORD_RENDER_V2_BUZZ_ENABLED` | web | `/buzz` | **ON** | `commands.py:348` |
| `DISCORD_RENDER_V2_CONTROLS_ENABLED` | web | the chart-message buttons and select (`type 3`) | **ON** | `commands.py:355` |
| `DISCORD_RENDER_V2_SYMBOLS_ENABLED` | web | the symbol check at the ack (D-04 / OI-01) | **ON** | `commands.py:240` |
| `DISCORD_RENDER_V2_ADAPTERS_ENABLED` | web | the provider adapters (P2.1): per-dependency timeouts, breakers, the `min(timeout, remaining)` ceiling | **ON** | `adapters/switch.py:24-32` |
| `DISCORD_RENDER_LOOPWATCH_ENABLED` | web | the event-loop stall probe that feeds `loop_stalled` | **ON** | `loopwatch.py:39-45` |

**To kill one:** set it to `0` (also accepted: `false`, `no`, `off`).

⛔⛔ **All of these are unset = ON, deliberately.** A kill switch that defaulted OFF would make
*"nobody set it"* and *"somebody deliberately shut it down"* indistinguishable from outside the repo —
the ambiguity `project_feature_flag_ledger` exists to prevent, and the same polarity
`HUB_PREVIEW_ENABLED` already carries. There is nothing to kill while the master is unset, because
the V2 handlers are the only callers (`adapters/switch.py:5-9`).

⚠️ **One polarity footnote worth knowing before you type.** The per-command switches treat an EMPTY
value as OFF (`commands.py:45`); the two P2 switches do not (`switch.py:27`, `loopwatch.py:45` —
empty is ON there). Set `0`, never blank, and the difference never matters.

⛔ Turning off `DISCORD_RENDER_V2_ADAPTERS_ENABLED` is a **switch, never a delete**: the handlers
bind the raw upstream functions again, giving back the pre-adapter timeouts and no breakers. That
restores a measured live defect (OI-21: a 60 s renderer client timeout over two attempts behind a
15 s deadline). Use it only if the adapters are the thing that is wrong.

---

## 4. The canary, then the first ten minutes

### 4.0 ⛔ THE CANARY IS THE ADMIN CHANNEL, AND IT IS NOT OPTIONAL

**Organic members exposed to V2 today: 0.** Everything built in this programme has run against the
test channel and the harnesses; `/data/discord_render_jobs.db` does not exist in production, so no
member has ever been served by this path. That number is the reason the canary exists — every
measurement so far is of a rig, and the first honest measurement of the product is the first real
member.

**The order, and the whole point is that each step is reversible before the next one costs anyone
anything:**

| Step | Who is exposed | Leave it here for | What you are watching |
|---|---|---|---|
| 1 | You, in the private admin channel | **5 real sessions** (§4.4) | the chart arrives, once, with its controls |
| 2 | The admin channel, normal use | one full RTH open (09:30–10:00 ET) | acks, the 10015 count, the stand-in count |
| 3 | The guild | the rest of the session | the same, at ~750 members' volume |

⛔ **Do not move to the next step on a clean interval alone.** A quiet ten minutes and a working
system are the same observation when nobody is using it — count the *sessions*, not the minutes.
That is the mistake this programme has already made once, with a shadow that logged at the right
rate and said nothing.

### 4.0b The first five sessions — what PASSES, stated before you look

A session is one `/chart` by a real person in Discord, start to finish. All five must be true of
all five sessions; **one failure of any row stops the canary and you roll back**, because the
denominator is five and a 1-in-5 failure is a 20 % failure rate, not an anomaly.

| # | Criterion | Where you read it |
|---|---|---|
| 1 | The member sees a chart, **once** — not a stand-in that never healed | the channel |
| 2 | Ack under 3 s | `/renderhealth` → acks over 3 s must stay **0** |
| 3 | Delivered under 8 s (S2 p99) | `/renderhealth` → delivered p99 |
| 4 | **Zero** `10015` and **zero** `ATTACHMENT_NOT_FOUND` | `drender` events, `cls=ack_late` / `discord_rejected` |
| 5 | Every degraded delivery carries its label; every failure ends in a sentence | the channel — read what the member reads |

⚠️ Rows 4 and 5 are the two this programme exists for, and they are the two an interval-based check
cannot see. Row 4 is C-04/C-02 (46 finals that reached nobody). Row 5 is C-06 and C-11.

### 4.0c The verdict — the exact command

```sh
PUSH_SECRET=… python docs/discord-render/instruments/flip_verdict.py --confirm-observed
```

It reads `GET /api/discord/render-health` and prints a line per criterion, then **one** of three
words:

- `PASS` (exit 0) — every criterion held, across ≥ 5 sessions;
- `FAIL` (exit 1) — a criterion was measured false. Roll back (§5), then diagnose;
- `INCONCLUSIVE` (exit 2) — fewer than 5 sessions, a metric that could not be read, or the two
  observed rows not confirmed. ⛔ **Not a pass and not a failure.** Collapsing it into either is the
  defect `CoverageLine` exists to avoid: it means "go get more sessions", not "ship" and not
  "roll back".

⛔⛔ **`--confirm-observed` IS THE FLAG THAT SAYS YOU READ THE CHANNEL, AND WITHOUT IT THE ANSWER
IS ALWAYS INCONCLUSIVE.** Criteria 1 and 5 are not in any metric — C-06's three unlabelled stand-ins
were invisible to every counter in the system and obvious to anyone who read the message. The tool
names both rows and refuses to score them, on purpose: a verdict that quietly graded 3 of 5 rows
and printed PASS would be the instrument that hid them a second time.

`python docs/discord-render/instruments/flip_verdict.py --self-check` proves it can fail — 13 cases,
including the discriminator that a measured FAIL beats a short run (otherwise a real break inside
the first four sessions files as "not enough data" and the canary carries on).

### 4.1 What to open

**In Discord (admin):** `/renderhealth` — already registered into the guild, admin-only, and it
answers whatever the flag says (`api/routers/discord_interactions.py:375`; registration recorded in
`LEDGER.md` step 1.2b).

**Over HTTP:**

```sh
curl -s -A "Mozilla/5.0" -H "Authorization: Bearer $PUSH_SECRET" \
     https://uctintelligence.com/api/discord/render-health
```

⛔ Never paste the bearer into a document, a chat, or a commit. `GET /api/discord/render-health`
answers **401** without it (`discord_interactions.py:779-782`).

⭐ **In the first minutes the payload will say `"no jobs database yet (V2 has never run on this
volume)"`, and that is correct, not broken.** The route deliberately peeks and never creates the
database (`discord_interactions.py:786, 791`). It changes the moment the first V2 job runs.

### 4.2 The numbers that matter, and what each one means

| Field | Healthy | Source |
|---|---|---|
| `queue.interactive` | near 0; a standing backlog means workers are blocked | `observe.py:316-318` |
| acks over 3 s (1 h) | **0**. This is SLO S1's hard ceiling: Discord has already failed that interaction | `observe.py:233-234` |
| delivered p50 / p95 / p99 (chart, RTH) | 2.5 s / 5 s / 8 s targets (S2, `03` §1) | `observe.py:298-299` |
| success rate (1 h) | ≥ 99.5 % (S5), excluding `symbol_not_found` and `no_bars` | `contract.py:39`, `observe.py:231-232` |
| `stuck` | **0** — a job non-terminal 60 s after it was created | `observe.py:34, 157` |
| `breakers.*.state` | `closed`. `half_open` is recovery, not an incident | `observe.py:191-193` |
| `alerts[]` | empty | `observe.py:283-285` |

### 4.3 The alert keys — what each one means and what you do

Alerts post to `DISCORD_RENDER_ALERT_WEBHOOK` (private `#render-alerts`). The observer evaluates
every **60 s** and each key has its own **durable 30-minute cooldown** held in the jobs database, so
a restart cannot re-page you for the same thing (`commands.py:100-103`, `observe.py:358-367`).
⭐ An alert is recorded as sent only **after** Discord accepts it, so a failed POST does not buy 30
minutes of silence (`observe.py:353-356`). With a blank webhook the alert is still written as a
`drender` log event under the same cooldown.

| Key | Fires when | Means | Do this |
|---|---|---|---|
| **`ack_over_3s`** | any acknowledgement over 3,000 ms in the last hour (`observe.py:233`) | Discord closed those interactions; the member got nothing. This is the single worst signal in the first ten minutes | **Roll back (§5).** S1 allows zero of these |
| **`failure_burst`** | ≥ 5 failures in 5 minutes, listed by class (`observe.py:241-244`) | something broke wholesale; the classes name which upstream | If the classes are V2-specific (`deadline`, `internal`, `queue_full`) **roll back**. If they are `flow_*` or `renderer_unavailable`, it is an upstream and V2 is reporting it honestly |
| **`breaker_open:<dep>`** | that dependency's breaker is open — one key per dependency (`observe.py:206`) | `<dep>` is one of `bars · quote · flow · renderer · entity`. Requests are being refused without waiting, which is the point | Check that upstream. **Silence is the recovery signal** — there is deliberately no "recovered" push, because breaker state is per-process on a pod whose median life is 8.4 minutes (`03` §0) |
| **`loop_stalled`** | the worst loop-block reading ≥ 1,000 ms (`observe.py:37, 176`) | the ONE event loop was blocked. This is C-02, the failure that took out the ack and the renderer's page load together, 37× more often than chance | **Roll back** if it appears after the flip and was absent before. Then look at what else the pod is doing |
| `slo_final_p95` | ≥ 10 jobs in 30 min and p95 delivery > 8,000 ms (`observe.py:228-229`) | slow, not broken | Watch one more window before acting; check renderer `/health` and the breakers first |
| `slo_success` | ≥ 20 non-user-error jobs in an hour under 99.5 % (`observe.py:231-232`) | the SLO is being missed | Read `last_failures` for the classes, then decide |
| `stuck_jobs` | any job non-terminal after 60 s (`observe.py:235-236`) | the deadline watchdog did not close a job out — S7 says this should be impossible | **Roll back** and keep the jobs row: it is the forensic record |
| `renderer_not_ready` | chart-renderer not ready on 2 consecutive probes (`observe.py:237-238`) | the renderer is down; members are getting labelled stand-ins | Not a V2 fault. Check chart-renderer `/health` — `browser_connected` is the honest browser field, **`ready` is not** |

### 4.4 Do one real command yourself

Run `/chart NVDA`, `/flow SPY` and one chart button in the guild, and confirm: the image arrives,
the controls row is present, and the reply carries a correlation id you can find:

```sh
python tools/railway_env_logs.py --filter drender
```

⛔ Search for the bare word `drender`. Railway's log search silently matches **nothing** for a phrase
containing brackets — measured — which is why every event line carries an unbracketed token
(`observe.py:9-11`).

---

## 5. Rollback

### 5.1 Which levers are a variable and which need a deploy

| What you want gone | Lever | Code change? | Reaches the running process |
|---|---|---|---|
| **The whole V2 path** | `railway variables --service web --unset DISCORD_RENDER_V2_ENABLED` | no | **on the next boot** of the `web` pod — ~2–3 min |
| One command (`/flow`, `/buzz`, controls, chart) | set that `DISCORD_RENDER_V2_*_ENABLED=0` | no | on the next boot |
| The provider adapters only | `DISCORD_RENDER_V2_ADAPTERS_ENABLED=0` | no | on the next boot |
| The loop probe only | `DISCORD_RENDER_LOOPWATCH_ENABLED=0` | no | on the next boot |
| Alerting only | set `DISCORD_RENDER_ALERT_WEBHOOK` to blank | no | on the next boot; alerts continue as log events |
| Shadow mode | `railway variables --service web --unset RENDER_V2_SHADOW` | no | on the next boot |
| The renderer pool | `railway variables --service chart-renderer --unset RENDER_POOL_ENABLED` | no | next boot of **chart-renderer** — a different service, its own deploy |
| `/renderhealth` off the command list | `python tools/discord_chart_commands.py register --guild <GUILD_ID>` (i.e. **without** `--renderhealth`) | no | immediately — it is a Discord API call, not a deploy |
| Anything on the pre-V2 path (the route delegation, the render-token guard, `services/chart_renderer/app.py`) | **revert the commit and push** | **yes** | a full build + deploy |

⛔ **"No deploy" means no code change and no revert — it does NOT mean no restart.** A process's
environment is fixed when it spawns, so every variable above reaches the running pod only when a new
pod boots. Budget ~2–3 minutes and confirm with §2.2 + §2.3 exactly as for the flip. The reason the
switches are read per call rather than captured at import is that a pod which boots with the new
value then honours it on **every** request, with no second state to reason about
(`adapters/switch.py:16-18`).

### 5.2 What the rollback costs

Jobs still in flight at the moment of the restart are **not resumed**. The old pod releases their
leases on shutdown (`api/main.py:7760-7763`), but `resume_pending()` only runs inside the V2 lifespan
block (`api/main.py:7707-7708`), so with the flag unset nothing claims them. Those members' deferred
replies stay "thinking" until Discord expires the interaction. At the queue sizes involved that is a
handful of requests; it is the honest cost and it is smaller than leaving a bad path live.

Everything else is unaffected: the jobs database, its rows and its alert cooldowns stay on the volume
as the forensic record (30-day retention, tokens nulled at terminal state — `03` §3.3).

### 5.3 ⛔⛔ H15 — a failing post-deploy smoke is ROLLED BACK FIRST and DIAGNOSED SECOND

This is a standing rule in `CLAUDE.md` and it applies to this flip without modification.

1. **Roll back** — §5.1, top row. Do not open a browser to see how bad it is.
2. **Confirm the rollback took**, at the layer the failure appeared in (§2.2 + §2.3). Reading the
   variable back with `--kv` is not confirmation.
3. **Then** report, and only then diagnose. The branch will still be there; the member will not.

⛔ *"Let me just check one thing first"* is the failure mode this rule names. It exists because the
2026-09-10 navigation freeze was live for four and a half hours, almost none of which was spent
fixing it.

⚠️ **INCONCLUSIVE IS NOT FAILED, and must not trigger a rollback.** "We could not measure it" and
"it is broken" are different facts. A 502 during somebody else's concurrent deploy, a probe that
timed out, an empty log filter, a `railway ssh` that printed nothing — all of those are
*unmeasured*. Master merge 1 recorded exactly this: a 502 during another session's swap, classified
INCONCLUSIVE, no rollback, re-measured clean (`LEDGER.md` row 4). Rolling back on an unmeasured
deploy teaches everyone to stop running the check.

---

## 6. Two things to do in the same session as the flip

1. **Update `docs/feature_flags.json`.** Set `DISCORD_RENDER_V2_ENABLED` to `status: "armed"`, put
   `"web"` in `where`, and put the **flip timestamp** in the note. A flip is not finished when the
   process has the value; it is finished when the ledger says so. The ledger drifted for a full day
   once (`RESEARCH_TECHNICAL_TAB_ENABLED`) and two readers then disagreed about whether a live
   surface was live. Then run `python tools/flag_ledger_audit.py`.
2. **Ledger the flip** in `docs/discord-render/LEDGER.md` with the running SHA, the in-process read,
   and the member-impact paragraph — the same shape as every merge row.

---

## 7. The two-minute version

```sh
railway deployment list --service web --json | head -40            # settled SUCCESS, >150 s old
railway variables --service web --set "DISCORD_RENDER_V2_ENABLED=1"
railway deployment list --service web --json | head -40            # a NEW SUCCESS, created after the --set
MSYS_NO_PATHCONV=1 railway ssh -s web echo <B64> "|" base64 -d "|" /opt/venv/bin/python   # V2='1'
# /renderhealth in Discord · one /chart · one /flow · watch #render-alerts for ten minutes
# anything in §4.3 marked "roll back" →
railway variables --service web --unset DISCORD_RENDER_V2_ENABLED  # then re-verify the boot
```
