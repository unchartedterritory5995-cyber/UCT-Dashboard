"""The owner's review queue (W1 §0.3, Part 7 "Continuous"; CONTRACTS §6.6).

Owner judgment is a VETO, not a gate: provisional records keep flowing, and
the questions worth the owner's attention land here as queue items, one tab
per kind of question. The owner answers accept / veto / resolve with an
optional note; every answer is an append-only wisdom_review_actions row.

⛔ A DECIDED ITEM IS NEVER RE-ASKED. An item's id is derived from its tab, its
subject and the PROPOSED value, so a job that re-enqueues the same proposal
after the owner vetoed it gets the decided item back instead of a new question.
A different proposal for the same subject is a different item.

⛔ ACTING IS CHECK-AND-SET. act() only moves an item out of 'open', inside the
caller's write transaction (store.write() is BEGIN IMMEDIATE), so a double
click or two tabs writes one action and one golden candidate, never two.

⭐ GOLDEN-SET GROWTH (W1 Part 7): accepting or vetoing an extraction-shaped item
(tabs golden, extraction_audit, attribution) records a wisdom_golden_candidates
row holding the label that stands after the ruling. The golden harness
(stream S-D) adopts candidates into wisdom_golden under its own gate; this
module never writes wisdom_golden.

Callers pass an open connection: store.write() for anything that writes,
store.read() for reads. Nothing here reads Journal / J2 / Notebook / broker data.
"""
from __future__ import annotations

import importlib
import json
import sqlite3
from datetime import datetime
from typing import Any, Optional

from api.services.wisdom.core import ids, timeutil
from api.services.wisdom.publish.schema import module_available

TABS = ("golden", "vocabulary", "contradictions", "attribution", "extraction_audit",
        "drafts", "sources", "capture", "authors")
STATUSES = ("open", "accepted", "vetoed", "resolved")
ACTIONS = {"accept": "accepted", "veto": "vetoed", "resolve": "resolved"}
GOLDEN_GROWTH_TABS = frozenset({"golden", "extraction_audit", "attribution"})
NOTE_REQUIRED = frozenset({("contradictions", "resolve")})  # a ruling of your own must say what it is

NOTE_MAX = 4000
SUMMARY_MAX = 500
SUBJECT_MAX = 300
LIST_LIMIT_MAX = 500

_GOLDEN_SPLIT_MODULE = "api.services.wisdom.extract.golden"


class ReviewError(Exception):
    status_code = 400


class InvalidReviewInput(ReviewError):
    status_code = 400


class ItemNotFound(ReviewError):
    status_code = 404


class ItemNotOpen(ReviewError):
    status_code = 409


# ── helpers ──────────────────────────────────────────────────────────────────

def canonical_json(value: Any) -> Optional[str]:
    if value is None:
        return None
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)


def _loads(text: Optional[str]) -> Any:
    if text is None:
        return None
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return {"unparsed": True}


def _now_iso(now: Optional[datetime]) -> str:
    return timeutil.iso_et(now if now is not None else timeutil.now_et())


def item_id_for(tab: str, subject_ref: str, new: Any) -> str:
    return ids.sha24("review", tab, subject_ref, canonical_json(new) or "")


def _clean_text(value: Any, field: str, limit: int, *, required: bool) -> Optional[str]:
    if value is None:
        if required:
            raise InvalidReviewInput(f"{field} is required")
        return None
    if not isinstance(value, str):
        raise InvalidReviewInput(f"{field} must be text")
    text = value.strip()
    if not text:
        if required:
            raise InvalidReviewInput(f"{field} is required")
        return None
    if len(text) > limit:
        raise InvalidReviewInput(f"{field} is longer than {limit} characters")
    return text


# ── writing ──────────────────────────────────────────────────────────────────

def enqueue(conn: sqlite3.Connection, *, tab: str, subject_ref: str, summary: str,
            old: Any = None, new: Any = None, evidence: Any = None,
            recommendation: Optional[str] = None, now: Optional[datetime] = None) -> dict:
    """Add a question to the owner's queue. Idempotent; never reopens a decided item."""
    if tab not in TABS:
        raise InvalidReviewInput(f"unknown tab {tab!r}")
    subject_ref = _clean_text(subject_ref, "subject_ref", SUBJECT_MAX, required=True)
    summary = _clean_text(summary, "summary", SUMMARY_MAX, required=True)
    recommendation = _clean_text(recommendation, "recommendation", NOTE_MAX, required=False)
    item_id = item_id_for(tab, subject_ref, new)
    row = conn.execute("SELECT status FROM wisdom_review_queue WHERE item_id = ?", (item_id,)).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO wisdom_review_queue (item_id, tab, subject_ref, summary, old_json, new_json, "
            "evidence_json, recommendation, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
            (item_id, tab, subject_ref, summary, canonical_json(old), canonical_json(new),
             canonical_json(evidence if evidence is not None else {}), recommendation, _now_iso(now)),
        )
        return {"item_id": item_id, "created": True, "status": "open"}
    if row["status"] == "open":
        conn.execute(
            "UPDATE wisdom_review_queue SET summary = ?, old_json = ?, evidence_json = ?, recommendation = ? "
            "WHERE item_id = ? AND status = 'open'",
            (summary, canonical_json(old), canonical_json(evidence if evidence is not None else {}),
             recommendation, item_id),
        )
        return {"item_id": item_id, "created": False, "status": "open"}
    return {"item_id": item_id, "created": False, "status": row["status"]}


def act(conn: sqlite3.Connection, item_id: str, *, action: str, actor: str,
        note: Optional[str] = None, actor_is_owner: bool = False,
        now: Optional[datetime] = None) -> dict:
    """Record the owner's answer. Call inside store.write() (one transaction)."""
    verb = str(action or "").strip().lower()
    if verb not in ACTIONS:
        raise InvalidReviewInput(f"unknown action {action!r}; expected one of {sorted(ACTIONS)}")
    actor = _clean_text(actor, "actor", 320, required=True)
    note = _clean_text(note, "note", NOTE_MAX, required=False)
    row = conn.execute("SELECT * FROM wisdom_review_queue WHERE item_id = ?", (item_id,)).fetchone()
    if row is None:
        raise ItemNotFound(f"no review item {item_id}")
    if row["status"] != "open":
        raise ItemNotOpen(f"review item {item_id} is already {row['status']}")
    if (row["tab"], verb) in NOTE_REQUIRED and not note:
        raise InvalidReviewInput(f"{verb} on the {row['tab']} tab needs a note stating the ruling")
    status = ACTIONS[verb]
    now_iso = _now_iso(now)
    cur = conn.execute(
        "UPDATE wisdom_review_queue SET status = ?, resolved_at = ?, resolved_by = ? "
        "WHERE item_id = ? AND status = 'open'",
        (status, now_iso, actor, item_id),
    )
    if cur.rowcount != 1:
        raise ItemNotOpen(f"review item {item_id} was decided by another request")
    action_id = conn.execute(
        "INSERT INTO wisdom_review_actions (item_id, actor, action, note, created_at) VALUES (?, ?, ?, ?, ?)",
        (item_id, actor, verb, note, now_iso),
    ).lastrowid
    candidate_id = None
    if row["tab"] in GOLDEN_GROWTH_TABS and verb in ("accept", "veto"):
        candidate_id = _record_golden_candidate(
            conn, dict(row), action_id=action_id, verdict=status, actor=actor, note=note,
            verified_by="owner" if actor_is_owner else "reviewer", now_iso=now_iso)
    return {"item_id": item_id, "status": status, "action_id": action_id, "golden_candidate_id": candidate_id}


def split_for(key: str) -> str:
    """dev/test split. The golden harness owns the rule (CONTRACTS §6.4, sha24 parity);
    until its module exists this uses the same parity on sha24(key)."""
    if module_available(_GOLDEN_SPLIT_MODULE):
        try:
            fn = getattr(importlib.import_module(_GOLDEN_SPLIT_MODULE), "split_for", None)
            if callable(fn):
                value = fn(key)
                if value in ("dev", "test"):
                    return value
        except Exception:
            pass
    return "dev" if int(ids.sha24(key), 16) % 2 == 0 else "test"


def _pick(field: str, *sources: Any) -> Optional[str]:
    for src in sources:
        if isinstance(src, dict) and src.get(field) not in (None, ""):
            return str(src[field])
    return None


def _record_golden_candidate(conn: sqlite3.Connection, item: dict, *, action_id: int, verdict: str,
                             actor: str, note: Optional[str], verified_by: str, now_iso: str) -> str:
    old, new, evidence = _loads(item["old_json"]), _loads(item["new_json"]), _loads(item["evidence_json"])
    if verdict == "accepted":
        expected, rejected = new, old
    else:
        # A vetoed proposal leaves the prior label standing; with no prior label the
        # ruling is "this extraction should not exist" — a precision example.
        expected, rejected = (old if old is not None else {"no_record": True}), new
    candidate_id = ids.sha24("golden_candidate", item["item_id"])
    conn.execute(
        "INSERT INTO wisdom_golden_candidates (candidate_id, item_id, action_id, tab, subject_ref, verdict, "
        "record_type, author_id, locator, expected_json, rejected_json, split, verified_by, actor, note, "
        "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (candidate_id, item["item_id"], action_id, item["tab"], item["subject_ref"], verdict,
         _pick("record_type", new, old, evidence), _pick("author_id", new, old, evidence),
         _pick("locator", evidence, new, old) or item["subject_ref"],
         canonical_json(expected), canonical_json(rejected), split_for(candidate_id),
         verified_by, actor, note, now_iso),
    )
    return candidate_id


# ── reading ──────────────────────────────────────────────────────────────────

_LIST_COLUMNS = "item_id, tab, subject_ref, summary, recommendation, status, created_at, resolved_at, resolved_by"


def list_items(conn: sqlite3.Connection, *, tab: Optional[str] = None, status: Optional[str] = "open",
               limit: int = 50, offset: int = 0) -> list[dict]:
    if tab is not None and tab not in TABS:
        raise InvalidReviewInput(f"unknown tab {tab!r}")
    if status not in (None, "all") and status not in STATUSES:
        raise InvalidReviewInput(f"unknown status {status!r}")
    limit = max(1, min(int(limit), LIST_LIMIT_MAX))
    offset = max(0, int(offset))
    sql, params = f"SELECT {_LIST_COLUMNS} FROM wisdom_review_queue WHERE 1 = 1", []
    if tab is not None:
        sql += " AND tab = ?"
        params.append(tab)
    if status not in (None, "all"):
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC, item_id LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    return [dict(r) for r in conn.execute(sql, params)]


def counts(conn: sqlite3.Connection) -> dict:
    """Every tab, every status, zeros included: an absent tab and an empty tab must read the same."""
    tabs = {tab: {**{s: 0 for s in STATUSES}, "total": 0} for tab in TABS}
    for row in conn.execute("SELECT tab, status, COUNT(*) AS n FROM wisdom_review_queue GROUP BY tab, status"):
        bucket = tabs.setdefault(row["tab"], {**{s: 0 for s in STATUSES}, "total": 0})
        bucket[row["status"]] = row["n"]
        bucket["total"] += row["n"]
    totals = {**{s: sum(t[s] for t in tabs.values()) for s in STATUSES}}
    totals["total"] = sum(t["total"] for t in tabs.values())
    return {"tabs": tabs, "totals": totals}


def get_item(conn: sqlite3.Connection, item_id: str) -> Optional[dict]:
    row = conn.execute("SELECT * FROM wisdom_review_queue WHERE item_id = ?", (item_id,)).fetchone()
    if row is None:
        return None
    item = {k: row[k] for k in row.keys() if not k.endswith("_json")}
    item["old"] = _loads(row["old_json"])
    item["new"] = _loads(row["new_json"])
    item["evidence"] = _loads(row["evidence_json"])
    item["actions"] = [dict(r) for r in conn.execute(
        "SELECT action_id, actor, action, note, created_at FROM wisdom_review_actions "
        "WHERE item_id = ? ORDER BY action_id", (item_id,))]
    cand = conn.execute(
        "SELECT candidate_id, verdict, split, verified_by, promoted_gid FROM wisdom_golden_candidates "
        "WHERE item_id = ?", (item_id,)).fetchone()
    item["golden_candidate"] = dict(cand) if cand is not None else None
    return item


def golden_candidates(conn: sqlite3.Connection, *, unpromoted_only: bool = True, limit: int = 500) -> list[dict]:
    """Public reader for the golden harness (stream S-D)."""
    sql = "SELECT * FROM wisdom_golden_candidates"
    if unpromoted_only:
        sql += " WHERE promoted_gid IS NULL"
    sql += " ORDER BY created_at, candidate_id LIMIT ?"
    rows = []
    for r in conn.execute(sql, (max(1, min(int(limit), 5000)),)):
        d = dict(r)
        d["expected"] = _loads(d.pop("expected_json"))
        d["rejected"] = _loads(d.pop("rejected_json"))
        rows.append(d)
    return rows


# ── contradictions (W1 §3.4) ─────────────────────────────────────────────────

def _recommend(principle: dict, record: dict) -> str:
    if principle.get("canonical") == 1:
        return ("Keep the canonical principle; record the later statement as a qualification. "
                "Until ruled, present both with dates.")
    a_date, b_date = principle.get("first_seen_at") or "", record.get("stated_at_et") or ""
    if b_date and a_date and b_date[:10] > a_date[:10] and record.get("author_id"):
        return (f"Recommend the newer statement ({b_date[:10]}, {record['author_id']}) as the ruling; "
                f"keep the {a_date[:10]} statement non-canonical. Until ruled, present both with dates.")
    return "Keep both non-canonical and present both with dates until ruled."


def refresh_contradictions(conn: sqlite3.Connection, *, now: Optional[datetime] = None) -> dict:
    """Queue every principle/record pair linked 'contradicts', sources side by side.

    The extractor never resolves a contradiction (W1 §3.4); this only asks."""
    created = refreshed = decided = 0
    rows = conn.execute(
        "SELECT s.principle_key, p.statement, p.author_id AS p_author, p.first_seen_at, p.canonical, "
        "r.record_id, r.author_id AS r_author, r.stated_at_et, r.source_id, r.segment_id, r.record_type, "
        "r.thesis, r.status AS r_status "
        "FROM wisdom_principle_support s "
        "JOIN wisdom_principles p ON p.principle_key = s.principle_key "
        "JOIN wisdom_records r ON r.record_id = s.record_id "
        "WHERE s.relation = 'contradicts' ORDER BY s.principle_key, r.record_id"
    ).fetchall()
    for row in rows:
        principle = {"principle_key": row["principle_key"], "statement": row["statement"],
                     "author_id": row["p_author"], "first_seen_at": row["first_seen_at"],
                     "canonical": row["canonical"], "locator": f"principle:{row['principle_key']}"}
        record = {"record_id": row["record_id"], "record_type": row["record_type"], "author_id": row["r_author"],
                  "stated_at_et": row["stated_at_et"], "thesis": row["thesis"], "status": row["r_status"],
                  "locator": f"{row['source_id']}#{row['segment_id']}"}
        out = enqueue(
            conn, tab="contradictions",
            subject_ref=f"principle:{row['principle_key']}|record:{row['record_id']}",
            summary=f"{row['principle_key']}: contradicted by {row['r_author'] or 'unknown'} "
                    f"on {(row['stated_at_et'] or 'an unknown date')[:10]}",
            old=principle, new=record, evidence={"side_by_side": [principle, record]},
            recommendation=_recommend(principle, record), now=now)
        if out["created"]:
            created += 1
        elif out["status"] == "open":
            refreshed += 1
        else:
            decided += 1
    return {"pairs": len(rows), "enqueued": created, "refreshed": refreshed, "already_decided": decided}


# ── file import (data/wisdom/golden/review-queue-v1.jsonl) ───────────────────

def _row_to_item(row: dict) -> dict:
    tab = row.get("tab") or ("golden" if row.get("gid") else None)
    subject = row.get("subject_ref") or (f"golden:{row['gid']}" if row.get("gid") else None)
    summary = row.get("summary") or (
        f"{row.get('record_type') or 'record'} {row.get('gid')}: {row.get('reason') or 'review'}"
        if row.get("gid") else None)
    old = row.get("old", row.get("old_label", _loads(row["old_json"]) if "old_json" in row else None))
    new = row.get("new", row.get("new_label", _loads(row["new_json"]) if "new_json" in row else None))
    evidence = row.get("evidence", _loads(row["evidence_json"]) if "evidence_json" in row else None)
    return {"tab": tab, "subject_ref": subject, "summary": summary, "old": old, "new": new,
            "evidence": evidence, "recommendation": row.get("recommendation")}


def import_queue_rows(conn: sqlite3.Connection, lines: list[str], *, now: Optional[datetime] = None) -> dict:
    """Load review items from JSON lines. Bad lines are reported by NUMBER only
    (never their content — a line can carry a verbatim quote) and never stop the rest."""
    result = {"rows": 0, "created": 0, "refreshed": 0, "already_decided": 0, "errors": []}
    for number, raw in enumerate(lines, start=1):
        if not raw.strip():
            continue
        result["rows"] += 1
        try:
            row = json.loads(raw)
            if not isinstance(row, dict):
                raise InvalidReviewInput("line is not a JSON object")
            out = enqueue(conn, now=now, **_row_to_item(row))
        except (ValueError, InvalidReviewInput) as exc:
            reason = exc.args[0] if isinstance(exc, InvalidReviewInput) else "invalid JSON"
            result["errors"].append({"line": number, "error": str(reason)[:200]})
            continue
        if out["created"]:
            result["created"] += 1
        elif out["status"] == "open":
            result["refreshed"] += 1
        else:
            result["already_decided"] += 1
    return result
