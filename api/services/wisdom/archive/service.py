"""Wisdom archive: validation, idempotent upsert and the admin reads.

⛔ WRITES ONLY wisdom_archive_records / wisdom_archive_calls / wisdom_archive_fts.
tests/test_wisdom_archive.py proves a batch leaves wisdom_records and
wisdom_segments untouched.

Validation is per item: a bad item is REJECTED with its index and a reason (never
its text), the good ones in the same batch still land. Unknown keys are refused,
so a share count or a position size cannot ride in on an extra field (W1 §0.4d).
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.wisdom.core import authors as core_authors

MAX_BATCH = 2000
RECORD_TYPES = ("CALL", "RESULT", "LESSON", "MACRO")
DIRECTIONS = ("long", "short", "neutral")
MAX_TEXT = 100_000
MAX_SHORT = 200

#: The outcome fields a scored call may carry; anything else is refused.
OUTCOME_FIELDS = ("r1", "r5", "r20", "r60", "mfe20", "mae20", "sim_R", "ctl_simR", "ctl_r20",
                  "vs_base20", "regime", "status")
_OUTCOME_TEXT = ("regime", "status")

RECORD_FIELDS = {"record_id", "author_id", "stated_date", "record_type", "tickers", "note", "quote",
                 "image_count", "sha"}
CALL_FIELDS = {"call_id", "record_id", "author_id", "ticker", "direction", "setup", "action", "posted",
               "entry", "stop", "target", "conf", "reported", "outcome", "methodology", "sha"}

_RECORD_ID = re.compile(r"^t\d{1,7}$")
_CALL_ID = re.compile(r"^(t\d{1,7})#\d{1,4}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")
_TICKER = re.compile(r"^[A-Z0-9][A-Z0-9.!\-/^=]{0,14}$")
_SHA = re.compile(r"^[0-9a-f]{16,64}$")
_SETUP = re.compile(r"^[A-Za-z0-9_.\- /]{1,80}$")


class ItemError(ValueError):
    pass


def team_authors() -> frozenset:
    """The six team authors, by slug — docs/wisdom/authors.json is the one authority."""
    return core_authors.call_authors()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _canonical_sha(row: dict) -> str:
    body = json.dumps({k: v for k, v in row.items() if k != "sha"}, sort_keys=True, ensure_ascii=True,
                      separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _str(item: dict, key: str, *, required: bool = False, limit: int = MAX_SHORT) -> Optional[str]:
    v = item.get(key)
    if v is None or (isinstance(v, str) and not v.strip() and not required):
        if required:
            raise ItemError(f"{key} required")
        return None
    if not isinstance(v, str):
        raise ItemError(f"{key} must be a string")
    v = v.strip()
    if required and not v:
        raise ItemError(f"{key} required")
    if len(v) > limit:
        raise ItemError(f"{key} too long")
    return v


def _num(item: dict, key: str) -> Optional[float]:
    v = item.get(key)
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(float(v)):
        raise ItemError(f"{key} must be a finite number or null")
    return float(v)


def normalize_ticker(raw: Any) -> str:
    if not isinstance(raw, str):
        raise ItemError("ticker must be a string")
    t = raw.strip().upper().lstrip("$")
    if not _TICKER.match(t):
        raise ItemError("ticker malformed")
    return t


def _author(item: dict) -> str:
    a = _str(item, "author_id", required=True)
    if a not in team_authors():
        raise ItemError("author_id is not one of the team authors")
    return a


def _unknown(item: dict, allowed: set) -> None:
    extra = sorted(set(item) - allowed)
    if extra:
        raise ItemError(f"unknown fields: {', '.join(extra)[:120]}")


def validate_record(item: Any) -> dict:
    if not isinstance(item, dict):
        raise ItemError("item must be an object")
    _unknown(item, RECORD_FIELDS)
    rid = _str(item, "record_id", required=True)
    if not _RECORD_ID.match(rid):
        raise ItemError("record_id malformed")
    rtype = _str(item, "record_type", required=True)
    if rtype not in RECORD_TYPES:
        raise ItemError("record_type not in CALL/RESULT/LESSON/MACRO")
    date = _str(item, "stated_date", required=True, limit=40)
    if not _DATE.match(date):
        raise ItemError("stated_date must start YYYY-MM-DD")
    raw_t = item.get("tickers") or []
    if isinstance(raw_t, str):
        raw_t = [t for t in raw_t.split(",") if t.strip()]
    if not isinstance(raw_t, list) or len(raw_t) > 500:
        raise ItemError("tickers must be a list or comma string")
    tickers = list(dict.fromkeys(normalize_ticker(t) for t in raw_t))
    ic = item.get("image_count", 0)
    if isinstance(ic, bool) or not isinstance(ic, int) or ic < 0 or ic > 1000:
        raise ItemError("image_count must be a non-negative integer")
    row = {
        "record_id": rid, "author_id": _author(item), "stated_date": date, "record_type": rtype,
        "tickers": ",".join(tickers), "note": _str(item, "note", limit=MAX_TEXT) or "",
        "quote": _str(item, "quote", limit=MAX_TEXT) or "", "image_count": ic,
    }
    sha = _str(item, "sha", limit=64)
    if sha is not None and not _SHA.match(sha):
        raise ItemError("sha must be lower-case hex")
    row["sha"] = sha or _canonical_sha(row)
    return row


def validate_call(item: Any) -> dict:
    if not isinstance(item, dict):
        raise ItemError("item must be an object")
    _unknown(item, CALL_FIELDS)
    cid = _str(item, "call_id", required=True)
    m = _CALL_ID.match(cid)
    if not m:
        raise ItemError("call_id malformed")
    rid = _str(item, "record_id", required=True)
    if rid != m.group(1):
        raise ItemError("record_id does not match call_id")
    direction = _str(item, "direction")
    if direction is not None and direction not in DIRECTIONS:
        raise ItemError("direction not in long/short/neutral")
    setup = _str(item, "setup", limit=80)
    if setup is not None and not _SETUP.match(setup):
        raise ItemError("setup malformed")
    outcome = item.get("outcome") or {}
    if not isinstance(outcome, dict):
        raise ItemError("outcome must be an object")
    bad = sorted(set(outcome) - set(OUTCOME_FIELDS))
    if bad:
        raise ItemError(f"unknown outcome fields: {', '.join(bad)[:120]}")
    clean_outcome: dict = {}
    for k in OUTCOME_FIELDS:
        if k not in outcome or outcome[k] is None:
            continue
        clean_outcome[k] = _str(outcome, k, limit=60) if k in _OUTCOME_TEXT else _num(outcome, k)
    row = {
        "call_id": cid, "record_id": rid, "author_id": _author(item),
        "ticker": normalize_ticker(item.get("ticker")), "direction": direction, "setup": setup,
        "action": _str(item, "action", limit=60), "posted": _str(item, "posted", limit=40),
        "entry": _num(item, "entry"), "stop": _num(item, "stop"), "target": _num(item, "target"),
        "conf": _str(item, "conf", limit=20), "reported": _str(item, "reported", limit=MAX_SHORT),
        "outcome_json": json.dumps(clean_outcome, sort_keys=True, separators=(",", ":")),
        "methodology": _str(item, "methodology", limit=MAX_SHORT),
    }
    sha = _str(item, "sha", limit=64)
    if sha is not None and not _SHA.match(sha):
        raise ItemError("sha must be lower-case hex")
    row["sha"] = sha or _canonical_sha(row)
    return row


_RECORD_COLS = ("record_id", "author_id", "stated_date", "record_type", "tickers", "note", "quote",
                "image_count", "sha", "imported_at")
_CALL_COLS = ("call_id", "record_id", "author_id", "ticker", "direction", "setup", "action", "posted",
              "entry", "stop", "target", "conf", "reported", "outcome_json", "methodology", "sha",
              "imported_at")


def _upsert_sql(table: str, cols: tuple, pk: str) -> str:
    sets = ", ".join(f"{c} = excluded.{c}" for c in cols if c != pk)
    return (f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))}) "
            f"ON CONFLICT({pk}) DO UPDATE SET {sets}")


def _fts_exists(conn) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE name = 'wisdom_archive_fts'").fetchone() is not None


def upsert_batch(conn: sqlite3.Connection, kind: str, items: list) -> dict:
    """Idempotent by primary key + sha: same sha -> unchanged, new sha -> updated."""
    if kind not in ("records", "calls"):
        raise ValueError("kind must be 'records' or 'calls'")
    if len(items) > MAX_BATCH:
        raise ValueError(f"at most {MAX_BATCH} items per batch")
    validate = validate_record if kind == "records" else validate_call
    table, pk, cols = (("wisdom_archive_records", "record_id", _RECORD_COLS) if kind == "records"
                       else ("wisdom_archive_calls", "call_id", _CALL_COLS))
    counts = {"received": len(items), "inserted": 0, "updated": 0, "unchanged": 0, "rejected": 0}
    errors: list = []
    fts = kind == "records" and _fts_exists(conn)
    sql = _upsert_sql(table, cols, pk)
    now = _now()
    seen: set = set()
    for i, item in enumerate(items):
        try:
            row = validate(item)
        except ItemError as exc:
            counts["rejected"] += 1
            if len(errors) < 50:
                errors.append({"index": i, "error": str(exc)})
            continue
        key = row[pk]
        if key in seen:
            counts["rejected"] += 1
            if len(errors) < 50:
                errors.append({"index": i, "error": "duplicate key in batch"})
            continue
        seen.add(key)
        prior = conn.execute(f"SELECT sha FROM {table} WHERE {pk} = ?", (key,)).fetchone()
        if prior is not None and prior[0] == row["sha"]:
            counts["unchanged"] += 1
            continue
        row["imported_at"] = now
        conn.execute(sql, tuple(row[c] for c in cols))
        counts["updated" if prior is not None else "inserted"] += 1
        if fts:
            rowid = conn.execute(f"SELECT rowid FROM {table} WHERE {pk} = ?", (key,)).fetchone()[0]
            conn.execute("DELETE FROM wisdom_archive_fts WHERE rowid = ?", (rowid,))
            conn.execute(
                "INSERT INTO wisdom_archive_fts (rowid, record_id, author_id, record_type, stated_date, "
                "tickers, note, quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (rowid, row["record_id"], row["author_id"], row["record_type"], row["stated_date"],
                 row["tickers"].replace(",", " "), row["note"], row["quote"]))
    return {"kind": kind, **counts, "errors": errors}


# ── admin reads ────────────────────────────────────────────────────────────────

def _call_dict(r) -> dict:
    d = dict(r)
    try:
        d["outcome"] = json.loads(d.pop("outcome_json") or "{}")
    except ValueError:
        d["outcome"] = {}
    return d


def _record_dict(r) -> dict:
    d = dict(r)
    d["tickers"] = [t for t in (d.get("tickers") or "").split(",") if t]
    return d


def by_ticker(conn, sym: str, *, limit: int = 500) -> dict:
    t = normalize_ticker(sym)
    records = [_record_dict(r) for r in conn.execute(
        "SELECT record_id, author_id, stated_date, record_type, tickers, note, quote, image_count "
        "FROM wisdom_archive_records WHERE (',' || tickers || ',') LIKE ? "
        "ORDER BY stated_date ASC, record_id ASC LIMIT ?", (f"%,{t},%", limit))]
    calls = [_call_dict(r) for r in conn.execute(
        "SELECT call_id, record_id, author_id, ticker, direction, setup, action, posted, entry, stop, target, "
        "conf, reported, outcome_json, methodology FROM wisdom_archive_calls WHERE ticker = ? "
        "ORDER BY posted ASC, call_id ASC LIMIT ?", (t, limit))]
    return {"ticker": t, "records": records, "calls": calls}


def by_setup(conn, setup: str, *, limit: int = 25) -> dict:
    s = (setup or "").strip()
    if not _SETUP.match(s):
        raise ItemError("setup malformed")
    base = (
        "SELECT c.call_id, c.record_id, c.author_id, c.ticker, c.direction, c.setup, c.action, c.posted, "
        "c.entry, c.stop, c.target, c.conf, c.reported, c.outcome_json, c.methodology, r.note AS record_note "
        "FROM wisdom_archive_calls c LEFT JOIN wisdom_archive_records r ON r.record_id = c.record_id "
        "WHERE c.setup = ? COLLATE NOCASE AND json_extract(c.outcome_json, '$.r20') IS NOT NULL ")
    best = [_call_dict(r) for r in conn.execute(
        base + "ORDER BY json_extract(c.outcome_json, '$.r20') DESC LIMIT ?", (s, limit))]
    worst = [_call_dict(r) for r in conn.execute(
        base + "ORDER BY json_extract(c.outcome_json, '$.r20') ASC LIMIT ?", (s, limit))]
    agg = conn.execute(
        "SELECT COUNT(*), SUM(json_extract(outcome_json, '$.r20') IS NOT NULL), "
        "AVG(json_extract(outcome_json, '$.r20')) FROM wisdom_archive_calls WHERE setup = ? COLLATE NOCASE",
        (s,)).fetchone()
    return {"setup": s, "n_calls": agg[0] or 0, "n_scored": agg[1] or 0,
            "mean_r20": agg[2], "best": best, "worst": worst}


_WORD = re.compile(r"[A-Za-z0-9]+")


def build_match(q: str) -> str:
    words = [w.lower() for w in _WORD.findall(q or "")][:12]
    terms = [w for w in dict.fromkeys(words) if len(w) >= 2]
    return " OR ".join('"' + t.replace('"', '""') + '"' for t in terms)


def search(conn, q: str, *, limit: int = 50) -> dict:
    match = build_match(q)
    if not match or not _fts_exists(conn):
        return {"q": q, "hits": []}
    rows = conn.execute(
        "SELECT f.record_id, f.author_id, f.record_type, f.stated_date, r.tickers, r.note, r.quote, "
        "bm25(wisdom_archive_fts) AS score FROM wisdom_archive_fts f "
        "JOIN wisdom_archive_records r ON r.rowid = f.rowid "
        "WHERE wisdom_archive_fts MATCH ? ORDER BY score ASC LIMIT ?", (match, limit)).fetchall()
    return {"q": q, "hits": [_record_dict(r) for r in rows]}


def stats(conn) -> dict:
    def grouped(sql: str) -> dict:
        return {(k if k is not None else "(none)"): n for k, n in conn.execute(sql)}

    return {
        "records": conn.execute("SELECT COUNT(*) FROM wisdom_archive_records").fetchone()[0],
        "calls": conn.execute("SELECT COUNT(*) FROM wisdom_archive_calls").fetchone()[0],
        "records_by_author": grouped(
            "SELECT author_id, COUNT(*) FROM wisdom_archive_records GROUP BY author_id ORDER BY 2 DESC"),
        "records_by_type": grouped(
            "SELECT record_type, COUNT(*) FROM wisdom_archive_records GROUP BY record_type ORDER BY 2 DESC"),
        "calls_by_author": grouped(
            "SELECT author_id, COUNT(*) FROM wisdom_archive_calls GROUP BY author_id ORDER BY 2 DESC"),
        "calls_by_setup": grouped(
            "SELECT setup, COUNT(*) FROM wisdom_archive_calls GROUP BY setup ORDER BY 2 DESC LIMIT 200"),
    }
