"""The two managed UCT Relative Strength watchlists: **RS Leaders** and **RS Emerging**.

Engineering map docs/superpowers/plans/2026-11-08-uct-rs-phase3-4-engineering-map.md,
unit 4-01 (decisions D9 names, D10 host, D11 rules). Rebuilt each morning at 04:40 ET by
the `rs_lists_nightly` job (`api.main._run_rs_lists`), after the 03:00 screener build and
the 04:15 rating history; read by members in the Watchlist picker's Prebuilt tab under
the section "UCT Relative Strength".

THE RULES, in real screener columns (`screener_rows` of ONE session: `bars_asof` = the
screener session), every name ETF-free twice (`COALESCE(is_etf, 0) != 1` AND not in
`rs_history.default_etf_tickers()`) and above the two published liquidity floors the RS
screener starters carry (`saved_screens._RS_LIQUID`, imported, never retyped):

  Leaders   rating >= 90 AND rs_nh_bars_ago <= 10 AND pct_vs_sma200 > 0
            AND rs_benchmark_agree = 1
  Emerging  rs_cross_up_bars_ago <= 5 AND rs_line_above_ma = 1 AND rating >= 80,
            minus every Leader (the cross age keeps counting after a cross the line has
            since given back, so "still above" is its own clause, as in the starter)

"rating" is the IBD-style 1-99 rating for the screener session itself: the
`rs_rating_history` row `rs_history_nightly` wrote for that session at 04:15, and the
screener's own `rs_rating_ibd` column only for a name with no such row. Why: the 03:00
build runs BEFORE the 04:15 rating job, so the screener column normally carries the
rating of the session before (`snapshot_db`'s comment on the seven columns). The
staleness guard below is what makes the history row for the session exist.

Each list keeps at most `CAP` names, cut by rating (then the most recent RS high), and is
then laid out in theme blocks: the theme is the screener `theme` column, else
`groups.resolve_primary_theme`, else the sector; themes run by member count, names inside
a theme by rating, then by the most recent RS high. Each item's note reads
"<Theme> · RS <rating> · high <n> bars ago".

THE GUARDS (`nightly_job`), each a recorded skip with a reason, never a raise:
  - `RS_LISTS_ENABLED` is not "1": return before reading or writing anything.
  - the screener has no session, or the rating history has none.
  - the rating history's newest session is OLDER than the screener session.
  - the lists already hold a session NEWER than the screener session.
  - per list: an empty result never replaces a list that holds names, unless the screener
    session is fresh (it is the settled session) and the session had rows to judge, so the
    rule truly returned nothing.
The receipt of every fire that got past the flag is a row in `rs_lists_runs` (a side
table in screener.db, created on first write) and is read back by `snapshot_db.status()`
as `rs_lists`.

The lists are updated in place: there is no dated history (D10). Writes go through
`watchlist_prebuilt.write_rs_list`, which owns the prebuilt store and its admin user.
"""
from __future__ import annotations

import json
import logging
import os
import time
from contextlib import closing

from api.services.screener import snapshot_db
from api.services.watchlist_prebuilt import RS_CATEGORY as CATEGORY
from api.services.watchlist_prebuilt import RS_LIST_NAMES as LIST_NAMES

log = logging.getLogger(__name__)

#: The switch, read per call by `enabled()`. Only the literal "1" arms it.
FLAG = "RS_LISTS_ENABLED"

#: The picker section and the two names have ONE owner, the prebuilt store (the picker
#: and the seeder's delete exemption read them there): `CATEGORY` and `LIST_NAMES` are
#: imported above, never retyped.
LEADERS_NAME, EMERGING_NAME = LIST_NAMES

#: The most names one list keeps.
CAP = 30
LEADERS_RATING_MIN = 90
LEADERS_NH_MAX_BARS = 10
EMERGING_RATING_MIN = 80
EMERGING_CROSS_MAX_BARS = 5
#: Emerging also needs the RS line still above its 21-day average now (owner decision,
#: 2026-11-07): a name that crossed up and fell back is not listed.
EMERGING_ABOVE_MA = 1

RUNS_TABLE = "rs_lists_runs"
RUNS_KEEP = 60

_LIQUID_DESC = "$10M+ traded a day and price $5 or more"
_BENCH_DESC = "Benchmarks agree means SPY and the equal-weight index RSP"

LEADERS_DESC = (
    "Stocks with an RS rating of 90 or higher (on a 1 to 99 scale) whose RS line made a "
    "new one-year high within the last 10 sessions, that trade above their 200-day "
    "average, and where both benchmarks agree. " + _BENCH_DESC + ": the RS line's "
    "20-day trend points the same way against both. No ETFs, " + _LIQUID_DESC + ". "
    f"Grouped by theme, at most {CAP} names, rebuilt each morning from the last session's "
    "close."
)
EMERGING_DESC = (
    "Stocks with an RS rating of 80 or higher (on a 1 to 99 scale) whose RS line crossed "
    "above its 21-day average within the last 5 sessions and is still above it, leaving "
    "out every name already on RS Leaders. No ETFs, " + _LIQUID_DESC + ". "
    f"Grouped by theme, at most {CAP} names, rebuilt each morning from the last session's "
    "close. " + _BENCH_DESC + " (the RS Leaders rule)."
)
DESCRIPTIONS = {LEADERS_NAME: LEADERS_DESC, EMERGING_NAME: EMERGING_DESC}

#: The screener columns one candidate row carries.
_ROW_COLUMNS = ("ticker", "company", "sector", "theme", "rs_rating_ibd", "rs_nh_bars_ago",
                "rs_cross_up_bars_ago", "rs_line_above_ma", "pct_vs_sma200", "rs_benchmark_agree")

_OPS = {"gte": (">=", "min"), "gt": (">", "min"), "lte": ("<=", "max"), "lt": ("<", "max")}


def enabled() -> bool:
    """`RS_LISTS_ENABLED` read per call: a flip needs no restart."""
    return os.environ.get("RS_LISTS_ENABLED", "0") == "1"


# --------------------------------------------------------------------------- #
# the rule
# --------------------------------------------------------------------------- #

def _liquid_sql() -> tuple[str, list]:
    """`saved_screens._RS_LIQUID` as SQL. An operator this does not know raises, so a
    floor added to the starters can never be dropped here without a test noticing."""
    from api.services.screener.saved_screens import _RS_LIQUID
    parts, args = [], []
    for f in _RS_LIQUID:
        key = f["key"]
        if key not in snapshot_db.COLUMNS:
            raise ValueError(f"liquidity floor names an unknown column {key!r}")
        op, bound = _OPS[f["op"]]
        parts.append(f"{key} {op} ?")
        args.append(f[bound])
    return " AND ".join(parts), args


def screener_session(conn) -> str | None:
    """The screener's session, YYYY-MM-DD: the MEDIAN row's `bars_asof` (the
    `snapshot_db.describe_rows` statistic, so one late row never moves it).

    None, never a raise, on a pod whose screener has never written (no
    `screener_rows` table yet): the job's friendly "the screener has no session
    yet" skip, not `OperationalError: no such table` (4-11 check). A
    `sqlite_master` lookup, so nothing is created."""
    from api.services.screener import rs_history
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'screener_rows'").fetchone() is None:
        return None
    d = snapshot_db.describe_rows(conn, " WHERE bars_asof IS NOT NULL", (),
                                  date_expr="bars_asof").get("snapshot_date")
    if d in (None, ""):
        return None
    try:
        return rs_history.session_key(d)
    except (TypeError, ValueError):
        return None


def _candidates(conn, session: str, etf_tickers) -> tuple[list, int]:
    """(rows that could pass either rule bar the rating, rows judged in the session)."""
    from api.services.screener import rs_history
    ymd = str(rs_history.session_ymd(session))
    liquid, largs = _liquid_sql()
    base = f"FROM screener_rows WHERE bars_asof = ? AND COALESCE(is_etf, 0) != 1 AND {liquid}"
    judged = int(conn.execute(f"SELECT COUNT(*) {base}", [ymd, *largs]).fetchone()[0] or 0)
    sql = (f"SELECT {', '.join(_ROW_COLUMNS)} {base} AND ("
           "(rs_nh_bars_ago <= ? AND pct_vs_sma200 > 0 AND rs_benchmark_agree = 1) "
           "OR (rs_cross_up_bars_ago >= 0 AND rs_cross_up_bars_ago <= ? AND rs_line_above_ma = ?))")
    rows = conn.execute(sql, [ymd, *largs, LEADERS_NH_MAX_BARS, EMERGING_CROSS_MAX_BARS,
                              EMERGING_ABOVE_MA]).fetchall()
    etfs = {str(t).upper() for t in (etf_tickers or ())}
    out = [dict(r) for r in rows if str(r["ticker"]).upper() not in etfs]
    return out, judged


def _rate(rows: list, session: str, history_reader) -> dict:
    """Give each row its `rating` for the session; returns the source counts."""
    hist = {}
    if rows:
        hist = history_reader([r["ticker"] for r in rows], session) or {}
    counts = {"history": 0, "screener": 0, "unrated": 0}
    for r in rows:
        h = hist.get(str(r["ticker"]).upper()) or {}
        if h.get("ibd") is not None:
            r["rating"] = int(h["ibd"])
            counts["history"] += 1
        elif r.get("rs_rating_ibd") is not None:
            r["rating"] = int(r["rs_rating_ibd"])
            counts["screener"] += 1
        else:
            r["rating"] = None
            counts["unrated"] += 1
    return counts


def _is_leader(r) -> bool:
    return (r["rating"] is not None and r["rating"] >= LEADERS_RATING_MIN
            and r.get("rs_nh_bars_ago") is not None
            and 0 <= r["rs_nh_bars_ago"] <= LEADERS_NH_MAX_BARS
            and r.get("pct_vs_sma200") is not None and r["pct_vs_sma200"] > 0
            and r.get("rs_benchmark_agree") == 1)


def _is_emerging(r) -> bool:
    return (r["rating"] is not None and r["rating"] >= EMERGING_RATING_MIN
            and r.get("rs_cross_up_bars_ago") is not None
            and 0 <= r["rs_cross_up_bars_ago"] <= EMERGING_CROSS_MAX_BARS
            and r.get("rs_line_above_ma") == EMERGING_ABOVE_MA)


def _strength_key(r):
    """Rating high to low, then the most recent RS high (no high sorts last), then A-Z."""
    nh = r.get("rs_nh_bars_ago")
    return (-(r["rating"] or 0), nh if nh is not None else 10 ** 6, str(r["ticker"]))


def _default_theme(sym: str):
    try:
        from api.services import groups
        row = groups.resolve_primary_theme(sym)
    except Exception:                                        # noqa: BLE001 - a theme is best effort
        return None
    name = (row or {}).get("theme_name") if isinstance(row, dict) else None
    return (name or "").strip() or None


def _theme_of(r, theme_resolver) -> str:
    for cand in (r.get("theme"), theme_resolver(r["ticker"]) if not r.get("theme") else None,
                 r.get("sector")):
        if cand and str(cand).strip():
            return str(cand).strip()
    return "Other"


def _layout(rows: list, theme_resolver) -> list:
    """Cut to `CAP` by strength, then lay the kept names out in theme blocks."""
    kept = sorted(rows, key=_strength_key)[:CAP]
    for r in kept:
        r["theme_label"] = _theme_of(r, theme_resolver)
    blocks: dict[str, list] = {}
    for r in kept:                                           # already strongest first
        blocks.setdefault(r["theme_label"], []).append(r)
    order = sorted(blocks, key=lambda t: (-len(blocks[t]), _strength_key(blocks[t][0]), t))
    return [r for t in order for r in blocks[t]]


def note_for(r) -> str:
    """'<Theme> · RS <rating> · high <n> bars ago'."""
    nh = r.get("rs_nh_bars_ago")
    if nh is None:
        high = "no RS high in the last year"
    else:
        high = f"high {int(nh)} bar{'' if int(nh) == 1 else 's'} ago"
    return f"{r['theme_label']} · RS {r['rating']} · {high}"


def _items(rows: list) -> list:
    return [{"sym": str(r["ticker"]).upper(), "notes": note_for(r)} for r in rows]


def _default_history_reader(tickers, session):
    from api.services.screener import rs_history
    return rs_history.read_fields(tickers, session=session)


def build(session: str, *, etf_tickers=None, history_reader=None, theme_resolver=None) -> dict:
    """The two lists for one screener session (YYYY-MM-DD), read-only.

    `{"leaders": [{sym, notes}], "emerging": [...], "receipt": {...}}`. Every reader is
    injectable; the defaults are `rs_history.default_etf_tickers()`, the session's
    `rs_history.read_fields` and `groups.resolve_primary_theme`."""
    from api.services.screener import rs_history
    if etf_tickers is None:
        etf_tickers = rs_history.default_etf_tickers()
    history_reader = history_reader or _default_history_reader
    theme_resolver = theme_resolver or _default_theme
    with closing(snapshot_db.connect()) as conn:
        rows, judged = _candidates(conn, session, etf_tickers)
    sources = _rate(rows, session, history_reader)
    leaders = [r for r in rows if _is_leader(r)]
    lead_syms = {r["ticker"] for r in leaders}
    emerging = [r for r in rows if r["ticker"] not in lead_syms and _is_emerging(r)]
    leaders_out = _layout(leaders, theme_resolver)
    emerging_out = _layout(emerging, theme_resolver)
    return {
        "leaders": _items(leaders_out),
        "emerging": _items(emerging_out),
        "receipt": {
            "session": session, "judged": judged, "candidates": len(rows),
            "rating_source": sources,
            "matched": {"leaders": len(leaders), "emerging": len(emerging)},
            "kept": {"leaders": len(leaders_out), "emerging": len(emerging_out)},
        },
    }


# --------------------------------------------------------------------------- #
# the receipt
# --------------------------------------------------------------------------- #

_RUNS_SQL = f"""
CREATE TABLE IF NOT EXISTS {RUNS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ran_at REAL, session TEXT, wrote_session TEXT, skipped TEXT, receipt TEXT
)"""


def record_run(receipt: dict) -> None:
    """Persist one fire's receipt. Never raises."""
    try:
        with closing(snapshot_db.connect()) as conn:
            conn.execute(_RUNS_SQL)
            conn.execute(
                f"INSERT INTO {RUNS_TABLE} (ran_at, session, wrote_session, skipped, receipt) "
                "VALUES (?, ?, ?, ?, ?)",
                (receipt.get("ran_at"), receipt.get("session"),
                 receipt.get("session") if receipt.get("wrote") else None,
                 receipt.get("skipped"), json.dumps(receipt, sort_keys=True, default=str)))
            conn.execute(f"DELETE FROM {RUNS_TABLE} WHERE id NOT IN (SELECT id FROM "
                         f"{RUNS_TABLE} ORDER BY id DESC LIMIT ?)", (RUNS_KEEP,))
            conn.commit()
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs_lists] receipt not written: %s", e)


def _table_exists(conn) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                        (RUNS_TABLE,)).fetchone() is not None


def last_run() -> dict | None:
    """The newest receipt, or None. READ-ONLY: a pod with no table creates nothing."""
    try:
        with closing(snapshot_db.connect()) as conn:
            if not _table_exists(conn):
                return None
            r = conn.execute(f"SELECT receipt FROM {RUNS_TABLE} ORDER BY id DESC LIMIT 1").fetchone()
        return json.loads(r["receipt"]) if r and r["receipt"] else None
    except Exception:                                        # noqa: BLE001
        return None


def _last_written_session() -> str | None:
    try:
        with closing(snapshot_db.connect()) as conn:
            if not _table_exists(conn):
                return None
            r = conn.execute(f"SELECT MAX(wrote_session) s FROM {RUNS_TABLE}").fetchone()
        return r["s"] if r else None
    except Exception:                                        # noqa: BLE001
        return None


# --------------------------------------------------------------------------- #
# the job
# --------------------------------------------------------------------------- #

def _default_settled() -> str | None:
    from api.services.screener import rs_history
    d = rs_history.settled_session()
    return rs_history.session_key(d) if d else None


def _default_rs_latest() -> str | None:
    from api.services.screener import rs_history
    return rs_history.status().get("latest_session")


def nightly_job(*, settled=None, rs_latest=None, writer=None, sizer=None, **build_kw) -> dict:
    """One fire of `rs_lists_nightly`. Never raises; returns the receipt.

    `settled` / `rs_latest` are the settled session and the rating history's newest
    session (YYYY-MM-DD, resolved here when omitted); `writer(name, desc, items)` and
    `sizer(name)` default to `watchlist_prebuilt.write_rs_list` / `rs_list_size`."""
    if not enabled():
        return {"enabled": False, "skipped": "not enabled", "wrote": False}
    t0 = time.time()
    receipt = {"enabled": True, "ran_at": t0, "session": None, "rs_session": None,
               "settled": None, "fresh": False, "skipped": None, "wrote": False, "lists": {}}
    try:
        from api.services import watchlist_prebuilt as wp
        writer = writer or wp.write_rs_list
        sizer = sizer or wp.rs_list_size
        with closing(snapshot_db.connect()) as conn:
            session = screener_session(conn)
        settled = settled if settled is not None else _default_settled()
        rs_latest = rs_latest if rs_latest is not None else _default_rs_latest()
        fresh = bool(session and settled and session == settled)
        receipt.update(session=session, rs_session=rs_latest, settled=settled, fresh=fresh)
        last = _last_written_session()
        if not session:
            receipt["skipped"] = "the screener has no session yet"
        elif not rs_latest:
            receipt["skipped"] = "the rating history has no session yet"
        elif rs_latest < session:
            receipt["skipped"] = (f"the rating history's newest session ({rs_latest}) is older "
                                  f"than the screener session ({session})")
        elif last and last > session:
            receipt["skipped"] = (f"the lists already hold session {last}, newer than the "
                                  f"screener session ({session})")
        if receipt["skipped"]:
            return _finish(receipt, t0)
        built = build(session, **build_kw)
        receipt["build"] = built["receipt"]
        for name, items in ((LEADERS_NAME, built["leaders"]), (EMERGING_NAME, built["emerging"])):
            receipt["lists"][name] = _write_one(name, items, receipt, writer, sizer)
        receipt["wrote"] = any(v.get("status") == "written" for v in receipt["lists"].values())
    except Exception as e:                                   # noqa: BLE001
        receipt["skipped"] = f"error: {type(e).__name__}: {e}"[:300]
    return _finish(receipt, t0)


def _write_one(name, items, receipt, writer, sizer) -> dict:
    """Write one list, unless it would put an empty list over a full one without a
    fresh session that truly returned nothing."""
    if not items:
        current = sizer(name) or 0
        truly_none = receipt["fresh"] and int((receipt.get("build") or {}).get("judged") or 0) > 0
        if current > 0 and not truly_none:
            return {"status": "kept", "names": current,
                    "reason": (f"the rule returned nothing from screener session "
                               f"{receipt['session']}, which is not fresh (settled "
                               f"{receipt['settled']}) or had no rows; kept {current} names")}
    out = writer(name, DESCRIPTIONS[name], items) or {}
    return {"names": len(items), **out}


def _finish(receipt: dict, t0: float) -> dict:
    receipt["duration_ms"] = round((time.time() - t0) * 1000.0, 1)
    record_run(receipt)
    return receipt
