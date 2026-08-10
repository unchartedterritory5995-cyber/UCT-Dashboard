"""Full-text index over EVERY transcript we can reach — search across companies.

The existing search finds a word inside ONE transcript you already opened. This
answers the question that actually moves money: *who said "tariff" this
quarter, and what did they say?* — across every company that reported.

Built on FMP Ultimate, which is uncapped, so the corpus costs time rather than
money. Established by probing:

  * `/stable/earning-call-transcript-latest?page=&limit=` enumerates the newest
    transcripts across ALL issuers. **Page size caps at 100 whatever `limit`
    says** — asking for 1000 returns 100, so the walk is by PAGE, never by a
    bigger limit.
  * page 10 reaches ~3 days back in peak season, so a week is ~20 pages.
  * `/stable/earning-call-transcript?symbol=&year=&quarter=` returns the full
    text for one call.

SQLite FTS5, on the Railway volume so it survives redeploys. `porter` stemming
so "tariffs" finds "tariff"; bm25 ranking so the call that dwells on a term
outranks the one that mentions it once.

The content lives IN the FTS table rather than a contentless index: snippets
are the product here, and a contentless index cannot produce them.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from typing import Any, Optional

_log = logging.getLogger(__name__)

DB_PATH = os.environ.get(
    "TRANSCRIPT_INDEX_DB_PATH",
    os.path.join(os.environ.get("DATA_DIR", "/data"), "transcript_index.db"))

# How much history to keep searchable. A transcript is ~50KB of text, so 90 days
# of peak season is on the order of a few hundred MB with the index — bounded
# deliberately rather than growing without limit on a shared volume.
RETENTION_DAYS = int(os.environ.get("TRANSCRIPT_INDEX_RETENTION_DAYS", "90"))
MAX_PAGES = int(os.environ.get("TRANSCRIPT_INDEX_MAX_PAGES", "25"))

_INIT_LOCK = threading.Lock()
_INITED = False


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db() -> None:
    global _INITED
    with _INIT_LOCK:
        if _INITED:
            return
        with _conn() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS transcripts (
                    symbol      TEXT NOT NULL,
                    fiscal_year INTEGER NOT NULL,
                    quarter     INTEGER NOT NULL,
                    call_date   TEXT,
                    words       INTEGER,
                    indexed_at  INTEGER NOT NULL,
                    PRIMARY KEY (symbol, fiscal_year, quarter)
                );
                CREATE INDEX IF NOT EXISTS ix_transcripts_date
                    ON transcripts(call_date DESC);

                CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
                    symbol UNINDEXED,
                    fiscal_year UNINDEXED,
                    quarter UNINDEXED,
                    call_date UNINDEXED,
                    content,
                    tokenize = 'porter unicode61'
                );
            """)
        _INITED = True


def has(symbol: str, fiscal_year: int, quarter: int) -> bool:
    """Already indexed? Checked BEFORE fetching, so a resumed sweep is cheap."""
    init_db()
    with _conn() as c:
        row = c.execute(
            "SELECT 1 FROM transcripts WHERE symbol=? AND fiscal_year=? AND quarter=?",
            (symbol.upper(), int(fiscal_year), int(quarter))).fetchone()
    return row is not None


def put(symbol: str, fiscal_year: int, quarter: int, call_date: str,
        content: str) -> None:
    """Index one transcript, replacing any earlier copy of the same call."""
    init_db()
    sym = (symbol or "").upper().strip()
    if not sym or not content:
        return
    with _conn() as c:
        # Delete before insert: FTS5 has no upsert, and without this a
        # re-indexed call would return twice in every search that matched it.
        c.execute("DELETE FROM transcript_fts WHERE symbol=? AND fiscal_year=? "
                  "AND quarter=?", (sym, int(fiscal_year), int(quarter)))
        c.execute("INSERT INTO transcript_fts(symbol, fiscal_year, quarter, "
                  "call_date, content) VALUES (?,?,?,?,?)",
                  (sym, int(fiscal_year), int(quarter), call_date or "", content))
        c.execute("INSERT OR REPLACE INTO transcripts(symbol, fiscal_year, "
                  "quarter, call_date, words, indexed_at) VALUES (?,?,?,?,?,?)",
                  (sym, int(fiscal_year), int(quarter), call_date or "",
                   len(content.split()), int(time.time())))


_FTS_SPECIALS = ('"', '*', '(', ')', ':', '^', '-')


def _to_match_query(q: str) -> Optional[str]:
    """User text → an FTS5 MATCH expression that cannot be a syntax error.

    A bare user string is not a valid FTS5 query: `AT&T`, `Q3:`, an unbalanced
    quote or a trailing `-` all raise OperationalError, which would surface as
    a 500 on an ordinary search. Each term is quoted, which also makes the
    match literal — the one syntax we deliberately keep is a leading `"` for a
    whole phrase.
    """
    q = (q or "").strip()
    if not q:
        return None
    phrase = q.startswith('"') and q.endswith('"') and len(q) > 2
    if phrase:
        inner = q[1:-1].replace('"', '')
        return f'"{inner}"' if inner.strip() else None
    terms = []
    for raw in q.split():
        t = "".join(ch for ch in raw if ch not in _FTS_SPECIALS).strip()
        if t:
            terms.append(f'"{t}"')
    return " AND ".join(terms) if terms else None


def search(query: str, limit: int = 40, symbol: Optional[str] = None,
           since: Optional[str] = None) -> dict[str, Any]:
    """Cross-company search. Returns ranked hits with a highlighted snippet."""
    init_db()
    match = _to_match_query(query)
    if not match:
        return {"query": query, "match": None, "hits": [], "total": 0}

    where = ["transcript_fts MATCH ?"]
    args: list[Any] = [match]
    if symbol:
        where.append("symbol = ?")
        args.append(symbol.upper().strip())
    if since:
        where.append("call_date >= ?")
        args.append(since)

    sql = f"""
        SELECT symbol, fiscal_year, quarter, call_date,
               snippet(transcript_fts, 4, '<mark>', '</mark>', ' … ', 28) AS snip,
               bm25(transcript_fts) AS score
          FROM transcript_fts
         WHERE {' AND '.join(where)}
         ORDER BY score
         LIMIT ?
    """
    args.append(max(1, min(int(limit or 40), 200)))
    try:
        with _conn() as c:
            rows = c.execute(sql, args).fetchall()
            total = c.execute(
                f"SELECT COUNT(*) FROM transcript_fts WHERE {' AND '.join(where)}",
                args[:-1]).fetchone()[0]
    except sqlite3.OperationalError as exc:
        # Never let a query shape become a 500 — report it as an empty result
        # with the reason attached.
        _log.warning("[tindex] bad match query %r: %s", match, exc)
        return {"query": query, "match": match, "hits": [], "total": 0,
                "error": "unsupported search syntax"}

    return {
        "query": query,
        "match": match,
        "total": total,
        "hits": [{"symbol": r["symbol"], "year": r["fiscal_year"],
                  "quarter": r["quarter"], "date": r["call_date"],
                  "snippet": r["snip"],
                  # bm25 returns NEGATIVE numbers, better = more negative.
                  # Flipped so a caller sorting descending gets what it expects.
                  "score": round(-float(r["score"]), 3)} for r in rows],
    }


def trend(query: str, months: int = 12, symbol: Optional[str] = None) -> dict[str, Any]:
    """How often a theme comes up, month by month, across the whole corpus.

    "Who is talking about tariffs, and is it accelerating" — a question no
    single-company view can answer, over a corpus that costs nothing because
    FMP Ultimate is uncapped.

    Reported as a SHARE, not a raw count. Calls cluster hard in earnings season,
    so a raw count peaks every quarter no matter what the term is doing — the
    shape would describe the calendar rather than the theme. `pct` is mentions
    as a percentage of the calls indexed that month, which is the honest series.
    """
    init_db()
    match = _to_match_query(query)
    if not match:
        return {"query": query, "months": [], "total": 0}

    args: list[Any] = [match]
    where = ["transcript_fts MATCH ?"]
    if symbol:
        where.append("symbol = ?")
        args.append(symbol.upper().strip())

    try:
        with _conn() as c:
            hits = c.execute(
                f"SELECT substr(call_date, 1, 7) AS ym, COUNT(*) n "
                f"  FROM transcript_fts WHERE {' AND '.join(where)} "
                f"   AND call_date != '' GROUP BY ym", args).fetchall()
            # The denominator comes from the SAME table, so a month with no
            # indexed calls cannot report a share at all rather than 100%.
            totals = c.execute(
                "SELECT substr(call_date, 1, 7) AS ym, COUNT(*) n FROM transcripts "
                " WHERE call_date != '' GROUP BY ym").fetchall()
    except sqlite3.OperationalError as exc:
        _log.warning("[tindex] trend failed for %r: %s", match, exc)
        return {"query": query, "months": [], "total": 0,
                "error": "unsupported search syntax"}

    hit_by = {r["ym"]: r["n"] for r in hits}
    rows = []
    for r in sorted(totals, key=lambda x: x["ym"])[-max(1, int(months)):]:
        ym, calls = r["ym"], r["n"]
        n = hit_by.get(ym, 0)
        rows.append({"month": ym, "calls": calls, "mentions": n,
                     "pct": round(n * 100.0 / calls, 1) if calls else None})
    return {"query": query, "match": match, "months": rows,
            "total": sum(v for v in hit_by.values())}


def stats() -> dict[str, Any]:
    init_db()
    with _conn() as c:
        row = c.execute(
            "SELECT COUNT(*) n, MIN(call_date) lo, MAX(call_date) hi, "
            "SUM(words) w FROM transcripts").fetchone()
        syms = c.execute("SELECT COUNT(DISTINCT symbol) FROM transcripts").fetchone()[0]
    size = os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0
    return {"transcripts": row["n"] or 0, "symbols": syms,
            "oldest": row["lo"], "newest": row["hi"],
            "words": row["w"] or 0, "db_mb": round(size / 1e6, 1), "db": DB_PATH}


def prune(days: int = None) -> int:
    """Drop calls older than the retention window. Returns rows removed."""
    init_db()
    import datetime
    days = RETENTION_DAYS if days is None else days
    cutoff = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
    with _conn() as c:
        n = c.execute("SELECT COUNT(*) FROM transcripts WHERE call_date < ? "
                      "AND call_date != ''", (cutoff,)).fetchone()[0]
        c.execute("DELETE FROM transcript_fts WHERE call_date < ? AND call_date != ''",
                  (cutoff,))
        c.execute("DELETE FROM transcripts WHERE call_date < ? AND call_date != ''",
                  (cutoff,))
    return n
