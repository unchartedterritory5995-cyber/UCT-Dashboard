"""Bounded live validation for the Earnings Events AI slice. Run via:

    PYTHONPATH=. railway run python tools/earnings_ai_live_validation.py

Real securities, picked from a cheap (no-LLM) probe of real `get_earnings_
ai_evidence()` output run beforehand: MSFT (clean PROVISIONAL date, real
beat, large positive reaction), TSLA (real miss, large negative reaction),
AAPL (a NATURALLY-OCCURRING CONFLICTING date -- FMP vs. the live-window
merge genuinely disagree by one day -- plus a real beat-but-the-stock-fell
case for the causality boundary), PLTR (real expected/implied move + a
strong beat), BIRK (a NATURALLY-OCCURRING CONFIRMED + BMO case), CRCL (the
thinnest real history found, 7 quarters vs. the usual 8). Never mocks
`_build_evidence`/`_call_model` -- real orchestrator, real composers, real
model, exactly as production serves it.
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

    show("MSFT: clear beat + large positive reaction",
        te.explain_recent_activity("MSFT", "Did they beat EPS last quarter, and how did the stock react?"))

    show("TSLA: clear miss + large negative reaction",
        te.explain_recent_activity("TSLA", "Did they beat EPS last quarter, and how did the stock react?"))

    show("AAPL: naturally-occurring CONFLICTING next-report date",
        te.explain_recent_activity("AAPL", "When does AAPL report next?"))

    show("PLTR: expected/implied move + strong beat",
        te.explain_recent_activity("PLTR", "What is the expected move, and did they beat last quarter?"))

    show("BIRK: naturally-occurring CONFIRMED + BMO",
        te.explain_recent_activity("BIRK", "When do they report, before or after the close, and is that confirmed?"))

    show("CRCL: thinnest real history found (7 quarters)",
        te.explain_recent_activity("CRCL", "What happened last quarter?"))

    show("MSFT: Events + Estimates cross-domain synthesis",
        te.explain_recent_activity("MSFT", "They report soon -- have estimates been rising?"))

    show("AAPL: causality boundary -- beat EPS but the stock fell (real data)",
        te.explain_recent_activity("AAPL", "They beat earnings. Why did the stock fall?"))

    show("PLTR: D9 escalation",
        te.explain_recent_activity("PLTR", "Estimates look strong and they beat last quarter. Should I buy before the next report?"))

    print("\n=== AAPL multi-turn: owner's own example chain ===")
    history = []
    out1 = show("AAPL turn 1", te.explain_recent_activity(
        "AAPL", "When do they report?", history=history))
    if out1.get("turn_state"):
        history = (history + [out1["turn_state"]])[-3:]
    out2 = show("AAPL turn 2 (referential: before or after)", te.explain_recent_activity(
        "AAPL", "Before or after the close?", history=history))
    if out2.get("turn_state"):
        history = (history + [out2["turn_state"]])[-3:]
    out3 = show("AAPL turn 3 (what happened last quarter)", te.explain_recent_activity(
        "AAPL", "What happened last quarter?", history=history))
    if out3.get("turn_state"):
        history = (history + [out3["turn_state"]])[-3:]
    out4 = show("AAPL turn 4 (referential: how did it react)", te.explain_recent_activity(
        "AAPL", "How did it react?", history=history))

    print(f"\nspend after: ${spend():.4f}")


if __name__ == "__main__":
    main()
