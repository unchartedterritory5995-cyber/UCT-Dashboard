# Governing Intent — Universal Custom Indicator + Screener Ecosystem

**Status:** authoritative, durable anti-drift context. Read this before scoping any new
phase, and re-read it whenever a session is reconstructing state after an interruption
(see DEC-011 in `DECISIONS.md`). Recorded verbatim from the owner's 2026-09-05
post-recovery instruction, lightly reformatted for reference — no substance added or
removed.

**Relationship to other program documents:** this file does not replace
`00-MASTER-PROMPT.md` (the verbatim master prompt + program-scope reconciliation) or
`DECISIONS.md` (the append-only decision log). It exists because those documents answer
"what was decided" and "what was the original ask" — this answers "what is the standing
intent that should shape every future judgment call," including ones no decision record
yet covers. If a future decision conflicts with this file, that conflict should be
surfaced explicitly (a new DEC entry explaining why), not silently overridden.

---

## The objective, restated

Not merely to improve Pine translation scores.

The objective is to build the most trustworthy, flexible, and useful custom
trading-logic ecosystem possible inside UCT Intelligence, while preserving the strong
architecture already discovered (see `CURRENT_ARCHITECTURE.md` and the Phase Zero
preservation contract in `00-MASTER-PROMPT.md`).

The long-term member experience should increasingly support:

- bring existing logic from TradingView/Pine;
- bring existing logic from thinkorswim/thinkScript;
- bring existing logic from TC2000/PCF;
- describe an indicator or screen in plain language;
- derive a best-effort interpretation from a screenshot;
- build/edit native UCT logic;
- understand what was interpreted and what was inferred;
- see whether the logic is VERIFIED / SUPPORTED / PARTIAL / EXPERIMENTAL / CORRECTLY
  REFUSED / UNSUPPORTED / DATA BLOCKED / EXECUTION BLOCKED / VENDOR AMBIGUOUS;
- chart the result;
- use numeric outputs as columns, sorts, thresholds and ranges;
- use boolean outputs as screens;
- save and reopen definitions;
- modify parameters safely;
- reuse the same definition across chart, screener and alerts;
- eventually support bounded Run Now / live / intraday workflows where data and
  execution guarantees actually permit them.

## What the product must favor

- **CORRECT REFUSAL over plausible wrong output.**
- **VERIFIED SEMANTICS over broad but unreliable language coverage.**
- **TRANSPARENCY over hidden inference.**
- **ONE CANONICAL LOGIC MODEL over per-surface special cases.**
- **EVIDENCE over documentation claims.**
- **PRESERVATION / EXTENSION over unnecessary rewrites.**
- **AUTOMATED ENGINEERING VALIDATION before broad human testing.**

## What NOT to optimize for (vanity metrics)

- raw function count;
- raw translated-script percentage;
- number of green tests without assessing what they prove;
- self-consistency presented as vendor parity;
- feature breadth that silently weakens execution guarantees.

## Core success metric

**MEMBER TASK SUCCESS**: can a member bring/build trading logic, understand what UCT
did with it, verify it sufficiently for the claimed support level, save it, reopen it,
chart it, screen with it, alert on it where allowed, and trust that unsupported cases
are refused honestly?

## Current strategic priorities (until the next ChatGPT Review Packet)

1. semantic correctness / vendor evidence;
2. reliability and regression safety;
3. observability;
4. completion of all five real Golden Journeys;
5. preservation of existing screener/chart/alert behavior;
6. migration fidelity for supported inputs;
7. only then broader capability expansion.

Do not let adjacent projects absorb this one. Pattern-engine work, terminal work,
generic screener redesign, pricing, broad UI redesign, and unrelated infrastructure
modernization should remain separate unless direct dependency evidence requires
interaction.

## Compatibility / reliability principle — "supported" is multidimensional

For any imported or created logic, keep separate where relevant:

- parse support;
- semantic support;
- numeric parity;
- visual parity;
- data availability;
- timeframe/session support;
- execution-lane support;
- chart support;
- screener support;
- alert support;
- persistence/reopen support;
- vendor verification.

Never collapse these into one flattering "supported" boolean if reality is partial.

## Future expansion discipline

When Phase One is complete, do not automatically jump into whichever feature is
easiest. Use Review Packet #2 to decide the next phase from evidence.

Likely future candidates (**none pre-authorized merely by appearing here**):

- wider vendor-parity coverage;
- improving remaining Pine blind-corpus gaps;
- thinkScript parity;
- PCF adversarial corpus;
- additional Pine parameter types;
- plain-language reliability;
- screenshot interpretation quality;
- intraday data/execution vertical slice;
- better editor/authoring UX;
- more advanced numeric screener workflows;
- alert workflows;
- cross-browser/mobile reliability;
- controlled human testing.

Select future work based on: member value; observed usage; correctness risk;
architectural fit; migration impact; data availability; performance; reversibility;
measurable improvement.

## Next major gate: CHATGPT REVIEW PACKET #2

Do not begin a new major product phase before Review Packet #2. That review should
determine:

- what Phase One actually proved;
- remaining correctness gaps;
- human-testing readiness;
- whether vendor-parity investment needs to broaden;
- whether Track F should expand;
- whether intraday work is justified next;
- which product capability produces the highest member-value gain without weakening
  trust.

## Why this file exists

This program has already survived one session interruption requiring a full
reconstruction from git history and persistent docs (see the 2026-09-05 session
recovery). A recovery that reconstructs *what was done* but not *why the program
exists and what it must never trade away* would let the program drift into a
collection of local tasks — the exact failure this file is meant to prevent for any
future session, interrupted or not.
