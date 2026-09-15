"""RQ-v11-001 — a NULL false positive on PRINCIPLE or MARKET_SIGNAL is a REVIEW ITEM.

**Owner ruling R7_RQ_V11_001: REVIEW_ITEM (2026-09-15).**

⭐ **The split this module encodes, and why it is not symmetric.** Golden v1.1's 44 NULL rows each
declare that a span contains none of the six record types. For four of them that claim rests on a
**mechanical screen** — a CALL, NEGATIVE_CALL or MENTION needs an instrument token, and a LEVEL
needs a stated price, so "no cashtag, no ticker-shaped token, no company name, no sector word
(plus no price for LEVEL)" settles it. A false positive against those four is a **measurement**.

⛔ For PRINCIPLE and MARKET_SIGNAL the claim rests on a **lexicon screen plus a human read**
(`docs/wisdom/methodology/golden-v1.1.md:96-104`), and the doc states the reason outright: *a
generalisable teaching statement has no lexical signature, so absence of vocabulary is not absence
of meaning.* All 44 rows are therefore `provisional`, and a false positive against those two types
is a **judgement to be reviewed, not a verdict to be scored against the extractor.**

⛔⛔ **THIS MODULE CHANGES NO NUMBER.** It does not touch `golden.score`, the per-type counts, or
the NULL false-positive totals. Those stay exactly what they were — the figure remains a
measurement, and this puts a QUEUE BESIDE IT. Anything else would let the weakest screen in the
set decide the extractor's verdict.

⭐ The evidence carried into each item is REAL, not reconstructed: golden v1.1's NULL rows store
their own screen hits under `evidence.null_checks`, so the item can say which lexicon tokens the
screen actually found (usually none — that is what made the row a NULL) and what the human read
recorded, rather than asserting a screen ran.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Iterable, Optional

#: The two types whose NULL claim is a screen PLUS a read. ⛔ Derived from the methodology's own
#: screen table (`_NULL_SCREEN_FOR["lexicon_screen+read"]` in tools/wisdom_golden_verify.py), not
#: retyped as a preference — these are exactly the types with no lexical signature.
JUDGEMENT_TYPES: tuple = ("PRINCIPLE", "MARKET_SIGNAL")

#: The four whose NULL claim a mechanical screen settles. A false positive here is a MEASUREMENT
#: and this module deliberately emits nothing for it.
MECHANICAL_TYPES: tuple = ("CALL", "NEGATIVE_CALL", "MENTION", "LEVEL")

REVIEW_TAB = "golden"
REASON = "RQ-v11-001"

#: Which stored screen list belongs to which judgement type.
_LEXICON_FIELD = {"PRINCIPLE": "principle_lexicon", "MARKET_SIGNAL": "signal_lexicon"}


def _lexicon_hits(null_row: dict, record_type: str) -> list:
    """The screen hits golden v1.1 stored for this row, for this type. [] is the normal answer."""
    checks = ((null_row or {}).get("evidence") or {}).get("null_checks") or {}
    field = _LEXICON_FIELD.get(record_type)
    value = checks.get(field) if field else None
    return sorted(value) if isinstance(value, (list, tuple, set)) else []


def _read_status(null_row: dict) -> dict:
    """What the human read recorded. ⛔ Reported as-is; an absent field is reported as absent."""
    row = null_row or {}
    return {
        "status": row.get("status"),
        "verification": row.get("verification"),
        "verified_by": row.get("verified_by"),
    }


def items_for_segment(segment_id: str, null_fp: dict, *, null_row: Optional[dict] = None,
                      run_id: Optional[str] = None) -> list:
    """One review item per JUDGEMENT type with a NULL false positive on this segment.

    ⛔ Returns `[]` for the four mechanical types no matter how many false positives they carry —
    that is the ruling, and `test_no_item_is_emitted_for_a_mechanical_type` is the rail on it.
    """
    out = []
    for record_type in JUDGEMENT_TYPES:
        count = int((null_fp or {}).get(record_type) or 0)
        if count <= 0:
            continue
        out.append({
            "tab": REVIEW_TAB,
            "subject_ref": f"null_segment:{segment_id}#{record_type}",
            "summary": (f"{REASON}: the extractor produced {count} {record_type} record(s) in a "
                        f"segment golden v1.1 declares empty of them. That claim rests on a "
                        f"lexicon screen plus a human read, so this is a review item, not a "
                        f"verdict against the extractor."),
            "new": {
                "reason": REASON,
                "segment_id": segment_id,
                "record_type": record_type,
                "false_positives": count,
                "lexicon_hits": _lexicon_hits(null_row, record_type),
                "human_read": _read_status(null_row),
                "run_id": run_id,
            },
            "evidence": {
                "screen": "lexicon_screen+read",
                "why_not_a_verdict": ("a generalisable teaching statement has no lexical "
                                      "signature, so absence of vocabulary is not absence of "
                                      "meaning (golden-v1.1.md:96-104)"),
                "gid": (null_row or {}).get("gid"),
                "locator": (null_row or {}).get("locator"),
            },
            "recommendation": ("Read the span. If the record is right, the NULL row is wrong and "
                               "golden v1.1 needs correcting; if the NULL row is right, this is a "
                               "real extractor false positive."),
        })
    return out


def enqueue_for_run(conn: sqlite3.Connection, segment_scores: dict, *,
                    null_rows: Optional[dict] = None, run_id: Optional[str] = None,
                    now=None) -> dict:
    """Enqueue every judgement-type NULL false positive in one gate run. Idempotent.

    `segment_scores` is the gate's own per-segment output (`extract_golden_gate.segment_scores`),
    so this reads the SAME numbers the report does and cannot disagree with them.

    ⭐ Idempotent through `review.item_id_for(tab, subject_ref, new)` — a re-run produces one row
    per (segment, type), not a flood. Proved by running it twice and counting.
    """
    from api.services.wisdom.publish import review

    rows = null_rows or {}
    emitted = created = 0
    for segment_id, scores in sorted((segment_scores or {}).items()):
        for item in items_for_segment(segment_id, (scores or {}).get("null_fp") or {},
                                      null_row=rows.get(segment_id), run_id=run_id):
            emitted += 1
            out = review.enqueue(conn, tab=item["tab"], subject_ref=item["subject_ref"],
                                 summary=item["summary"], new=item["new"],
                                 evidence=item["evidence"],
                                 recommendation=item["recommendation"], now=now)
            created += int(bool(out.get("created")))
    return {"reason": REASON, "emitted": emitted, "created": created,
            "judgement_types": list(JUDGEMENT_TYPES)}


def score_silently(ctx) -> dict:
    """Daily-chain entry point. Reads the newest gate run's per-segment scores, if one exists.

    ⛔ Not gated by a flag: it writes only to the admin review queue and publishes nothing, and a
    queue that can be switched off is a queue nobody trusts. It is a no-op when no gate run has
    been recorded, which is the state on a fresh store.
    """
    from api.services.wisdom.core import store

    with store.write() as conn:
        scores = _latest_segment_scores(conn)
        if not scores:
            return {"reason": REASON, "emitted": 0, "created": 0, "skipped": "no gate run recorded"}
        return enqueue_for_run(conn, scores["segment_scores"], null_rows=scores.get("null_rows"),
                               run_id=scores.get("run_id"))


def _latest_segment_scores(conn: sqlite3.Connection) -> Optional[dict]:
    """The newest gate eval's per-segment scores, if the run recorded them.

    ⚠️ Returns None rather than guessing when the stored metrics carry no per-segment detail —
    an eval row holds aggregates, and inventing a per-segment breakdown from them would be the
    E5 class of error (a number whose provenance nobody can reconstruct).
    """
    from api.services.wisdom.extract import golden

    row = conn.execute(
        "SELECT run_id, metrics_json FROM wisdom_eval_runs WHERE kind = ? ORDER BY created_at DESC, run_id DESC "
        "LIMIT 1", (golden.EVAL_KIND,)).fetchone()
    if row is None:
        return None
    import json

    try:
        metrics = json.loads(row["metrics_json"] or "{}")
    except (TypeError, ValueError):
        return None
    seg = metrics.get("segment_scores")
    if not isinstance(seg, dict) or not seg:
        return None
    return {"run_id": row["run_id"], "segment_scores": seg,
            "null_rows": metrics.get("null_rows") if isinstance(metrics.get("null_rows"), dict) else {}}
