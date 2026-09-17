"""The weekly 50-segment extraction audit (W1 §6.5, Part 7 weekly chain).

A second extraction pass over a seeded random sample of last week's extracted
segments, at one effort level deeper, submitted through the same Batch path
(purpose 'audit', custom_id prefix "wa_" salted with the ISO week). At reap, the
second pass is validated with the same writer rules and compared, as record keys,
with what was stored. Any disagreement becomes ONE wisdom_review_queue item
(tab extraction_audit) with the two key sets side by side. Nothing is written to
wisdom_records by an audit, and no key ever carries a private value.

Gate: WISDOM_EXTRACT_AUDIT_ENABLED (core.flags.extract_audit_enabled).
"""
from __future__ import annotations

import json
import random
from collections import Counter
from datetime import timedelta
from typing import Optional

from api.services.wisdom.core import flags, ids, store, timeutil
from api.services.wisdom.extract import config, prompt, segmenter, writer

AUDIT_SIZE = 50
LOOKBACK_DAYS = 7


def week_key(now) -> str:
    year, week, _ = timeutil.to_et(now).isocalendar()
    return f"{year}-W{week:02d}"


def select_segments(conn, extractor_version: str, week: str, *, now=None, n: int = AUDIT_SIZE) -> list[dict]:
    now = timeutil.to_et(now) if now is not None else timeutil.now_et()
    since = timeutil.iso_et(now - timedelta(days=LOOKBACK_DAYS))
    done = [r[0] for r in conn.execute(
        "SELECT DISTINCT segment_id FROM wisdom_extract_requests WHERE purpose = 'extract' AND status = 'done' "
        "AND extractor_version = ? AND updated_at >= ? AND segment_id IS NOT NULL", (extractor_version, since))]
    audited = {r[0] for r in conn.execute(
        "SELECT segment_id FROM wisdom_extract_requests WHERE purpose = 'audit' AND extractor_version = ?",
        (extractor_version,))}
    pool = sorted(s for s in done if s not in audited)
    chosen = random.Random(f"{week}|{extractor_version}").sample(pool, min(n, len(pool)))
    out = []
    for segment_id in chosen:
        seg = writer.load_segment(conn, segment_id)
        if seg is not None:
            out.append(seg)
    return out


def run_audit(ctx, *, client=None, n: int = AUDIT_SIZE) -> dict:
    out = {"dry_run": ctx.dry_run}
    if not ctx.force and not flags.extract_audit_enabled():
        out.update(status="skipped", reason="WISDOM_EXTRACT_AUDIT_ENABLED is off")
        return out
    from api.services.wisdom.extract import batch

    # ⛔⛔ R52, THE THIRD ENTRY POINT. The check above is a SCHEDULING gate and `force` is
    # allowed to bypass it. Spending is a different question, and `force` is NOT allowed to
    # bypass that: this path reaches `batch.submit_pending`, which has no spend gate of its own
    # (the only one lives in `batch.run_daily`), so a forced weekly run used to submit PAID audit
    # batches with WISDOM_EXTRACT_AUDIT_ENABLED *and* WISDOM_EXTRACT_ENABLED both off. It was
    # $0 only because `select_segments` needs recent done requests and there were none.
    if not batch.spend_allowed(ctx):
        out.update(status="skipped", reason=batch.spend_refusal(ctx))
        return out

    version = prompt.extractor_version()
    week = week_key(ctx.now_et)
    with store.read() as conn:
        segments = select_segments(conn, version, week, now=ctx.now_et, n=n)
    out.update(week=week, sampled=len(segments))
    if not segments:
        out["status"] = "nothing_to_audit"
        return out
    effort = config.next_effort(config.configured_effort())
    out["effort"] = effort
    return batch.submit_pending(ctx, client=client, limit=len(segments), purpose="audit", segment_rows=segments,
                                effort=effort, salt=week, out=out)


def _stored_keys(conn, segment_id: str, extractor_version: str) -> Counter:
    keys: Counter = Counter()
    rows = conn.execute(
        "SELECT r.record_type, r.ticker, r.stance, r.direction, r.market_signal_json, p.statement "
        "FROM wisdom_records r LEFT JOIN wisdom_principles p ON p.principle_key = r.principle_key "
        "WHERE r.segment_id = ? AND r.extractor_version = ? AND r.status != 'superseded'",
        (segment_id, extractor_version)).fetchall()
    for rtype, ticker, stance, direction, signal_json, statement in rows:
        if rtype == "PRINCIPLE":
            keys[(rtype, writer.normalize_quote_key(statement or ""))] += 1
        elif rtype == "MARKET_SIGNAL":
            try:
                name = (json.loads(signal_json or "{}") or {}).get("name") or ""
            except ValueError:
                name = ""
            keys[(rtype, writer.normalize_quote_key(name))] += 1
        else:
            keys[(rtype, ticker, stance, direction)] += 1
    return keys


def compare_and_queue(conn, *, segment: dict, source: dict, output, extractor_version: str, custom_id: str,
                      now_iso: Optional[str] = None) -> dict:
    validation = writer.validate_output(output, segment=segment, source=source)
    audit_keys = Counter(ch.key() for ch in validation.kept)
    stored = _stored_keys(conn, segment["segment_id"], extractor_version)
    only_stored, only_audit = stored - audit_keys, audit_keys - stored
    report = {"stored": sum(stored.values()), "audit": sum(audit_keys.values()),
              "only_stored": sum(only_stored.values()), "only_audit": sum(only_audit.values()),
              "agreement": not only_stored and not only_audit, "written": 0}
    if report["agreement"]:
        return report
    now = now_iso or timeutil.iso_et(timeutil.now_et())
    item_id = ids.sha24("extraction_audit", segment["segment_id"], extractor_version, custom_id)
    summary = (f"Second extraction pass disagrees on segment {segment['segment_id']}: "
               f"{report['only_stored']} record(s) only in the stored extraction, "
               f"{report['only_audit']} only in the audit pass")
    conn.execute(
        "INSERT OR IGNORE INTO wisdom_review_queue (item_id, tab, subject_ref, summary, old_json, new_json, "
        "evidence_json, recommendation, status, created_at) VALUES (?, 'extraction_audit', ?, ?, ?, ?, ?, ?, 'open', ?)",
        (item_id, f"segment:{segment['segment_id']}", summary,
         json.dumps(sorted([list(k) for k in only_stored.elements()], key=str)),
         json.dumps(sorted([list(k) for k in only_audit.elements()], key=str)),
         json.dumps({"custom_id": custom_id, "extractor_version": extractor_version,
                     "validation": dict(validation.counts), "path": segment.get("path"),
                     "segmenter": segmenter.SEGMENTER_VERSION}, sort_keys=True),
         "Read the segment; keep the stored records, or re-extract if the second pass is right.", now))
    report["review_item_id"] = item_id
    return report
