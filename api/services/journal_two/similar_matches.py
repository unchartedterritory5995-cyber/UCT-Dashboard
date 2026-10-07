"""Find more like this: today's names whose technicals match a member's tagged chart (wave 13, 13J).

A member tags a chart block with a setup (13H-1's `ta.setupTag`); 13I-1 froze that block's
technical fingerprint. Every night, after the screener's snapshot and the 05:00 ET scan sweep,
this module ranks today's nightly-scored universe (`screener_rows`) against each tagged block
and stores the ten closest names, with the reason for each, in `j2_similar_matches`. The
request path (`api/routers/notebook_setups_board.py`, `SimilarNames.jsx`) ONLY READS those rows.

⛔⛔ NEVER A PER-REQUEST UNIVERSE SCAN. `load_universe` and `rank_matches` are called by
`run_nightly` and by nothing a request reaches. `read_matches` and `list_templates` read this
table and the member's own chart-block index, and never open the screener store, the bars store
or the pattern store. The rail (`tests/test_notebook_similar_matches.py`) arms all three to
raise and still gets an answer from the route, and is mutation-proved.

⛔⛔ THE SIMILARITY IS DETERMINISTIC OVER 13I-1's `summary_values`, AND NOTHING IS RE-DERIVED.
  * The template's values are `tech_fingerprint.summary_values(block fingerprint)`.
  * A universe row's values are `tech_fingerprint.summary_values` over
    `tech_fingerprint._row_fields(row)` -- the SAME projection the fingerprint uses when it
    reads a nightly row -- so "RS 94" means the same thing on both sides.
  * The fields compared are exactly the fingerprint fields the nightly row holds
    (`tech_fingerprint._ROW_COLUMNS`). The three it does not hold (`pct_vs_sma10`, the base
    length and depth) are computed on bars, and this job never computes a fingerprint per
    universe name.
  * Confirmed patterns come from `tech_fingerprint._pattern_field` (the confirmed-only read,
    `confirmed_only=True`, the pattern lab's read-only door). Never `pattern_engine_ids`: those
    are raw detections (13I-1 decision 2).

THE DISTANCE (one constants block, `RULES`, pinned by a test):
  * a numeric field:  d = min(1, |candidate - template| / scale)
  * a category field: d = 0 when equal, else 1
  * the fingerprint distance is the weighted mean of d over the fields BOTH sides hold. A
    candidate holding less than `MIN_COVERAGE` of the template's field weight is not ranked
    (too little to compare honestly); a template with fewer than `MIN_TEMPLATE_FIELDS` fields
    is reported as too thin and gets no matches.
  * patterns: the `SHORTLIST` nearest names by fingerprint distance are re-ranked with one more
    term, d = 1 - (template setups also confirmed on the name) / (template setups), weight
    `PATTERN_WEIGHT`, whenever the template carries confirmed setups and the name's verdicts
    could be read. Two stages, so the confirmed-pattern store is read for at most `SHORTLIST`
    names per template (cached across the run), never for the whole universe.
  * score = round(100 x (1 - distance)); ties broken by symbol. The top `MATCHES_PER_TEMPLATE`.

THE COST, AND ITS BOUNDS (measured numbers in docs/notebook/wave13-13j.md):
  * one read of the universe per run: `UNIVERSE_CAP` rows x 16 projected columns;
  * at most `MEMBER_CAP` members a run and `MAX_TEMPLATES` templates a member; each template
    is one pass over the universe (12 field comparisons a name) plus at most `SHORTLIST`
    cached pattern reads;
  * `RUN_BUDGET_S`: the run stops STARTING members past it and says how many it deferred.
    Members are taken least-recently-matched first, so a deferred member is first next night;
  * each member's chart-block index is caught up first (`chart_blocks.catch_up`, which freezes
    at most `chart_blocks.FREEZE_BUDGET` new fingerprints).
It runs on an APScheduler worker thread, off the event loop, mon-fri at `RUN_AT_ET`, and reads
the flag per run, so it is inert while dark.

Idempotent: a re-run for the same universe day replaces that day's rows with identical ones.
Purged with the account (`account_purge._DIRECT_USER_TABLES`). No model call, no vendor call,
never writes a note.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from types import MappingProxyType
from typing import Any, Callable

from api.services.journal_two import chart_blocks, sample_marker
from api.services.journal_two import tech_fingerprint as tfp
from api.services.notebook_flags import flag_on

log = logging.getLogger(__name__)

#: The enablement gate (unset = OFF; WAVE-13-PLAN section 3.6).
FLAG = "NOTEBOOK_FIND_SIMILAR_ENABLED"


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse (default OFF)."""
    return flag_on(FLAG, False)


# ── THE CONSTANTS. One block; tests/test_notebook_similar_matches.py pins every value. ─────────

#: field -> (weight, scale). scale None = a category (equal or not). A numeric scale is the
#: difference at which the field counts as fully different, in the field's own unit.
RULES = MappingProxyType({
    "adr_pct":            (1.0, 3.0),     # percentage points of average daily range
    "pct_vs_sma20":       (1.0, 8.0),     # points of distance from the 20-day
    "pct_vs_sma50":       (1.5, 15.0),    # points of distance from the 50-day
    "pct_vs_sma200":      (0.5, 40.0),    # points of distance from the 200-day
    "ma_stack":           (1.0, None),    # full-bull / partial / bear
    "ema_stack_intact":   (0.5, None),    # the scanner's close > EMA10 > EMA20, both rising
    "rs_rank":            (2.0, 25.0),    # rank points (1-99)
    "rs_line_trend":      (0.5, None),    # up / flat / down
    "pullback_depth_pct": (1.5, 10.0),    # points of depth
    "vol_nweek_low":      (0.5, 10.0),    # 20 / 15 / 10 bars, 0 = no dry-up
    "close_cv_pct":       (1.0, 3.0),     # points of close CV (tightness)
    "pole_pct":           (1.0, 50.0),    # points of prior run
})
PATTERN_WEIGHT = 2.0
MIN_COVERAGE = 0.6
MIN_TEMPLATE_FIELDS = 4
SHORTLIST = 50
MATCHES_PER_TEMPLATE = 10
MAX_TEMPLATES = 25
MEMBER_CAP = 300
UNIVERSE_CAP = 8000
RUN_BUDGET_S = 600.0
RETAIN_DAYS = 7
#: The run's hour (ET): after the 03:00 snapshot build and the 05:00 ET scan sweep
#: (`scan_evaluator.SWEEP_HOUR_ET`), before the 09:30 open.
RUN_AT_ET = (5, 45)
JOB_ID = "notebook_similar_matches_nightly"

#: How a reason names a field to a member (the client prints these, never its own copy).
LABELS = MappingProxyType({
    "adr_pct": ("ADR", "%"), "pct_vs_sma20": ("vs 20-day", "%"), "pct_vs_sma50": ("vs 50-day", "%"),
    "pct_vs_sma200": ("vs 200-day", "%"), "ma_stack": ("MA stack", ""),
    "ema_stack_intact": ("EMA stack", ""), "rs_rank": ("RS", ""), "rs_line_trend": ("RS line", ""),
    "pullback_depth_pct": ("depth", "%"), "vol_nweek_low": ("volume dry-up", " bars"),
    "close_cv_pct": ("tightness", "%"), "pole_pct": ("prior run", "%"),
})

_DDL = (
    """CREATE TABLE IF NOT EXISTS j2_similar_matches (
        user_id         TEXT NOT NULL,
        note_id         TEXT NOT NULL,
        embed_key       TEXT NOT NULL,
        as_of           TEXT NOT NULL,
        rank            INTEGER NOT NULL,
        symbol          TEXT NOT NULL,
        score           INTEGER NOT NULL,
        distance        REAL NOT NULL,
        coverage        REAL NOT NULL,
        reasons_json    TEXT NOT NULL,
        template_symbol TEXT,
        template_as_of  TEXT,
        computed_at     TEXT NOT NULL,
        PRIMARY KEY (user_id, note_id, embed_key, as_of, rank)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_j2_similar_matches_user ON j2_similar_matches(user_id, computed_at)",
)


def ensure_schema(conn: sqlite3.Connection) -> None:
    for stmt in _DDL:
        conn.execute(stmt)


def _connect() -> sqlite3.Connection:
    from api.services.auth_db import get_connection
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


# ── the universe (NIGHTLY ONLY) ────────────────────────────────────────────────────────────────

_UNIVERSE_COLUMNS = ("ticker", "bars_asof", "is_etf", "candle_score") + tuple(tfp._ROW_COLUMNS)


def load_universe() -> dict[str, Any]:
    """Today's nightly-scored names: every `screener_rows` row within the fingerprint's own
    nightly lag (`NIGHTLY_MAX_LAG_DAYS`) of the newest `bars_asof`, as summary values.
    ⛔ Called by `run_nightly` only."""
    from api.services.screener import snapshot_db
    cols = ", ".join(_UNIVERSE_COLUMNS)
    try:
        with snapshot_db.connect() as c:
            raw = [dict(r) for r in c.execute(f"SELECT {cols} FROM screener_rows ORDER BY ticker")]
    except sqlite3.OperationalError as e:
        if "no such table" in str(e).lower():
            return {"as_of": None, "rows": [], "truncated": False}
        raise
    return universe_from_rows(raw)


def universe_from_rows(raw: list[dict]) -> dict[str, Any]:
    """The pure half of `load_universe` (the rails feed it fixture rows)."""
    dated = [(tfp._ymd_to_iso(r.get("bars_asof")), r) for r in raw]
    days = [d for d, _ in dated if d]
    if not days:
        return {"as_of": None, "rows": [], "truncated": False}
    newest = max(days)
    floor = (date.fromisoformat(newest) - timedelta(days=tfp.NIGHTLY_MAX_LAG_DAYS)).isoformat()
    rows = []
    for day, r in sorted(dated, key=lambda x: str(x[1].get("ticker") or "")):
        sym = str(r.get("ticker") or "").upper()
        if not sym or not day or day < floor:
            continue
        rows.append({"symbol": sym, "as_of": day, "is_etf": bool(r.get("is_etf")),
                     "values": tfp.summary_values({"fields": tfp._row_fields(r)})})
    truncated = len(rows) > UNIVERSE_CAP
    return {"as_of": newest, "rows": rows[:UNIVERSE_CAP], "truncated": truncated}


# ── the distance (pure) ────────────────────────────────────────────────────────────────────────

def _setups(patterns: Any) -> set[str]:
    return {str(p.get("setup")) for p in patterns or [] if isinstance(p, dict) and p.get("setup")}


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def fingerprint_distance(template: dict, candidate: dict) -> dict[str, Any] | None:
    """{distance, coverage, weight, sum, reasons} over the RULES fields, or None when the
    candidate holds too little of the template to compare. Pure."""
    t_weight = num = den = 0.0
    reasons = []
    for field, (w, scale) in RULES.items():
        a = template.get(field)
        if a is None:
            continue
        t_weight += w
        b = candidate.get(field)
        label, unit = LABELS[field]
        if b is None:
            reasons.append({"field": field, "label": label, "unit": unit, "template": a,
                            "candidate": None, "delta": None, "same": None, "d": None})
            continue
        if scale is None:
            same = a == b
            d, delta = (0.0 if same else 1.0), None
        else:
            fa, fb = _num(a), _num(b)
            if fa is None or fb is None:
                continue
            delta = round(fb - fa, 2)
            d = min(1.0, abs(fb - fa) / scale)
            same = None
        num += w * d
        den += w
        reasons.append({"field": field, "label": label, "unit": unit, "template": a, "candidate": b,
                        "delta": delta, "same": same, "d": round(d, 4)})
    if t_weight == 0 or den / t_weight < MIN_COVERAGE:
        return None
    return {"distance": num / den, "coverage": den / t_weight, "sum": num, "weight": den,
            "reasons": reasons}


def with_patterns(fd: dict[str, Any], template_setups: set[str],
                  candidate_field: dict | None) -> dict[str, Any]:
    """Add the pattern term to a fingerprint distance. A candidate whose verdicts could not be
    read is compared without it, and the reason says so."""
    if not template_setups:
        return {**fd, "patterns": None}
    if not candidate_field or candidate_field.get("missing"):
        return {**fd, "patterns": {"shared": [], "templateOnly": sorted(template_setups),
                                   "missing": (candidate_field or {}).get("missing") or "patterns_unavailable"}}
    have = _setups(candidate_field.get("value"))
    shared = sorted(template_setups & have)
    d = 1.0 - len(shared) / len(template_setups)
    return {**fd, "distance": (fd["sum"] + PATTERN_WEIGHT * d) / (fd["weight"] + PATTERN_WEIGHT),
            "patterns": {"shared": shared, "templateOnly": sorted(template_setups - have), "missing": None}}


def rank_matches(template_values: dict, template_symbol: str | None, universe: dict[str, Any], *,
                 pattern_field: Callable[[str, str], dict] | None = None,
                 pattern_cache: dict | None = None) -> list[dict[str, Any]]:
    """The `MATCHES_PER_TEMPLATE` closest universe names to one template. ⛔ NIGHTLY ONLY."""
    tsym = (template_symbol or "").upper()
    t_count = sum(1 for f in RULES if template_values.get(f) is not None)
    if t_count < MIN_TEMPLATE_FIELDS:
        return []
    rows = universe.get("rows") or []
    template_is_etf = any(r["symbol"] == tsym and r["is_etf"] for r in rows)
    scored = []
    for r in rows:
        if r["symbol"] == tsym or (r["is_etf"] and not template_is_etf):
            continue
        fd = fingerprint_distance(template_values, r["values"])
        if fd is not None:
            scored.append((fd["distance"], r["symbol"], r, fd))
    scored.sort(key=lambda x: (x[0], x[1]))
    shortlist = scored[:SHORTLIST]
    t_setups = _setups(template_values.get("patterns"))
    cache = pattern_cache if pattern_cache is not None else {}
    reader = pattern_field or (lambda as_of, sym: tfp._pattern_field(as_of, sym))
    final = []
    for _, sym, r, fd in shortlist:
        cf = None
        if t_setups:
            key = (sym, r["as_of"])
            if key not in cache:
                cache[key] = reader(r["as_of"], sym)
            cf = cache[key]
        full = with_patterns(fd, t_setups, cf)
        final.append((round(full["distance"], 6), sym, full))
    final.sort(key=lambda x: (x[0], x[1]))
    out = []
    for i, (dist, sym, full) in enumerate(final[:MATCHES_PER_TEMPLATE], start=1):
        out.append({"rank": i, "symbol": sym, "score": int(round(100 * (1 - dist))),
                    "distance": round(dist, 4), "coverage": round(full["coverage"], 4),
                    "reasons": {"fields": full["reasons"], "patterns": full["patterns"]}})
    return out


# ── the nightly job ────────────────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _members(conn: sqlite3.Connection, cap: int) -> list[str]:
    """Members with a live chart note, the least recently matched first (never matched first)."""
    rows = conn.execute(
        "SELECT e.user_id AS uid, (SELECT MAX(m.computed_at) FROM j2_similar_matches m"
        "   WHERE m.user_id = e.user_id) AS last_run"
        " FROM j2_note_embeds e JOIN j2_notes n ON n.id = e.note_id AND n.user_id = e.user_id"
        "   AND n.deleted_at IS NULL"
        " WHERE e.widget_id = ? GROUP BY e.user_id"
        " ORDER BY (last_run IS NOT NULL), last_run, e.user_id LIMIT ?",
        (chart_blocks.CHART_WIDGET, cap)).fetchall()
    return [r["uid"] for r in rows]


def templates_for(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    """The member's tagged chart blocks with a frozen fingerprint, newest day first, at most
    `MAX_TEMPLATES` (the plan's bound). Read from the index only."""
    blocks = chart_blocks.list_blocks(user_id, conn, limit=chart_blocks.LIST_LIMIT)
    # ⛔ Never a sample chart (fin-data I3): the example plan's hand-written fingerprint is not
    # a setup the member traded, and it must not spend one of their template slots either.
    blocks = sample_marker.without_sample_notes(conn, user_id, blocks)
    return [b for b in blocks if b.get("setupTag") and b.get("fingerprint")][:MAX_TEMPLATES]


def write_matches(conn: sqlite3.Connection, user_id: str, block: dict, as_of: str,
                  matches: list[dict], computed_at: str) -> None:
    conn.execute("DELETE FROM j2_similar_matches WHERE user_id = ? AND note_id = ? AND embed_key = ?"
                 " AND as_of = ?", (user_id, block["noteId"], block["embedKey"], as_of))
    conn.executemany(
        "INSERT INTO j2_similar_matches (user_id, note_id, embed_key, as_of, rank, symbol, score,"
        " distance, coverage, reasons_json, template_symbol, template_as_of, computed_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(user_id, block["noteId"], block["embedKey"], as_of, m["rank"], m["symbol"], m["score"],
          m["distance"], m["coverage"], json.dumps(m["reasons"], separators=(",", ":")),
          block.get("symbol"), block.get("asOf"), computed_at) for m in matches])


def run_member(conn: sqlite3.Connection, user_id: str, universe: dict[str, Any], *,
               pattern_cache: dict, pattern_field: Callable | None = None,
               compute: Callable | None = None) -> dict[str, int]:
    chart_blocks.catch_up(user_id, conn, compute=compute)
    templates = templates_for(conn, user_id)
    as_of, now = universe["as_of"], _now()
    written = thin = 0
    keep = set()
    for b in templates:
        keep.add((b["noteId"], b["embedKey"]))
        matches = rank_matches(b["values"] or {}, b.get("symbol"), universe,
                               pattern_field=pattern_field, pattern_cache=pattern_cache)
        if not matches and sum(1 for f in RULES if (b["values"] or {}).get(f) is not None) < MIN_TEMPLATE_FIELDS:
            thin += 1
        write_matches(conn, user_id, b, as_of, matches, now)
        written += len(matches)
    # A template the member untagged or deleted takes its rows with it; old days age out.
    for r in conn.execute("SELECT DISTINCT note_id, embed_key FROM j2_similar_matches WHERE user_id = ?",
                          (user_id,)).fetchall():
        if (r["note_id"], r["embed_key"]) not in keep:
            conn.execute("DELETE FROM j2_similar_matches WHERE user_id = ? AND note_id = ? AND embed_key = ?",
                         (user_id, r["note_id"], r["embed_key"]))
    floor = (date.fromisoformat(as_of) - timedelta(days=RETAIN_DAYS)).isoformat()
    conn.execute("DELETE FROM j2_similar_matches WHERE user_id = ? AND as_of < ?", (user_id, floor))
    conn.commit()
    return {"templates": len(templates), "rows": written, "thin": thin}


def run_nightly(*, conn: sqlite3.Connection | None = None, universe: dict[str, Any] | None = None,
                pattern_field: Callable | None = None, compute: Callable | None = None,
                member_cap: int = MEMBER_CAP, budget_s: float = RUN_BUDGET_S,
                clock: Callable[[], float] = time.monotonic) -> dict[str, Any]:
    """The nightly precompute. Reads the flag per run (inert while dark). Never raises."""
    if not enabled():
        return {"ran": False, "reason": "flag_off"}
    started = clock()
    try:
        uni = universe if universe is not None else load_universe()
    except Exception:  # noqa: BLE001 -- an unreadable store: no run tonight, said so
        log.warning("[similar_matches] universe unreadable", exc_info=True)
        return {"ran": False, "reason": "universe_unreadable"}
    if not uni.get("rows") or not uni.get("as_of"):
        return {"ran": False, "reason": "no_universe"}
    owned = conn is None
    conn = conn or _connect()
    report = {"ran": True, "asOf": uni["as_of"], "universe": len(uni["rows"]),
              "universeTruncated": bool(uni.get("truncated")), "members": 0, "templates": 0,
              "rows": 0, "thin": 0, "deferred": 0, "errors": 0}
    try:
        ensure_schema(conn)
        members = _members(conn, member_cap)
        cache: dict = {}
        for i, uid in enumerate(members):
            if clock() - started > budget_s:
                report["deferred"] = len(members) - i
                break
            try:
                r = run_member(conn, uid, uni, pattern_cache=cache, pattern_field=pattern_field,
                               compute=compute)
            except Exception:  # noqa: BLE001 -- one member's failure never stops the rest
                log.warning("[similar_matches] member run failed", exc_info=True)
                conn.rollback()
                report["errors"] += 1
                continue
            report["members"] += 1
            for k in ("templates", "rows", "thin"):
                report[k] += r[k]
        report["patternReads"] = len(cache)
        report["seconds"] = round(clock() - started, 3)
        return report
    finally:
        if owned:
            conn.close()


def run_nightly_blocking() -> None:
    """The scheduler's entry: one line of receipt either way."""
    try:
        r = run_nightly()
        print(f"[scheduler] notebook similar matches: {r}")
    except Exception as e:  # noqa: BLE001
        print(f"[scheduler] notebook similar matches error: {e}")


def install_scheduler_hook(scheduler: Any, cron_trigger: Any, tz: Any) -> bool:
    """Register the nightly run (mon-fri, `RUN_AT_ET`). Inert while the flag is off (read per
    run), so a flip needs no restart. Never raises."""
    try:
        scheduler.add_job(run_nightly_blocking,
                          trigger=cron_trigger(day_of_week="mon-fri", hour=RUN_AT_ET[0],
                                               minute=RUN_AT_ET[1], timezone=tz),
                          id=JOB_ID, max_instances=1, coalesce=True, misfire_grace_time=7200,
                          replace_existing=True)
        return True
    except Exception:  # noqa: BLE001
        log.warning("[similar_matches] scheduler hook not installed", exc_info=True)
        return False


# ── the request path: READS ONLY ───────────────────────────────────────────────────────────────

def _latest_as_of(conn: sqlite3.Connection, user_id: str, note_id: str, embed_key: str) -> str | None:
    r = conn.execute("SELECT MAX(as_of) FROM j2_similar_matches WHERE user_id = ? AND note_id = ?"
                     " AND embed_key = ?", (user_id, note_id, embed_key)).fetchone()
    return r[0] if r else None


def _template_shape(b: dict) -> dict:
    return {"noteId": b["noteId"], "embedKey": b["embedKey"], "noteTitle": b.get("noteTitle") or "",
            "symbol": b.get("symbol"), "setupTag": b.get("setupTag"), "asOf": b.get("asOf"),
            "frozen": b.get("fingerprint") is not None}


def read_matches(conn: sqlite3.Connection, user_id: str, note_id: str, embed_key: str) -> dict | None:
    """The stored matches for one of the member's chart blocks, or None when the note is not
    theirs (the route's one 404). Reads `j2_similar_matches` and the chart-block index only."""
    ensure_schema(conn)
    chart_blocks.ensure_schema(conn)
    block = chart_blocks.get_block(user_id, note_id, embed_key, conn)
    if block is None:
        n = conn.execute("SELECT id, title FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                         (note_id, user_id)).fetchone()
        if n is None:
            return None
        template = {"noteId": note_id, "embedKey": embed_key, "noteTitle": n["title"] or "",
                    "symbol": None, "setupTag": None, "asOf": None, "frozen": False}
    else:
        template = _template_shape(block)
    as_of = _latest_as_of(conn, user_id, note_id, embed_key)
    rows = conn.execute(
        "SELECT rank, symbol, score, distance, coverage, reasons_json, computed_at FROM j2_similar_matches"
        " WHERE user_id = ? AND note_id = ? AND embed_key = ? AND as_of = ? ORDER BY rank",
        (user_id, note_id, embed_key, as_of)).fetchall() if as_of else []
    matches = [{"rank": r["rank"], "symbol": r["symbol"], "score": r["score"], "distance": r["distance"],
                "coverage": r["coverage"], "reasons": json.loads(r["reasons_json"])} for r in rows]
    if rows:
        status = "ready"
    elif block is not None and not block.get("setupTag"):
        status = "not_tagged"
    else:
        status = "pending"
    return {"template": template, "asOf": as_of, "computedAt": rows[0]["computed_at"] if rows else None,
            "status": status, "matches": matches}


def list_templates(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    """The member's tagged chart blocks the nightly run matches (at most `MAX_TEMPLATES`), each
    with the day and count of its stored matches. Reads the index and this table only."""
    ensure_schema(conn)
    chart_blocks.ensure_schema(conn)
    out = []
    for b in templates_for(conn, user_id):
        as_of = _latest_as_of(conn, user_id, b["noteId"], b["embedKey"])
        n = conn.execute("SELECT COUNT(*) FROM j2_similar_matches WHERE user_id = ? AND note_id = ?"
                         " AND embed_key = ? AND as_of = ?",
                         (user_id, b["noteId"], b["embedKey"], as_of)).fetchone()[0] if as_of else 0
        out.append({**_template_shape(b), "matchesAsOf": as_of, "matchCount": int(n)})
    return out
