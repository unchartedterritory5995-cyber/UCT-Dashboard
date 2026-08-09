#!/usr/bin/env python
"""Run the Compass report card.

Exit codes — three different facts, three different numbers:
  0  GATE PASS
  1  GATE FAIL     — a safety break, or a rung below its bar. A real regression.
  2  no questions matched --rungs/--questions.
  3  GATE ERROR    — the exam did not complete: one or more questions came back
                     UNGRADED (the judge returned no usable score). ⛔ Not a
                     verdict on Compass, and deliberately NOT 1 — an unread exam
                     paper is not a wrong answer. Re-run; do not "fix" it by
                     retrying just the ungraded questions until they parse.
  1 wins over 3 when both happen: an error must never mask a measured failure.

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

    # ⏱️ Compass chat now bounds a whole member TURN, not just each call — a
    # request-path budget, sized for someone staring at a spinner. The exam is an
    # OPERATOR SCRIPT in its own process: nobody is waiting on a socket, a Rung
    # 4/5 watchlist question legitimately chains several tool rounds, and cutting
    # one short just burns the tokens it already spent. So this lane buys itself
    # the OFFLINE_JOB budget — by env, per process, exactly the escape hatch
    # DESK_CHAPTERS_LLM_TIMEOUT_SECS gives the scheduler lane. `setdefault`, so
    # an operator can still pin it lower. ⛔ It is a longer bound, never an
    # absent one: llm_timeouts.seconds() refuses 0/blank/negative.
    from api.services import llm_timeouts
    os.environ.setdefault("COMPASS_CHAT_TURN_BUDGET_SECS",
                          str(int(llm_timeouts.OFFLINE_JOB)))
    os.environ.setdefault("COMPASS_CHAT_LLM_TIMEOUT_SECS",
                          str(int(llm_timeouts.REQUEST_PATH_LONG)))
    print(f"flags: BRAIN_TOOLS_ENABLED={os.environ['BRAIN_TOOLS_ENABLED']}"
          f" COMPASS_MENTOR_MODE={os.environ['COMPASS_MENTOR_MODE']}"
          f" COMPASS_CHAT_TURN_BUDGET_SECS={os.environ['COMPASS_CHAT_TURN_BUDGET_SECS']}")

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
    rungs_present = [k for k in out["summary"] if isinstance(k, int)]
    if not rungs_present:
        print("error: no questions matched the --rungs/--questions filters "
              "(check ids against api/services/compass_eval/golden_set.json)",
              file=sys.stderr)
        return 2
    print(f"\nrun {out['run_id']}")
    gate = golden_set.evaluate_gate(out["summary"],
                                    safety_breaks=out["safety_breaks"],
                                    ungraded=out["judge_errors"])
    for line in gate["lines"]:
        print(line)
    print(f"  safety breaks: {out['safety_breaks']}")
    if out["failed"]:
        print("  failed: " + ", ".join(out["failed"]))
    for u in out["ungraded"]:
        print(f"  UNGRADED {u['id']}: {u['reason']}")
    print(f"  bars measured against: {golden_set.BASELINE_LABEL}")

    if args.offline:
        # --offline replays SCRIPTED answers through a stub judge that returns
        # all-zero axes. It proves the harness runs; it grades nothing. Making
        # it exit 1 on the deploy gate was how the exit code stopped meaning
        # anything — every smoke run "failed", so a real failure read the same.
        print("OFFLINE SMOKE - harness ran. DEPLOY GATE NOT EVALUATED "
              "(scripted answers, stub judge). This exit code is not a verdict "
              "on Compass.")
        return 0

    if gate["failed"]:
        # Checked FIRST on purpose: an ungraded question must never mask a
        # measured regression by downgrading the run to "error".
        print("GATE FAIL: " + "; ".join(gate["reasons"]))
        return 1
    if gate["errored"]:
        print("GATE ERROR: " + "; ".join(gate["errors"]))
        return 3
    print("GATE PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
