# Review r2 — PR #726 (W2-B1 RS-1 research.company), head 27e228693e

Reviewer: independent, read-only (no push/merge/flag change). Date 2026-11-03.
Scope: delta 73e97cce3c..27e228693e plus full diff vs origin/master (5d95103c8a). Synthetic text only; no market values.

## Verdict: APPROVE dark merge (no blocking items)

## B1 (web cache keyed by user+turn) — FIXED
- rs1.py `web_for_turn(ctx, query, recency, symbol)`: the slot stays keyed by (user, turn_id) for the one-call budget, but it now stores `what=(SYMBOL, query)`.
  - Same symbol and query: the result is shared.
  - Different symbol or query: returns `{"turn_used": True}` and makes no call. `assemble` adds UNKNOWN_WEB_TURN_USED, so another company's commentary is never served.
- Single-flight: the slot is claimed under the lock before the call, and followers wait on an Event (60 s timeout gives "no answer"). This also closes r1's check-then-call race.
- Test `test_at_most_one_web_call_per_turn_never_another_companys_commentary` passes.
- Residual (non-blocking, unchanged): turn_id is chosen by the client, so the real bound is budget.Meter.

## B2 (month-prefix regex) — FIXED
- `_MONTH_NAME` now matches only whole month names or abbreviations (with `\b`), and "May" only when capitalised (`(?-i:May)`).
- Probes (allowed = {142.1}), all now flagged:
  - "Shares declined 18%"
  - "Gross margin 75%"
  - "The market 40% rally"
  - "Decreased 9 points"
  - "It may 12 rise"
- Real dates still pass ("On May 12", "12 March").
- Residual (non-blocking; record in RS-1 §4.1): a 1–2 digit number next to a REAL month name is still treated as a date. "In June 30% fell." and "dec 9% lower" pass.
  - Minimal hardening: a `(?!\s*%)` lookahead after the day number in both month alternatives of `_DATE_NUM_RE`.
- r1's other non-blocking gate limits remain: years 1900–2099, sign, units, spelled-out numbers.

## (i) Headlines in sources[].title not figure-gated — NOT BLOCKING
- `sources[].title` is the verbatim UCT news-store headline (rs1.py facts_from_news, cut to 140 characters), attributed and dated. Master's `news.company` / headlines view already shows the member the same content, ungated.
- The one headline quoted inside a FACT IS figure-gated (assemble → `unconfirmed_figures` on each fact). A figure in it drops that fact.
- Web citations get `_host(url)` as their title, so no web prose reaches titles.
- Fix is docs-only: the RS-1 invariant should read "facts/interpretation never carry an ungated figure; sources are quoted third-party titles". No code change needed for dark.

## (ii) Research text replayed to the model unwrapped — FIXED in delta; NOT BLOCKING
- turn.py `outcome_for_model`: an outcome row whose `actions` contain `research.ask` now replays as `[UCT] <research_results>…</research_results>`.
  - It goes through `_block`, which escapes & < >, so an embedded `</research_results>` cannot close the block (the test asserts count == 1).
  - `_SYSTEM_TAIL` already declares everything in `<research_results>` as DATA, never instructions.
  - New test: `test_an_imperative_web_sentence_stays_web_commentary_and_replays_only_as_data`.
- Master v1 research, for comparison:
  - The Perplexity answer goes to the model inside `<research_results>` within the turn.
  - The model's reply, often a paraphrase of web text, is stored as the agent row, and `history_messages` replays it RAW as assistant text with no wrapper.
  - So master already replays web-derived prose unwrapped. The PR's research rows are wrapped, which is stricter than master and not a new risk.
- `research.ask` is not in LOCAL_ONLY_ACTIONS. That is correct:
  - Its facts are gateway figures from non-isolated kinds (quote/news/earnings/fundamentals/themes), the same class master already lets the model see via `quote` / `news.company`.
  - Model-isolated kinds refuse for purpose="research" at the gateway.
  - Local-only would only be needed if an isolated kind became an input; `test_no_input_kind_is_isolated_in_the_real_registry` guards against that.

## Gating / dark — CONFIRMED
- Production web: UCT_AGENT_DATA=1. UCT_AGENT_DATA_KINDS has 11 kinds: instrument.resolve, quote, quotes, bars.daily, fundamentals, earnings, news.company, themes, screen.run, screen.count, screen.saved. `research.company` is ABSENT.
- Server: gateway.read refuses unlisted kinds (test_default_off_refuses_before_any_read_or_web_call). No web call and no Meter reservation happen.
- Browser: `researchServed()` needs `data_kinds` to include research.company (+ instrument.resolve), so with the kind absent `registerResearchCapability` registers nothing. As a result:
  - the manifest is unchanged;
  - research.ask is never planned;
  - the `research` domain in the data group is empty;
  - the research view (AgentResult/present.js) is unreachable;
  - WIDE_VIEWS 'research' is inert.
- NOT flag-gated (non-blocking; minor user-visible changes):
  - routing.js: the `data` group title is longer ("…news and research…, why a stock is moving"). This is a prompt-text change wherever the group is offered, about 10 tokens, so negligible cost. The section_b and nl1 parity captures moved because of it.
  - The new words `what's driving` / `what is driving` route those messages to the data group (existing stock/news capabilities) even while dark. This is a small routing improvement with no new capability.
- kinds.py imports rs1 at load. rs1's top-level imports are stdlib + envelope only; budget/turn/gateway are imported lazily. No side effects.

## Scope (budget / limits / model ids / auth / F-16 / F-23 / providers) — PASS
- Files touched:
  - provider_licensing_class.py: +1 row, ("perplexity","research") class R, disclosure pending Stage 7.
  - marketdata/kinds.py: kind registration.
  - research/*.
  - section_b_requests.json.
  - turn.py: +4 lines in outcome_for_model.
  - App agent UI / capability / routing / present.
  - Docs, tests, nl1 parity fixture.
- No change to budget.py, entitlements, gateway.py, router auth, model ids, caps, or F-16/F-23 isolation code. A grep of the added lines finds no model id, cap constant, require_admin, api_key, os.environ, or HTTP client.
- No new external provider. The web leg reuses `turn._research` → perplexity_search.web_search via budget.Meter.research; the licensing row records that existing Perplexity use for this surface.

## Tests (targeted, worktree at 27e228693e; suite lock not taken)
- pytest: test_uct_agent_research_rs1 + all test_uct_agent_qa_* + contract + isolation_layers + isolation_lead_fixes + nl1 + routing + budget_isolation → 557 passed.
- vitest: agentResearch, agentContracts, agentIsolationL5, agentRouting*, agentPresentation (8 files) → 142 passed.

## Scratch merge onto origin/agent/rc/w11 (b22bb85a36) — 3 expected conflicts, all resolved cleanly
1. app/src/agent/routing.js: keep rc/w11's indicatorAlerts block (the R-04 cross/alert regexes and the "EMA / SMA crosses" title), plus #726's `data` group (title, `research` domain, `what's driving`). The file parses.
2. docs/agent/program/BOARD.md: union of both sides (rc's Wave 1.1 + Wave 2 tables, #726's rows). The integrator should dedupe the W2-B1 row (#726 now at 27e228693e).
3. api/services/uct_agent/scan/sat/section_b_requests.json: take the rc side, then RE-CAPTURE with `UPDATE_SAT1_REQUESTS=1 npx vitest run src/agent/agentScanSat1Requests.test.jsx`. About 60 lines move (the data-group title). Do not hand-merge.

- turn.py and tests/fixtures/nl1_assemble_parity.json auto-merged. The NL-1 parity vitest passes on the merged tree without a re-bless.
- Targeted tests after the merge:
  - vitest (SAT1 capture, NL1 selection, research, routing, contracts, isolation L5): 117 passed.
  - pytest (rs1, qa_*, contract, isolation_layers, nl1_selection, agent_eval_run, scan_sat_section_b): 512 passed.
- The merge was aborted; nothing was committed or pushed.

## Non-blocking follow-ups before flag-on
1. Month-adjacent % bypass: add the `(?!\s*%)` lookahead, plus tests.
2. Record headline titles as quoted third-party text in RS-1 §4.1.
3. Still open from r1:
   - planner `research` + `research.ask` in one turn (null `research` when research.ask is planned);
   - Perplexity member disclosure (Stage 7).
   - (The footer/live wording issue is addressed in the delta by LIVE_ONLY_MARKED.)
