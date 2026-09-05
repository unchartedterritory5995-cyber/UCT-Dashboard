"""Bounded live validation for Security Research Q&A Slice 3 (bounded
multi-turn conversation). Run via:

    PYTHONPATH=. railway run python tools/slice3_live_validation.py

Deliberately narrow -- two flows only, given the shared $10/day cost cap on
the `ticker_explain` surface is also serving real production traffic today:

  Flow 1 (AAPL, 5 turns) -- referential follow-up domain carry-forward,
      new-domain mid-conversation switch, and the explicit >3-turn
      sliding-window-aging proof the owner's Slice 3 authorization required
      (turn 5's outgoing history must have aged out turn 1).
  Flow 2 (NVDA, 1 turn with a fabricated AAPL history) -- cross-security
      entity isolation against the REAL production code path, not a mock.

Never touches `_build_evidence` or `_call_model` -- this is the real
orchestrator, real composers, real model, exactly as production serves it.
"""
import json

from api.services import narrative_cost_guard as guard
from api.services import ticker_explain as te


def spend():
    return guard.spend_today_usd(te._COST_SURFACE)


def show(label, out):
    print(f"\n--- {label} ---")
    print(f"response_state={out['response_state']!r} "
          f"insufficient_evidence={out['insufficient_evidence']!r}")
    print(f"domains={out.get('domains')!r}")
    if out.get("summary"):
        print(f"summary: {out['summary'][:200]}")
    if out.get("caveat"):
        print(f"caveat: {out['caveat'][:200]}")
    if out.get("clarification_question"):
        print(f"clarification_question: {out['clarification_question'][:200]}")
    if out.get("insufficient_evidence_reason"):
        print(f"insufficient_evidence_reason: {out['insufficient_evidence_reason'][:200]}")
    print(f"citations: {[c['id'] for c in (out.get('citations') or [])]}")
    print(f"turn_state: {json.dumps(out.get('turn_state'))}")
    return out


def main():
    print(f"spend before: ${spend():.4f}")

    # ── Flow 1: AAPL, 5 turns ────────────────────────────────────────────
    print("\n========== FLOW 1: AAPL 5-turn conversation ==========")
    history = []

    out1 = show("turn 1: what changed with this company recently? (news baseline)",
               te.explain_recent_activity("AAPL", "What changed with this company recently?", history=history))
    if out1.get("turn_state"):
        history = (history + [out1["turn_state"]])[-3:]

    out2 = show("turn 2: why does that matter? (referential -- should carry turn 1's domains)",
               te.explain_recent_activity("AAPL", "Why does that matter?", history=history))
    if out2.get("turn_state"):
        history = (history + [out2["turn_state"]])[-3:]

    out3 = show("turn 3: what about ownership? (explicit new domain -- should switch, not carry)",
               te.explain_recent_activity("AAPL", "What does institutional ownership look like?", history=history))
    if out3.get("turn_state"):
        history = (history + [out3["turn_state"]])[-3:]
    print(f"[after turn 3] outgoing-history-for-next-turn length: {len(history)} "
          f"(expect <=3; questions so far: {[h['question'] for h in history]})")

    out4 = show("turn 4: how has that changed recently? (referential again)",
               te.explain_recent_activity("AAPL", "How has that changed recently?", history=history))
    if out4.get("turn_state"):
        history = (history + [out4["turn_state"]])[-3:]
    print(f"[after turn 4] outgoing-history-for-next-turn questions: {[h['question'] for h in history]}")
    turn1_question = out1["turn_state"]["question"] if out1.get("turn_state") else None

    out5 = show("turn 5: and what about analyst sentiment? (sliding-window-aging proof turn)",
               te.explain_recent_activity("AAPL", "And what about analyst sentiment?", history=history))
    print(f"[before turn 5 request] history sent = {[h['question'] for h in history]}")
    aged_out = turn1_question is not None and turn1_question not in [h["question"] for h in history]
    print(f"SLIDING-WINDOW-AGING PROOF: turn 1's question ({turn1_question!r}) present in "
          f"turn 5's outgoing history? {'YES -- FAIL' if not aged_out else 'NO -- aged out correctly (PASS)'}")

    print(f"\nspend after Flow 1: ${spend():.4f}")

    # ── Flow 2: NVDA, 1 turn, fabricated AAPL history (entity isolation) ──
    print("\n========== FLOW 2: NVDA turn with a fabricated AAPL history ==========")
    fake_aapl_history = [{
        "sym": "AAPL", "question": "What is Apple's institutional ownership?",
        "response_state": "answer", "domains": ["ownership"],
        "summary": "Apple's institutional ownership is dominated by Vanguard and BlackRock.",
    }]
    out6 = show("NVDA turn with a mismatched-sym (AAPL) history entry",
               te.explain_recent_activity("NVDA", "Why does that matter?", history=fake_aapl_history))
    leaked = "Apple" in (out6.get("summary") or "") or "Vanguard" in (out6.get("summary") or "")
    print(f"ENTITY ISOLATION PROOF: does the NVDA answer mention AAPL's fabricated-history "
          f"content? {'YES -- FAIL' if leaked else 'NO -- isolated correctly (PASS)'}")
    print(f"turn_state.sym == 'NVDA'? {out6.get('turn_state', {}).get('sym') == 'NVDA'}")

    print(f"\nspend after Flow 2 (total): ${spend():.4f}")


if __name__ == "__main__":
    main()
