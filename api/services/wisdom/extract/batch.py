"""Batch submit and reap for extraction (W1 §4.6-4.7, CONTRACTS §6.4, §0 #11-12).

Wisdom-owned plumbing, deliberately NOT api/services/llm_batch.py: its ledger is a
shared JSON file, its client is engine's 60 s singleton, it abandons batches after
24 h and it hands its handler None with no error type. Here:

  * the client is anthropic.Anthropic(timeout=WISDOM_EXTRACT_LLM_TIMEOUT_SECS,
    default llm_timeouts.OFFLINE_JOB) — scheduler threads only, never a request;
  * every request is a row in wisdom_extract_requests BEFORE batches.create is
    called (status 'submitting'), so a crash between create and bookkeeping leaves
    a row adopt_orphans() can reconcile instead of a paid batch nobody reads;
  * custom_id = "wx_" + sha256(source_id|source_version|segment_ids|extractor_version)[:40],
    which always matches ^[a-zA-Z0-9_-]{1,64}$; request params carry no temperature,
    top_p, top_k, prefill or fallbacks; meta is pointers only (the row, not the text);
  * reap reads results lazily and tolerates a stream that dies mid-way: each result
    is handled in its own transaction guarded by the row status, so the next tick
    resumes where the last stopped and nothing is written twice;
  * errored / canceled / expired / max_tokens / unparseable results go back to
    'retry' with an attempt counter and an error_type (MAX_ATTEMPTS, then 'failed');
    a max_tokens retry is re-sent one effort level lower per attempt;
    an invalid_request or a refusal is terminal.

Idempotency key: one request per (segment, extractor_version, purpose); a segment
belongs to exactly one (source_id, source_version). A re-ingested source is a new
version with new segments and is extracted again; older provisional records are
superseded, never deleted.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from api.services import llm_timeouts
from api.services.wisdom.core import flags, store, timeutil
from api.services.wisdom.extract import budget, config, golden, prompt, seams, segmenter, writer

log = logging.getLogger(__name__)

CUSTOM_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
MAX_REQUESTS_PER_BATCH = 2000
DAILY_SEGMENT_LIMIT = 400
DAILY_SOURCE_LIMIT = 50
ORPHAN_AFTER_S = 15 * 60
ORPHAN_GIVE_UP_S = 6 * 3600
ORPHAN_LIST_LIMIT = 200
TRANSCRIPT_STREAMS = ("zoom_live", "workshop", "interview", "education")
BATCH_KINDS = ("extract", "audit")
_AMBIGUOUS_SUBMIT_ERRORS = ("APIConnectionError", "APITimeoutError", "ReadTimeout", "ConnectTimeout", "TimeoutError")


class ExtractUnavailable(RuntimeError):
    pass


#: ⛔⛔ THE WISDOM-SPECIFIC NAME EXISTS BECAUSE THE GENERIC ONE IS NOT FREE TO SET.
#: `ANTHROPIC_API_KEY` in the operator's shell is the variable **Claude Code itself** reads to
#: authenticate and bill. Exporting it to feed this gate changes how the agent session that
#: launches the gate is authenticated — a side effect nobody asked for, on the account that pays
#: for the session. `WISDOM_ANTHROPIC_API_KEY` lets the programme carry its own credential
#: without touching that. Owner ruling R32, 2026-09-15. §11.3 still applies to both: the value
#: lives in the environment, never in a file, and is never printed.
KEY_VARS = ("WISDOM_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY")

#: Where the OS credential store keeps the gate's key (R34, 2026-09-15).
KEYRING_SERVICE, KEYRING_USER = "uct-wisdom", "anthropic"


def key_from_keyring():
    """The OS credential store, as a THIRD source. Returns None on anything going wrong.

    ⭐ Why it never raises: a machine with no `keyring` installed, no backend, a locked store, or
    simply no entry must behave **exactly as it did before this existed** — fall through to the
    same `ExtractUnavailable`. A credential lookup that turns a missing optional dependency into a
    crash would make the gate harder to run, not easier.

    ⛔ Returns the value; never logs it, never reports its length, never reports which backend
    answered — a backend name is a small leak about the operator's machine and buys nothing.
    """
    try:
        import keyring  # optional, declared in requirements.txt

        value = keyring.get_password(KEYRING_SERVICE, KEYRING_USER)
    except Exception:
        return None
    return (value or "").strip() or None


def make_client():
    key = ""
    for name in KEY_VARS:
        key = os.environ.get(name, "").strip()
        if key:
            break
    if not key:
        # ⛔ The ENVIRONMENT is still preferred over the store. `railway run` and a one-off export
        # are both deliberate, visible acts scoped to one process; the store is ambient and
        # applies to every run on the machine, so it loses a tie.
        key = key_from_keyring() or ""
    if not key:
        # ⛔ Names both variables and the store, and NEITHER value — an error that quotes a key is
        # a key in a log.
        raise ExtractUnavailable(
            f"no API key: set {KEY_VARS[0]} (preferred) or {KEY_VARS[1]}, "
            f"or store one under keyring service {KEYRING_SERVICE!r} / user {KEYRING_USER!r}")
    import anthropic

    return anthropic.Anthropic(
        api_key=key,
        timeout=llm_timeouts.seconds("WISDOM_EXTRACT_LLM_TIMEOUT_SECS", llm_timeouts.OFFLINE_JOB),
    )


def custom_id_for(source_id: str, source_version: int, segment_ids: list[str], extractor_version: str, *,
                  purpose: str = "extract", salt: str = "") -> str:
    prefix = "wx_" if purpose == "extract" else "wa_"
    parts = [str(source_id), str(source_version), ",".join(segment_ids), extractor_version]
    if salt:
        parts.append(salt)
    cid = prefix + hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:40]
    if not CUSTOM_ID_RE.match(cid):
        raise ValueError(f"custom_id {cid!r} does not match the API's pattern")
    return cid


def _now_iso() -> str:
    return timeutil.iso_et(timeutil.now_et())


def _page(key: str, message: str, metadata: dict) -> None:
    try:
        from api.services import chart_health_alerts

        chart_health_alerts.emit(key, "critical", message, metadata)
    except Exception:
        log.exception("[wisdom-extract] could not page %s", key)


# ── segmentation of newly ingested sources ───────────────────────────────────

def _edu_video_id(source: dict) -> Optional[int]:
    for text in (source.get("external_ref"), source.get("home_pointer")):
        m = re.search(r"edu_videos(?::|\.id=)(\d+)", str(text or ""))
        if m:
            return int(m.group(1))
    return None


def load_payload(source: dict, loader: Optional[Callable] = None) -> Optional[dict]:
    fn = loader or seams.seam("api.services.wisdom.sources", "segment_payload")
    if fn is not None:
        payload = fn(dict(source))
        if payload:
            return payload
    stream = source.get("stream")
    if stream in TRANSCRIPT_STREAMS:
        video_id = _edu_video_id(source)
        if video_id is not None:
            from api.services import education_service

            cues = education_service.get_transcript_cues(video_id)
            if cues:
                chapters = (education_service.get_insights(video_id) or {}).get("chapters") or []
                return {"kind": "transcript", "cues": cues, "chapters": chapters}
    key = source.get("raw_r2_key")
    if key:
        from api.services.wisdom.core import r2

        data = r2.get(key)
        if data is None:
            return None
        if str(key).endswith(".gz"):
            data = gzip.decompress(data)
        text = data.decode("utf-8", errors="replace")
        if stream == "sunday_scans":
            return {"kind": "sunday_scans", "html": text} if text.lstrip().startswith("<") else \
                {"kind": "sunday_scans", "text": text}
        if stream == "discord":
            try:
                content = json.loads(text).get("content")
            except (ValueError, AttributeError):
                content = text
            return {"kind": "discord", "content": content or ""}
    return None


def segment_pending_sources(*, limit: int = DAILY_SOURCE_LIMIT, dry_run: bool = False,
                            loader: Optional[Callable] = None) -> dict:
    with store.read() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT s.* FROM wisdom_sources s WHERE NOT EXISTS (SELECT 1 FROM wisdom_segments g "
            "WHERE g.source_id = s.source_id AND g.source_version = s.version) ORDER BY s.ingested_at LIMIT ?",
            (int(limit),))]
    report: Counter = Counter()
    for source in rows:
        try:
            payload = load_payload(source, loader)
        except Exception:
            log.exception("[wisdom-extract] payload load failed for %s", source.get("source_id"))
            report["payload_error"] += 1
            continue
        if not payload:
            report["no_payload"] += 1
            continue
        segments = segmenter.segments_for_payload(payload)
        report["sources_segmented"] += 1
        report["segments"] += len(segments)
        if not dry_run and segments:
            with store.write() as conn:
                segmenter.write_segments(conn, source["source_id"], source["version"], segments)
    report["sources_considered"] = len(rows)
    return dict(report)


# ── building requests ────────────────────────────────────────────────────────

def pending_segments(conn, extractor_version: str, limit: int) -> list[dict]:
    rows = conn.execute(
        "SELECT g.* FROM wisdom_segments g JOIN wisdom_sources s ON s.source_id = g.source_id "
        "AND s.version = g.source_version WHERE s.incomplete = 0 AND NOT EXISTS ("
        "SELECT 1 FROM wisdom_extract_requests r WHERE r.segment_id = g.segment_id "
        "AND r.extractor_version = ? AND r.purpose = 'extract') "
        "ORDER BY COALESCE(s.recording_started_at_et, s.published_at_et, s.ingested_at) DESC, g.source_id, g.ordinal "
        "LIMIT ?", (extractor_version, int(limit))).fetchall()
    out = []
    for row in rows:
        seg = dict(row)
        seg["cue_map"] = segmenter.cue_map_for(conn, seg["segment_id"])
        out.append(seg)
    return out


def retry_rows(conn, extractor_version: str, purpose: str, limit: int) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM wisdom_extract_requests WHERE extractor_version = ? AND purpose = ? AND status = 'retry' "
        "ORDER BY updated_at LIMIT ?", (extractor_version, purpose, int(limit)))]


def char_estimate_tokens(params: dict) -> int:
    body = json.dumps(params.get("system")) + json.dumps(params.get("messages")) + json.dumps(
        params.get("output_config"))
    return max(1, len(body) // 3)


def count_input_tokens(client, params: dict) -> int:
    resp = client.messages.count_tokens(model=params["model"], system=params["system"],
                                        messages=params["messages"], output_config=params["output_config"])
    return int(resp.input_tokens)


def _build_items(client, segs: list[dict], retries: list[dict], *, extractor_version: str, model: str, effort: str,
                 purpose: str, salt: str, dry_run: bool, out_tokens: int) -> tuple[list[dict], Counter]:
    counts: Counter = Counter()
    system_text = prompt.system_prompt()
    items: list[dict] = []
    todo = [(seg, None) for seg in segs]
    with store.read() as conn:
        for row in retries:
            seg = writer.load_segment(conn, row["segment_id"]) if row.get("segment_id") else None
            if seg is None:
                counts["retry_segment_missing"] += 1
                continue
            todo.append((seg, row))
        sources = {}
        for seg, _row in todo:
            key = (seg["source_id"], seg["source_version"])
            if key not in sources:
                sources[key] = writer.load_source(conn, seg["source_id"], seg["source_version"])
    for seg, row in todo:
        source = sources.get((seg["source_id"], seg["source_version"]))
        if source is None:
            counts["source_missing"] += 1
            continue
        use_effort = effort
        if row is not None and row.get("error_type") == "max_tokens":
            # the same effort would think its way past max_tokens again: one level lower per attempt
            use_effort = config.lower_effort(effort, steps=int(row.get("attempt") or 1))
            counts[f"retry_effort:{use_effort}"] += 1
        params = prompt.build_params(seg, source, model=model, effort=use_effort, system_text=system_text,
                                     hints=prompt.asr_hints(seg))
        if row is not None and row.get("est_input_tokens"):
            tokens = int(row["est_input_tokens"])
        elif client is not None and not dry_run:
            try:
                tokens = count_input_tokens(client, params)
                counts["tokens_counted"] += 1
            except Exception as exc:
                counts[f"count_tokens_failed:{type(exc).__name__}"] += 1
                tokens = char_estimate_tokens(params)
        else:
            tokens = char_estimate_tokens(params)
            counts["tokens_char_estimated"] += 1
        est = budget.estimate_cost(model, tokens, out_tokens, batch=True)
        cid = row["custom_id"] if row is not None else custom_id_for(
            seg["source_id"], seg["source_version"], [seg["segment_id"]], extractor_version, purpose=purpose, salt=salt)
        items.append({"custom_id": cid, "source_id": seg["source_id"], "source_version": seg["source_version"],
                      "segment_id": seg["segment_id"], "params": params, "est_input_tokens": tokens,
                      "est_output_tokens": out_tokens, "est_cost_usd": est, "retry": row is not None,
                      "prior_est": float(row.get("est_cost_usd") or 0.0) if row is not None else 0.0})
    return items, counts


def submit_items(items: list[dict], client, *, extractor_version: str, model: str, purpose: str,
                 cap: float) -> dict:
    report: Counter = Counter()
    batch_ids: list[str] = []
    for start in range(0, len(items), MAX_REQUESTS_PER_BATCH):
        chunk = items[start:start + MAX_REQUESTS_PER_BATCH]
        now = _now_iso()
        live: list[dict] = []
        with store.write() as conn:
            for it in chunk:
                row = conn.execute("SELECT status FROM wisdom_extract_requests WHERE custom_id = ?",
                                   (it["custom_id"],)).fetchone()
                if row is None:
                    conn.execute(
                        "INSERT INTO wisdom_extract_requests (custom_id, batch_id, source_id, source_version, "
                        "segment_ids_json, extractor_version, attempt, status, segment_id, purpose, model, "
                        "est_input_tokens, est_output_tokens, est_cost_usd, created_at, updated_at) "
                        "VALUES (?, NULL, ?, ?, ?, ?, 1, 'submitting', ?, ?, ?, ?, ?, ?, ?, ?)",
                        (it["custom_id"], it["source_id"], it["source_version"], json.dumps([it["segment_id"]]),
                         extractor_version, it["segment_id"], purpose, model, it["est_input_tokens"],
                         it["est_output_tokens"], it["est_cost_usd"], now, now))
                elif row["status"] == "retry":
                    conn.execute(
                        "UPDATE wisdom_extract_requests SET status = 'submitting', attempt = attempt + 1, "
                        "batch_id = NULL, error = NULL, error_type = NULL, est_cost_usd = ?, updated_at = ? "
                        "WHERE custom_id = ?", (it["est_cost_usd"], now, it["custom_id"]))
                else:
                    report["skipped_not_retryable"] += 1
                    continue
                live.append(it)
        if not live:
            continue
        try:
            created = client.messages.batches.create(
                requests=[{"custom_id": it["custom_id"], "params": it["params"]} for it in live])
        except Exception as exc:
            name = type(exc).__name__
            report[f"submit_error:{name}"] += 1
            ambiguous = name in _AMBIGUOUS_SUBMIT_ERRORS
            permanent = getattr(exc, "status_code", None) in (400, 401, 403, 404, 413, 422)
            with store.write() as conn:
                for it in live:
                    if ambiguous:
                        conn.execute("UPDATE wisdom_extract_requests SET error_type = ?, error = ?, updated_at = ? "
                                     "WHERE custom_id = ?", (f"submit_unconfirmed:{name}", str(exc)[:500], now,
                                                             it["custom_id"]))
                    else:
                        conn.execute(
                            "UPDATE wisdom_extract_requests SET status = CASE WHEN ? OR attempt >= ? THEN 'failed' "
                            "ELSE 'retry' END, error_type = ?, error = ?, updated_at = ? WHERE custom_id = ?",
                            (int(permanent), config.MAX_ATTEMPTS, f"submit:{name}", str(exc)[:500], _now_iso(),
                             it["custom_id"]))
            continue
        with store.write() as conn:
            _record_batch(conn, created, live, extractor_version=extractor_version, model=model, purpose=purpose,
                          cap=cap)
        batch_ids.append(created.id)
        report["submitted"] += len(live)
    return {"batch_ids": batch_ids, **dict(report)}


def _record_batch(conn, created, live: list[dict], *, extractor_version: str, model: str, purpose: str,
                  cap: float) -> None:
    now = _now_iso()
    conn.execute(
        "INSERT OR IGNORE INTO wisdom_batches (batch_id, kind, extractor_version, model, submitted_at, status, "
        "request_count, cost_usd_estimate, cost_usd_actual, budget_cap_usd, checkpoint_json) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        (created.id, purpose, extractor_version, model, now, str(getattr(created, "processing_status", "submitted")),
         len(live), round(sum(it["est_cost_usd"] for it in live), 6), cap, json.dumps({"results_handled": 0})))
    for it in live:
        conn.execute("UPDATE wisdom_extract_requests SET batch_id = ?, status = 'submitted', updated_at = ? "
                     "WHERE custom_id = ?", (created.id, now, it["custom_id"]))


def submit_pending(ctx, *, client=None, limit: int = DAILY_SEGMENT_LIMIT, purpose: str = "extract",
                   segment_rows: Optional[list[dict]] = None, effort: Optional[str] = None, salt: str = "",
                   out: Optional[dict] = None) -> dict:
    out = dict(out or {})
    version = prompt.extractor_version()
    model = config.configured_model()
    effort = effort or config.configured_effort()
    out.setdefault("extractor_version", version)
    with store.read() as conn:
        retries = retry_rows(conn, version, purpose, limit)
        segs = segment_rows if segment_rows is not None else pending_segments(conn, version, max(0, limit - len(retries)))
        out_tokens = budget.output_token_estimate(conn, model, effort)
    if not retries and not segs:
        out["status"] = "nothing_to_do"
        return out
    if client is None and not ctx.dry_run:
        client = make_client()
    items, counts = _build_items(client, segs, retries, extractor_version=version, model=model, effort=effort,
                                 purpose=purpose, salt=salt, dry_run=ctx.dry_run, out_tokens=out_tokens)
    out["build"] = dict(counts)
    with store.read() as conn:
        decision = budget.select_within_budget(
            conn, version, [it["est_cost_usd"] for it in items],
            exclude_pending_usd=sum(it["prior_est"] for it in items if it["retry"]))
    out["budget"] = decision.as_dict()
    selected = items[:decision.allowed_count]
    out["candidates"] = len(items)
    out["selected"] = len(selected)
    out["selected_estimate_usd"] = round(sum(it["est_cost_usd"] for it in selected), 6)
    if decision.stopped:
        ctx.log(decision.reason)
        if not ctx.dry_run:
            _page(f"wisdom_extract_budget_stop:{version}", f"Wisdom extraction stopped at its budget: {decision.reason}",
                  {"extractor_version": version, "cap_usd": decision.cap_usd})
    if ctx.dry_run:
        out["status"] = "dry_run"
        return out
    if not selected:
        out["status"] = "budget_stop"
        return out
    out["submit"] = submit_items(selected, client, extractor_version=version, model=model, purpose=purpose,
                                 cap=decision.cap_usd)
    out["status"] = "budget_stop" if decision.stopped else "submitted"
    ctx.log(f"{purpose}: submitted {out['submit'].get('submitted', 0)} request(s), estimate "
            f"${out['selected_estimate_usd']:.2f}; budget remaining ${decision.remaining_usd:.2f}")
    return out


def run_daily(ctx, *, client=None, limit: int = DAILY_SEGMENT_LIMIT, loader: Optional[Callable] = None) -> dict:
    """Daily chain step: segment new sources, then extract NEW segments only — gated by
    WISDOM_EXTRACT_ENABLED, the golden gate and the budget."""
    version = prompt.extractor_version()
    model = config.configured_model()
    out = {"extractor_version": version, "model": model, "effort": config.configured_effort(),
           "dry_run": ctx.dry_run}
    if not ctx.force and not flags.extract_enabled():
        out.update(status="skipped", reason="WISDOM_EXTRACT_ENABLED is off")
        return out
    out["segmentation"] = segment_pending_sources(dry_run=ctx.dry_run, loader=loader)
    with store.read() as conn:
        gate = golden.gate_status(conn, extractor_version=version, model=model)
    out["gate"] = {k: gate.get(k) for k in ("accepted", "run_id", "reason")}
    if not gate["accepted"]:
        out["status"] = "blocked_by_gate"
        ctx.log(f"extraction blocked by the golden gate: {gate.get('reason')}")
        return out
    return submit_pending(ctx, client=client, limit=limit, purpose="extract", out=out)


# ── reaping ──────────────────────────────────────────────────────────────────

def _first_text(message) -> Optional[str]:
    for block in getattr(message, "content", None) or []:
        if getattr(block, "type", None) == "text":
            return getattr(block, "text", None)
    return None


def _finish(conn, req: dict, status: str, cost: float, usage: Optional[dict], *, error_type: Optional[str] = None,
            error: Optional[str] = None, report: Optional[dict] = None) -> str:
    conn.execute(
        "UPDATE wisdom_extract_requests SET status = ?, actual_cost_usd = actual_cost_usd + ?, usage_json = ?, "
        "error_type = ?, error = ?, records_written = ?, report_json = ?, updated_at = ? WHERE custom_id = ?",
        (status, float(cost), json.dumps(usage) if usage is not None else None, error_type,
         (error or "")[:500] or None, (report or {}).get("written"),
         json.dumps(report, sort_keys=True) if report is not None else None, _now_iso(), req["custom_id"]))
    return status


def _retry_or_fail(conn, req: dict, error_type: str, error: str, cost: float = 0.0,
                   usage: Optional[dict] = None) -> str:
    attempt = int(conn.execute("SELECT attempt FROM wisdom_extract_requests WHERE custom_id = ?",
                               (req["custom_id"],)).fetchone()[0])
    status = "failed" if attempt >= config.MAX_ATTEMPTS else "retry"
    return _finish(conn, req, status, cost, usage, error_type=error_type, error=error)


def handle_result(req: dict, item, batch_row: dict) -> str:
    """Handle ONE result in ONE transaction. Returns the request's resulting status."""
    result = getattr(item, "result", None)
    rtype = getattr(result, "type", None)
    model = req.get("model") or batch_row.get("model")
    with store.write() as conn:
        current = conn.execute("SELECT status, batch_id FROM wisdom_extract_requests WHERE custom_id = ?",
                               (req["custom_id"],)).fetchone()
        if current is None or current["status"] != "submitted" or current["batch_id"] != batch_row["batch_id"]:
            return current["status"] if current is not None else "unknown"
        if rtype == "succeeded":
            message = result.message
            cost = budget.cost_from_usage(model, getattr(message, "usage", None), batch=True)
            usage = budget.usage_dict(getattr(message, "usage", None))
            conn.execute("UPDATE wisdom_batches SET cost_usd_actual = COALESCE(cost_usd_actual, 0) + ? "
                         "WHERE batch_id = ?", (cost, batch_row["batch_id"]))
            stop = getattr(message, "stop_reason", None)
            if stop == "refusal":
                details = getattr(message, "stop_details", None)
                return _finish(conn, req, "failed", cost, usage, error_type="refusal",
                               error=str(getattr(details, "category", "") or ""))
            if stop == "max_tokens":
                return _retry_or_fail(conn, req, "max_tokens", "output hit max_tokens", cost, usage)
            try:
                output = json.loads(_first_text(message) or "")
            except ValueError as exc:
                return _retry_or_fail(conn, req, "json_decode", str(exc), cost, usage)
            segment = writer.load_segment(conn, req["segment_id"]) if req.get("segment_id") else None
            source = writer.load_source(conn, req["source_id"], req["source_version"])
            if segment is None or source is None:
                return _finish(conn, req, "failed", cost, usage, error_type="segment_or_source_missing")
            if req.get("purpose") == "audit":
                from api.services.wisdom.extract import audit

                report = audit.compare_and_queue(conn, segment=segment, source=source, output=output,
                                                 extractor_version=req["extractor_version"],
                                                 custom_id=req["custom_id"])
            else:
                report = writer.write_output(conn, segment=segment, source=source, output=output,
                                             extractor_version=req["extractor_version"])
            return _finish(conn, req, "done", cost, usage, report=report)
        if rtype == "errored":
            err = getattr(result, "error", None)
            inner = getattr(err, "error", None)
            error_type = getattr(inner, "type", None) or getattr(err, "type", None) or "errored"
            message = str(getattr(inner, "message", "") or "")
            if error_type in ("invalid_request_error", "invalid_request"):
                return _finish(conn, req, "failed", 0.0, None, error_type=error_type, error=message)
            return _retry_or_fail(conn, req, error_type, message)
        if rtype in ("canceled", "expired"):
            return _retry_or_fail(conn, req, rtype, rtype)
        return _retry_or_fail(conn, req, f"unknown_result:{rtype}", "")


def _progress(mb) -> dict:
    counts = getattr(mb, "request_counts", None)
    done = sum(int(getattr(counts, k, 0) or 0) for k in ("succeeded", "errored", "canceled", "expired"))
    processing = int(getattr(counts, "processing", 0) or 0)
    total = done + processing
    eta_s = None
    created = getattr(mb, "created_at", None)
    if isinstance(created, datetime) and done and processing:
        elapsed = (datetime.now(timezone.utc) - created.astimezone(timezone.utc)).total_seconds()
        eta_s = int(elapsed * processing / done)
    return {"status": getattr(mb, "processing_status", None), "done": done, "total": total, "eta_s": eta_s}


def _reap_batch(client, batch_row: dict, report: Counter) -> dict:
    batch_id = batch_row["batch_id"]
    with store.read() as conn:
        rows = {r["custom_id"]: dict(r) for r in conn.execute(
            "SELECT * FROM wisdom_extract_requests WHERE batch_id = ?", (batch_id,))}
    handled, partial = 0, None
    try:
        for item in client.messages.batches.results(batch_id):
            req = rows.get(getattr(item, "custom_id", None))
            if req is None:
                report["unknown_custom_id"] += 1
                continue
            if req["status"] != "submitted":
                continue
            req["status"] = handle_result(req, item, batch_row)
            report[f"result:{req['status']}"] += 1
            handled += 1
    except Exception as exc:
        partial = f"{type(exc).__name__}: {exc}"[:300]
    with store.write() as conn:
        if partial is None:
            missing = [cid for cid, r in rows.items() if r["status"] == "submitted"]
            for cid in missing:
                current = conn.execute("SELECT status FROM wisdom_extract_requests WHERE custom_id = ?",
                                       (cid,)).fetchone()
                if current is not None and current["status"] == "submitted":
                    _retry_or_fail(conn, rows[cid], "missing_result", "no result returned for this custom_id")
            conn.execute("UPDATE wisdom_batches SET status = 'reaped', checkpoint_json = ? WHERE batch_id = ?",
                         (json.dumps({"results_handled_last_tick": handled, "missing": len(missing),
                                      "reaped_at": _now_iso()}), batch_id))
            touched = {(r["source_id"], r["source_version"], r["extractor_version"]) for r in rows.values()}
            for source_id, version, extractor_version in touched:
                open_rows = conn.execute(
                    "SELECT COUNT(*) FROM wisdom_extract_requests WHERE source_id = ? AND source_version = ? "
                    "AND extractor_version = ? AND status NOT IN ('done', 'failed')",
                    (source_id, version, extractor_version)).fetchone()[0]
                if not open_rows:
                    report["superseded"] += writer.supersede_source_versions(conn, source_id, version,
                                                                             extractor_version)
        else:
            conn.execute("UPDATE wisdom_batches SET status = 'ended_partial', checkpoint_json = ? WHERE batch_id = ?",
                         (json.dumps({"results_handled_last_tick": handled, "error": partial,
                                      "at": _now_iso()}), batch_id))
            report["partial_batches"] += 1
    return {"batch_id": batch_id, "handled": handled, "partial": partial}


def adopt_orphans(client, *, now: Optional[datetime] = None) -> dict:
    """Rows left in 'submitting' (a crash or an ambiguous timeout around batches.create):
    adopt the batch whose results carry exactly those custom_ids; requeue only when no
    candidate batch exists and the rows are old enough that none ever will."""
    now = now or datetime.now(timezone.utc)
    with store.read() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT custom_id, updated_at, created_at, extractor_version, purpose, model, est_cost_usd "
            "FROM wisdom_extract_requests WHERE status = 'submitting' AND batch_id IS NULL")]
        known = {r[0] for r in conn.execute("SELECT batch_id FROM wisdom_batches")}
    report: Counter = Counter()
    groups: dict = {}
    for row in rows:
        stamp = timeutil.parse_iso(row["updated_at"])
        if stamp is None or (now - stamp).total_seconds() < ORPHAN_AFTER_S:
            continue
        groups.setdefault((row["updated_at"], row["extractor_version"], row["purpose"], row["model"]), []).append(row)
    if not groups:
        return {}
    recent = []
    for i, mb in enumerate(client.messages.batches.list(limit=100)):
        if i >= ORPHAN_LIST_LIMIT:
            break
        if mb.id not in known:
            recent.append(mb)
    for (stamp_iso, version, purpose, model), members in groups.items():
        stamp = timeutil.parse_iso(stamp_iso)
        ids_wanted = {m["custom_id"] for m in members}
        candidates = []
        for mb in recent:
            created = getattr(mb, "created_at", None)
            counts = getattr(mb, "request_counts", None)
            total = sum(int(getattr(counts, k, 0) or 0) for k in
                        ("processing", "succeeded", "errored", "canceled", "expired"))
            if isinstance(created, datetime) and abs((created - stamp).total_seconds()) <= 1800 \
                    and total == len(members):
                candidates.append(mb)
        adopted = False
        for mb in candidates:
            if getattr(mb, "processing_status", None) != "ended":
                report["orphan_candidate_not_ended"] += 1
                continue
            try:
                got = {getattr(item, "custom_id", None) for item in client.messages.batches.results(mb.id)}
            except Exception:
                report["orphan_results_unreadable"] += 1
                continue
            if got == ids_wanted:
                with store.write() as conn:
                    _record_batch(conn, mb, [{"custom_id": m["custom_id"], "est_cost_usd": m["est_cost_usd"] or 0.0}
                                             for m in members],
                                  extractor_version=version, model=model, purpose=purpose, cap=budget.budget_cap_usd())
                report["orphans_adopted"] += len(members)
                adopted = True
                break
        if adopted:
            continue
        if not candidates and (now - stamp).total_seconds() >= ORPHAN_GIVE_UP_S:
            with store.write() as conn:
                for m in members:
                    _retry_or_fail(conn, m, "submit_unconfirmed", "no batch carries these custom_ids")
            report["orphans_requeued"] += len(members)
            _page("wisdom_extract_orphans_requeued", f"{len(members)} extraction request(s) had no batch and were "
                  "requeued", {"extractor_version": version})
        else:
            report["orphans_waiting"] += len(members)
    return dict(report)


def reap(ctx, *, client=None) -> dict:
    """Short tick (wisdom_extract_reap, :16/:46): advance every open batch, handle ended ones,
    reconcile orphans, and report progress, cost so far and ETA."""
    out: dict = {"dry_run": ctx.dry_run}
    if not ctx.force and not flags.extract_enabled():
        out.update(status="skipped", reason="WISDOM_EXTRACT_ENABLED is off")
        return out
    marks = ",".join("?" for _ in BATCH_KINDS)
    with store.read() as conn:
        open_batches = [dict(r) for r in conn.execute(
            f"SELECT * FROM wisdom_batches WHERE kind IN ({marks}) AND status != 'reaped' ORDER BY submitted_at",
            BATCH_KINDS)]
        submitting = conn.execute("SELECT COUNT(*) FROM wisdom_extract_requests WHERE status = 'submitting'"
                                  ).fetchone()[0]
    if not open_batches and not submitting:
        out["status"] = "idle"
        out["totals"] = _totals()
        return out
    if client is None:
        client = make_client()
    report: Counter = Counter()
    if submitting and not ctx.dry_run:
        out["orphans"] = adopt_orphans(client)
    progress = []
    for batch_row in open_batches:
        try:
            mb = client.messages.batches.retrieve(batch_row["batch_id"])
        except Exception as exc:
            report[f"retrieve_error:{type(exc).__name__}"] += 1
            continue
        state = _progress(mb)
        state["batch_id"] = batch_row["batch_id"]
        progress.append(state)
        if state["status"] != "ended":
            if not ctx.dry_run:
                with store.write() as conn:
                    conn.execute("UPDATE wisdom_batches SET status = ?, checkpoint_json = ? WHERE batch_id = ?",
                                 (str(state["status"]), json.dumps(state), batch_row["batch_id"]))
            continue
        if ctx.dry_run:
            continue
        state["reap"] = _reap_batch(client, batch_row, report)
    out["progress"] = progress
    out["report"] = dict(report)
    out["totals"] = _totals()
    etas = [p["eta_s"] for p in progress if p.get("eta_s")]
    out["eta_s"] = max(etas) if etas else None
    out["status"] = "ok"
    ctx.log(f"reap: {len(progress)} open batch(es); cost so far ${out['totals']['actual_usd']:.2f}; "
            f"eta {out['eta_s']}s; {dict(report)}")
    return out


def _totals() -> dict:
    with store.read() as conn:
        actual = conn.execute("SELECT COALESCE(SUM(cost_usd_actual), 0) FROM wisdom_batches").fetchone()[0]
        statuses = {r[0]: r[1] for r in conn.execute(
            "SELECT status, COUNT(*) FROM wisdom_extract_requests GROUP BY status")}
    return {"actual_usd": round(float(actual or 0.0), 6), "requests": statuses}
