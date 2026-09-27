# CONTRACT B-POD-BBG — Bloomberg Pod Synthesis → the Bloomberg Dossier (gate item 7)

Read `_SHARED_PREAMBLE.md` and `_EXTERNAL_PREAMBLE.md` first; both bind. You are a POD SYNTHESIS task (Document B §8): you read the eight leaf files and write the single canonical dossier. You do no new web research except to re-check one cited page when two leaves conflict.

ID: B-POD-BBG. GROUP: B. WAVE: 2. MODEL: Fable. BUDGET: 90 tool calls or 75 minutes.
INPUTS (read all eight in full; use offset/limit past 2000 lines): `03-competitive-research/bloomberg/01-search-navigation.md` … `08-why-they-stay.md`.
FILE DESTINATION: `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\03-competitive-research\bloomberg\dossier.md` (single writer).

DELIVERABLE: the Bloomberg dossier in the Part LX template (sections A–P) PLUS a section Q that answers each Part CCXLV question explicitly or records its ceiling:
* How does a user begin? · discover functions? · move between securities? · configure the workspace? · save work? · receive alerts? · inspect data provenance? · combine news and analysis? · research earnings? · screen? · collaborate? · What keeps professionals inside all day?
For each: the answer in two to five sentences, the leaf file(s) and sources it rests on, the confidence, and the ceiling if one applied. An honest ceiling is complete; an inferred answer is not.

RULES:
1. Reconcile the leaves: where two files disagree (e.g., `MON`/`MNRS`, colour groups vs `Group-1/#A` badges, `TRAN`/`EVTS`, `PEERS`/`RV`), state Position A / Position B / Evidence / Resolution in a "Reconciliations" section. Mnemonics the leaves could not find are listed as UNVERIFIED, never asserted.
2. Keep the workflow lens: the dossier is about how professionals chain functions (Part VIII's 16-step chain), not a feature list. Section E reconstructs at least five Part XIV workflows step by step from the leaves' evidence.
3. Sections M and N (best ideas / bad ideas for UCT) are hypotheses tied to a UCT workflow or persona, each citing the leaf evidence; never "UCT should build X because Bloomberg has it". Include the anti-patterns for Part LXIII.
4. Section P lists, per section, the confidence and ceiling, and the one owner-supplied artifact that would raise it (OI-08).
5. End with GAPS, a merged SOURCES list (dedupe, keep tiers and dates), and NOT INSPECTED.

RETURN SUMMARY ≤150 words: path, the dossier's one-sentence philosophy for Bloomberg (Part CCXLVII), how many of the twelve CCXLV questions are answered vs ceilinged, ≤3 open questions.
OUTPUT STRUCTURE, CONFIDENCE, SOURCE HANDLING, DO NOT: per the preambles (binding). Do not spawn sub-agents.
