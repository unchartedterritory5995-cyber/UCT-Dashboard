# CONTRACT B-VAL-01 — Benchmark Universe Validator (Document C Part VII)

Read `_EXTERNAL_PREAMBLE.md` first; it is part of this contract.

ID: B-VAL-01. ROLE: Benchmark universe validator (Group B). WAVE: 1b. MODEL: Opus. BUDGET: 100 tool calls or 70 minutes.
MISSION: Validate the candidate benchmark universe against the criterion "unique learning value for a small US equities-and-options desk and its retail-plus members," confirm exact current product names, availability, positioning, and versions, flag redundancy, and propose substitutions or additions with evidence — so the program studies ten to twelve products that each teach something different.

CANDIDATES (in flight as dossiers): Bloomberg Terminal · LSEG Workspace · FactSet · S&P Capital IQ Pro · Koyfin · TradingView · AlphaSense · FinChat (Fiscal.ai?) · TIKR · Quartr · YCharts · Benzinga Pro · Gödel Terminal. Desk-tool slots (separate roles): thinkorswim, TradingView-as-used, Finviz, plus one to be discovered.

QUESTIONS:
1. For each candidate: exact current name, owner, current availability (GA / beta / sunset), positioning statement (theirs), primary persona, price posture (public), the one thing it teaches that no other candidate teaches. Cite.
2. Redundancy analysis: which pairs or triads overlap substantially (e.g., Koyfin / TIKR / FinChat prosumer fundamentals; LSEG / FactSet / CIQ enterprise research). Recommend which to keep at full depth, which to downgrade to a light dossier, and why.
3. Gaps in the universe for UCT's shape: options-flow and unusual-activity terminals (e.g., Unusual Whales, FlowAlgo, Cheddar Flow, Market Chameleon, OptionStrat), AI-native research tools beyond AlphaSense/FinChat (e.g., Perplexity Finance, Fintool, Rogo, Hebbia, Daloopa, Fey), trader-desk platforms (Trade Ideas, Sierra Chart, DAS Trader, thinkorswim as a terminal), event/catalyst tools (Wall Street Horizon, EarningsWhispers), news terminals (Cheddar? Fly on the Wall, Bloomberg alternatives like Koyfin news), macro terminals (MacroMicro, Trading Economics). For each: does it provide materially differentiated workflow learning? Recommend at most three additions with evidence.
4. Evidence accessibility per product: is there public documentation, a help center, demo videos with transcripts, a free tier? Rate each product's likely evidence ceiling (🟢 documented publicly / 🟡 partial / 🔴 paywalled) so the program can budget verification.
5. Produce the recommended universe table: product · role in the study (deep / standard / light / desk-tool) · rationale · ceiling · what UCT workflow it informs. Mark it PROVISIONAL; the orchestrator records the decision in `DECISION_LOG.md`.

OUT OF SCOPE: writing any dossier; reading internal UCT files.
FILE DESTINATION: `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\03-competitive-research\benchmark-universe.md`.
OUTPUT STRUCTURE, CONFIDENCE, RETURN SUMMARY, SOURCE HANDLING, DO NOT: per `_EXTERNAL_PREAMBLE.md` (binding).
