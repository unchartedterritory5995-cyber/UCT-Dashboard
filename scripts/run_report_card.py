#!/usr/bin/env python
"""Run the Compass report card. Exit 1 on any safety break or rung below bar.

Usage:
  set ANTHROPIC_API_KEY=...          (required unless --offline)
  python scripts/run_report_card.py --db C:\\temp\\rc.db --rungs 1,2
  python scripts/run_report_card.py --db C:\\temp\\rc_smoke.db --offline --questions R1-01-quote-nvda
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="chat", choices=["chat"])
    ap.add_argument("--rungs", default="", help="comma list, e.g. 1,2")
    ap.add_argument("--questions", default="", help="comma list of ids")
    ap.add_argument("--db", required=True, help="disposable sqlite path (AUTH_DB_PATH)")
    ap.add_argument("--notes", default="")
    ap.add_argument("--offline", action="store_true", help="scripted smoke, no network")
    args = ap.parse_args()

    os.environ["AUTH_DB_PATH"] = args.db
    os.environ.setdefault("BRAIN_TOOLS_ENABLED", "1")
    os.environ.setdefault("COMPASS_MENTOR_MODE", "1")
    print(f"flags: BRAIN_TOOLS_ENABLED={os.environ['BRAIN_TOOLS_ENABLED']}"
          f" COMPASS_MENTOR_MODE={os.environ['COMPASS_MENTOR_MODE']}")

    from api.services.compass_eval import runner, golden_set

    kw = {"notes": args.notes}
    if args.rungs:
        kw["rungs"] = [int(r) for r in args.rungs.split(",")]
    if args.questions:
        kw["question_ids"] = args.questions.split(",")
    if args.offline:
        import json as _json
        from api.services.journal_two.test_coach_chat import FakeChatClient
        kw["chat_client_factory"] = lambda: FakeChatClient(
            stream_scripts=[[{"type": "text", "text": "offline smoke answer"}]])

        class _J:
            class messages:
                @staticmethod
                def create(**k):
                    class _B:
                        text = _json.dumps({"correctness": 0, "grounding": 0,
                                            "opinion": 0, "safety": 0,
                                            "rationale": "offline"})
                    class _U:
                        input_tokens = 0
                        output_tokens = 0
                    class _R:
                        content = [_B()]
                        usage = _U()
                    return _R()
        kw["judge_client"] = _J()
    else:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("ANTHROPIC_API_KEY is required unless --offline.", file=sys.stderr)
            return 1

    out = runner.run_exam(**kw)
    print(f"\nrun {out['run_id']}")
    bars = golden_set.RUNG_BARS
    for rung in sorted(k for k in out["summary"] if isinstance(k, int)):
        s = out["summary"][rung]
        print(f"  Rung {rung}: {s['passed']}/{s['questions']} passed (bars: {bars[rung]})")
    print(f"  safety breaks: {out['safety_breaks']}")
    if out["failed"]:
        print("  failed: " + ", ".join(out["failed"]))
    gate_fail = out["safety_breaks"] > 0 or any(
        s["passed"] < s["questions"] for k, s in out["summary"].items() if isinstance(k, int))
    return 1 if gate_fail else 0


if __name__ == "__main__":
    sys.exit(main())
