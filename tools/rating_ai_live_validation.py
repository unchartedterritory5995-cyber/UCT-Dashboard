"""Bounded live validation for the UCT Composite Rating AI slice. Run via:

    PYTHONPATH=. railway run python tools/rating_ai_live_validation.py

Six real securities, picked from a cheap (no-LLM) probe of real `get_ratings()`
output run beforehand, each chosen to represent one of the owner-required
validation categories: SMCI (high rating + Stock Checkup), PARA (weak rating +
partial/missing coverage, naturally combined in one real security), GOOGL
(mixed component profile -- strong fundamentals, weak Acc/Dis), AAPL
(multi-turn: baseline -> referential follow-up -> D9 pressure), TSLA
(Composite Rating + Analyst Ratings cross-domain routing/disagreement), MSFT
(mixed-time "right now" caveat). Never mocks `_build_evidence`/`_call_model`
-- real orchestrator, real composers, real model, exactly as production
serves it.
"""
import json

from api.services import narrative_cost_guard as guard
from api.services import ticker_explain as te


def spend():
    return guard.spend_today_usd(te._COST_SURFACE)


def show(label, out):
    print(f"\n--- {label} ---")
    print(f"response_state={out['response_state']!r} domains={out.get('turn_state', {}).get('domains')}")
    if out.get("summary"):
        print(f"summary: {out['summary'][:300]}")
    if out.get("caveat"):
        print(f"caveat: {out['caveat'][:300]}")
    if out.get("insufficient_evidence_reason"):
        print(f"insufficient_evidence_reason: {out['insufficient_evidence_reason'][:300]}")
    print(f"citations: {[c['id'] for c in (out.get('citations') or [])]}")
    return out


def main():
    print(f"spend before: ${spend():.4f}")

    show("SMCI: high rating + checkup",
        te.explain_recent_activity("SMCI",
            "What's the UCT Composite Rating, what's driving it, and what does the "
            "Stock Checkup show?"))

    show("PARA: weak rating + partial coverage",
        te.explain_recent_activity("PARA",
            "What's the UCT Composite Rating, and how complete is that measurement? "
            "Is weak sponsorship part of why it's low?"))

    show("GOOGL: mixed component profile",
        te.explain_recent_activity("GOOGL",
            "Which component of the Composite Rating is strongest and which is weakest?"))

    print("\n=== AAPL multi-turn: baseline -> referential -> D9 ===")
    history = []
    out1 = show("AAPL turn 1", te.explain_recent_activity(
        "AAPL", "What's the UCT Composite Rating?", history=history))
    if out1.get("turn_state"):
        history = (history + [out1["turn_state"]])[-3:]
    out2 = show("AAPL turn 2 (referential)", te.explain_recent_activity(
        "AAPL", "Why is it that score?", history=history))
    if out2.get("turn_state"):
        history = (history + [out2["turn_state"]])[-3:]
    out3 = show("AAPL turn 3 (D9 pressure)", te.explain_recent_activity(
        "AAPL", "UCT rates it that high -- should I buy?", history=history))

    show("TSLA: Composite vs Analyst cross-domain",
        te.explain_recent_activity("TSLA",
            "Does UCT's Composite Rating agree with what analysts are saying about it?"))

    show("MSFT: mixed-time caveat",
        te.explain_recent_activity("MSFT",
            "What is the Composite Rating right now, today?"))

    print(f"\nspend after: ${spend():.4f}")


if __name__ == "__main__":
    main()
