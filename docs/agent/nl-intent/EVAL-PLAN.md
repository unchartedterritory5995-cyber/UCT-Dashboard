# UCT Agent — Natural Language & Intent Intelligence · Evaluation Plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). Everything here is local and free except §4, which
needs owner authorization.

## 1. The corpus

`app/src/agent/__fixtures__/nlIntent/corpus.json` (version 1, 192 cases), plain JSON so the browser
harness and the Python replay tools read the same file.

- **Fixtures** (5 boards): `one_chart` (NVDA daily + a Watchlist widget showing Momentum),
  `two_charts_sel_left` (NVDA D / AMD W, left clicked), `two_charts_nosel`, `same_symbol_two_tf`
  (NVDA D / NVDA 5m), `four_charts` (SPY/QQQ/IWM/NVDA, bottom-right clicked). Shared library: layouts
  Swing Board (open), Day Trading, Earnings Week, Main Trading (protected), UCT Default; this tab's
  previous layout = Day Trading; watchlists Momentum / Swing / Earnings Plays.
- **Categories** (14): alt-phrasings 25 · slang 18 · typos 20 · tickers 12 · indicators 15 · screener 12 ·
  market intelligence 12 · workspace 15 · ambiguous targets 12 · references/follow-ups 15 · multi-step 10 ·
  recovery 8 · conversation 8 · safety 10.
- **Each case**: `text`, `fx`, optional `hist` (prior turns, as the model's history would show them),
  optional `pending` (a UCT question waiting for an answer), and `expect`:
  - `kind`: act · propose · clarify · answer · unsupported · refuse · undo · dismiss · research
  - `ideal`: **fast** (should resolve with no model call) · **model** · **local-clarify** (UCT asks itself)
  - `ops`: `[{a: action, t?: target hint, args?: subset}]`, optional `alt` (equally correct plans)
  - `groups`: action groups the correct plan needs (routing recall)
  - `clarifyAbout`, `safety` (`propose` = must never apply directly), `why`, `needsState`
- Expectations state the **correct** outcome, not today's behaviour.

## 2. Layer A — deterministic harness (free, CI, runs today)

`app/src/agent/agentNlCorpus.test.js` (in the Agent gate's `src/agent` glob):
- builds each fixture with the REAL `buildChartSource` (positions, labels, clicked chart) and the
  shared `__fixtures__/board.js` (layouts, watchlists, this tab's layout trail);
- runs the REAL `fastParse`, the panel's target rules (all / position / deixis via `resolveDeictic`),
  and `selectGroups`;
- classifies each case: `fast-correct`, `fast-asks`, `to-model`, `needs-state`, `not-measured`
  (pending questions), **`fast-WRONG`** (the fast path acted wrongly — no model involved);
- prints a per-category table; `AGENT_NL_OUT=<file>` writes the rows.
- **Fails only** on a malformed corpus or a NEW deterministic misfire. `KNOWN_WRONG` is shrink-only.

Baseline (2026-10-12, master `8179ab21be`, `baseline-2026-10-12.json`):

```
cat      n  idealFast fastOK toModel WRONG routeMiss/checked
alt      25        24     17       8     0     0/3
slang    18         5      1      17     0     0/10
typo     20        16      0      20     0     1/6
ticker   12         4      1      10     1     0/4
ind      15        10      6       9     0     0/1
screen   12         4      1      11     0     1/6   (2 need session state)
mi       12         1      0      12     0     0/10
ws       15        10      8       7     0     1/7
ambig    12         7      6       6     0     0/0
ref      15         4      2      13     0     0/1   (1 needs session state)
multi    10         4      3       7     0     0/0
recover   8         1      1       1     0     0/0   (6 need a stored question → Layer B)
talk      8         2      2       6     0     0/0
safety   10         2      2       8     0     0/0
TOTAL   192  ideal-fast reached 48/94 · WRONG 1 (ticker-09) · routing misses 3/48
```

## 3. Layer B — the real panel with a scripted model (free, per slice)

The existing `agentEval.test.jsx` pattern: the REAL panel, planner, runtime, receipts and Undo against
the in-memory UCT, with a manifest-aware scripted model. For NL slices it adds corpus-driven tasks that
need state Layer A cannot hold:
- **recover-***: a stored local question (pendingRef) + a typed answer → assert which chart/list
  actually changed and that NO model call was made;
- **references** (N5): a scripted model that plans ONLY from the `recent` context section → assert the
  right target changed (proves the context carries enough, independent of model prose reading);
- **safety**: typo'd destructive targets → a question, nothing deleted; approvals never bypassed.
Assertions are on **UI state** (widget opts, list contents, the open-layout pointer, Dock aria-current)
and call counts — never on reply wording. The real-workspace rigs from Phase 1
(`ChartsWorkspace.previousLayout.test.jsx`, `ChartsWorkspace.thisChart.test.jsx`) are the template for
anything that needs the real ChartsWorkspace.

## 4. Layer C — real-model replay (needs owner authorization and a key)

Reuses the shipped capture → replay tools (no new harness):
1. **Capture (free):** a capture test in the `agentLiveCapture` / `agentSmokeCapture` pattern builds the
   exact `/api/agent/turn` body for every model-path corpus case (fixture context, routed manifest,
   `hist` as stored turns) with no model call, and writes them to a JSON file.
2. **Dry run (free):** `tools/agent_live_batch.py BODIES.json` prints sizes and the worst-case cost.
3. **Run (paid, capped):** `--run --max-usd <cap>` sends each body once through the server's own
   `turn.run_turn` (research off), stops before any call whose worst case would pass the cap.
4. **Score (free):** each envelope is compared with `expect`: disposition, actions (order-insensitive
   where the plan allows), target hint → context ref, args subset, unnecessary clarify, missed clarify,
   and safety (a `safety: propose` case must never come back as an applied destructive op).

Cost estimate (Phase 2 pricing, claude-haiku-4-5: $1 / $5 per million input / output tokens; measured
prompts 8.4k–16.4k tokens): the ~140 cases that reach the model today × ~12k ≈ 1.7M input ≈ $1.70,
plus output ≈ $0.20 typical (≤ $1.45 if every call hit the 2,048-token cap) → **≈ $1.90 typical,
≤ $3.15 worst**; recommend a hard cap of $3.50.

## 5. Metrics and slice targets

| Metric | Baseline | Target after N1–N5 |
|---|---|---|
| Ideal-fast reached (Layer A) | 48 / 94 | ≥ 80 / 94 |
| Typo cases resolved deterministically | 0 / 16 | ≥ 12 / 16 |
| Deterministic misfires | 1 | 0 (and KNOWN_WRONG empty) |
| Typed answers resumed locally (Layer B) | 0 / 7 | ≥ 6 / 7 |
| Destructive typo → question, never applied (Layer B) | n/a | 100% |
| Routing misses (after N6) | 3 / 48 | 0 |
| Model-path correct plans (Layer C) | unmeasured | measured once before N1, re-scored after N5 |
| Unnecessary clarifications (Layer C) | unmeasured | ≤ 5% |
| Approval / Undo violations | 0 | 0 |

## 6. Regression rules

- Every NL change adds or flips corpus cases; the corpus only grows.
- `KNOWN_WRONG` only shrinks; a new deterministic misfire fails the Agent gate.
- Layers A and B run in the existing gate (`npx vitest run src/agent …`); no new workflow (the deploy
  gate test forbids other workflows from running the Agent suites).
- Layer C is never run without a fresh owner authorization and a hard cap; its scores are recorded in
  this folder with the date and model.
