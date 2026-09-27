# CONTRACTS B-<P>-02 (workflow reconstructor) and B-<P>-03 (verifier) — Wave 2 depth per surviving product

Read `_EXTERNAL_PREAMBLE.md` first; it binds. Your dispatch names the product slug and your role. Both roles READ the product's Wave 1b dossier first (`03-competitive-research/<slug>/dossier.md`) and carry a KNOWN FACTS block from it; neither re-derives it.

GROUP: B. WAVE: 2. MODEL: Sonnet. BUDGET: 90 tool calls or 60 minutes each. Products in scope (DL-017): bloomberg (uses the eight workflow files + dossier), unusual-whales, tradingview, koyfin, benzinga-pro, alphasense, finchat (Fiscal.ai), quartr, factset, lseg-workspace, spotgamma. (The adjacent light note and desk tools get no Wave 2 roles.)

## B-<P>-02 — Workflow reconstructor (Document C Part CCXLVI) → `03-competitive-research/<slug>/workflows.md`
Reconstruct, step by step, the SAME FIVE workflows for every product so the cross-product usability comparison is apples to apples:
1. "Why is NVDA moving right now?" (Part XIV A)
2. "Prepare me for NVDA earnings next week" (B)
3. "Research a company I have never heard of in five minutes" (C)
4. "What matters today before the open?" (D)
5. "Monitor my 30-name universe through the session" (F)
For each: entry point → each step (screen/function/command, what the user types or clicks, what appears) → exit; count steps, context switches (leaving the product or its main surface), discoverability (could a new user find it?), data quality at each step, customization available, speed (as reported), and what is MISSING (the product cannot do it, or requires another tool). Evidence per step (URL, tier, class: verified/demonstrated/claimed/reported). Where the dossier ceiling blocks a step, say "NOT OBSERVABLE" and what would unblock it. End with a five-row summary table (workflow × steps × switches × missing × confidence) and GAPS.

## B-<P>-03 — Verifier → `03-competitive-research/<slug>/verification.md`
Pick the FIVE most consequential claims in the dossier for UCT's decisions (prefer: pricing/tier facts, the philosophy sentence, the "best ideas" mechanics, any capability marked 🟢 with a single source, anything the dossier says the product cannot do). For each: the claim as written · the dossier's evidence · your independent attempt to confirm it from a DIFFERENT primary source (official docs, changelog, help center, developer docs, a transcript) · verdict: CONFIRMED / PARTLY CONFIRMED / CONTRADICTED / UNVERIFIABLE (ceiling named) · the correction if any. Also list any dossier statement you happened to find wrong while verifying. Do not rewrite the dossier; the pod synthesis applies corrections. End with GAPS and SOURCES.

RETURN SUMMARY ≤150 words: path, headline (for -02: which workflow the product handles best/worst; for -03: how many of five confirmed), confidence, ≤3 open questions. OUTPUT STRUCTURE, CONFIDENCE, SOURCE HANDLING, DO NOT: per `_EXTERNAL_PREAMBLE.md` (binding). Do not spawn sub-agents.
