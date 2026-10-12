# NL Intent — Overnight Implementation (2026-10-12)

Branch `feat/agent-nl-intent-impl` (worktree `C:\w\nli`) on `docs/agent-nl-intent` (`fe11ebf779`, the
accepted architecture + corpus) on master = production `8179ab21be`. **Local only — not pushed.**
No paid calls; no `useAgent.js`, routing, prompt, history, persistence or UI change.

## Commits

| Commit | Slice | What |
|---|---|---|
| `2a22984fb8` | N1-safety | a pronoun is never a ticker ("add it to momentum" no longer adds IT) |
| `c4ca69a7b6` | N2 | typo-tolerant names: layouts, watchlists, saved screens, templates |
| `3ebca55cd1` | N3 | typo-tolerant instant commands from a registry-generated lexicon |
| `d8ca72a171` | N4 | grounded lowercase tickers + exact company names via the existing ticker search |
| `846750f1bc` | owner decision 1 | a bare chart command uses the valid clicked chart, else asks |
| `38ddf13d0c` | backlog (state-driven) | "add rsi to the amd chart" / "…the 5 minute chart" |

## Corpus (deterministic layers, `agentNlCorpus.test.js`)

| | Baseline `fe11ebf779` | After `38ddf13d0c` |
|---|---|---|
| Cases | 192 | 195 (+ambig-13/14/15 for the bare-command decision) |
| Ideal-fast reached | 48 / 94 | **67 / 95** |
| Typo cases resolved deterministically | 0 / 16 | **13 / 15** (typo-15 re-classed: destructive → model/proposal) |
| Deterministic misfires (WRONG) | 1 (ticker-09) | **0** (KNOWN_WRONG empty) |
| Routing misses | 3 / 48 | 3 / 48 (routing frozen — N6) |

Newly passing (by slice): N2 typo-06/07/08/20 · N3 typo-01/02/04/09/10/11/14/18/19 · N4 slang-04,
ticker-03 · bare-command ambig-13/14 (+ambig-15 asks) · qualifiers ambig-05/07. N1-safety removed the
only WRONG (ticker-09 → now goes to the model, which knows what "it" is).

Remaining ideal-fast misses and why (each is either deliberate, frozen, or needs new phrasing that the
owner ruled out — none is a misfire):
- needs a phrase not in the registry (owner: no new phrase lists): alt-03 "can you show me the weekly",
  alt-06 "give me the hourly", alt-07 "monthly view please", alt-11 "get rid of the volume bars",
  alt-13 "show pre and post market" (split at "and"), slang-01 "throw a 20 ema on it", slang-03 "kill the
  volume", slang-18 "scrap that", ws-02 "give me another chart", ticker-05 "spy daily", alt-24 "chart NVDA
  weekly", ambig-08 "make the bottom left one weekly", multi-09 "left chart weekly, right chart daily",
  ref-13 "only the first two", screen-10, mi-12, ind-15 "add the 10 and 20 sma".
- two capabilities claim it (genuinely two readings → model): alt-16 "put RSI on my chart"
  (watchlist.add vs indicator.add), ws-13 "show my momentum watchlist" (open vs list contents).
- Indicators catalog contract (N7, below): ind-01 "add bollinger", ind-11 "add stochastics".
- no instant phrase for indicator.hide/show: ind-07.
- deliberate: typo-03 "ad" (2-letter words are never corrected), typo-05 "pls" (3-letter fillers).
- harness state: screen-02/06, ref-06 (`needsState`).

## Safety evidence

| Requirement | Test |
|---|---|
| Pronouns never tickers (it/this/them/all/one…; IT only when marked: `$IT` or capitals in a lowercase message; all-caps messages mark nothing) | agentNlTickers "pronouns are never tickers" (13) |
| Never guess between targets: name ties ask; typo readings with two different actions → nothing; ambiguous company → asked; two NVDA charts → asked | agentNlNames tie tests; agentNlTypos "cancel \| candle"; agentNlTickers "alphabet"; agentDeixis qualifier tie |
| Stricter thresholds for high-impact: rename/copy STRICT (1 edit, 5+ letters) and still proposals; templates only ever ASK; destructive results never come from a typo correction; deletes have no instant phrase | agentNlNames "HIGH-IMPACT", template test, delete test; agentNlTypos "destructive" |
| Fuzzy never bypasses permissions/protection: a protected layout reached through a typo is still refused | agentNlNames "protected layout reached through a typo" |
| No substitution of a different instrument: look-alikes (Apple Hospitality REIT, leveraged NVDA ETF) never win; exact tickers never re-interpreted; tickers never typo-corrected | agentNlTickers N4 suite; agentNlTypos ticker test |
| Stale chart selections: closed chart / layout switch → asks | agentDeixis "closed chart"; thisChart e2e "after a layout switch" |
| Approvals never typo-corrected ("yse", "do itt") | agentNlTypos |
| Real UI state, not replies | real ChartsWorkspace e2e (thisChart: which chart's timeframe changed); commitPlan checks of chart symbol and watchlist contents |
| False-positive sweep | 60 look-alike sentences ("weakly bullish", "cancel that order", "go long", "candle patterns"…) → no correction; corpus-wide "a correction never fires on a model/question case" |
| Production builds | esbuild-minified phrase source keeps every regex/string word and drops comments (checked) |

## Test suites

`npx vitest run src/agent src/components/chart/builder/agentMutations src/pages/charts` (the deploy
gate's Agent suites + all chart-workspace tests) at the branch head `38ddf13d0c`: **185 files, 2,362 passed, 0 failed**.
`pytest tests/test_uct_agent*.py`: **268 passed** (no server file changed). `ScanObjectCard.test.jsx` timed out
under machine load in two intermediate full runs and passes alone (5/5) — unrelated to this branch.
Lint: zero new problems in every changed source file; new tests carry only the repo-wide test-globals baseline.

## Frozen seams (documented, not built)

1. **N1 typed answers** — needs `useAgent.send` (Response Experience owns message handling).
   Seam: pure `agent/nl/answer.js resolvePendingAnswer(pending, text, host)` → `{pick: ref} | {all} |
   {dismiss} | {changed}` (ordinal "2"/"the second", position word, symbol/label token, label typo via
   nl/match); ONE call at the top of `send` when `pendingRef.kind === 'target'`, feeding the existing
   `chooseTarget`. Also record local questions WITH their choices (outcome text only).
2. **N5 reference context** — a `recent` context provider (last executed change: actions, target
   labels, args digest; last listed set: ordinal → id) needs ONE host accessor fed by the runtime's
   receipts in `useAgent` (shared conversation state) → after Response Experience.
3. **N6** — routing on lexicon-corrected text + live-name group hints (`routing.js`); clarify-with-
   choices when the model names an unknown target (`turn.py` sanitize + panel). Both frozen.
4. **Telemetry** — `fastParse(...).corrected` is returned but `useAgent` does not record it yet
   (frozen file): one field in the fast-path `record()` call when ownership allows.

## N7 — Indicators catalog contract (proposal; no Indicators file was edited)

Needed so "add bollinger", "add stochastics", "add bollies", "add macd 12 26 9" resolve without the model:

```ts
// components/chart/engine catalog rows (catalogRows / nativeRegistry definitions) — ADDITIVE fields
type CatalogRow = {
  id: string; name: string; inputs: Input[]          // existing
  shortName?: string                                  // existing on some defs ("BB") — expose it
  aliases?: string[]                                  // NEW: common member names, lowercase
                                                      //   bb: ['bollinger', 'bollinger band'], stoch: ['stochastic'],
                                                      //   macd: ['macd histogram']?  (Indicators decides)
  positionalInputs?: string[]                         // NEW: input keys in the order traders say numbers
                                                      //   macd: ['fast','slow','signal'], bb: ['period','stdDev']
}
```
Agent side (after the contract lands, Agent-owned): `indicatorEdits.defIdOfWords` matches name →
shortName → aliases through `nl/match` (plural-insensitive); `settingsOfWords` maps "macd 12 26 9" onto
`positionalInputs` (only when the count equals the list length; otherwise the model). The lexicon then
picks the aliases up automatically (it already reads the catalog).

## Recommended integration order

1. Agent integration review of this branch (6 commits; no shared-file overlap with Response Experience:
   it touches stock/news/breadth/useAgent/turn/store/AgentPanel/AgentResult/present.js; this branch
   touches watchlist/layout/screener/chart/workspace/fastPath/deixis + new nl/*).
2. Land after (or before) Response Experience — no textual overlap; re-run the Agent gate on the merge.
3. Then, with ownership reassigned: N1 typed answers + telemetry (useAgent), N5, N6.
4. N7 when Indicators adds catalog `aliases` / `positionalInputs`.
5. Real-model corpus replay (owner $, capped) once N1/N5 land, to measure the model-path cases.
