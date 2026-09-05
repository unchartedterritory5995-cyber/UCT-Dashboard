"""Targeted re-validation of the four fixes applied after the first bounded
live-validation pass (rounding, BMO/AMC hedge-awareness, reaction-binding
narrowing, natural-language date masking). Run via:

    PYTHONPATH=. railway run python tools/earnings_ai_live_revalidation.py
"""
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

    show("MSFT: clear beat + large positive reaction (rounding fix)",
        te.explain_recent_activity("MSFT", "Did they beat EPS last quarter, and how did the stock react?"))

    show("AAPL: naturally-occurring CONFLICTING next-report date",
        te.explain_recent_activity("AAPL", "When does AAPL report next?"))

    show("PLTR: expected/implied move + strong beat (rounding + reaction-binding fix)",
        te.explain_recent_activity("PLTR", "What is the expected move, and did they beat last quarter?"))

    print("\n=== AAPL multi-turn: owner's own example chain (re-run) ===")
    history = []
    out1 = show("AAPL turn 1", te.explain_recent_activity(
        "AAPL", "When do they report?", history=history))
    if out1.get("turn_state"):
        history = (history + [out1["turn_state"]])[-3:]
    out2 = show("AAPL turn 2 (referential: before or after -- BMO/AMC hedge fix)", te.explain_recent_activity(
        "AAPL", "Before or after the close?", history=history))
    if out2.get("turn_state"):
        history = (history + [out2["turn_state"]])[-3:]
    out3 = show("AAPL turn 3 (what happened last quarter)", te.explain_recent_activity(
        "AAPL", "What happened last quarter?", history=history))
    if out3.get("turn_state"):
        history = (history + [out3["turn_state"]])[-3:]
    out4 = show("AAPL turn 4 (referential: how did it react -- date-masking fix)", te.explain_recent_activity(
        "AAPL", "How did it react?", history=history))

    print(f"\nspend after: ${spend():.4f}")


if __name__ == "__main__":
    main()
