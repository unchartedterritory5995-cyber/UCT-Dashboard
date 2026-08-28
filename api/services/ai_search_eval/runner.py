"""AI-Search agent-lane exam runner.

Thin by design: compass_eval's runner exists to drive coach_chat through a
seeded j2 sandbox and read fired tools back out of chat rows; this lane's
entry point returns everything directly — run_agent(query, system, …,
capture=[]) hands back the answer AND the per-call {name, args, result}
ground truth. So the runner is: build the prod-faithful system prompt
(router._grounded_system — run_agent appends its own AGENT tail), run the
loop, feed compass_eval's mechanical checks + judge, score against this
lane's bars, store in the (sibling-file) trend store.

Prod-parity notes (from the 2026-08-28 analysis):
- BRAIN_TOOLS_ENABLED must be set before voice_tool_impls imports or
  grade_ticker/ask_the_brain silently vanish from the 16-tool schema and
  every gate naming them false-fails — the CLI stages it.
- Local grounding pieces are best-effort and may be cold (flow worker,
  brain index); each result records meta.grounding_sources so a
  cold-grounding run is legible in the stored rows.
- An exception or error out of run_agent lands in the UNGRADED lane (an
  exam-infrastructure fault is not a model verdict — D-22).
"""
from __future__ import annotations

import time
import uuid

from api.services.ai_search_eval.golden_set import (
    load_golden_set,
    question_passed,
)


def _judge_client():
    from api.services.engine import _get_anthropic_client
    return _get_anthropic_client()


def run_exam(*, rungs: list[int] | None = None, question_ids: list[str] | None = None,
             offline: bool = False, notes: str = "") -> dict:
    """Run the exam; returns {run_id, results, summary, safety_breaks, ungraded}.

    offline=True runs NOTHING against the model — it validates the golden set
    shape and prints the bars (the deploy gate is not evaluated; compass's
    --offline has the same semantics)."""
    from api.services.compass_eval import checks, judge, store
    from api.routers import ai_search as router
    from api.services.ai_search_agent import run_agent

    questions = load_golden_set()
    if rungs:
        questions = [q for q in questions if int(q["rung"]) in set(rungs)]
    if question_ids:
        wanted = set(question_ids)
        questions = [q for q in questions if q["id"] in wanted]
    run_id = uuid.uuid4().hex[:12]

    if offline:
        return {"run_id": run_id, "results": [], "summary": {},
                "safety_breaks": 0, "ungraded": 0,
                "selected": [q["id"] for q in questions], "offline": True}

    store.init_db()
    try:
        import subprocess
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        sha = "unknown"
    store.record_run(run_id, git_sha=sha or "unknown", mode="ai_search_agent",
                     model="", notes=notes or "agent-lane exam")

    jc = _judge_client()
    results: list[dict] = []
    summary: dict[int, dict] = {}
    safety_breaks = 0
    ungraded_total = 0

    for q in questions:
        rung = int(q["rung"])
        s = summary.setdefault(rung, {"questions": 0, "passed": 0, "ungraded": 0})
        capture: list[dict] = []
        grounding_note = ""
        t0 = time.time()
        try:
            system, _salt, meta = router._grounded_system(q["question"])
            grounding_note = ",".join(meta.get("grounding_sources") or []) or "none"
            res = run_agent(q["question"], system, [], None, capture=capture) or {}
        except Exception as e:   # infra fault → ungraded, never a model verdict
            res = {"answer": "", "error": f"harness: {type(e).__name__}"}
        elapsed = round(time.time() - t0, 1)

        transcript = {"answer": res.get("answer") or "",
                      "fired_tools": capture, "question": q}
        mech = checks.run_mechanical_checks(transcript)

        if res.get("error") and not res.get("answer"):
            # the lane returned nothing — exam infrastructure or provider fault
            ungraded_total += 1
            s["ungraded"] += 1
            axes = {"judge_error": f"agent error: {res.get('error')}"}
            store.record_score(run_id, q["id"], rung, axes, mech["auto_fails"],
                               mech["tool_gate_pass"], passed=False,
                               answer="", rationale=f"grounding={grounding_note}",
                               judge_error=axes["judge_error"])
            results.append({"id": q["id"], "rung": rung, "verdict": "UNGRADED",
                            "why": res.get("error"), "elapsed_s": elapsed})
            continue

        axes = judge.judge_answer(transcript, client=jc)
        if not judge.judged(axes):
            ungraded_total += 1
            s["ungraded"] += 1
            store.record_score(run_id, q["id"], rung, axes, mech["auto_fails"],
                               mech["tool_gate_pass"], passed=False,
                               answer=transcript["answer"],
                               rationale=f"grounding={grounding_note}",
                               judge_error=axes.get("judge_error"))
            results.append({"id": q["id"], "rung": rung, "verdict": "UNGRADED",
                            "why": axes.get("judge_error"), "elapsed_s": elapsed})
            continue

        passed = question_passed(rung, axes, mech["auto_fails"], mech["tool_gate_pass"])
        s["questions"] += 1
        if passed:
            s["passed"] += 1
        if mech["auto_fails"]:
            safety_breaks += 1
        store.record_score(run_id, q["id"], rung, axes, mech["auto_fails"],
                           mech["tool_gate_pass"], passed=passed,
                           answer=transcript["answer"],
                           rationale=(axes.get("rationale") or "")[:400]
                                     + f" | grounding={grounding_note}"
                                     + f" | tools={','.join(res.get('tools_used') or [])}",
                           judge_error=None)
        results.append({
            "id": q["id"], "rung": rung,
            "verdict": "PASS" if passed else "FAIL",
            "axes": {k: axes.get(k) for k in ("correctness", "grounding", "opinion", "safety")},
            "auto_fails": mech["auto_fails"],
            "tool_gate_pass": mech["tool_gate_pass"],
            "tools_used": res.get("tools_used") or [],
            "grounding": grounding_note,
            "elapsed_s": elapsed,
        })

    return {"run_id": run_id, "results": results, "summary": summary,
            "safety_breaks": safety_breaks, "ungraded": ungraded_total}
