---
id: ADR-0049
title: "No execution" does NOT reach historical backtesting — backtesting is IN CHARTER, and it already ships
status: accepted
date: 2026-09-26
decided_by: the programme under owner delegation (*"make judgement calls and decisions"*)
gate_item: 9, 18, 27
promotion: Locked: a default taken over a GENUINE SILENCE, with the documents searched first NAMED per ADR-0008's rule, and a boundary read off shipped code rather than argued. Reversal condition is one owner sentence.
supersedes: the reading of GOVERNING_PRINCIPLES §13's no-execution default as reaching historical simulation
superseded_by: none
register_row: none
---

# ADR-0049 — "No execution" does NOT reach historical backtesting — backtesting is IN CHARTER, and it already ships

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme under owner delegation (*"make judgement calls and decisions"*) · gate item 9, 18, 27

**Why it is an ADR and not a tracker row:** Locked: a default taken over a GENUINE SILENCE, with the documents searched first NAMED per ADR-0008's rule, and a boundary read off shipped code rather than argued. Reversal condition is one owner sentence.

**Supersedes:** the reading of GOVERNING_PRINCIPLES §13's no-execution default as reaching historical simulation

## Context

Gate item 9 named this its highest-leverage open question **because BRK-01's size depends on it**.
⭐ Per ADR-0008's rule, the documents searched **before** defaulting are named:
`GOVERNING_PRINCIPLES.md` §13, `05-product-strategy/non-goals.md` (NG-01..NG-03),
`OWNER_DECISIONS.md`, `charter/OWNER_SEED_FACTS.md`, CARDs 1–27. **None of them rules on
historical simulation.** *"A default over an unread answer is an overwrite; this one is over a
genuine silence."* (`12-decisions/DECISION_CARDS_2026-09-26.md:784`)

## ⛔ The argument is not needed, because the boundary is already drawn in shipped code

**`app/src/pages/cot/cotAnalogs.js` is a backtest, it is LIVE, and it is MOUNTED** — imported
by `app/src/pages/CotData.jsx` and `app/src/pages/cot/PositioningRail.jsx` (verified at
`origin/master`). Its own header: *"Historical precedents for the current positioning setup …
its forward return is how the proxy ETF's weekly close moved 4 / 8 / 13 weeks after the stretch
BEGAN … a precedent only knows what was knowable then (no lookahead past idx)."*
(`:788`)

⭐⭐ **That is point-in-time historical performance measurement with explicit lookahead
discipline — the defining shape of a backtest — serving members today, and nobody in the
history of this codebase treated it as an execution question.** The neighbours agree:
`setup_triggers` carries win/loss records over historical fires, `uct20_nav.py` chains a
composition-aware historical equity curve, and the breadth analogues match patterns to forward
outcomes. **The permissive boundary is not being proposed; it is being READ OFF what already
runs** (`:790`).

## Decision — the rule, stated so it cannot be stretched

✅ **IN CHARTER:** computing over past data — historical precedent studies, per-setup
expectancy, forward-return distributions, strategy simulation with stated assumptions. **No order
exists at any point, so there is nothing for "no execution or order management" to attach to.
§13 governs ORDER FLOW; a backtest has none** (`:794`).

⛔ **STILL OUT — the edges a backtest must not creep across** (`:796-800`):

1. **No "run this strategy" / "execute" affordance** of any kind, live or paper. The moment a
   simulation acquires a button that places or stages an order it is **NG-01**.
2. **No broker write path, including a send-to-broker bridge** (**NG-03** — see ADR-0051).
3. **No position-of-record.** A simulated portfolio is a computation, never an account state
   (**NG-02**).
4. ⚠️ **FILL ASSUMPTIONS MUST BE STATED ON THE SURFACE.** A backtest that reports returns
   without disclosing how it filled is an **unfalsifiable trust claim** — **NG-17** —
   *"and that, not execution, is the real hazard in this feature."* `cotAnalogs` sets the standard
   to match: it states its proxy and its no-lookahead rule in the code that computes it.

## Alternatives actually considered

1. **Read §13 broadly, so historical simulation is out.** Rejected: it would retroactively
   make a live, mounted, member-facing surface a charter violation, which is the tell that the
   reading is wrong.
2. **Escalate it to the owner.** Rejected under the delegation, and the silence was genuine —
   five owner-input documents were searched first and none rules on it.

## Consequences

* ⭐ **BRK-01 KEEPS ITS FULL SCOPE** — chain UI, greeks, vol surface, payoff/risk graph
  **and** strategy backtesting — and remains the largest actionable item in the programme
  (`:802`).
* It **bounds ADR-0013**: the no-execution ceiling is about **order flow**, not about computing
  over the past. ADR-0013's structural-break-out rule is unchanged; its reach is narrowed.
* ⚠️ **Reversal condition:** one owner sentence reading §13 more broadly. BRK-01
  then shrinks to its chain/greeks/vol-surface half and item 9 §4's sizing is re-cut.
  **Nothing else in the programme changes** (`:802`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:782-802`
- `00-program-control/GOVERNING_PRINCIPLES.md:78`
- `05-product-strategy/non-goals.md` (NG-01, NG-02, NG-03, NG-17)
