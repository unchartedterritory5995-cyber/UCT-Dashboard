# SC-1 SAT-1 — the first interactive Scanner acceptance test

- **Owner:** agent-sc.
- **Tests:** SC-1 v1.1 on `agent/int` once #582 and #584 are integrated.
- **Where:** a **local sandbox only** (`scripts/hub_sandbox_boot.py`). It never runs against production. These features are dark in production and stay that way.
- **Data:** a **synthetic** screener universe seeded by `api/services/uct_agent/scan/sat/seed.py`. Tickers are `SY001…` and companies are "SAT synthetic …". It is not market data, so no answer in SAT-1 says anything about real stocks.
- **Expected values are measured, not typed.** The seeding tool runs the real SC-1 kinds against the seeded data and prints their answers. Compare the panel against that printout.

## 0. Before you start (one time)

| | |
|---|---|
| Machine | This box has **no `C:\data`**, so the sandbox cannot touch live data. The launcher still pins every data path into the sandbox and arms its write tripwire. |
| Port | **8095**. 8077 belongs to the hub sandbox. The launcher refuses a busy port; it never kills anything. |
| Model key | Steps **B2–B4** use the Agent's own planner, which makes real model calls billed to the existing **$5/ET-day Agent cap** (no new budget, no screener compiler). Set `ANTHROPIC_API_KEY` in this PowerShell window and boot with `--allow-model-keys`. **Without a key, run section A only.** Its requests take the no-model fast path. |
| Paid compiler | Leave `SCREENER_NL_COMPILE_ENABLED` **unset**. `/api/screener/compile` must never be called (step E2 checks). |

## 1. Build and boot (PowerShell, from `C:\UCT\agent-sc`)

agent-sc checks out the integrated commit in this worktree before SAT-1 starts and says so in its status file.

```powershell
cd C:\UCT\agent-sc\app
npm run build                         # builds app\dist; never npm install / npm ci
cd C:\UCT\agent-sc
$env:UCT_AGENT_DATA = "1"
$env:UCT_AGENT_SCAN = "1"
$env:SCREENER_LOGIC_ENABLED = "1"
Remove-Item Env:SCREENER_NL_COMPILE_ENABLED -ErrorAction SilentlyContinue
# only for section B (planner):  $env:ANTHROPIC_API_KEY = "<your key>"
C:\UCT\agent\.venv\Scripts\python.exe scripts\hub_sandbox_boot.py --data-dir 'C:\data-sat1' --port 8095 --test-email sat1@local.dev
# add --allow-model-keys for section B
```

⛔ The **first line** the launcher prints is the shared-root snapshot. It must say **CLEAN** (or NOT HASHED). If it doesn't, stop.

**Second PowerShell window: sign up and seed.**

```powershell
cd C:\UCT\agent-sc
curl.exe -X POST http://localhost:8095/api/auth/signup -H "Content-Type: application/json" -d '{\"email\":\"sat1@local.dev\",\"password\":\"Sat1Local2026!\",\"display_name\":\"SAT1\"}'
C:\UCT\agent\.venv\Scripts\python.exe -m api.services.uct_agent.scan.sat.seed --data-dir 'C:\data-sat1' --scenario fresh --member-email sat1@local.dev
```

**Keep the seed printout.** It lists the measured counts, `as_of`, `stale`, coverage and notes, plus "another member's screen id (must be REFUSED for you)".

**Browser:**
1. Open `http://localhost:8095/login` and sign in as `sat1@local.dev`. `ADMIN_EMAILS` makes this account an admin, and the Agent is admin-only.
2. Open `/charts`. In DevTools, run `window.__uctAgent(true)` and reload. The **UCT Agent** button appears; open the panel.
3. Keep the DevTools **Network** tab open, filtered to `agent/data|screener`.

## 2. Steps and expected results

Record PASS/FAIL beside each step. "Seed: X" means the value the seed printout shows for X.

### A. No-model requests (work without a key)

| # | Type in the panel | Expect |
|---|---|---|
| A1 | `show me my strongest stocks` | One `POST /api/agent/data` with `kind: screen.run`, `turn_id: t-…`, and **no** `/api/screener/scan`. The reply has a count, "Showing the first 10 by RS Rank", **"values as of the 2026-10-30 close (nightly), not live"** (the seed's session), and a coverage line whose numbers equal Seed: "A1 strongest" (with the fresh scenario, "Checked 121 stocks: 120 could be decided, 1 was excluded for stopped price history"; a sort is not a criterion, so no names count as missing a value), and a count equal to that line's answer. It never says "live" or "now". SYSTOP is absent. |
| A2 | `my saved screens` | `kind: screen.saved`. "Your screens: SAT Leaders, SAT Semis volume, SAT EMA cross (indicator) (can't run here: indicator-condition scans aren't available …)". **No** "SAT other member's screen". |
| A3 | `run my sat leaders screen` | `params: {saved_id: <id>, limit: 10}`, the **id only** and no spec. The reply begins "SAT Leaders:" and its count = Seed: "RS rank >= 90". |
| A4 | `run my sat ema cross (indicator) screen` | Refused: "indicator-condition scans aren't available …". **No rows**, and nothing is approximated. |
| A5 | In one message: `show me my strongest stocks` once, then again in a **new** message | Each message gets its own `turn_id` and its own scan. See B4 for two scans inside one message. |

### B. Natural-language screening (planner; needs the key + `--allow-model-keys`)

| # | Type | Expect |
|---|---|---|
| B1 | `find semiconductor stocks trading over twice their usual volume` | The spec has `industry in [Semiconductors]` and `vol_ratio ≥ 2`; count = Seed: "Semiconductors with vol_ratio >= 2". |
| B2 | Slang and units: `chip names up today`, `small caps under $2B`, `stocks trading over $50M a day` | The fields are the corpus's (d26, d22, d08). "$2B" becomes 2000000000 and "$50M" becomes 50000000 dollars, never share volume. Write down any wrong interpretation: it is NL-quality evidence for the corpus, not a SAT failure of SC-1. |
| B3 | Unsupported: `stocks where MACD just turned positive`, `EMA 9 crossing above EMA 20`, `put/call ratio above 2` | Each is refused or answered with "the Screener doesn't have …". **Never** a substituted field and **never** rows. |
| B4 | `screen for RS rank above 90, and separately screen for price above 100` | **Two** `/api/agent/data` calls with the **same** `turn_id`. The first answers; the second says "this turn already ran 1 scan". |
| B5 | Malformed: `screen for zorblax above 5` | Refused before any read ("the Screener has no field …"), with **no** `/api/agent/data` call. |

### C. Zero matches, empty universe, freshness

| # | Do | Expect |
|---|---|---|
| C1 | `show me stocks priced over $100000` (planner) or the seed's zero-match line | `0 stocks match`, "No names matched. Screener snapshot as of the 2026-10-30 close …". No table. Not stale. |
| C2 | Re-seed with `--scenario stale`, then A1 again | "This data is stale" and "3 sessions behind the last close". `as_of` is three sessions earlier. |
| C3 | Re-seed with `--scenario mixed`, then A1 | Stale, with "do not all run through the same session (oldest …)". |
| C4 | Re-seed with `--scenario empty`, then A1 | `0 stocks match`, with the note "could not say which session …". It is **not** marked stale and never claims a date. |
| C5 | Re-seed with `--scenario fresh` before continuing |  |

### D. Isolation and refusals (DevTools console, on the sandbox origin)

```js
const turn = 'sat1-manual-' + Date.now()
const read = (kind, params) => fetch('/api/agent/data', { method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, params, purpose: 'answer', turn_id: turn + kind + JSON.stringify(params).length }) }).then(r => r.json())
await read('screen.run', { saved_id: OTHER_ID })        // OTHER_ID from the seed printout
await read('screen.run', { text: 'rs_rank >= 90' })     // criteria text, deterministic grammar
await read('screen.run', { spec: { filters: [{ key: 'scan', op: 'in', value: ['x'] }] } })
```

| # | Expect |
|---|---|
| D1 | The other member's id is `refused`, "you have no saved screen with that id". Their screen's name and spec appear **nowhere** in the response. |
| D2 | Criteria text gives `status` ok/partial, `data.origin.source: "text"` with an explanation, and a count equal to A3's. |
| D3 | The `scan` key is `refused`, "indicator-condition scans aren't available …". |

### E. Flags off, no paid compiler

| # | Do | Expect |
|---|---|---|
| E1 | Stop the server (Ctrl+C). In the boot window, `Remove-Item Env:UCT_AGENT_SCAN, Env:UCT_AGENT_DATA`. Boot again with the same command. Reload, then A1. | The answer comes from the Screener's own route (`/api/screener/scan`) with **no** `/api/agent/data` call. The D-snippet reads all answer `refused`, "the Agent data gateway is off". |
| E2 | Across the whole run, filter Network for `compile`. | **Zero** requests to `/api/screener/compile`. |

## 3. Report

Send agent-sc each step's PASS/FAIL, the seed printouts, and anything unexpected, with a screenshot where wording matters. Then stop the server. `C:\data-sat1` can be deleted afterwards: it holds only synthetic data and the one sandbox account.
