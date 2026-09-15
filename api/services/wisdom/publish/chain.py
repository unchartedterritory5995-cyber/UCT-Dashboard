"""The Wisdom Loop chains: daily, weekly, monthly (W1 Part 7; CONTRACTS §5).

Each chain is an ordered list of steps. A step calls ONE public function of the
package that owns the work, always as fn(ctx) with the registry's JobContext,
so the package's own kill switch, idempotency and dry-run handling stay where
they belong. This module owns the ORDER and the record, nothing else.

Every step gets its own result entry and its own wisdom_chain_steps row:
  ok             the function returned
  failed         it raised, reported failure, or its module exists but will not import
  not_available  its module or attribute does not exist yet (named in the reason)
  skipped        with a reason: the step said so, a flag W1 puts on the step itself
                 is off, it is a documented in-line pass, or it already succeeded
                 for this due_key in an earlier run

⛔ ONE FAILING STEP NEVER STOPS THE REST. Each call is isolated, and each row is
written as its step finishes, so a crash mid-chain leaves the trail up to it.

⛔ A FAILED STEP FAILS THE CHAIN, AFTER EVERY STEP HAS RUN. The job then raises,
so the registry records the run as failed and pages; returning "ok" would hide
the failure from the watchdog. The core catch-up re-runs a failed slot within its
grace window, and on that re-run steps already 'ok' for the same due_key are
skipped, so only the failed and unfinished work repeats.

A step whose module is not built yet is NOT a chain failure: Wave 1 ships the
chains before several packages exist, dark, and the dashboard names what is
missing.
"""
from __future__ import annotations

import importlib
import json
import logging
import time
from dataclasses import dataclass
from typing import Callable, Optional

from api.services.wisdom.core import flags, store, timeutil
from api.services.wisdom.publish.schema import module_available

log = logging.getLogger(__name__)

CHAINS = ("daily", "weekly", "monthly")
STEP_STATUSES = ("ok", "failed", "not_available", "skipped")
STREAMS = ("capture", "sources", "extract", "evals", "publish")
_RESULT_JSON_MAX = 20_000


@dataclass(frozen=True)
class Step:
    name: str
    stream: str
    targets: tuple = ()                               # ((module, attribute), ...) first found wins
    gate: Optional[Callable[[], bool]] = None         # only where W1 flags the step itself
    gate_env: Optional[str] = None
    inline_note: Optional[str] = None                 # a pass that runs inside another step


# W1 Part 7 daily order. Context snapshot -> outcomes -> CALL-REPLAY run inside
# evals.run_daily; Brain KB publish and every other consumer run inside
# publish.adapters.run_daily, each behind its own flag (dark previews when off).
DAILY: tuple = (
    Step("capture", "capture", (("api.services.wisdom.capture", "run_all"),)),
    Step("sources", "sources", (("api.services.wisdom.sources", "run_daily"),)),
    Step("stt_alias", "extract", inline_note="the STT/alias pass runs inside extract.run_daily, "
                                             "before any segment reaches the extractor"),
    Step("extract", "extract", (("api.services.wisdom.extract", "run_daily"),)),
    Step("evals", "evals", (("api.services.wisdom.evals", "run_daily"),)),
    Step("retrieval", "publish", (("api.services.wisdom.publish.retrieval", "refresh"),)),
    Step("adapters", "publish", (("api.services.wisdom.publish.adapters", "run_daily"),)),
    Step("level_alerts", "publish", (("api.services.wisdom.publish.level_alerts", "score_silently"),)),
    Step("lookalike", "publish", (("api.services.wisdom.publish.lookalike", "score_silently"),)),

    # RQ-v11-001 (owner ruling R7, 2026-09-15). Runs AFTER the gate's numbers exist and BEFORE
    # the publication floor, so a NULL false positive on PRINCIPLE or MARKET_SIGNAL reaches the
    # owner's queue as a question rather than being scored against the extractor as a verdict.
    # ⛔ Not flag-gated: it writes only to the admin review queue and publishes nothing, and a
    # queue that can be switched off is a queue nobody trusts. A no-op until a gate run exists.
    Step("rq_v11_001", "evals", (("api.services.wisdom.evals.null_review", "score_silently"),)),

    # Wave 1.5 item 2. ⛔ BEFORE publication_floor, and the order is load-bearing: the floor reads
    # `stability` and `stability_runs`, so a reconciliation that ran AFTER it would leave the floor
    # judging yesterday's scores — every record blocked on a NULL the reconciler had just filled in.
    # A no-op until MIN_RUNS compatible runs are persisted, which is the state on a fresh box.
    Step("reconcile_stability", "extract", (("api.services.wisdom.extract.reconcile", "score_silently"),)),
    # ⛔⛔ Item 3's SECOND half, and it is not optional. The four filter sites BLOCK a below-floor
    # PRINCIPLE or MARKET_SIGNAL; this is what makes one SURFACE. The owner's rule is "2/3 may
    # surface only in the admin review queue", and the queue is NOT upstream of the Brain KB,
    # Ask-AI or dossier lanes — nothing enqueues a PRINCIPLE on the publish path — so blocking
    # alone would make a blocked record vanish rather than surface. Idempotent: review.enqueue
    # keys on item_id_for(tab, subject_ref, new), so re-running produces one row, not a flood.
    Step("publication_floor", "publish", (("api.services.wisdom.publish.floor", "score_silently"),)),
)

# W1 Part 7 weekly order (Sunday, after Sunday Scans publishes).
WEEKLY: tuple = (
    Step("sunday_scans", "sources", (("api.services.wisdom.sources", "run_weekly_sunday_scans"),)),
    Step("reconcile_outcomes", "evals", (("api.services.wisdom.evals", "reconcile_weekly"),)),
    Step("vocab_candidates", "core", (("api.services.wisdom.core.vocab", "refresh_candidates"),)),
    Step("contradictions", "publish", (("api.services.wisdom.publish.chain", "contradictions_refresh"),)),
    Step("voice_profile", "publish", (("api.services.wisdom.publish.adapters", "refresh_voice_profile"),),
         gate=flags.voice_profile_enabled, gate_env="WISDOM_VOICE_PROFILE_ENABLED"),
    Step("weekly_report", "publish", (("api.services.wisdom.publish.report", "run_weekly"),)),
    Step("extract_audit", "extract", (("api.services.wisdom.extract", "run_weekly_audit"),)),
)

# W1 Part 7 monthly (first Sunday): the recognition proposal packet, dark.
MONTHLY: tuple = (
    Step("recognition_packet", "publish", (("api.services.wisdom.publish.report", "build_monthly_packet"),)),
)

STEPS = {"daily": DAILY, "weekly": WEEKLY, "monthly": MONTHLY}


class ChainStepsFailed(RuntimeError):
    def __init__(self, chain: str, failed: list, result: dict):
        super().__init__(f"{chain} chain: step(s) failed: {', '.join(failed)} "
                         f"(detail in wisdom_chain_steps run {result.get('chain_run_id')})")
        self.result = result


# ── resolution ───────────────────────────────────────────────────────────────

def resolve(step: Step) -> dict:
    """{'fn', 'target', 'tried', 'import_error'} — never raises."""
    tried: list[str] = []
    for module, attr in step.targets:
        label = f"{module}.{attr}"
        tried.append(label)
        if not module_available(module):
            continue
        try:
            mod = importlib.import_module(module)
        except Exception as exc:
            return {"fn": None, "target": label, "tried": tried,
                    "import_error": f"{module} failed to import: {type(exc).__name__}: {exc}"}
        fn = getattr(mod, attr, None)
        if callable(fn):
            return {"fn": fn, "target": label, "tried": tried, "import_error": None}
    return {"fn": None, "target": tried[0] if tried else step.name, "tried": tried, "import_error": None}


def _missing_reason(step: Step, tried: list[str]) -> str:
    parts = []
    for (module, attr), label in zip(step.targets, tried):
        parts.append(f"{label} (module present, no {attr})" if module_available(module)
                     else f"{label} (module {module} not built)")
    return "not built yet: " + "; ".join(parts)


def catalogue() -> dict:
    """Every chain's steps and whether each target resolves right now."""
    out = {}
    for chain, steps in STEPS.items():
        rows = []
        for ordinal, step in enumerate(steps):
            if step.inline_note:
                rows.append({"ordinal": ordinal, "step": step.name, "stream": step.stream,
                             "target": None, "available": None, "note": step.inline_note})
                continue
            res = resolve(step)
            rows.append({"ordinal": ordinal, "step": step.name, "stream": step.stream, "target": res["target"],
                         "available": res["fn"] is not None, "gate_env": step.gate_env,
                         "note": res["import_error"] or (None if res["fn"] else _missing_reason(step, res["tried"]))})
        out[chain] = rows
    return out


# ── running ──────────────────────────────────────────────────────────────────

def _normalize(out) -> tuple:
    if isinstance(out, dict):
        status = out.get("status")
        if status == "skipped" or out.get("skipped"):
            reason = out.get("reason") or out.get("skipped")
            return "skipped", reason if isinstance(reason, str) else "the step reported it skipped", out
        if status == "failed":
            return "failed", str(out.get("error") or "the step reported failure"), out
        return "ok", None, out
    return "ok", None, {"result": out}


def _dumps(value) -> Optional[str]:
    if value is None:
        return None
    text = json.dumps(value, default=str, ensure_ascii=False)
    if len(text) > _RESULT_JSON_MAX:
        text = json.dumps({"truncated": True, "head": text[:_RESULT_JSON_MAX]}, ensure_ascii=False)
    return text


def _prior_ok_steps(chain: str, due_key: str) -> dict:
    with store.read() as conn:
        return {r["step"]: r["chain_run_id"] for r in conn.execute(
            "SELECT step, chain_run_id FROM wisdom_chain_steps "
            "WHERE chain = ? AND due_key = ? AND status = 'ok' AND dry_run = 0", (chain, due_key))}


def _persist(ctx, chain: str, entry: dict) -> Optional[str]:
    try:
        with store.write() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO wisdom_chain_steps (chain_run_id, chain, due_key, ordinal, step, target, "
                "status, reason, dry_run, started_at, finished_at, result_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (ctx.run_id, chain, ctx.due_key, entry["ordinal"], entry["step"], entry["target"] or entry["step"],
                 entry["status"], entry["reason"], int(bool(ctx.dry_run)), entry["started_at"],
                 entry["finished_at"], _dumps(entry.get("result"))),
            )
        return None
    except Exception as exc:
        log.exception("[wisdom] could not record chain step %s/%s", chain, entry["step"])
        return f"{type(exc).__name__}: {exc}"


def _run_step(step: Step, ctx, prior_ok: dict) -> dict:
    status, reason, payload, target = "ok", None, None, None
    if step.name in prior_ok:
        status, reason = "skipped", f"already ok for {ctx.due_key} in run {prior_ok[step.name]}"
    elif step.inline_note:
        status, reason = "skipped", step.inline_note
    elif step.gate is not None and not step.gate():
        status, reason = "skipped", f"{step.gate_env} is off"
    else:
        res = resolve(step)
        target = res["target"]
        if res["import_error"]:
            status, reason = "failed", res["import_error"]
        elif res["fn"] is None:
            status, reason = "not_available", _missing_reason(step, res["tried"])
        else:
            try:
                status, reason, payload = _normalize(res["fn"](ctx))
            except Exception as exc:
                status, reason = "failed", f"{type(exc).__name__}: {exc}"[:2000]
                log.exception("[wisdom] chain step %s raised", step.name)
    return {"step": step.name, "stream": step.stream, "target": target, "status": status,
            "reason": reason, "result": payload}


def run_chain(chain: str, ctx, steps: Optional[tuple] = None) -> dict:
    steps = STEPS[chain] if steps is None else steps
    prior_ok = _prior_ok_steps(chain, ctx.due_key) if (ctx.due_key and not ctx.dry_run) else {}
    results = []
    for ordinal, step in enumerate(steps):
        started, t0 = timeutil.iso_et(timeutil.now_et()), time.monotonic()
        entry = {"ordinal": ordinal, **_run_step(step, ctx, prior_ok), "started_at": started}
        entry["finished_at"] = timeutil.iso_et(timeutil.now_et())
        entry["seconds"] = round(time.monotonic() - t0, 3)
        persist_error = _persist(ctx, chain, entry)
        if persist_error:
            entry["persist_error"] = persist_error
        ctx.log(f"{chain}:{step.name} -> {entry['status']}" + (f" ({entry['reason']})" if entry["reason"] else ""))
        results.append(entry)
    summary = {s: sum(1 for r in results if r["status"] == s) for s in STEP_STATUSES}
    out = {"chain": chain, "chain_run_id": ctx.run_id, "due_key": ctx.due_key, "dry_run": bool(ctx.dry_run),
           "summary": summary, "steps": [{k: v for k, v in r.items() if k != "result"} for r in results]}
    if chain == "daily":
        out["observation_log"] = write_observation_log(ctx, chain, results)
    return out


def _payload_numbers(payload) -> str:
    if not isinstance(payload, dict):
        return ""
    nums = [f"{k}={v}" for k, v in payload.items() if isinstance(v, (int, float)) and not isinstance(v, bool)]
    return (" " + " ".join(nums[:3])) if nums else ""


def write_observation_log(ctx, chain: str, results: list) -> list:
    lines = []
    for stream in STREAMS:
        mine = [r for r in results if r["stream"] == stream]
        if not mine:
            continue
        parts = []
        for r in mine:
            text = f"{r['step']}={r['status']}{_payload_numbers(r.get('result'))}"
            if r["status"] != "ok" and r["reason"]:
                text += f" ({r['reason'][:120]})"
            parts.append(text)
        lines.append({"stream": stream, "line": "; ".join(parts)})
    try:
        now_iso = timeutil.iso_et(timeutil.now_et())
        with store.write() as conn:
            for entry in lines:
                conn.execute(
                    "INSERT OR REPLACE INTO wisdom_observation_log (chain_run_id, chain, due_key, stream, line, "
                    "dry_run, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (ctx.run_id, chain, ctx.due_key, entry["stream"], entry["line"][:2000],
                     int(bool(ctx.dry_run)), now_iso))
    except Exception:
        log.exception("[wisdom] could not write the observation log for run %s", ctx.run_id)
    return lines


def _job(chain: str, ctx) -> dict:
    result = run_chain(chain, ctx)
    failed = [s["step"] for s in result["steps"] if s["status"] == "failed"]
    if failed:
        raise ChainStepsFailed(chain, failed, result)
    return result


def daily_job(ctx) -> dict:
    return _job("daily", ctx)


def weekly_job(ctx) -> dict:
    return _job("weekly", ctx)


def monthly_job(ctx) -> dict:
    return _job("monthly", ctx)


# ── this module's own step ───────────────────────────────────────────────────

def contradictions_refresh(ctx) -> dict:
    """Weekly: queue every principle/record pair linked 'contradicts'. A dry run only counts."""
    from api.services.wisdom.publish import review

    if ctx.dry_run:
        with store.read() as conn:
            pairs = conn.execute(
                "SELECT COUNT(*) FROM wisdom_principle_support WHERE relation = 'contradicts'").fetchone()[0]
        return {"dry_run": True, "pairs": pairs}
    with store.write() as conn:
        return review.refresh_contradictions(conn, now=ctx.now_et)


# ── reading ──────────────────────────────────────────────────────────────────

def last_runs(conn) -> dict:
    """The latest run of each chain with its steps in order (None when a chain never ran)."""
    out: dict = {}
    for chain in CHAINS:
        head = conn.execute(
            "SELECT chain_run_id, due_key, MAX(dry_run) AS dry_run, MIN(started_at) AS started_at, "
            "MAX(finished_at) AS finished_at FROM wisdom_chain_steps WHERE chain = ? "
            "GROUP BY chain_run_id ORDER BY started_at DESC LIMIT 1", (chain,)).fetchone()
        if head is None:
            out[chain] = None
            continue
        steps = [dict(r) for r in conn.execute(
            "SELECT ordinal, step, target, status, reason, started_at, finished_at FROM wisdom_chain_steps "
            "WHERE chain_run_id = ? ORDER BY ordinal", (head["chain_run_id"],))]
        out[chain] = {**dict(head), "dry_run": bool(head["dry_run"]), "steps": steps,
                      "summary": {s: sum(1 for x in steps if x["status"] == s) for s in STEP_STATUSES}}
    return out
