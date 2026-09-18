"""The Wisdom Loop chains: daily, weekly, monthly (W1 Part 7; CONTRACTS §5).

Each chain is an ordered list of steps. A step calls ONE public function of the
package that owns the work, always as fn(ctx) with the registry's JobContext,
so the package's own kill switch, idempotency and dry-run handling stay where
they belong. This module owns the ORDER and the record, nothing else.

Every step gets its own result entry and its own wisdom_chain_steps row:
  ok             the function returned, and nothing in its result says it declined to run
  failed         it raised, reported failure, or its module exists but will not import
  not_available  its module or attribute does not exist yet (named in the reason)
  skipped        with a reason: the step said so — AT ANY DEPTH of its result (R66) — a
                 flag W1 puts on the step itself is off, it is a documented in-line pass,
                 or it already succeeded for this due_key in an earlier run

⛔⛔ R66 — A STEP'S SKIP MARKERS ARE NOT ALWAYS AT THE TOP LEVEL, AND READING ONLY THE TOP
LEVEL RECORDED A STEP THAT DID NOTHING AS `ok`. Measured in production on 2026-09-16: the
`sources` step returned {"discord": {"skipped": …}, "transcripts": {"skipped": …}} — both
sub-streams declined, nothing was ingested — and the chain result AND the observation log
both said `ok`. `evals` does the same thing one level down ({"context": {"skipped": …},
"outcomes": {"skipped": …}, …}), so the same night reported two honest-looking `ok`s for two
steps that did no work at all. `_normalize` now WALKS the whole result; `_decide_outcome`
carries the rule, including the one for the mixed case.

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
    # ⚰️⚰️ R57 (owner ruling, 2026-09-15): THREE STEPS DELETED HERE, and they had never run.
    #
    #   reconcile_outcomes -> evals.reconcile_weekly            — not implemented anywhere
    #   vocab_candidates   -> core.vocab.refresh_candidates     — not implemented anywhere
    #   voice_profile      -> adapters.refresh_voice_profile    — not implemented anywhere
    #
    # ⛔ THE FAILURE WAS SILENT BY DESIGN. `resolve()` returns fn=None for an unresolvable target
    # and `_run_step` records `not_available` — a SKIP, not a failure. The chain stayed green, the
    # watchdog never paged, and three quarters of the weekly chain did nothing for the programme's
    # whole life. `not_available` exists so a chain can outlive an unbuilt module, and its price is
    # that an UNBUILT step is indistinguishable from a MISSPELLED one. A fourth step here was
    # misspelled (`run_weekly_audit` for `run_audit`) and IS fixed rather than deleted.
    #
    # ⭐ Deleted rather than left declared, because a step that cannot run is not a plan — it is a
    # green tick standing in for one. The intent is preserved as W2 backlog items in
    # docs/wisdom/OVERNIGHT-CHECKPOINTS.md, where it can be scheduled instead of skipped.
    # `tests/test_wisdom_chain_targets_resolve.py` now fails by name on any new unresolvable target.
    Step("contradictions", "publish", (("api.services.wisdom.publish.chain", "contradictions_refresh"),)),
    Step("weekly_report", "publish", (("api.services.wisdom.publish.report", "run_weekly"),)),
    # ⚰️⚰️ R57 (owner ruling, 2026-09-15). This named `run_weekly_audit`, WHICH DOES NOT EXIST —
    # not in `extract/__init__.py`, not anywhere in the repo. `resolve()` returned fn=None, the
    # step recorded `not_available`, and nothing paged, so **the weekly extraction audit had never
    # run once.** The step was not wrong to exist: RUNBOOK.md:108 and CONTRACTS.md:251 both specify
    # it ("S-D weekly 50-segment audit", gated by WISDOM_EXTRACT_AUDIT_ENABLED), and
    # `extract.run_audit` IS that implementation — it reads the flag at audit.py:54 and salts by
    # ISO week at audit.py:70. Only the NAME was wrong, in two artifacts at once
    # (extract/jobs.py:5 carries the same wrong name in prose).
    # ⛔ The rail that makes this unrepeatable is `test_wisdom_chain_targets_resolve.py`: every
    # step target in this table must import and resolve, so a typo fails by name instead of
    # degrading to a silent `not_available`.
    Step("extract_audit", "extract", (("api.services.wisdom.extract", "run_audit"),)),
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

# ── R66: the outcome is read from the WHOLE result, not its top level ────────
#
# ⛔⛔ THE RULE, AND THE MIXED CASE, IN ONE PLACE. A step's result is walked; every dict in it
# is a NODE that may declare it did nothing (a skip marker) or show that work happened (a write
# counter above zero, or an explicit `did_work`). Then:
#
#   skips and NO work   -> skipped, and the reason NAMES each sub-stream and its own sentence
#   skips AND work      -> ok, and the reason is mandatory: "partial: worked (…) but N
#                          sub-outcome(s) skipped — …"   ⭐ see below for why ok and not skipped
#   no skips            -> unchanged: ok (or failed, checked first)
#
# ⭐ WHY MIXED IS `ok` AND NOT `skipped`, and it is a real decision, not a default.
# `ok` is the ONLY status `_prior_ok_steps` treats as done, so it is also the resume contract:
# a catch-up re-runs everything that is not `ok`. A step that wrote rows must not have that
# half re-done on the next catch-up, so a partial run has to record `ok`. What makes it honest
# is that `reason` is NEVER null on a partial — and `reason` was previously null for EVERY ok
# step, so a non-null reason on an ok row now means exactly "this ran partially, here is what
# declined". `write_observation_log` prints the reason for ok rows too, for the same purpose.
#
# ⛔ SCOPE, stated so nobody reads this as more than it is. This judges DECLARED outcomes. A
# step that declares nothing and writes nothing (level_alerts on a day with no open calls)
# still reads `ok`: it did not decline, it had nothing to do, and inventing a skip for it would
# make the honest zero indistinguishable from a switched-off lane. Nested FAILURE markers are
# recorded in `_outcome` but do NOT change the status — `adapters.run_daily` is contractually
# allowed to swallow one adapter's failure, and changing that here would page for something the
# publish contract deliberately tolerates.

#: A node DECLARES it did nothing when it carries a truthy `skipped`, or one of these in
#: `status`. ⛔ Read off the real step payloads, never invented: `skipped`
#: (sources.run_daily, evals.pipeline.run_daily, retrieval.refresh, reconcile.score_silently,
#: evals.null_review), `skipped_holiday` (capture.runner), `nothing_to_do` /
#: `blocked_by_gate` / `night_budget_stop` (extract.batch), `not_available` (this module).
SKIP_STATUSES = frozenset({"skipped", "skipped_holiday", "nothing_to_do",
                           "not_available", "blocked_by_gate", "night_budget_stop"})

#: Evidence work actually HAPPENED: a write counter above zero, or the explicit `did_work`
#: marker a step sets when its counter has a name nothing here knows.
#: ⛔ A WHITELIST, NOT "any positive number". `floor: 0.8`, `lookback_days: 10`,
#: `candidates: 5`, `open_calls: 3` and `docs: 412` are thresholds, configuration and INPUTS —
#: counting them would let a step that skipped every sub-stream outvote its own skip markers,
#: which is the defect this walk exists to kill, re-committed one level down.
WORK_KEYS = frozenset({
    "written", "inserted", "updated", "created", "rows", "emitted", "submitted", "changed",
    "removed", "kept", "indexed_docs", "drafts", "example_drafts", "playbook_drafts",
    "crosses", "delivered", "scored", "matched_new", "replayed", "enqueued", "blocked",
    "retracted", "promoted", "keys", "tickers_badged", "entities_with_lines", "style_titles",
    "corpus_documents",
})
#: The same idea for the `<thing>_updated` / `<thing>_written` family (reconcile.write_scores
#: returns records_updated / principles_updated), so a new counter of that shape counts itself.
WORK_SUFFIXES = ("_written", "_inserted", "_updated", "_created", "_emitted", "_drafts", "_rows")

_WALK_MAX_DEPTH = 6
_WALK_MAX_NODES = 500
#: How many items a reason names before it says "+N more", and the reason's hard ceiling.
_REASON_ITEMS = 4
_REASON_MAX = 600


def _skip_text(node: dict) -> str:
    """The node's OWN sentence for why it did nothing.

    ⭐ When a node carries both (`evals.null_review` returns {"reason": "RQ-v11-001",
    "skipped": "no gate run recorded"}), both are printed: the old code took `reason` first and
    recorded the ticket number as the explanation.
    """
    marker = node.get("skipped")
    marker = marker.strip() if isinstance(marker, str) and marker.strip() else None
    reason = node.get("reason")
    reason = reason.strip() if isinstance(reason, str) and reason.strip() else None
    if marker and reason and marker != reason:
        return f"{marker} ({reason})"
    return marker or reason or "the step reported it skipped"


def _declares_skip(node: dict) -> bool:
    if node.get("skipped"):
        return True
    status = node.get("status")
    return isinstance(status, str) and status in SKIP_STATUSES


def _work_evidence(node: dict) -> list:
    """The write counters above zero in ONE node. `False`, `0`, negatives and NaN are not work."""
    hits: list = []
    if node.get("did_work"):
        hits.append(("did_work", node["did_work"]))
    for key, value in node.items():
        if key == "did_work" or not isinstance(value, (int, float)):
            continue
        if not value > 0:
            continue
        if key in WORK_KEYS or key.endswith(WORK_SUFFIXES):
            hits.append((key, value))
    return hits


def _item_label(key: str, item: dict, index: int) -> str:
    """A list entry is named by what it IS where it can be ("datasets.tweets"), never only by
    its position — an index tells a reader nothing about which sub-stream declined."""
    for name_key in ("dataset", "step", "name", "id", "run_id", "pass_index"):
        value = item.get(name_key)
        if isinstance(value, (str, int)) and not isinstance(value, bool) and str(value).strip():
            return f"{key}.{str(value).strip()}"
    return f"{key}[{index}]"


def _child_path(parent: str, label) -> str:
    return f"{parent}.{label}" if parent else str(label)


def walk_outcome(out, *, max_depth: int = _WALK_MAX_DEPTH, max_nodes: int = _WALK_MAX_NODES) -> dict:
    """Every dict inside a step's result, with the path that reaches it.

    {"skips": [(path, text)], "work": [(path, key, value)], "nodes": int, "truncated": bool}
    — the root's path is "".

    ⭐ ONE RULE FOR EVERY NODE: a node's skip declaration and its write counters are collected
    independently, so a node claiming `skipped` while reporting `written: 1` shows up as BOTH
    and is decided as mixed. Suppressing a skipping node's own counters would have made a
    declaration outrank a measurement, which is the shape of the defect, inverted.
    """
    skips: list = []
    work: list = []
    nodes = 0
    truncated = False
    queue = [("", out, 0)]
    while queue:
        path, node, depth = queue.pop(0)
        if not isinstance(node, dict):
            continue
        nodes += 1
        if nodes > max_nodes:
            truncated = True
            break
        if _declares_skip(node):
            skips.append((path, _skip_text(node)))
        work.extend((path, key, value) for key, value in _work_evidence(node))
        if depth >= max_depth:
            truncated = True
            continue
        for key, value in node.items():
            if isinstance(value, dict):
                queue.append((_child_path(path, key), value, depth + 1))
            elif isinstance(value, (list, tuple)):
                for index, item in enumerate(value):
                    if isinstance(item, dict):
                        queue.append((_child_path(path, _item_label(key, item, index)), item, depth + 1))
    return {"skips": skips, "work": work, "nodes": nodes, "truncated": truncated}


def _render(items: list, render_one, joiner: str) -> str:
    parts = [render_one(item) for item in items[:_REASON_ITEMS]]
    if len(items) > _REASON_ITEMS:
        parts.append(f"+{len(items) - _REASON_ITEMS} more")
    return joiner.join(parts)


def _decide_outcome(scan: dict) -> tuple:
    """(status, reason) from a walked result. The rule is the comment block above."""
    skips, work = scan["skips"], scan["work"]
    if not skips:
        return "ok", None
    named = _render(skips, lambda s: f"{s[0] or '<step>'} ({s[1]})", "; ")
    if not work:
        # ⭐ A skip declared ONLY at the top level keeps its exact old sentence, so every
        # existing reason string in wisdom_chain_steps still reads the same.
        if len(skips) == 1 and skips[0][0] == "":
            return "skipped", skips[0][1][:_REASON_MAX]
        return "skipped", f"skipped: {named}"[:_REASON_MAX]
    did = _render(work, lambda w: f"{(w[0] + '.') if w[0] else ''}{w[1]}={w[2]}", ", ")
    return "ok", (f"partial: worked ({did}) but {len(skips)} sub-outcome(s) "
                  f"skipped — {named}")[:_REASON_MAX]


def _normalize(out) -> tuple:
    if not isinstance(out, dict):
        return "ok", None, {"result": out}
    # ⛔ FAILURE IS READ FIRST. The old order asked about skips first, so a result carrying both
    # would have hidden a declared failure behind a nested skip once the walk went deep.
    if out.get("status") == "failed":
        return "failed", str(out.get("error") or "the step reported failure"), out
    try:
        scan = walk_outcome(out)
    except Exception:  # noqa: BLE001 — an outcome recorder that throws turns a healthy step red
        log.exception("[wisdom] could not walk a step result; falling back to its top level")
        scan = {"skips": ([("", _skip_text(out))] if _declares_skip(out) else []),
                "work": [], "nodes": 1, "truncated": True}
    status, reason = _decide_outcome(scan)
    if not scan["skips"]:
        return status, reason, out
    return status, reason, {**out, "_outcome": {
        "decision": "partial" if scan["work"] else "skipped",
        "skipped": [{"path": path, "reason": text} for path, text in scan["skips"]],
        "work": [{"path": path, "key": key, "value": value} for path, key, value in scan["work"]],
        "nodes": scan["nodes"], "truncated": scan["truncated"]}}


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
            # ⛔ R66: the reason is printed for an `ok` row too. `reason` is null for every
            # ordinary ok step, so the only ok rows this reaches are PARTIAL ones — and a
            # partial whose skipped half is invisible on the daily line is the same lie the
            # walk was written to stop, moved one artifact along.
            if r["reason"]:
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
