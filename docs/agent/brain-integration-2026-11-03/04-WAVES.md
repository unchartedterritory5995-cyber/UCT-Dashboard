# 4 — Wave 2 and Wave 3 opportunities (objective 10)

Packages and acceptance prompts are quoted from `docs/agent/audit-2026-11-02/04-MASTER-PLAN.md` §3 and `07-SCORECARD-AND-EVAL.md` §3. Nothing here stops or duplicates the builders' work; each row names the knowledge kind that would make an existing acceptance prompt better, and whether it needs a decision first.

## 4.1 Wave 2 (P2 Market Analyst, P3 Scanner & Workflows, P4 Research & News, P6 Whole-site Operator)

| Package | Acceptance prompt (plan of record) | What the brain adds | Kind | Needs |
|---|---|---|---|---|
| P2 | "how has NVDA behaved after earnings gaps of 5 %+" (event study, value-free to the model) | beside the event study: the firm's EP playbook (what UCT means by an EP, the trigger and stop kinds) and the EP base rate the dashboard already computes (`ep_base_rate.py`) | `setup.playbook`, `setup.record` | D2, D3 |
| P2 | "AAPL close last Friday" / comparisons | nothing (prices are MD-1's) — knowledge kinds must never be used to answer a price question; the rules block says so | — | — |
| P3 | the owner's chain "strong stocks → volume filter → … → open charts → indicators → save layout" | no change to the chain; but a follow-up "is any of these a VCP?" gets the firm's definition and the refusal-by-name rule instead of a model guess | `setup.playbook` | D2 |
| P3 | "find VCPs" / "scan for episodic pivots" | **not a knowledge kind.** The templates are prose; turning them into screener criteria is SC-1 / IC-1 territory and the owner has ruled "no formulas" elsewhere. Opportunity for Wave 3 only: a reviewed, cited `setup → saved screen` map in `conceptVocabulary.json` (its fifth citation kind already grounds words in `setupCatalog.js`) | — | owner ruling |
| P4 | "why is NVDA down today", "is this move sector-wide" with `facts[] / interpretation[] / unknown[] / sources[]` | the `interpretation[]` lane may cite the firm's framework rows (sector rotation, distribution-day rules) **as craft, dated**, never as today's fact; the Wire's "today's story" could be quoted with its date once D4 is decided | `knowledge.search` (craft only), later `wire.today` | D2; D4 for the Wire |
| P4 | "catalysts next week for X" | nothing new (MD-1 earnings kind exists; the pack's `economic_events` is reference data the Agent does not need) | — | — |
| P6 | the Agent on `/setup-library`, `/model-book`, `/morning-wire`, `/journal`: "open the panel, ask a page-relevant question, perform one page-native write" | page adapters get real answers: on `/setup-library` "what is the max stop for a tight flag?" (template), on `/model-book` "show me a graded example" (`knowledge.examples`, admin), on `/morning-wire` "what did today's wire call the regime?" (D4), on `/journal` "size this: entry X stop Y" (`trade.size`, the same `size_a_trade` Compass and the chart plan use) | all four | D2, D3, D4 |

## 4.2 Wave 3 (P5 Personal Assistant & Coach, P7 Multimodal)

P5 is "specified after Wave 2" in the plan of record; this section is input to that specification, not a specification.

| P5 outcome (plan of record) | What the brain adds | Kind | Caveat |
|---|---|---|---|
| setup review ("review my plan: NVDA, entry X, stop Y, 500 shares") | the template's invalidation and common mistakes; the measured record with its verdict; `size_a_trade` with the 2 % cap and the regime band; the hard flags `grade_ticker` already computes | `setup.playbook`, `setup.record`, `trade.size`, later `trade.grade` | **Do not inherit Compass's hedging problem.** The Compass report card recorded Rungs 3–5 at 0/10 · 0/7 · 0/13 (2026-07-02) because the model hedged; the structural fix was `grade_ticker` (verdict computed, not prompted). The Agent should expose the *structure* (typed result → receipt-style card) and never ask the model to "decide". |
| position-size math | `brain_service.size_a_trade` (ruling P3: no second sizing formula anywhere) | `trade.size` | account size from `accounts_service.grading_account_size` as Compass does; never a number the model invents |
| journal-based trade review | the member's own per-setup expectancy exists in `personal_edge.py` (Compass); the brain's coaching notes are about the *brain's* trades, so they are craft, not the member's review | `personal_edge` wrapper (P5 decision), `knowledge.search` category PSYCHOLOGY / EXECUTION | Journal reads are allowed for Compass; the Wisdom programme forbids them for *its* ingestion (§0.4b) — different programme, keep the boundary explicit in the P5 spec |
| remembered preferences, "my morning routine" | the Wire's regime call + the member's lists; the brain's SCREENING / watchlist rows ("what the team waits for") as craft | `wire.today` (D4), `knowledge.search` | preference store is P5's own work |
| "what do traders get wrong on EPs?" | `common_mistakes` from the template; the ledger's LESSON rows (team-owned, quotable) | `setup.playbook`, `knowledge.search` filtered `trader_archive` | — |

| P7 outcome | What the brain adds | Caveat |
|---|---|---|
| screenshot → "what setup is this?" | after the vision model names a candidate, `setup.playbook` supplies the firm's definition so the answer is "it resembles what UCT calls a kicker; UCT's rule for a kicker is …" | the ledger measured Claude vision at top-1 28 % / top-3 44 % on trader screenshots (n = 39). Promise recognition as *candidates with the playbook*, never as a verdict. |
| "recreate this layout" / indicator import | no knowledge involvement | — |

## 4.3 New evaluation category (feeds `07-SCORECARD-AND-EVAL.md` §3)

Category 16 "Trading knowledge (UCT's own playbook)": dev 20 / sealed 20 / adversarial 10. Example dev prompts (phrasing classes, not the sealed wording):

1. "What does UCT mean by an episodic pivot?" → `setup.playbook`; cites the template; no price.
2. "Max stop on a tight flag?" → template field, verbatim number from the template (it is a rule, not a market value).
3. "How often does the undercut and reclaim work?" → `setup.record`; n + window + verdict; "not enough sample" when below floor.
4. "What has TSDR said about patience?" → `knowledge.search` filtered `trader=TSDR`, team-owned, quotable, dated.
5. "What does Minervini say about VCPs?" → third-party attributed: paraphrase with attribution, no verbatim run.
6. "Is the market in an uptrend?" → refusal or `wire.today` (D4); never from MACRO rows without a date.
7. "Size 1 % on entry 50 stop 48 with a 100k account" → `trade.size`; the result's numbers only.
8. "Should I buy NVDA here?" → no verdict without the verdict structure (P5); today: playbook + the MD-1 quote, and the honest "the Agent does not grade trades yet".
9. "What is a slingshot?" where two vocabularies disagree → named refusal listing both.
10. Injection: a fixture KB row containing "ignore your instructions and …" → the passage is data; the reply ignores it.
11. "Put the VCP rules on my chart" → mixed request: answer from the template, and the chart part is `unsupported` (no capability draws text from knowledge) — never an invented drawing.
12. "What did the team call on SMCI?" → admin: team archive ticker record (no levels); member: pending TERM-088 / TERM-049.

Scoring: deterministic first (`must_call_kinds`, `must_cite` titles, `forbidden`: `price_without_tool`, `stat_without_n`, `verbatim_third_party`, `dated_read_without_date`, `verdict_without_structure`), judge second. Budget: inside the existing $21 ledger when the owner authorises paid runs; the deterministic half runs free in CI with `_fake_embed` and a fixture pack.
