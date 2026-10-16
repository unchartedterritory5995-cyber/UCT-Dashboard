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
from datetime import datetime, timedelta, timezone
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


# ── setup playbooks ──────────────────────────────────────────────────────────

SETUP_FIELDS = {"setup_id", "name", "family", "aliases", "used_by", "stats", "stats_trades", "context",
                "teachings", "winners", "failures", "sha"}
#: The measured numbers a playbook's stats may carry; anything else is refused.
STAT_FIELDS = ("n", "n_scored", "win20", "med_r20", "mean_r20", "med_edge20", "mean_simR", "mean_edgeR",
               "edgeR_z", "thin")
CONTEXT_GROUPS = ("trader", "kind", "market", "entry", "extension_from_50", "direction")
TEACHING_FIELDS = {"record_id", "author_id", "date", "note"}
EXAMPLE_FIELDS = {"call_id", "record_id", "ticker", "author_id", "posted", "direction", "action", "evidence",
                  "r20", "sim_R", "regime"}
MAX_ALIASES = 40
MAX_CONTEXT_VALUES = 20
MAX_TEACHINGS = 20
MAX_EXAMPLES = 20
TEACHING_NOTE_CHARS = 400
EVIDENCE_CHARS = 200
_SETUP_ID = re.compile(r"^[a-z0-9_]{1,60}$")


def _stats(raw: Any, where: str) -> dict:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ItemError(f"{where} must be an object")
    bad = sorted(set(raw) - set(STAT_FIELDS))
    if bad:
        raise ItemError(f"unknown {where} fields: {', '.join(bad)[:120]}")
    out: dict = {}
    for k in STAT_FIELDS:
        if k not in raw or raw[k] is None:
            continue
        if k == "thin":
            if not isinstance(raw[k], bool):
                raise ItemError(f"{where}.thin must be a boolean")
            out[k] = raw[k]
        else:
            out[k] = _num(raw, k)
    return out


def _bounded_list(item: dict, key: str, cap: int) -> list:
    v = item.get(key) or []
    if not isinstance(v, list) or len(v) > cap:
        raise ItemError(f"{key} must be a list of at most {cap}")
    return v


def _teaching(t: Any) -> dict:
    if not isinstance(t, dict):
        raise ItemError("teaching must be an object")
    _unknown(t, TEACHING_FIELDS)
    rid = _str(t, "record_id", required=True)
    if not _RECORD_ID.match(rid):
        raise ItemError("teaching record_id malformed")
    date = _str(t, "date", limit=40)
    if date is not None and not _DATE.match(date):
        raise ItemError("teaching date must start YYYY-MM-DD")
    return {"record_id": rid, "author_id": _author(t), "date": date,
            "note": _clip(_str(t, "note", limit=MAX_TEXT), TEACHING_NOTE_CHARS)}


def _example(e: Any) -> dict:
    if not isinstance(e, dict):
        raise ItemError("example must be an object")
    _unknown(e, EXAMPLE_FIELDS)
    cid = _str(e, "call_id", required=True)
    m = _CALL_ID.match(cid)
    if not m or _str(e, "record_id", required=True) != m.group(1):
        raise ItemError("example call_id/record_id malformed")
    direction = _str(e, "direction")
    if direction is not None and direction not in DIRECTIONS:
        raise ItemError("example direction not in long/short/neutral")
    return {"call_id": cid, "record_id": m.group(1), "ticker": normalize_ticker(e.get("ticker")),
            "author_id": _author(e), "posted": _str(e, "posted", limit=40), "direction": direction,
            "action": _str(e, "action", limit=60),
            "evidence": _clip(_str(e, "evidence", limit=MAX_TEXT), EVIDENCE_CHARS),
            "r20": _num(e, "r20"), "sim_R": _num(e, "sim_R"), "regime": _str(e, "regime", limit=60)}


def validate_setup(item: Any) -> dict:
    if not isinstance(item, dict):
        raise ItemError("item must be an object")
    _unknown(item, SETUP_FIELDS)
    sid = _str(item, "setup_id", required=True, limit=60)
    if not _SETUP_ID.match(sid):
        raise ItemError("setup_id malformed")
    aliases = _bounded_list(item, "aliases", MAX_ALIASES)
    if not all(isinstance(a, str) and 0 < len(a.strip()) <= 80 for a in aliases):
        raise ItemError("aliases must be short strings")
    used_by = _bounded_list(item, "used_by", 10)
    if not all(isinstance(a, str) and a in team_authors() for a in used_by):
        raise ItemError("used_by must name team authors")
    context = item.get("context") or {}
    if not isinstance(context, dict):
        raise ItemError("context must be an object")
    bad = sorted(set(context) - set(CONTEXT_GROUPS))
    if bad:
        raise ItemError(f"unknown context groups: {', '.join(bad)[:120]}")
    clean_ctx: dict = {}
    for g in CONTEXT_GROUPS:
        rows = context.get(g)
        if rows is None:
            continue
        if not isinstance(rows, dict) or len(rows) > MAX_CONTEXT_VALUES:
            raise ItemError(f"context.{g} must be an object of at most {MAX_CONTEXT_VALUES}")
        clean_ctx[g] = {}
        for v, st in rows.items():
            if not isinstance(v, str) or not 0 < len(v) <= 60:
                raise ItemError(f"context.{g} value malformed")
            clean_ctx[g][v] = _stats(st, f"context.{g}")
    row = {
        "setup_id": sid, "name": _str(item, "name", required=True), "family": _str(item, "family", limit=60),
        "aliases_json": json.dumps([a.strip() for a in aliases], ensure_ascii=False),
        "used_by_json": json.dumps(used_by),
        "stats_json": json.dumps({"all": _stats(item.get("stats"), "stats"),
                                  "trades": _stats(item.get("stats_trades"), "stats_trades")}, sort_keys=True),
        "context_json": json.dumps(clean_ctx, sort_keys=True, ensure_ascii=False),
        "teachings_json": json.dumps([_teaching(t) for t in _bounded_list(item, "teachings", MAX_TEACHINGS)],
                                     ensure_ascii=False),
        "winners_json": json.dumps([_example(e) for e in _bounded_list(item, "winners", MAX_EXAMPLES)],
                                   ensure_ascii=False),
        "failures_json": json.dumps([_example(e) for e in _bounded_list(item, "failures", MAX_EXAMPLES)],
                                    ensure_ascii=False),
    }
    sha = _str(item, "sha", limit=64)
    if sha is not None and not _SHA.match(sha):
        raise ItemError("sha must be lower-case hex")
    row["sha"] = sha or _canonical_sha(row)
    return row


_SETUP_COLS = ("setup_id", "name", "family", "aliases_json", "used_by_json", "stats_json", "context_json",
               "teachings_json", "winners_json", "failures_json", "sha", "imported_at")
KINDS = ("records", "calls", "setups")


def _upsert_sql(table: str, cols: tuple, pk: str) -> str:
    sets = ", ".join(f"{c} = excluded.{c}" for c in cols if c != pk)
    return (f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))}) "
            f"ON CONFLICT({pk}) DO UPDATE SET {sets}")


def _fts_exists(conn) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE name = 'wisdom_archive_fts'").fetchone() is not None


def upsert_batch(conn: sqlite3.Connection, kind: str, items: list) -> dict:
    """Idempotent by primary key + sha: same sha -> unchanged, new sha -> updated."""
    if kind not in KINDS:
        raise ValueError("kind must be 'records', 'calls' or 'setups'")
    if len(items) > MAX_BATCH:
        raise ValueError(f"at most {MAX_BATCH} items per batch")
    validate, table, pk, cols = {
        "records": (validate_record, "wisdom_archive_records", "record_id", _RECORD_COLS),
        "calls": (validate_call, "wisdom_archive_calls", "call_id", _CALL_COLS),
        "setups": (validate_setup, "wisdom_archive_setups", "setup_id", _SETUP_COLS),
    }[kind]
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


# ── member reads (owner ruling 2026-10-15: paid members + in-app tools) ────────

_AUTHOR = re.compile(r"^[a-z0-9_\-]{1,40}$")


def _call_summary(conn, where: str, params: tuple) -> dict:
    agg = conn.execute(
        "SELECT COUNT(*), SUM(json_extract(outcome_json, '$.r20') IS NOT NULL), "
        f"AVG(json_extract(outcome_json, '$.r20')) FROM wisdom_archive_calls WHERE {where}", params).fetchone()
    return {"n_calls": agg[0] or 0, "n_scored": agg[1] or 0, "mean_r20": agg[2]}


def ticker_summary(conn, sym: str) -> dict:
    t = normalize_ticker(sym)
    return {"ticker": t, **_call_summary(conn, "ticker = ?", (t,))}


def last_call(conn, sym: str) -> Optional[dict]:
    """The newest call on a ticker, without its price levels (the member surfaces never show them)."""
    t = normalize_ticker(sym)
    r = conn.execute(
        "SELECT call_id, record_id, author_id, ticker, direction, setup, action, posted, outcome_json "
        "FROM wisdom_archive_calls WHERE ticker = ? ORDER BY posted DESC, call_id DESC LIMIT 1", (t,)).fetchone()
    return _call_dict(r) if r is not None else None


def by_author(conn, author: str, *, limit: int = 100) -> dict:
    """One trader: newest records first, their calls newest first, and a scored-call summary."""
    a = (author or "").strip().lower()
    if not _AUTHOR.match(a) or a not in team_authors():
        raise ItemError("author is not one of the team authors")
    records = [_record_dict(r) for r in conn.execute(
        "SELECT record_id, author_id, stated_date, record_type, tickers, note, quote, image_count "
        "FROM wisdom_archive_records WHERE author_id = ? ORDER BY stated_date DESC, record_id DESC LIMIT ?",
        (a, limit))]
    calls = [_call_dict(r) for r in conn.execute(
        "SELECT call_id, record_id, author_id, ticker, direction, setup, action, posted, entry, stop, target, "
        "conf, reported, outcome_json, methodology FROM wisdom_archive_calls WHERE author_id = ? "
        "ORDER BY posted DESC, call_id DESC LIMIT ?", (a, limit))]
    n_records = conn.execute("SELECT COUNT(*) FROM wisdom_archive_records WHERE author_id = ?", (a,)).fetchone()[0]
    return {"author": a, "n_records": n_records, **_call_summary(conn, "author_id = ?", (a,)),
            "records": records, "calls": calls}


#: Words that carry no retrieval signal in a member's question; dropped before the FTS
#: OR-query so "what did they say about X" does not rank on "what" and "say".
_STOP = frozenset("""a an and are as at be been but by can could did do does for from had has have how i if in
into is it its me my of on or our say said should so that the their them then there they this to us was we
were what when where which who why will with would you your about any some think thoughts view take""".split())


def _clip(text: Optional[str], n: int) -> str:
    t = " ".join((text or "").split())
    return t if len(t) <= n else t[: max(0, n - 1)].rstrip() + "…"


def _scored_calls(conn, record_ids: list) -> dict:
    out: dict = {}
    if not record_ids:
        return out
    marks = ",".join("?" * len(record_ids))
    for r in conn.execute(
            "SELECT record_id, ticker, direction, setup, posted, outcome_json FROM wisdom_archive_calls "
            f"WHERE record_id IN ({marks}) ORDER BY call_id", tuple(record_ids)):
        d = _call_dict(r)
        out.setdefault(d["record_id"], []).append(d)
    return out


def retrieval_hits(conn, query: str, *, tickers=(), limit: int = 6, excerpt_chars: int = 280) -> list:
    """Compact, bounded hits for Ask AI and Compass: records naming a queried ticker first
    (newest first), then FTS-ranked matches on the remaining words. Each hit carries the
    record id, trader, date, a note excerpt and its calls' scored outcomes. Never raises on an
    empty/odd query; returns [] when nothing matches."""
    limit = max(1, min(int(limit or 6), 20))
    picked: list = []
    seen: set = set()
    syms = []
    for t in tickers or ():
        try:
            syms.append(normalize_ticker(t))
        except ItemError:
            continue
    for t in list(dict.fromkeys(syms))[:3]:
        for r in conn.execute(
                "SELECT record_id, author_id, stated_date, record_type, tickers, note FROM wisdom_archive_records "
                "WHERE (',' || tickers || ',') LIKE ? ORDER BY stated_date DESC, record_id DESC LIMIT ?",
                (f"%,{t},%", limit)):
            if r[0] not in seen and len(picked) < limit:
                seen.add(r[0])
                picked.append(r)
    words = [w for w in _WORD.findall(query or "") if w.lower() not in _STOP]
    match = build_match(" ".join(words))
    if len(picked) < limit and match and _fts_exists(conn):
        for r in conn.execute(
                "SELECT f.record_id, f.author_id, f.stated_date, f.record_type, r.tickers, r.note "
                "FROM wisdom_archive_fts f JOIN wisdom_archive_records r ON r.rowid = f.rowid "
                "WHERE wisdom_archive_fts MATCH ? ORDER BY bm25(wisdom_archive_fts) ASC LIMIT ?",
                (match, limit * 2)):
            if r[0] not in seen and len(picked) < limit:
                seen.add(r[0])
                picked.append(r)
    calls = _scored_calls(conn, [r[0] for r in picked])
    hits = []
    for r in picked:
        rec_calls = []
        for c in calls.get(r[0], [])[:3]:
            o = c.get("outcome") or {}
            rec_calls.append({"ticker": c["ticker"], "direction": c.get("direction"), "setup": c.get("setup"),
                              "posted": c.get("posted"),
                              "outcome": {k: o[k] for k in ("r5", "r20", "r60", "status") if k in o}})
        hits.append({"record_id": r[0], "author_id": r[1], "stated_date": r[2], "record_type": r[3],
                     "tickers": [t for t in (r[4] or "").split(",") if t][:8],
                     "excerpt": _clip(r[5], excerpt_chars), "calls": rec_calls})
    return hits


# ── setup playbooks: reads ───────────────────────────────────────────────────

def _setup_dict(r) -> dict:
    d = dict(r)
    for k in ("aliases", "used_by", "stats", "context", "teachings", "winners", "failures"):
        try:
            d[k] = json.loads(d.pop(f"{k}_json") or "null")
        except ValueError:
            d[k] = None
    return d


_PLAYBOOK_SQL = ("SELECT setup_id, name, family, aliases_json, used_by_json, stats_json, context_json, "
                 "teachings_json, winners_json, failures_json FROM wisdom_archive_setups")


def playbook(conn, setup: str) -> Optional[dict]:
    """One setup's playbook, or None when no such setup was imported."""
    s = (setup or "").strip().lower()
    if not _SETUP_ID.match(s):
        raise ItemError("setup malformed")
    r = conn.execute(_PLAYBOOK_SQL + " WHERE setup_id = ?", (s,)).fetchone()
    return _setup_dict(r) if r is not None else None


def playbooks(conn) -> dict:
    """Index rows, most-called first."""
    rows = []
    for r in conn.execute(_PLAYBOOK_SQL):
        d = _setup_dict(r)
        st = (d.get("stats") or {}).get("all") or {}
        rows.append({"setup_id": d["setup_id"], "name": d["name"], "family": d.get("family"),
                     "n": st.get("n"), "n_scored": st.get("n_scored"), "mean_edgeR": st.get("mean_edgeR"),
                     "edgeR_z": st.get("edgeR_z"), "n_teachings": len(d.get("teachings") or []),
                     "n_examples": len(d.get("winners") or []) + len(d.get("failures") or [])})
    rows.sort(key=lambda x: (-(x["n"] or 0), x["setup_id"]))
    return {"setups": rows}


def _alias_pattern(alias: str) -> Optional[re.Pattern]:
    a = " ".join((alias or "").split())
    if len(a) < 2:
        return None
    # short all-caps aliases (EP, HVE, LP) match case-sensitively, so "ep" inside prose does not
    flags = 0 if (a.isupper() and len(a) <= 4) else re.I
    return re.compile(r"(?<![A-Za-z0-9])" + re.escape(a) + r"(?![A-Za-z0-9])", flags)


def match_setups(conn, text: str, *, limit: int = 2) -> list:
    """Setup ids the text names (by id, name or a stored alias), longest match first."""
    t = text or ""
    if not t.strip():
        return []
    found: dict = {}
    for sid, name, aliases_json in conn.execute(
            "SELECT setup_id, name, aliases_json FROM wisdom_archive_setups"):
        try:
            aliases = json.loads(aliases_json or "[]")
        except ValueError:
            aliases = []
        best = 0
        for a in [sid.replace("_", " "), (name or "").split("/")[0].split("(")[0], *aliases]:
            p = _alias_pattern(a)
            if p is not None and p.search(t):
                best = max(best, len(a.strip()))
        if best:
            found[sid] = best
    return [sid for sid, _ in sorted(found.items(), key=lambda kv: (-kv[1], kv[0]))][:max(1, limit)]

# ── research surfaces: per-ticker daily activity ─────────────────────────────

#: The longest window ticker_daily answers, in calendar days.
MAX_DAILY_DAYS = 3650


def ticker_daily(conn, sym: str, *, days: int = 365, today: Optional[str] = None) -> dict:
    """Team posts and calls on one ticker, per stated day, oldest first, for the last `days`
    calendar days ending `today` (an ISO date; default the newest archived day for the ticker).

    A day with no team post is ABSENT, never a zero row: the archive records what was posted, so
    a missing day says the team did not post about the name that day, not that something was
    measured as zero.
    `archive_through` is the newest day in the WHOLE archive: past it, nothing is known yet.
    """
    t = normalize_ticker(sym)
    n = max(1, min(int(days or 365), MAX_DAILY_DAYS))
    like = f"%,{t},%"
    # How far the archive reaches at all: a day after this is UNKNOWN (not yet imported), never
    # "the team did not post". A surface laying these counts on a calendar needs both facts.
    reach = conn.execute("SELECT MAX(stated_date) FROM wisdom_archive_records").fetchone()[0]
    archive_through = str(reach)[:10] if reach else None
    end = today or (conn.execute(
        "SELECT MAX(stated_date) FROM wisdom_archive_records WHERE (',' || tickers || ',') LIKE ?",
        (like,)).fetchone()[0])
    if not end:
        return {"ticker": t, "through": None, "days": [], "posts_total": 0, "calls_total": 0,
                "last_post": None, "archive_through": archive_through}
    end = str(end)[:10]
    start = (datetime.fromisoformat(end) - timedelta(days=n - 1)).date().isoformat()
    posts = dict(conn.execute(
        "SELECT substr(stated_date, 1, 10) AS d, COUNT(*) FROM wisdom_archive_records "
        "WHERE (',' || tickers || ',') LIKE ? AND substr(stated_date, 1, 10) BETWEEN ? AND ? "
        "GROUP BY d", (like, start, end)).fetchall())
    calls = dict(conn.execute(
        "SELECT substr(posted, 1, 10) AS d, COUNT(*) FROM wisdom_archive_calls "
        "WHERE ticker = ? AND substr(posted, 1, 10) BETWEEN ? AND ? GROUP BY d",
        (t, start, end)).fetchall())
    rows = [{"date": d, "posts": posts.get(d, 0), "calls": calls.get(d, 0)}
            for d in sorted(set(posts) | set(calls))]
    last = conn.execute(
        "SELECT MAX(stated_date) FROM wisdom_archive_records WHERE (',' || tickers || ',') LIKE ?",
        (like,)).fetchone()[0]
    return {"ticker": t, "from": start, "through": end, "days": rows,
            "posts_total": sum(r["posts"] for r in rows), "calls_total": sum(r["calls"] for r in rows),
            "last_post": str(last)[:10] if last else None, "archive_through": archive_through}
