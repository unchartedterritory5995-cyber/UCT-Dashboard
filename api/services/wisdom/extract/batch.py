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
    # THE $0 BRANCH, AND IT COMES FIRST ON PURPOSE. Everything below this point reads an API
    # key and imports the paid SDK; a local run must reach none of it. Branching here rather
    # than inside the paid construction is what makes "the local path cannot spend" a
    # structural property instead of a promise - tests assert the SDK is never imported.
    from api.services.wisdom.extract import config

    if config.is_local():
        from api.services.wisdom.extract import local_backend

        return local_backend.make_local_client()
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
    """Fresh segments (zero extract requests at this version) — R100 (owner ruling, 2026-09-18):
    ordered by `config.category_priority_order()` first, unknown categories last, then by source
    date descending within a category, then by (source_id, ordinal) for a total order.

    ⛔⛔ TWO-PHASE FETCH, deliberately. The pending pool can be the whole back catalog (26,454
    segments at session 25); loading full segment TEXT — the field the ORDER BY never needs —
    for every one of them just to sort would be a real memory cost paid every night. Phase 1
    fetches only the columns the sort needs (no `text`, no cue_map, no join beyond `show` and the
    date coalesce); phase 2 re-fetches full rows, in the derived order, for the `limit`-sized
    slice phase 1 actually selected.

    ⭐ **Backward-compatible by construction, not by branch.** A segment whose source has no `show`
    (every fixture written before R100, and every test that doesn't care about category) ranks as
    "unknown" alongside every other uncategorised segment — which means they all tie on rank and
    fall through to the SAME date-desc/source_id/ordinal order the query used before this ruling.
    Category priority only changes anything once `show` values start matching the order.
    """
    from api.services.wisdom.extract import prescreen
    from tools.wisdom.category_norm import normalize_category

    if int(limit) <= 0:
        return []
    order = config.category_priority_order()
    rank_map = {name: i for i, name in enumerate(order)}
    unknown_rank = len(order)
    candidates = [dict(r) for r in conn.execute(
        "SELECT g.segment_id, g.source_id, g.ordinal, s.show AS show, "
        "COALESCE(s.recording_started_at_et, s.published_at_et, s.ingested_at) AS sort_date "
        "FROM wisdom_segments g JOIN wisdom_sources s ON s.source_id = g.source_id "
        "AND s.version = g.source_version WHERE s.incomplete = 0 AND NOT EXISTS ("
        "SELECT 1 FROM wisdom_extract_requests r WHERE r.segment_id = g.segment_id "
        "AND r.extractor_version = ? AND r.purpose = 'extract')",
        (extractor_version,)).fetchall()]
    # ⛔ least-significant key first — Timsort's stability is what lets three single-key sorts
    # express "rank asc, then date desc, then source_id/ordinal asc" without inverting a date
    # STRING (ISO-8601 sorts lexicographically; there is no clean negation of a string short of
    # a second representation).
    candidates.sort(key=lambda c: (c["source_id"], c["ordinal"]))
    candidates.sort(key=lambda c: c["sort_date"] or "", reverse=True)
    candidates.sort(key=lambda c: rank_map.get(
        normalize_category(c["show"]) if c["show"] else None, unknown_rank))
    if prescreen.prescreen_enabled():
        candidates = _apply_prescreen(conn, candidates)
    chosen_ids = [c["segment_id"] for c in candidates[:int(limit)]]
    if not chosen_ids:
        return []
    marks = ",".join("?" * len(chosen_ids))
    full = {r["segment_id"]: dict(r) for r in conn.execute(
        f"SELECT g.* FROM wisdom_segments g WHERE g.segment_id IN ({marks})", chosen_ids)}
    out = []
    for sid in chosen_ids:
        seg = full.get(sid)
        if seg is None:
            continue
        seg["cue_map"] = segmenter.cue_map_for(conn, seg["segment_id"])
        out.append(seg)
    return out


def _apply_prescreen(conn, candidates: list[dict]) -> list[dict]:
    """R102 (session 27): drop segments the lexical screens rule out, in PRIORITY ORDER, before
    truncating to the night's limit — so an enabled night still gets `limit` worth of segments
    that SURVIVED the screen, not `limit` minus however many it would have skipped.

    ⛔ Only called when `prescreen.prescreen_enabled()` — off by default, see prescreen.py's own
    docstring for why. Fetches `text` for the WHOLE remaining candidate pool at once: a real
    memory cost, paid only when an operator has opted in, in exchange for the API spend the
    screen exists to avoid.
    """
    from api.services.wisdom.extract import prescreen

    ids = [c["segment_id"] for c in candidates]
    if not ids:
        return candidates
    marks = ",".join("?" * len(ids))
    texts = {r["segment_id"]: r["text"] for r in conn.execute(
        f"SELECT segment_id, text FROM wisdom_segments WHERE segment_id IN ({marks})", ids)}
    return [c for c in candidates if prescreen.is_candidate(texts.get(c["segment_id"], ""))]


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
                 pass_index: Optional[int] = None, run_id: Optional[str] = None,
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
                        "est_input_tokens, est_output_tokens, est_cost_usd, created_at, updated_at, "
                        "pass_index, run_id) "
                        "VALUES (?, NULL, ?, ?, ?, ?, 1, 'submitting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (it["custom_id"], it["source_id"], it["source_version"], json.dumps([it["segment_id"]]),
                         extractor_version, it["segment_id"], purpose, model, it["est_input_tokens"],
                         it["est_output_tokens"], it["est_cost_usd"], now, now, pass_index, run_id))
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


#: ⛔⛔ R53: how many independent passes the chain makes over each segment.
#:
#: ⭐ `floor.MIN_RUNS = 3` is what the reconciler needs to coexist before it will score anything,
#: so this defaulting to 3 is not a coincidence — a smaller N means the floor never has enough
#: runs and every record sits UNRECONCILED forever. Raising it above 3 silently converts the 0.8
#: publication floor from unanimity into 80% agreement, which is a correctness change and not a
#: throughput one (R17 = HOLD_3).
PASSES_ENV = "WISDOM_EXTRACT_PASSES"
DEFAULT_PASSES = 3


def npass_count() -> int:
    raw = (os.environ.get(PASSES_ENV) or "").strip()
    if not raw:
        return DEFAULT_PASSES
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_PASSES
    return n if n >= 1 else DEFAULT_PASSES


#: ⛔⛔ THE PER-NIGHT REQUEST THROTTLE — R53's other number, and like the budget beside it
#: **A VALUE, NOT A SWITCH**, for the reason `budget.daily_budget_usd` is written around: an unset
#: QUANTITY must not mean "submit nothing" (an invisible outage) or "submit everything" (an
#: invisible bill). So it defaults to the ruled number, and a value that is PRESENT but nonsensical
#: REFUSES rather than falling back — `WISDOM_DAILY_SEGMENT_LIMIT=4OO` (letter O) quietly becoming
#: 400 is how a night gets re-sized by nobody.
#:
#: ⛔ IT IS READ AT CALL TIME, AND THAT IS THE WHOLE POINT. A default argument
#: (`limit: int = DAILY_SEGMENT_LIMIT`) is evaluated ONCE, at IMPORT, so the throttle would be
#: frozen at whatever the environment held when this module was first imported and could only be
#: changed by a deploy — which is exactly what making it overridable was for. `submit_pending` and
#: `run_daily` therefore default to None and resolve through here on every call.
#:
#: ⭐ It bounds REQUESTS, not segments: at N=3 a 400-request night is 133 segments (`run_daily`).
DAILY_SEGMENT_LIMIT_ENV = "WISDOM_DAILY_SEGMENT_LIMIT"
DAILY_SEGMENT_LIMIT = 400


class DailySegmentLimitUnusable(ValueError):
    """A nightly request throttle that is set but unusable. Refused, never silently defaulted."""


def daily_segment_limit() -> int:
    """One night's request ceiling. Raises rather than guessing when the value is unusable."""
    raw = os.environ.get(DAILY_SEGMENT_LIMIT_ENV)
    if raw is None or not str(raw).strip():
        return DAILY_SEGMENT_LIMIT
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        raise DailySegmentLimitUnusable(
            f"{DAILY_SEGMENT_LIMIT_ENV}={str(raw)[:40]!r} is not a whole number of requests. Refusing "
            f"rather than falling back to {DAILY_SEGMENT_LIMIT} — a typo must not quietly become a "
            "throttle.")
    if value <= 0:
        raise DailySegmentLimitUnusable(
            f"{DAILY_SEGMENT_LIMIT_ENV}={value} is not positive. Unset it to use the default "
            f"({DAILY_SEGMENT_LIMIT}); zero is not a way to pause extraction — "
            "WISDOM_EXTRACT_ENABLED is.")
    return value


def submit_pending(ctx, *, client=None, limit: Optional[int] = None, purpose: str = "extract",
                   segment_rows: Optional[list[dict]] = None, effort: Optional[str] = None, salt: str = "",
                   out: Optional[dict] = None, run_id: Optional[str] = None,
                   pass_index: Optional[int] = None, include_retries: bool = True,
                   night_cap_usd: Optional[float] = None,
                   night_date: Optional[str] = None,
                   all_or_nothing: bool = False) -> dict:
    # ⛔ R53: resolved PER CALL, never captured as a default argument (see daily_segment_limit).
    limit = daily_segment_limit() if limit is None else int(limit)
    out = dict(out or {})
    version = prompt.extractor_version()
    model = config.configured_model()
    effort = effort or config.configured_effort()
    out.setdefault("extractor_version", version)
    with store.read() as conn:
        # ⛔ R53: passes 2..N pass include_retries=False. `retry_rows` is fetched per CALL, so an
        # N-pass night that let every pass carry retries would re-submit each retry N times and
        # bill for it.
        retries = retry_rows(conn, version, purpose, limit) if include_retries else []
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
        # ⛔⛔ R65: TWO CEILINGS, TWO SCOPES, NEVER A min() OF THE CAPS.
        # This used to pass `min(programme_cap, night_cap)` as THE cap, which
        # `select_within_budget` then compared against CUMULATIVE PROGRAMME spend — so a
        # night line clamped the whole programme to that number and the SECOND night got
        # nothing while programme headroom sat unused. The programme total is measured
        # against programme spend; the night line against THAT NIGHT's spend.
        programme_cap = budget.budget_cap_usd()
        decision = budget.select_within_budget(
            conn, version, [it["est_cost_usd"] for it in items], cap=programme_cap,
            exclude_pending_usd=sum(it["prior_est"] for it in items if it["retry"]),
            night_cap=night_cap_usd, night_date=night_date)
    out["budget"] = decision.as_dict()
    if all_or_nothing and decision.stopped:
        # ⛔⛔ BUG FOUND IN PRODUCTION 2026-09-19 (session 28, the programme's first real night):
        # an N-pass night's segment set must be IDENTICAL across every pass, or
        # `reconcile.reconcile()` permanently refuses to score it (it compares SEGMENT SETS, not
        # content) -- a `budget_stop` PARTIAL trim here is not a smaller pass, it is
        # unreconcilable data that already cost real money. run_daily's own pre-check only
        # catches a FULLY exhausted night (`remaining <= 0`); it cannot see "remaining is
        # positive but too small for this pass's full segment list", which is exactly the shape
        # that shrank pass 3 of 105 segments to 92 that night and left all 338 records stuck
        # unreconciled forever. Refuse the WHOLE pass instead: a night that cannot afford every
        # pass in full does fewer FULL passes, never one partial one.
        out["candidates"] = len(items)
        out["selected"] = 0
        out["selected_estimate_usd"] = 0.0
        out["status"] = "would_break_pass_parity"
        out["reason"] = decision.reason
        ctx.log(f"{purpose} pass {pass_index}: refused all {len(items)} segment(s) rather than a "
                f"partial {decision.allowed_count}/{len(items)} -- remaining budget cannot cover "
                f"the full pass ({decision.reason})")
        return out
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
                                 pass_index=pass_index, run_id=run_id,
                                 cap=decision.cap_usd)
    out["status"] = "budget_stop" if decision.stopped else "submitted"
    ctx.log(f"{purpose}: submitted {out['submit'].get('submitted', 0)} request(s), estimate "
            f"${out['selected_estimate_usd']:.2f}; budget remaining ${decision.remaining_usd:.2f}")
    return out


#: ⛔⛔ R52 (owner ruling, 2026-09-15) — Q-3. `force` no longer bypasses the switch that SPENDS.
#:
#: ⚰️ WHAT IT WAS. Both entry points read `if not ctx.force and not flags.extract_enabled()`, so a
#: forced run skipped the gate entirely. And `force` is not a developer-only concept: it is a query
#: parameter on `POST /api/admin/wisdom/core/jobs/{job_id}/run?force=true&dry_run=false`
#: (`wisdom_core.py:138-156`), whose only guard is `require_admin`. So the one switch in this
#: programme that can cost money was one admin request away from not applying.
#:
#: ⭐ WHY `force` EXISTS AND WHY IT KEEPS EVERYTHING ELSE. It is for re-running a slot the
#: scheduler swallowed, and it should still bypass the master switch, the job's own kill switch and
#: the trading-day check — those bound WHEN work happens. `WISDOM_EXTRACT_ENABLED` bounds WHETHER
#: MONEY IS SPENT, which is a different kind of thing, and the ruling separates them.
#:
#: ⛔ THE DELIBERATE DOOR. A forced run may still spend, but only when the operator says so in the
#: same breath: `WISDOM_EXTRACT_ACCEPT_SPEND` must equal the exact literal below. Two conditions
#: that must be met at once, neither of them a default, and the acceptance is recorded in the
#: refusal text and the step's reason so it can never be invisible afterwards.
ACCEPT_SPEND_ENV = "WISDOM_EXTRACT_ACCEPT_SPEND"
ACCEPT_SPEND_VALUE = "I-ACCEPT-EXTRACTION-SPEND"


def spend_accepted() -> bool:
    return (os.environ.get(ACCEPT_SPEND_ENV) or "").strip() == ACCEPT_SPEND_VALUE


def spend_allowed(ctx) -> bool:
    """May this run spend? R64: only an UNFORCED run, and only with the switch on.

    ⛔⛔ A FORCED RUN CAN NEVER SPEND, WHATEVER ANY FLAG SAYS. Measured 2026-09-17: the chain
    runs `sources` immediately before `extract` in the SAME run, and `sources` lets `force`
    bypass WISDOM_SOURCES_INGEST_ENABLED outright — so with the extract switch on, ONE ordinary
    admin request (`POST /api/admin/wisdom/jobs/wisdom_daily_chain/run?force=true`, which is
    exactly what an operator does to check a switch they just flipped) took the store from 0
    sources to thousands of segments to three passes of up to 400 requests.

    ⚰️ R52 made force require an acceptance literal WHILE THE SWITCH WAS OFF, and that was the
    wrong half: the dangerous case is force WITH the switch ON, where this function used to
    short-circuit to True on the flag before it ever looked at `force`. R64 removes the
    acceptance literal from the force path entirely — it is not a key, and there is no
    combination of environment variables that makes a forced run spend.

    ⭐ Paid extraction is reachable on the SCHEDULED chain run only. A deliberate one-off has
    its own door, which shows the projected cost and makes the operator echo it back.
    """
    if getattr(ctx, "force", False):
        return False
    return flags.extract_enabled()


def spend_refusal(ctx) -> str:
    """Why it will not spend — and for a forced run, that no flag can change the answer."""
    if getattr(ctx, "force", False):
        return ("R64: force never spends. A forced run bypasses SCHEDULING only; paid extraction "
                "happens on the scheduled run, or through the dedicated paid action that shows "
                "the projected cost. No environment variable changes this.")
    return "WISDOM_EXTRACT_ENABLED is off"


def run_daily(ctx, *, client=None, limit: Optional[int] = None, loader: Optional[Callable] = None) -> dict:
    """Daily chain step: segment new sources, then extract NEW segments only — gated by
    WISDOM_EXTRACT_ENABLED, the golden gate and the budget."""
    version = prompt.extractor_version()
    model = config.configured_model()
    out = {"extractor_version": version, "model": model, "effort": config.configured_effort(),
           "dry_run": ctx.dry_run}
    if not spend_allowed(ctx):
        out.update(status="skipped", reason=spend_refusal(ctx))
        return out
    # ⛔ R53: resolved PER CALL, never captured as a default argument (see daily_segment_limit).
    limit = daily_segment_limit() if limit is None else int(limit)
    out["segmentation"] = segment_pending_sources(dry_run=ctx.dry_run, loader=loader)
    with store.read() as conn:
        gate = golden.gate_status(conn, extractor_version=version, model=model)
    out["gate"] = {k: gate.get(k) for k in ("accepted", "run_id", "reason")}
    if not gate["accepted"]:
        out["status"] = "blocked_by_gate"
        ctx.log(f"extraction blocked by the golden gate: {gate.get('reason')}")
        return out

    # ── R53: N passes over the SAME segments ─────────────────────────────────
    n = npass_count()
    out["passes"] = n
    if n <= 1:
        return submit_pending(ctx, client=client, limit=limit, purpose="extract", out=out)

    # ⛔⛔ R53: THE PER-NIGHT CEILING, checked BEFORE the first request of the night is sent.
    #
    # ⭐ It is a SEPARATE ceiling, not a replacement. `select_within_budget` enforces the PROGRAMME
    # total (WISDOM_EXTRACT_BUDGET_USD, default 120) from the DB; this bounds ONE NIGHT. The
    # tightest binds, and neither replaces the PC-side ledger's own cap. An unusable value REFUSES
    # rather than defaulting — a typo'd budget silently becoming 25.0 is how somebody ships a night
    # they did not authorise.
    #
    # ⚠️ Checked against the night's ESTIMATE (segments x N x the measured per-request rate), so it
    # can only ever stop work from starting. Actuals are enforced afterwards by the same
    # programme-total machinery the single-pass path already used.
    try:
        night_cap = budget.daily_budget_usd()
    except budget.DailyBudgetUnusable as exc:
        out.update(status="skipped", reason=f"daily budget unusable: {exc}")
        ctx.log(out["reason"])
        return out
    out["daily_budget_usd"] = night_cap

    # ⛔ THE THROTTLE BOUNDS REQUESTS, NOT SEGMENTS. `limit` is a request ceiling, so N passes over
    # `limit // N` segments is what keeps a night inside it. At N=3 and limit=400 that is 133
    # segments and 399 requests. ⭐ The nightly BILL is therefore flat in N; what N changes is
    # coverage per night, and so total nights — not what a night costs.
    per_night = max(0, limit // n)
    with store.read() as conn:
        retries = retry_rows(conn, version, "extract", limit)
        segs = pending_segments(conn, version, max(0, per_night - len(retries)))
    out["segments_selected"] = len(segs)
    out["retries_carried"] = len(retries)
    if not segs and not retries:
        out["status"] = "nothing_to_do"
        return out

    # ⛔ ONE run id PER PASS, and they must sort oldest-first by NAME: `reconcile.discover` sorts
    # directory names and `score_silently` takes `ids[-MIN_RUNS:]`, so a night's three passes have
    # to sort together and after yesterday's.
    stamp = timeutil.iso_et(ctx.now_et).replace(":", "").replace("-", "")[:15]

    out["runs"] = []
    for p in range(1, n + 1):
        run_id = f"{stamp}Z-chain-p{p}"
        out["runs"].append(run_id)
        # ⛔⛔ RETRIES RIDE ON PASS 1 ONLY. `submit_pending` fetches retry rows itself on every
        # call, so letting every pass carry them would re-submit each retry N times and bill for
        # it. Passes 2..N are given an explicit `segment_rows` and no retry budget.
        # ⛔ The night's ceiling shrinks as passes are submitted, so pass 3 cannot spend pass 1's
        # budget twice. A pass that would cross it submits nothing rather than part of a pass —
        # a half-submitted pass is the UNRECONCILED case, which costs money and scores nothing.
        # ⭐ R65: this stays as a cheap IN-RUN pre-check across passes. The authoritative
        # rationing is now the night-scoped DB comparison inside select_within_budget, so
        # the FULL night line is passed below — pass 1's submitted rows show up as that
        # night's pending when pass 2 asks, which is what makes the passes share one night.
        spent_so_far = sum(float(r.get("selected_estimate_usd") or 0.0)
                           for r in out.get("pass_results") or [])
        remaining = night_cap - spent_so_far
        if remaining <= 0:
            out.setdefault("pass_results", []).append(
                {"pass_index": p, "run_id": run_id, "status": "night_budget_stop",
                 "reason": f"the night's ${night_cap:.2f} is spent (${spent_so_far:.2f} estimated)"})
            ctx.log(f"extract pass {p}/{n}: stopped at the nightly budget (${night_cap:.2f})")
            continue
        sub = submit_pending(ctx, client=client, limit=len(segs) if p > 1 else limit,
                             purpose="extract", segment_rows=segs, salt=f"pass{p}",
                             run_id=run_id, pass_index=p, include_retries=(p == 1),
                             night_cap_usd=night_cap,
                             night_date=ctx.now_et.date().isoformat(),
                             all_or_nothing=True,
                             out={"pass_index": p, "run_id": run_id})
        out.setdefault("pass_results", []).append(
            {k: sub.get(k) for k in ("status", "submitted", "batch_id", "reason", "pass_index",
                                     "run_id", "selected_estimate_usd")})
    out["status"] = "submitted_n_passes"
    return out


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


def _handle_extract_result(conn, req: dict, *, segment: dict, source: dict, output: dict, model: str) -> dict:
    """R53: persist EVERY pass; ingest only the first.

    ⛔⛔ INGEST EXACTLY ONCE, AND THE REASON IS NOT TIDINESS. `writer.record_id_for(segment_id,
    extractor_version, record_hash)` is DETERMINISTIC, so ingesting all N passes would mint N rows
    carrying the same `record_id` for the same finding — and the reconciler would then be scoring a
    record against copies of itself and reporting perfect stability for a single observation. Pass
    1 ingests; 2..N are persisted and nothing more.

    ⚠️ `pass_index IS NULL` means the single-pass era (any request submitted before the
    extract_003 migration) and is treated as pass 1 — absent is not zero, and zero is not a pass.
    """
    from api.services.wisdom.extract import run_records

    pass_index = req.get("pass_index")
    pass_index = 1 if pass_index is None else int(pass_index)
    run_id = req.get("run_id")

    if pass_index <= 1:
        report = dict(writer.write_output(conn, segment=segment, source=source, output=output,
                                          extractor_version=req["extractor_version"]))
    else:
        report = {"written": 0, "not_ingested": "pass>1"}

    if run_id:
        try:
            # ⛔ The SAME validator and the same vocabulary every pass, so a later pass is judged by
            # exactly the rules the first one was. Anything else makes the passes incomparable,
            # which is the E5 confound the reconciler exists to avoid.
            # ⚠️ `validate_output` is pure — it resolves and checks, it never writes — so calling it
            # here for pass 1 as well (after `write_output` has already validated internally) costs
            # CPU and changes nothing. Threading a Validation out of `write_output` instead would
            # mean changing its signature on the one path that writes member-visible rows.
            validation = writer.validate_output(output, segment=segment, source=source)
            report["kept"] = len(validation.kept)
            report["persisted"] = run_records.persist_result(
                run_id=run_id, segment=segment, validation=validation,
                extractor_version=req["extractor_version"], model=model,
                effort=config.configured_effort(), pass_index=pass_index)
            run_records.touch_segment(run_id, segment["segment_id"])
        except Exception as exc:
            # ⛔ The DB write above has already happened and IS the product. A failure to persist the
            # run costs a night's reconciliation, never the extraction, so it is recorded and never
            # raised — raising here would turn a bookkeeping problem into a lost paid result.
            log.exception("[wisdom-extract] persisting run %s failed", run_id)
            report["persist_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
    return report


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
                report = _handle_extract_result(conn, req, segment=segment, source=source, output=output,
                                                model=model)
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


def _same_night_scoring(ctx) -> dict:
    """R70's rider on the reap: score a night the tick a night's LAST pass is reaped.

    ⛔⛔ IT CAN NEVER FAIL THE REAP. Reap's contract is to advance batches and persist paid
    results; scoring is a rider on top of that. A reconciliation that raises costs one scoring
    cycle — the next tick retries, because a failed claim is retryable — while raising here would
    abandon a tick's reaped work and re-open every batch it had just closed.

    ⚠️ It is called AFTER the batches have been advanced, deliberately: the night that completes
    on THIS tick has to be scored on THIS tick, which is the whole ruling.
    """
    try:
        from api.services.wisdom.extract import same_night

        return same_night.score_completed_nights(ctx)
    except Exception as exc:
        log.exception("[wisdom-extract] same-night scoring failed; the reap is unaffected")
        return {"error": f"{type(exc).__name__}: {str(exc)[:200]}"}


def reap(ctx, *, client=None) -> dict:
    """Short tick (wisdom_extract_reap, :16/:46): advance every open batch, handle ended ones,
    reconcile orphans, and report progress, cost so far and ETA.

    ⭐ R70: a night whose passes are ALL reaped is reconciled and floored before this returns.
    """
    out: dict = {"dry_run": ctx.dry_run}
    if not spend_allowed(ctx):
        out.update(status="skipped", reason=spend_refusal(ctx))
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
        # ⛔ THE IDLE TICK SCORES TOO. A night completes on the tick that reaps its last batch,
        # and that tick takes the branch below — but if the scoring itself failed there (a claim
        # left 'failed' is retryable), every following tick is IDLE, and an early return here
        # would mean the retry never happens.
        out["same_night"] = _same_night_scoring(ctx)
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
    out["same_night"] = _same_night_scoring(ctx)
    return out


def _totals() -> dict:
    with store.read() as conn:
        actual = conn.execute("SELECT COALESCE(SUM(cost_usd_actual), 0) FROM wisdom_batches").fetchone()[0]
        statuses = {r[0]: r[1] for r in conn.execute(
            "SELECT status, COUNT(*) FROM wisdom_extract_requests GROUP BY status")}
    return {"actual_usd": round(float(actual or 0.0), 6), "requests": statuses}
