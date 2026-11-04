# UCT Agent — Track D: advanced trading workflows (DARK)

Branch `agent/w4/trading-workflows`. Everything here ships **dark**: nothing registers, routes or reads until the
server switches it on. Each workflow is a deterministic computation over **existing** MD-1 kinds, read through the
existing gateway and its per-turn budget (8 reads). There is no new kind, route, model call, provider, spend, or
permission.

## The flag

`UCT_AGENT_WORKFLOWS` (server env, default **off**), defined in `api/services/uct_agent/workflows.py`:

| value | effect |
|---|---|
| unset, empty, `0`, `off`, `false` | no workflow (default) |
| `1`, `true`, `on`, `all` | every workflow |
| `relativeStrength,watchlistChanges` | only the named ones (staged activation) |

`GET /api/agent/config` answers `workflows: [names]`, and the browser reads it with `agentClient.serverWorkflows()`.
A workflow registers (`capabilities/workflowGate.js` `workflowServed`) only when **both** of these hold:
- its name is listed;
- the server serves the data gateway and lists every kind it reads (`data_kinds`, fail-closed).

While a workflow is registered, it adds its own routing words to its group (`armGroupWords`, the knowledge.js
pattern). Its reset removes exactly those words, so with the flag off routing is unchanged. `routing.js` is not edited.

## Isolation (F-16 / F-23)

The workflows follow the `stock.dailyBars` / `chart.describeSetup` contract.

Each workflow is a NON-local, served market **query**. UCT computes and words every figure in a fixed card, and no
model writes a number:
- The actions are in `turn.DATA_READ_ACTIONS`, so on a plan made only of these reads the server blanks the model's
  pre-read reply (`tests/test_uct_agent_workflows.py`).
- No workflow reads an isolated kind (`ratings`, `breadth.current`).
- Every `readData` call names a literal kind and passes `currentTurnId()`. The agent-qa static rails check both.

Every card follows the same rules:
- It names the sessions or the instant each figure comes from.
- It says "completed sessions only" where bars are used.
- It says plainly when data is stale, partial, or uneven.
- It ends **"Descriptive, not a recommendation."**
- A missing or unusable read answers in fixed words and states no figure. It never echoes the envelope's notes.

## Workflows

### 1. Relative strength — `stock.relativeStrength` (workflow `relativeStrength`)

**Why:** "Is it leading the market?" is the first question a momentum trader asks of a name. Today the member has to
eyeball it with Compare Symbols.

**Reads:** one `instrument.resolve` (both words), then two `bars.daily` reads (the stock and the benchmark), each of
n+1 bars or 253 bars.

**Computation:** `relativeStrengthOf`, pure. The two series are aligned on the session dates both of them hold. For
each window n:
- stock % and benchmark %, close to close;
- the difference in points;
- the ratio change, i.e. the RS line's change.

It also reports the RS line's position against its high over the longest window measured. The windows are the
member's n, or 5, 21, 63, 126 and 252 sessions. A window the bars cannot cover is named and never estimated.

**Benchmark:** the member's ticker, or SPY ("the market", "the S&P"). UCT never picks "the sector" for a stock. If the
member says "vs its sector" without naming a fund, UCT asks which ETF.

**Overlay:** the card suggests `compare SPY on this chart`, which is the canonical `chart.compare` (Compare Symbols).
The workflow itself changes no chart.

**Refusals (fixed words):**
- the stock's bars or the benchmark's bars are unavailable or refused;
- the two series share fewer than two sessions;
- the benchmark is the same symbol as the stock;
- the benchmark is "sector" with no fund named.

**Notes the card adds when they apply:** the window is not covered; one series ends earlier than the other; the data
is stale.

**Tests:**
- `app/src/agent/agentWorkflowRelativeStrength.test.jsx`: the computation, recomputed independently; refusals; stale
  and uneven data; the real panel on the fast path and the model path; dark-by-default; isolation; routing words.
- Capreg dark corpus `workflow.relativeStrength`: 4 phrasings at levels (a), (b) and (c).

### 2. What changed in my watchlist — `watchlist.changes` (workflow `watchlistChanges`)

**Why:** this is the daily habit question: "what moved in my list, and is there news behind it?" Today it takes a
scan of the Watchlist widget plus a News search per symbol.

**Target:** one of the member's saved watchlists. The fast path resolves a named list. With several lists and no
name, the model asks which.

**Reads:**
- one `quotes` read covering the list's first 50 symbols (the kind's own cap);
- at most five `news.company` reads (`limit: 25`), one per largest absolute mover.

That is 6 reads or fewer, inside the turn's 8.

**Computation:** `changesOf` and `newsCountOf`, both pure. It reports:
- counts of up, down and unchanged;
- the top three gainers and the top three decliners, using each quote row's own `change_pct` against the previous
  session close (never recomputed);
- news counts, only for items published in the 24 hours up to the snapshot's own `as_of`. When the page is full and
  the store has more, the count is a floor ("25+").

**Dating and wording:** the header names the snapshot instant in ET (always dated) and the session label. The card
never says "live" or "now". It shows counts only, never headline text (the News widget and `news.latest` show items).

**Refusals and notes:**
- quotes are unavailable or refused, or no symbol has a change: fixed words, no figure;
- the list is empty: nothing is read;
- per-symbol notes: no quote; no change figure; the list is longer than one read; quotes are stale; news ingest is
  behind; no news count is available.

**Tests:**
- `app/src/agent/agentWorkflowWatchlistChanges.test.jsx`: counts and movers, the news window and floor, the card,
  refusals; the real panel on the fast path (exact read list), the 50-symbol cap, the empty list and the model path;
  dark by default; isolation.
- Dark corpus `workflow.watchlistChanges`: 4 phrasings at levels (a), (b) and (c) on the WATCH board.

## Capability-regression (capreg) integration

The dark corpus lives in `app/src/agent/qa/capabilityRegression/baseline/corpus.dark.json`. It uses the main corpus's
schema and is run by `corpus.dark.test.jsx` at all three levels:
- routing;
- deterministic;
- final state through the real panel with the faithful scripted model.

These run under the **whole** catalog (`ALL_KINDS`; `testing/registry.js configFor` turns every workflow on only
there). They never run under production's configuration, where these capabilities do not exist.

The inventory and the coverage report count the dark intents (`testing/corpus.js catalogCorpus`). The Python
baseline lock (`tests/test_uct_agent_capreg_baseline.py`) does **not** cover `corpus.dark.json` yet; that is a
follow-up for the capreg owner.

## Activation checklist (owner)

1. Merge the branch dark. Flags unset means no change: there is no manifest delta and `manifest.golden.json` is
   unchanged.
2. On web, set `UCT_AGENT_WORKFLOWS=relativeStrength` (one workflow at a time). Check:
   - `/api/agent/config` lists the workflow;
   - an admin smoke test of the three phrasings above;
   - the card is dated and ends "Descriptive, not a recommendation."
3. Add the next workflow name. Roll back by unsetting the variable.
