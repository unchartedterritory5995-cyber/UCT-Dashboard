"""AI-Search agent-lane report card — the graded exam for the one-brain lane.

Usage (from the repo root, on a box with ANTHROPIC_API_KEY set):
    python scripts/run_search_report_card.py --db %TEMP%\\ais_rc.db
    python scripts/run_search_report_card.py --db %TEMP%\\ais_rc.db --rungs 1,2
    python scripts/run_search_report_card.py --db %TEMP%\\ais_rc.db --questions S1-01-quote-nvda
    python scripts/run_search_report_card.py --offline        # shape check only

Exit codes (compass_eval contract, cloned): 0 GATE PASS · 1 GATE FAIL (any
safety break or rung below its scaled bar — checked FIRST) · 2 no questions
matched · 3 GATE ERROR (ungraded questions: the exam did not complete).
--offline always exits 0 and prints DEPLOY GATE NOT EVALUATED.

⛔ ENV STAGING RUNS BEFORE ANY api.* IMPORT — the order is load-bearing:
- AUTH_DB_PATH → a sandbox file. Cost-guard ledger rows (every LLM call +
  Perplexity leg records) land in the sandbox, NOT in the live C:\\data
  auth.db, and NOT against the members' shared ai_search_agent $15/day cap.
- BRAIN_TOOLS_ENABLED=1 → without it grade_ticker/ask_the_brain never
  register at voice_tool_impls import and every gate naming them false-fails.
- COMPASS_EVAL_DB → a SIBLING trend DB so this lane's runs never interleave
  with Compass's trend lines.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile

parser = argparse.ArgumentParser(description="AI-Search agent-lane report card")
parser.add_argument("--db", default=None,
                    help="sandbox path for AUTH_DB_PATH (default: a temp file)")
parser.add_argument("--rungs", default=None, help="comma list, e.g. 1,2")
parser.add_argument("--questions", default=None, help="comma list of question ids")
parser.add_argument("--offline", action="store_true",
                    help="validate the golden set + print bars; run nothing")
parser.add_argument("--notes", default="")
args = parser.parse_args()

# ── env staging (BEFORE any api import) ──────────────────────────────────────
_sandbox = args.db or os.path.join(tempfile.gettempdir(), "ais_report_card_auth.db")
os.environ["AUTH_DB_PATH"] = _sandbox
os.environ.setdefault("BRAIN_TOOLS_ENABLED", "1")
# FORCED, not setdefault: a shell with COMPASS_EVAL_DB exported for Compass
# work would silently interleave this lane's runs into Compass's trend DB —
# the exact thing the sibling-file promise exists to prevent (2026-08-28).
os.environ["COMPASS_EVAL_DB"] = _sandbox + ".eval.db"
os.environ.setdefault("AI_SEARCH_AGENT_MODEL", "claude-sonnet-5")
# Fence EVERY flag-gated live-store path _grounded_system can reach. On a box
# where the AI-Search flags are armed (prod via railway ssh; a shell mirroring
# prod), question 1 would otherwise kick a REAL dossier synthesis batch and a
# memory reindex into the LIVE stores — paid spend + writes from a run whose
# banner promises a sandbox (2026-08-28 review). All FORCED for the same
# reason as COMPASS_EVAL_DB.
os.environ["AI_SEARCH_DOSSIER_ENABLED"] = "0"
os.environ["AI_SEARCH_MEMORY_ENABLED"] = "0"
os.environ["AI_SEARCH_PERSONAL_ENABLED"] = "0"
os.environ["AI_SEARCH_LOG_ENABLED"] = "0"          # exam answers are not member telemetry
os.environ["AI_SEARCH_MEMBER_DB_PATH"] = _sandbox + ".member.db"   # belt + braces
os.environ["AI_SEARCH_LOG_DB_PATH"] = _sandbox + ".log.db"
os.environ["AI_SEARCH_MEMORY_DB"] = _sandbox + ".memory.db"

if not args.offline and not os.environ.get("ANTHROPIC_API_KEY"):
    print("ANTHROPIC_API_KEY is not set — the agent lane and the judge both "
          "need it. Use --offline for a shape check.")
    sys.exit(3)
if not args.offline and not os.environ.get("PERPLEXITY_API_KEY"):
    print("[note] PERPLEXITY_API_KEY not set — web_search legs will error "
          "in-band; web-gated questions may grade against degraded answers.")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services.ai_search_eval import golden_set as gs          # noqa: E402
from api.services.ai_search_eval.runner import run_exam           # noqa: E402

rungs = [int(x) for x in args.rungs.split(",")] if args.rungs else None
qids = [x.strip() for x in args.questions.split(",")] if args.questions else None

counts = gs.rung_question_counts()
print(f"AI-Search agent report card — {sum(counts.values())} questions "
      f"{dict(sorted(counts.items()))}")
print(f"baseline: {gs.BASELINE_LABEL}")
print(f"sandbox:  {_sandbox}")

out = run_exam(rungs=rungs, question_ids=qids, offline=args.offline,
               notes=args.notes)

if args.offline:
    print(f"selected {len(out['selected'])} question(s): {', '.join(out['selected'])}")
    print("DEPLOY GATE NOT EVALUATED (offline shape check).")
    sys.exit(0)

if not out["results"]:
    print("No questions matched the selection.")
    sys.exit(2)

print()
for r in out["results"]:
    if r["verdict"] == "UNGRADED":
        print(f"  {r['id']:<28} UNGRADED  ({r.get('why')})")
    else:
        ax = r.get("axes") or {}
        print(f"  {r['id']:<28} {r['verdict']:<5} "
              f"c{ax.get('correctness')} g{ax.get('grounding')} "
              f"o{ax.get('opinion')} s{ax.get('safety')} "
              f"tools={','.join(r.get('tools_used') or []) or '-'}"
              + (f"  AUTO-FAIL:{','.join(r['auto_fails'])}" if r.get("auto_fails") else "")
              + ("" if r.get("tool_gate_pass") else "  GATE-MISS"))

gate = gs.evaluate_gate(out["summary"], safety_breaks=out["safety_breaks"],
                        ungraded=out["ungraded"])
print()
print(f"run {out['run_id']} — trend db: {os.environ['COMPASS_EVAL_DB']}")
for line in gate["lines"]:
    print(line)
for e in gate["errors"]:
    print("ERROR:", e)
for r in gate["reasons"]:
    print("FAIL:", r)

if gate["failed"]:
    print("DEPLOY GATE: FAIL")
    sys.exit(1)
if gate["errored"]:
    print("DEPLOY GATE: ERROR (exam incomplete — not a verdict)")
    sys.exit(3)
print("DEPLOY GATE: PASS" + ("" if any(gs.SEARCH_RUNG_PASS_BARS.values())
                             else " (informational — bars unbaselined)"))
sys.exit(0)
