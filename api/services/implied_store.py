"""Nightly implied-move + grade snapshot store (web-side, /data SQLite).

Why nightly & pre-report: 'implied at the time' history for the paired-bars
hero. A morning-after capture stores IV-crushed values and poisons the pair —
capture runs post-close (options quotes settle ~4:15 ET) for tonight's AMC +
reporters through today+WINDOW (env IMPLIED_CAPTURE_WINDOW_DAYS, default 1),
with bmo-today (or session-unknown-today) excluded (it may already have
reported this morning; a post-report capture would store IV-crushed values).
First-write-wins per (sym, report_date): with the narrowed window the first
write IS the T-1/T-0-pre-report write — the earliest snapshot is the honest
pre-report implied; later recaptures never overwrite it.

── Reporter-list provider (2026-08-05 incident) ─────────────────────────────
`upcoming_reporters` used to source the reporter list from Finnhub's
`/calendar/earnings` ALONE. Finnhub free-tier is 60 calls/min and shared with
every other Finnhub caller in the process — a busy night can 429 the whole
account, and a 429'd reporter list means the capture has NOTHING to work
with (production, 2026-08-05: `{'captured': 0, 'skipped': 0, 'failed': 0,
'collisions': 4}` — the run fired correctly, Finnhub just had nothing left
to give it). `upcoming_reporters` is now **FMP primary, Finnhub fallback**
(`_fmp_reporters` / `_finnhub_reporters`) — FMP is a paid Premium plan on
this account and `stable/earnings-calendar` is a proven-working endpoint
(see api/routers/calendar.py's `_fmp_range_week`). FMP's calendar carries
NEITHER a bmo/amc session NOR a quarter/year fiscal identity, so
`run_nightly_capture` (a) treats an unknown session on a today-dated row as
unsafe to capture (same direction as the existing bmo-today skip — a missing
snapshot is honest, an IV-crushed one silently corrupts the record) and (b)
opportunistically backfills session + fiscal identity for TODAY's rows via a
narrow, single-day Finnhub lookup (`_finnhub_today_enrichment`) that has a
real chance of landing even on a night the wide 14-day Finnhub call is itself
rate-limited.

── Fiscal key NULL on the primary path (2026-08-05, Task 4) ─────────────────
The above enrichment ONLY ever ran for rows dated TODAY. But the normal T-1
capture's rows are dated today+1 (the default `IMPLIED_CAPTURE_WINDOW_DAYS`
is 1, and a today-dated row without a confirmed "amc" session is skipped
anyway) — so the one path that mattered most never got backfilled at all,
and the majority of permanent snapshots were being written with
`fiscal_year = NULL, fiscal_quarter = NULL`. That NULL key is exactly what
breaks Task 8b's pairing (implied-vs-realized RICH/CHEAP chip): 8b pairs a
snapshot to its history row by the PROVIDER'S fiscal identity, not by
`report_date` string equality, precisely because `report_date` here is an
ANNOUNCEMENT date while the history model carries the fiscal PERIOD END —
two different calendars that often disagree by weeks. A NULL-keyed snapshot
can never join to anything, silently resurrecting the exact failure 8b
fixed.

`_finnhub_today_enrichment` / `_merge_today_enrichment` are now
`_finnhub_day_enrichment` / `_merge_day_enrichment` — same bodies, but
`run_nightly_capture` calls them once per DISTINCT report_date represented
in the capture window (capped at `window_days + 1` calls by construction),
not just for today. A third, bounded per-symbol leg
(`_fmp_fiscal_repair` / `_nearest_fiscal_identity` / `_apply_fiscal_repair`,
FMP `earning-call-transcript-dates`, capped at `_FISCAL_REPAIR_MAX_SYMBOLS`
symbols/night) covers whatever the day-scoped Finnhub leg still misses. A
row that STILL has no fiscal key after all three legs is never written —
counted in `summary["skipped_no_fiscal"]` instead — because this store is
append-only and a permanently-unpairable row is worse than an absent one.
See `run_nightly_capture`'s docstring for the full three-leg chain, and
`repair_null_fiscal_keys` / `tools/implied_fiscal_backfill.py` for the
one-shot, idempotent repair of rows already written before this fix
shipped (safe only while the underlying reports are still unreported —
Finnhub/FMP still list them as upcoming).
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re
import sqlite3
import threading
from contextlib import closing
from zoneinfo import ZoneInfo

from api.services import implied_move
from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

_DATA_DIR = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(os.getcwd(), "data"))
DB_PATH = os.environ.get("IMPLIED_STORE_DB", os.path.join(_DATA_DIR, "implied_moves.db"))

_REPORTERS_CACHE = TTLCache()
_REPORTERS_TTL = 6 * 3600

_SCHEMA = """
CREATE TABLE IF NOT EXISTS implied_snapshots (
  sym TEXT NOT NULL, report_date TEXT NOT NULL, captured_at TEXT NOT NULL,
  pct REAL NOT NULL, dollar REAL NOT NULL, expiry TEXT, strike REAL, spot REAL,
  iv_atm REAL, source TEXT, fiscal_year INTEGER, fiscal_quarter INTEGER,
  PRIMARY KEY (sym, report_date)
);
CREATE TABLE IF NOT EXISTS grade_snapshots (
  sym TEXT NOT NULL, date TEXT NOT NULL, surface TEXT NOT NULL,
  grade TEXT NOT NULL, inputs_json TEXT NOT NULL,
  PRIMARY KEY (sym, date, surface)
);
"""

# Additive migration for a DB file created before fiscal_year/fiscal_quarter
# existed — CREATE TABLE IF NOT EXISTS above never adds columns to an already-
# existing table, so an existing /data/implied_moves.db needs an explicit
# ALTER. Mirrors the PRAGMA table_info(...) guard used by desk_session_announce
# / education_service / modelbook_service elsewhere in this codebase.
_FISCAL_KEY_ALTERS = (
    ("fiscal_year", "ALTER TABLE implied_snapshots ADD COLUMN fiscal_year INTEGER"),
    ("fiscal_quarter", "ALTER TABLE implied_snapshots ADD COLUMN fiscal_quarter INTEGER"),
)

_INIT_LOCK = threading.Lock()
_INITIALIZED: set[str] = set()


def _int_or_none(v):
    """int(v) preserving None — an absent fiscal_year/fiscal_quarter must never
    coerce to a phantom 0, and a genuine 0 (however implausible) must survive."""
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _float_or_none(v):
    """float(v) preserving None — used for eps_estimate's presence check in
    `_reporter_preferred`; a real negative estimate must never be treated as
    falsy/absent, and a malformed value must never crash the tie-break."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _canon(sym: str) -> str:
    """Canonical store form — matches the repo-wide convention in
    groups.py/theme_index.py/theme_performance.py: uppercase, dot→hyphen
    class-share notation (BRK.B and BRK-B must key the same row)."""
    return (sym or "").strip().upper().replace(".", "-")


def _connect() -> sqlite3.Connection:
    """Open a connection with WAL pragma (no schema init, no directory creation —
    see _ensure_init)."""
    c = sqlite3.connect(DB_PATH, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _ensure_init() -> None:
    """Run schema initialization once per DB_PATH (double-checked lock pattern).
    Also owns directory creation — a bare filename DB_PATH (no directory
    component, e.g. in tests) must not crash `os.makedirs`, and this runs once
    per process instead of on every connection."""
    global _INITIALIZED
    if DB_PATH in _INITIALIZED:
        return
    with _INIT_LOCK:
        if DB_PATH in _INITIALIZED:
            return
        d = os.path.dirname(DB_PATH)
        if d:
            os.makedirs(d, exist_ok=True)
        with closing(_connect()) as c:
            c.executescript(_SCHEMA)
            cols = {r["name"] for r in c.execute("PRAGMA table_info(implied_snapshots)")}
            for col_name, alter_sql in _FISCAL_KEY_ALTERS:
                if col_name not in cols:
                    c.execute(alter_sql)
            c.commit()
        _INITIALIZED.add(DB_PATH)


def _has_snapshot(sym: str, report_date: str) -> bool:
    """Check if a snapshot exists for this (sym, report_date) pair."""
    _ensure_init()
    with closing(_connect()) as c:
        row = c.execute(
            "SELECT 1 FROM implied_snapshots WHERE sym = ? AND report_date = ? LIMIT 1",
            (_canon(sym), report_date),
        ).fetchone()
    return row is not None


def record_implied(sym: str, report_date: str, payload: dict, captured_at: str,
                    fiscal_year: int | None = None, fiscal_quarter: int | None = None) -> None:
    """`fiscal_year`/`fiscal_quarter` are the provider's own fiscal identifiers
    (see `upcoming_reporters`) — the pairing key a client uses to join this
    snapshot to its history row by fiscal identity instead of by `report_date`
    string equality (a past history row's true announcement date is often
    unknown). Optional + additive: existing callers that omit them keep
    writing a row exactly as before (fiscal_year/fiscal_quarter = NULL).
    INSERT OR IGNORE + the (sym, report_date) PRIMARY KEY still make this
    first-write-wins and idempotent — a re-run with a different fiscal key on
    an already-captured (sym, report_date) is silently ignored, same as any
    other field."""
    _ensure_init()
    with closing(_connect()) as c, c:
        c.execute(
            "INSERT OR IGNORE INTO implied_snapshots "
            "(sym, report_date, captured_at, pct, dollar, expiry, strike, spot, iv_atm, source, "
            "fiscal_year, fiscal_quarter) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (_canon(sym), report_date, captured_at, payload["pct"], payload["dollar"],
             payload.get("expiry"), payload.get("strike"), payload.get("spot"),
             payload.get("iv_atm"), payload.get("source"),
             _int_or_none(fiscal_year), _int_or_none(fiscal_quarter)),
        )


def get_implied_history(sym: str, limit: int = 8) -> list[dict]:
    _ensure_init()
    with closing(_connect()) as c:
        rows = c.execute(
            "SELECT sym, report_date, captured_at, pct, dollar, expiry, fiscal_year, fiscal_quarter "
            "FROM implied_snapshots WHERE sym = ? ORDER BY report_date DESC LIMIT ?",
            (_canon(sym), int(limit)),
        ).fetchall()
    return [dict(r) for r in rows]


def all_symbols() -> list[str]:
    """Every symbol with at least one snapshot, ascending.

    Drives `tools/implied_backfill_run.py --from-store`: the names the nightly
    capture already tracks are exactly the ones worth reconstructing history
    for, since a backfilled quarter is only useful next to the live ones."""
    _ensure_init()
    with closing(_connect()) as c:
        rows = c.execute(
            "SELECT DISTINCT sym FROM implied_snapshots ORDER BY sym"
        ).fetchall()
    return [r["sym"] for r in rows]


def get_earliest_report_date(sym: str) -> str | None:
    """MIN(report_date) for a symbol — drives the router's `history_since`
    without drifting once more than `limit` snapshots exist for a name."""
    _ensure_init()
    with closing(_connect()) as c:
        row = c.execute(
            "SELECT MIN(report_date) AS md FROM implied_snapshots WHERE sym = ?",
            (_canon(sym),),
        ).fetchone()
    return row["md"] if row and row["md"] is not None else None


# ── startup catch-up (2026-08-05 incident) ─────────────────────────────────
# A Railway redeploy landing at/after the nightly trigger time causes a
# freshly re-created APScheduler MemoryJobStore to compute the job's NEXT run
# as the trigger's next occurrence strictly AFTER boot time — i.e. tomorrow,
# with no memory that today's slot was ever due (confirmed against the
# installed apscheduler: `BaseScheduler.add_job` calls
# `trigger.get_next_fire_time(previous_fire_time=None, now)`, and with no
# prior fire time a CronTrigger returns the next occurrence strictly after
# `now` — see tests/test_implied_store.py's
# `test_cron_trigger_on_fresh_jobstore_skips_todays_run_once_the_trigger_time_has_passed`).
# `misfire_grace_time` cannot help here — it only matters once a job's
# next_run_time is ALREADY set (in a live process) and the scheduler's own
# check loop runs late; it does nothing for a next_run_time that was
# recomputed as tomorrow because the process wasn't even running yet.
#
# `capture_due_by` is the pure (no DB) half of the startup decision;
# `latest_capture_date` is the DB half — together they tell "already captured
# tonight" from "nothing captured tonight" (api/main.py's IMPLIED_STORE_ENABLED
# startup block). `setup_grade.grade_snapshot_due_by` + `latest_grade_date`
# below are the same pair for the 16:40 ET §12 accountability snapshot.
CAPTURE_HOUR_ET = 16
CAPTURE_MINUTE_ET = 35


def capture_due_by(now_et: dt.datetime) -> bool:
    """True iff the nightly capture's weekday trigger window has opened as of
    `now_et` (Mon–Fri, at/after 16:35 ET) — i.e. a capture is EXPECTED to
    already have run today. Pure. Weekday-only by design (requirement 6 of
    the incident fix): a weekend resolves False here; a holiday this
    predicate can't distinguish still resolves True, but `run_nightly_capture`
    itself naturally no-ops on an empty reporter list, so firing on a holiday
    is harmless."""
    if now_et.weekday() >= 5:  # Sat=5, Sun=6
        return False
    return (now_et.hour, now_et.minute) >= (CAPTURE_HOUR_ET, CAPTURE_MINUTE_ET)


def latest_capture_date() -> str | None:
    """MAX ET-calendar date (YYYY-MM-DD) across implied_snapshots.captured_at
    — the DB-side half of the startup catch-up decision (paired with
    `capture_due_by`). `captured_at` is stamped
    `now.isoformat(timespec="seconds")` at write time (an ISO-8601 string
    with a ±HH:MM offset), so its first 10 characters ARE the calendar date
    regardless of offset. None on an empty table — a caller comparing this
    against today's ISO date must treat None as "not today" (it will never
    equal a real date string), not skip the comparison."""
    _ensure_init()
    with closing(_connect()) as c:
        row = c.execute(
            "SELECT MAX(substr(captured_at, 1, 10)) AS d FROM implied_snapshots"
        ).fetchone()
    return row["d"] if row and row["d"] is not None else None


def latest_grade_date(surface: str) -> str | None:
    """MAX(date) in grade_snapshots for `surface` — the §12 accountability
    record's counterpart to `latest_capture_date`, paired with
    `setup_grade.grade_snapshot_due_by` for the same startup catch-up. None
    if no row exists yet for this surface."""
    _ensure_init()
    with closing(_connect()) as c:
        row = c.execute(
            "SELECT MAX(date) AS d FROM grade_snapshots WHERE surface = ?",
            (surface,),
        ).fetchone()
    return row["d"] if row and row["d"] is not None else None


def record_grade(sym: str, date: str, surface: str, grade: str, inputs: dict) -> None:
    _ensure_init()
    with closing(_connect()) as c, c:
        c.execute(
            "INSERT OR REPLACE INTO grade_snapshots (sym, date, surface, grade, inputs_json) "
            "VALUES (?,?,?,?,?)",
            (_canon(sym), date, surface, grade, json.dumps(inputs, separators=(",", ":"))),
        )


def get_grade_history(sym: str, surface: str, limit: int = 30) -> list[dict]:
    _ensure_init()
    with closing(_connect()) as c:
        rows = c.execute(
            "SELECT sym, date, surface, grade, inputs_json FROM grade_snapshots "
            "WHERE sym = ? AND surface = ? ORDER BY date DESC LIMIT ?",
            (_canon(sym), surface, int(limit)),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["inputs"] = json.loads(d.pop("inputs_json"))
        out.append(d)
    return out


_US_SYM_RE = re.compile(r"^[A-Z]{1,5}(-[A-Z])?$")


def _is_us_symbol(canon_sym: str) -> bool:
    """True for a plain US-listed-style symbol (post-`_canon`: upper + dot-
    to-hyphen). Filters FMP's stable/earnings-calendar international/OTC
    noise before it ever reaches `implied_move.get_expected_move`, which
    needs a Massive-listed US options chain anyway — keeping them would only
    inflate `failed` with guaranteed misses. Mirrors api/routers/calendar.py's
    `_is_us_symbol` but additionally allows a trailing SINGLE-letter
    class-share suffix (BRK-B, BF-A) so a real dual-class US ticker is never
    silently dropped.

    The suffix is capped at exactly one letter, not two — live-verified
    2026-08-05: FMP's `symbol` field appends a two-letter EXCHANGE suffix to
    non-US tickers (`SHOP.TO` Toronto, `TITR.MI` Milan, `INDIANHUME.NS`
    India, `IP.BK` Bangkok), which `_canon`'s dot→hyphen rule turns into
    `SHOP-TO` / `TITR-MI` / `IP-BK` — format-identical to a genuine US
    class-share ticker under a naive `{1,2}` suffix cap, and several of
    these were observed slipping through and inflating `failed` with
    guaranteed Massive-chain misses. Real US dual/multi-class tickers
    (BRK-A/B, BF-A/B, HEI-A, LEN-B, MOG-A, GEF-B, CWEN-A, LGF-A/B, JW-A/B)
    are, without exception, exactly ONE trailing letter — this still keeps
    every one of them while rejecting the two-letter exchange-code pattern.
    A residual few one-letter foreign suffixes (e.g. `-V` TSX Venture, `-L`
    London) can still slip through; accepted as a smaller, honestly-documented
    remainder rather than zero-suffix support (which would drop real US
    class shares instead)."""
    return bool(_US_SYM_RE.match(canon_sym or ""))


_FMP_CHUNK_TIMEOUT_SECS = 10
_FMP_CHUNK_MAX_WORKERS = 6


def _fmp_reporters_for_day(day: dt.date, key: str) -> list[dict] | None:
    """One FMP `stable/earnings-calendar` call scoped to a SINGLE calendar
    day — see `_fmp_reporters` for why a call must never span more than one
    day. Returns `None` on failure; the caller treats that as "this day
    contributed nothing" (not a whole-provider failure — one bad day-chunk
    must never blank out the rest)."""
    import requests
    try:
        resp = requests.get(
            "https://financialmodelingprep.com/stable/earnings-calendar",
            params={"from": day.isoformat(), "to": day.isoformat(), "apikey": key},
            timeout=_FMP_CHUNK_TIMEOUT_SECS,
        )
        if not resp.ok:
            _log.warning("upcoming_reporters: FMP HTTP %d for %s", resp.status_code, day.isoformat())
            return None
        data = resp.json()
    except Exception as e:  # noqa: BLE001 — one day-chunk's failure must never kill the batch
        _log.warning("upcoming_reporters: FMP fetch failed for %s: %s", day.isoformat(), e)
        return None
    if not isinstance(data, list):
        return None
    out = []
    for row in data:
        if not isinstance(row, dict):
            continue
        sym = _canon(row.get("symbol"))
        rd = row.get("date")
        if not sym or not rd or not _is_us_symbol(sym):
            continue
        out.append({"sym": sym, "report_date": rd, "hour": "",
                     "fiscal_year": None, "fiscal_quarter": None,
                     "eps_estimate": _float_or_none(row.get("epsEstimated"))})
    return out


def _fmp_reporters(days: int, today: dt.date) -> list[dict] | None:
    """FMP `stable/earnings-calendar` rows for [today, today+days] — the
    PRIMARY reporter-list source (see module docstring). Returns `None` on
    TOTAL failure (no key, or EVERY per-day chunk below failed) so the
    caller falls back to Finnhub — never an empty list standing in for "FMP
    is down" (that would silently suppress the fallback on exactly the kind
    of night this function exists to protect against). A PARTIAL failure
    (some days succeeded, some didn't) returns whatever succeeded — partial
    real data beats nothing.

    ── One-call-per-day, not one call for the whole range (2026-08-05) ──────
    Live-probe-verified: a single `stable/earnings-calendar` request spanning
    MULTIPLE days silently truncates at a ~4000-row response cap — and the
    truncation is NOT date-fair. Direct measurement on this account: a
    single day's global volume runs ~1,400-2,200 rows (well under the cap),
    but requesting `[today, today+1]` in ONE call returned exactly 4000 rows
    with **zero** of them dated `today` — every row was `today+1`, meaning
    the earlier day was dropped ENTIRELY, not merely thinned. A 14-day-wide
    call was worse: 2,192 rows total, concentrated on days 7-14 out, with
    **days 0-1 (today/tomorrow) completely absent** — exactly the two days
    `run_nightly_capture`'s window actually reads. A resilience fix that
    returns "a reporter list" while silently dropping the ONE slice the
    caller needs is not actually fixed. Chunking one call per calendar day
    keeps every single call safely under the cap (each day's own volume
    never approached it) regardless of which days are busy.
    """
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return None
    day_list = [today + dt.timedelta(days=i) for i in range(days + 1)]
    results: list[list[dict] | None] = [None] * len(day_list)
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(
            max_workers=min(_FMP_CHUNK_MAX_WORKERS, len(day_list))) as pool:
        future_to_idx = {pool.submit(_fmp_reporters_for_day, d, key): i
                          for i, d in enumerate(day_list)}
        for fut in concurrent.futures.as_completed(future_to_idx):
            i = future_to_idx[fut]
            try:
                results[i] = fut.result()
            except Exception as e:  # noqa: BLE001 — a worker-thread failure isolates to its own day
                _log.warning("upcoming_reporters: FMP day-chunk worker failed: %s", e)
                results[i] = None
    if all(r is None for r in results):
        return None  # every single day-chunk failed -> total provider failure -> Finnhub fallback
    out: list[dict] = []
    for r in results:
        if r:
            out.extend(r)
    return out


def _finnhub_reporters(days: int, today: dt.date) -> list[dict]:
    """Finnhub `/calendar/earnings` rows for [today, today+days] — the
    FALLBACK reporter-list source, used only when `_fmp_reporters` returns
    `None`. Each row carries Finnhub's `hour` field ("bmo"/"amc"/"dmh"/"") so
    callers can apply session-aware capture logic (see run_nightly_capture),
    plus Finnhub's own `fiscal_year`/`fiscal_quarter` (from
    /calendar/earnings' `year`/`quarter`) — the fiscal identity
    `record_implied` files the snapshot under, so a later history row keyed
    on the SAME provider quarter/year (but a different date — the period
    end, not this announcement date) can still pair with it. Routed through
    the shared api.services.finnhub_client.fh_get (2026-08-05) so this call
    shares the process-wide token bucket / 429 cooldown with every other
    Finnhub caller. Returns `[]` on ANY failure — the same honest-empty
    contract this path has always had."""
    from api.services.finnhub_client import fh_get
    data = fh_get(
        "/calendar/earnings",
        {"from": today.isoformat(), "to": (today + dt.timedelta(days=days)).isoformat()},
        timeout=10,
    )
    rows = (data or {}).get("earningsCalendar") or [] if isinstance(data, dict) else []
    return [{"sym": _canon(row.get("symbol")), "report_date": row.get("date"),
             "hour": row.get("hour") or "",
             "fiscal_year": _int_or_none(row.get("year")),
             "fiscal_quarter": _int_or_none(row.get("quarter")),
             # Carried ONLY as `_dedupe_reporters`' tie-break input (review
             # round 1, CRITICAL) — a real epsEstimate marks the genuine row
             # when Finnhub lists the same (sym, date) twice under two
             # different fiscal quarters (observed live: GLOO 2026-08-17).
             "eps_estimate": _float_or_none(row.get("epsEstimate"))}
            for row in rows if row.get("symbol") and row.get("date")]


def upcoming_reporters(days: int = 14, now: dt.datetime | None = None) -> list[dict]:
    """Symbols reporting within `days` — FMP primary, Finnhub fallback (see
    module docstring). Empty list on ANY failure of BOTH providers — the
    nightly job then no-ops (holiday-safe)."""
    today = (now or dt.datetime.now()).date()
    # Cache key includes the date — `days` alone collided across calendar days,
    # serving yesterday's reporter list (and yesterday's report_dates) all day.
    key = f"impstore::reporters::{days}::{today.isoformat()}"
    cached = _REPORTERS_CACHE.get(key)
    if cached is not None:
        return list(cached)

    out = _fmp_reporters(days, today)
    source = "fmp"
    if out is None:
        out = _finnhub_reporters(days, today)
        source = "finnhub"
    if out:
        _log.info("[implied-store] upcoming_reporters: %d row(s) from %s", len(out), source)
        _REPORTERS_CACHE.set(key, list(out), _REPORTERS_TTL)
    return out


def _hour_rank(hour) -> int:
    """1 for 'bmo' (case/whitespace-insensitive), else 0. 'bmo' is the ONE
    hour value `run_nightly_capture` branches on (the bmo-today skip, read
    one line after `_dedupe_reporters` resolves) — review round 2 CRITICAL:
    a collision that ties on eps_estimate presence and fiscal_year/
    fiscal_quarter but genuinely differs on `hour` used to fall through to
    array order, meaning WHICH candidate's `hour` survived decided whether
    tonight's capture fired at all (or worse, ran under the wrong session
    and stored an IV-crushed value under first-write-wins). When ambiguous,
    bias toward 'bmo' — the SAFE direction: wrongly resolving to 'bmo' costs
    one quarter's pre-report snapshot (no data, honestly cold); wrongly
    resolving to anything else risks silently storing a corrupted
    post-report value forever. Per §12: showing nothing beats showing a
    confidently wrong number.

    Review round 3 CRITICAL — MUST normalize the same way
    `run_nightly_capture` does (`.lower()` at the bmo-today check, one line
    after this resolves) or the bias silently breaks: `_hour_rank("BMO")`
    with a bare `== "bmo"` returns 0, tying with 'amc' (also 0), and the
    canonical-string fallback then picks whichever sorts greater in plain
    ASCII — 'BMO' < 'amc' ('B'=66 < 'a'=97) — so 'amc' would win and a
    genuinely-bmo row could be captured as if pre-report, storing an
    IV-crushed value permanently. Verified live."""
    return 1 if (hour or "").strip().lower() == "bmo" else 0


def _reporter_sort_key(rep: dict) -> tuple:
    """A STRICT total order over a reporter row, so `_reporter_preferred`
    never falls through to "whichever came first" — review round 2 CRITICAL.
    The prior 3-field key `(eps_present, fiscal_year, fiscal_quarter)` could
    tie while the rows genuinely differed elsewhere (observed live: a
    same-date duplicate tying on all three but disagreeing on `hour` —
    'bmo' vs 'amc' — decided by Finnhub's array order whether tonight's
    capture fired at all). This key adds `hour` (the one remaining field
    `run_nightly_capture` branches on) and, as the unconditional final
    tie-break, a canonical JSON serialization of the WHOLE row — so two
    reporter dicts compare equal here if and ONLY IF they are content-
    identical (order genuinely can't matter then), and unequal otherwise
    resolves the SAME way regardless of which one was visited first.
    `eps_present` uses `is not None`, never a truthy check: a genuine
    `eps_estimate` of 0.0 must count as present, matching the module's
    phantom-zero standard everywhere else."""
    eps_present = rep.get("eps_estimate") is not None
    absent = -1  # sentinel below any real fiscal_year/fiscal_quarter (never 0 or negative in practice)
    fy = rep.get("fiscal_year") if rep.get("fiscal_year") is not None else absent
    fq = rep.get("fiscal_quarter") if rep.get("fiscal_quarter") is not None else absent
    hour_rank = _hour_rank(rep.get("hour"))
    canonical = json.dumps(rep, sort_keys=True, default=str)
    return (eps_present, fy, fq, hour_rank, canonical)


def _reporter_preferred(new: dict, old: dict) -> bool:
    """Deterministic, ORDER-INDEPENDENT tie-break between two reporter rows
    sharing the same (sym, report_date) — see `_dedupe_reporters`. Built on
    `_reporter_sort_key`'s strict total order: real `eps_estimate` first,
    then higher (fiscal_year, fiscal_quarter), then 'bmo'-biased `hour`, then
    (unconditionally) the row's own canonical serialization. Because the key
    is total, `new_key > old_key` picks the SAME winner regardless of which
    row is visited first — a true fixed comparison, not "first wins"."""
    return _reporter_sort_key(new) > _reporter_sort_key(old)


def _dedupe_reporters(reporters: list[dict]) -> tuple[list[dict], list[dict]]:
    """Finnhub's /calendar/earnings can list the SAME (sym, report_date)
    MORE THAN ONCE under DIFFERENT fiscal quarters — observed live:
        GLOO 2026-08-17 -> {"quarter":2,"year":2027,"epsEstimate":-0.187}
                        and {"quarter":2,"year":2026,"epsEstimate":null}
    `record_implied`'s identity is (sym, report_date) — see its docstring for
    why it can't be fiscal-keyed (SQLite doesn't dedupe NULLs in a composite
    PK, and a fiscal-keyed PK would break idempotency for every row written
    without a fiscal key). Left undeduped, whichever of these two rows
    happens to appear FIRST in Finnhub's array is the one `_has_snapshot`/
    `INSERT OR IGNORE` files the PERMANENT snapshot under — an artifact of
    provider array order, not anything meaningful. Once captured, that
    identity can never be corrected (the implied move at the time isn't
    reconstructible), and the wrong fiscal quarter either never pairs with
    its real history row (bar never draws) or pairs against the WRONG
    quarter's realized move (feeds a false number into the RICH/CHEAP chip).

    Resolves via `_reporter_preferred` — a genuinely fixed, total-order
    comparison (review round 2), so the result is the SAME regardless of the
    array's order, not just "usually the same".

    Returns (deduped_reporters, collisions) — `collisions` is one dict per
    resolved duplicate: `{"sym", "report_date", "distinct"}`, where `distinct`
    is False when the dropped row was content-identical to the survivor
    (harmless — either choice behaves the same) and True when it genuinely
    differed. Callers decide what's worth surfacing (see
    `run_nightly_capture`); `len(collisions)` is the raw total."""
    best: dict[tuple, dict] = {}
    collisions: list[dict] = []
    for rep in reporters:
        k = (rep.get("sym"), rep.get("report_date"))
        prev = best.get(k)
        if prev is None:
            best[k] = rep
            continue
        winner = rep if _reporter_preferred(rep, prev) else prev
        loser = prev if winner is rep else rep
        distinct = _reporter_sort_key(winner) != _reporter_sort_key(loser)
        collisions.append({"sym": rep.get("sym"), "report_date": rep.get("report_date"),
                            "distinct": distinct})
        best[k] = winner
    return list(best.values()), collisions


def _finnhub_day_enrichment(day_iso: str) -> dict[str, dict]:
    """Best-effort Finnhub `/calendar/earnings` lookup scoped to ONE calendar
    day — used to backfill the bmo/amc `hour` and fiscal_year/quarter for
    rows dated `day_iso` when the PRIMARY reporter-list source (FMP) left
    them unknown (see `_fmp_reporters`).

    Renamed from `_finnhub_today_enrichment` (Task 4, 2026-08-05) — the
    body is unchanged (it was already day-scoped), but the OLD caller only
    ever invoked it for `today`, so the normal T-1 capture (rows dated
    today+1 under the default 1-day window) never got this backfill at
    all. See `run_nightly_capture`, which now calls this once per distinct
    `report_date` still missing a fiscal key or session, not just today's.

    A single-day ask is far cheaper than the full 14-day reporter list — it
    has a real chance of landing even on a night the wide Finnhub calendar
    call is itself rate-limited, which is exactly the night this matters
    most. Routed through the shared finnhub_client budget/cooldown like every
    other Finnhub caller.

    Returns `{}` on ANY failure (missing key, 429, timeout, bad shape, or
    genuinely no rows) — callers MUST treat a missing symbol as "still
    unknown", never assume absence means non-bmo (see the same-day skip in
    `run_nightly_capture`)."""
    from api.services.finnhub_client import fh_get
    data = fh_get("/calendar/earnings", {"from": day_iso, "to": day_iso}, timeout=8)
    rows = (data or {}).get("earningsCalendar") or [] if isinstance(data, dict) else []
    out: dict[str, dict] = {}
    for row in rows:
        sym = _canon(row.get("symbol"))
        if not sym:
            continue
        out[sym] = {
            "hour": (row.get("hour") or "").strip(),
            "fiscal_year": _int_or_none(row.get("year")),
            "fiscal_quarter": _int_or_none(row.get("quarter")),
        }
    return out


def _merge_day_enrichment(in_window: list[dict], hints_by_day: dict[str, dict[str, dict]]) -> list[dict]:
    """Pure merge: fills `hour`/`fiscal_year`/`fiscal_quarter` on rows whose
    PRIMARY source left them unknown, from `hints_by_day` — a
    `{report_date: {sym: hint}}` map covering every day `run_nightly_capture`
    chose to enrich (see `_finnhub_day_enrichment`).

    Generalized from `_merge_today_enrichment` (Task 4, 2026-08-05): a
    single `today_iso` + flat `hints` map could only ever backfill rows
    dated today, but the normal T-1 capture's rows are dated today+1 —
    exactly the ones that never got enriched before this fix, leaving the
    majority of permanent snapshots with a NULL fiscal pairing key. Each
    row is matched ONLY against `hints_by_day[row['report_date']]` — a hint
    computed for one day is never applied to a row dated a different day,
    even for the same symbol.

    NEVER overwrites a value the primary source already supplied, and never
    mutates the input dicts in place (`in_window` entries may be objects
    shared with the `_REPORTERS_CACHE` TTL cache via `upcoming_reporters` —
    mutating them would corrupt what every other caller inside the same 6h
    TTL window sees)."""
    if not hints_by_day:
        return in_window
    out = []
    for r in in_window:
        day_hints = hints_by_day.get(r.get("report_date"))
        hint = day_hints.get(r.get("sym")) if day_hints else None
        if not hint:
            out.append(r)
            continue
        merged = dict(r)
        if not (merged.get("hour") or "").strip():
            merged["hour"] = hint.get("hour") or ""
        if merged.get("fiscal_year") is None:
            merged["fiscal_year"] = hint.get("fiscal_year")
        if merged.get("fiscal_quarter") is None:
            merged["fiscal_quarter"] = hint.get("fiscal_quarter")
        out.append(merged)
    return out


# ── Leg 3 — bounded per-symbol fiscal repair (Task 4, 2026-08-05) ───────────
# Leg 2 (_finnhub_day_enrichment) resolves the fiscal key for the large
# majority of rows (Finnhub carries quarter/year on 100% of its own
# /calendar/earnings rows), but a night Finnhub itself is rate-limited or
# silent can still leave a row unresolved. FMP's
# `stable/earning-call-transcript-dates` is a viable PER-SYMBOL fallback —
# it returns the correct fiscal identity (`{"quarter","fiscalYear","date"}`)
# but is one call per symbol, so it can never back a bulk calendar sweep
# (see the plan's "What cannot be fixed" §D2) — only a bounded per-symbol
# repair for the handful of rows that still need it after Leg 2.
_FISCAL_REPAIR_MAX_SYMBOLS = 20
_FMP_TRANSCRIPT_DATES_TIMEOUT_SECS = 8


def _fmp_fiscal_repair(sym: str) -> list[dict] | None:
    """One FMP `stable/earning-call-transcript-dates?symbol=` call for
    `sym` — returns the raw list of `{"quarter","fiscalYear","date"}`
    entries (FMP's documented shape), or `None` on any failure (missing
    key, HTTP error, network error, or a non-list body). The caller
    (`_nearest_fiscal_identity`) picks the entry closest to the row's
    report_date. Exactly one HTTP call per invocation — the per-night cap
    lives in the caller (`run_nightly_capture` / `repair_null_fiscal_keys`),
    not here, so this stays a simple, testable single-call unit."""
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return None
    import requests
    try:
        resp = requests.get(
            "https://financialmodelingprep.com/stable/earning-call-transcript-dates",
            params={"symbol": sym, "apikey": key},
            timeout=_FMP_TRANSCRIPT_DATES_TIMEOUT_SECS,
        )
        if not resp.ok:
            _log.warning("fiscal repair: FMP HTTP %d for %s", resp.status_code, sym)
            return None
        data = resp.json()
    except Exception as e:  # noqa: BLE001 — one symbol's failure must never crash the batch
        _log.warning("fiscal repair: FMP transcript-dates fetch failed for %s: %s", sym, e)
        return None
    return data if isinstance(data, list) else None


def _nearest_fiscal_identity(entries: list[dict], report_date: str) -> tuple:
    """Picks the entry in `entries` (FMP's `earning-call-transcript-dates`
    shape) whose `date` is nearest `report_date` and returns its
    `(fiscalYear, quarter)` as `(int|None, int|None)`. A malformed or
    missing `date` on an entry is skipped, never crashes the match; an
    empty or all-malformed `entries` (or an unparseable `report_date`)
    returns `(None, None)` — an honest absence, never a guessed identity.
    Never derived from `report_date`'s own calendar month — that
    calendar-fiscal assumption is exactly what Task 8b disproved on AAPL,
    whose fiscal Q1 ends in December."""
    try:
        target = dt.date.fromisoformat(report_date or "")
    except ValueError:
        return None, None
    best_entry = None
    best_delta = None
    for e in entries or []:
        try:
            ed = dt.date.fromisoformat(e.get("date") or "")
        except (ValueError, AttributeError):
            continue
        delta = abs((ed - target).days)
        if best_delta is None or delta < best_delta:
            best_delta = delta
            best_entry = e
    if best_entry is None:
        return None, None
    return _int_or_none(best_entry.get("fiscalYear")), _int_or_none(best_entry.get("quarter"))


def _apply_fiscal_repair(in_window: list[dict], repaired_by_sym: dict[str, tuple]) -> list[dict]:
    """Pure merge: fills a STILL-missing `fiscal_year`/`fiscal_quarter` from
    Leg 3's per-symbol repair (`repaired_by_sym`: `{sym: (fiscal_year,
    fiscal_quarter)}`) — same never-overwrite, never-mutate-in-place
    contract as `_merge_day_enrichment`. A `(None, None)` repair result
    (the symbol's FMP lookup succeeded but no entry was close enough to be
    useful) is a legitimate no-op, not an error."""
    if not repaired_by_sym:
        return in_window
    out = []
    for r in in_window:
        fix = repaired_by_sym.get(r.get("sym"))
        if not fix or (r.get("fiscal_year") is not None and r.get("fiscal_quarter") is not None):
            out.append(r)
            continue
        fy, fq = fix
        merged = dict(r)
        if merged.get("fiscal_year") is None and fy is not None:
            merged["fiscal_year"] = fy
        if merged.get("fiscal_quarter") is None and fq is not None:
            merged["fiscal_quarter"] = fq
        out.append(merged)
    return out


def run_nightly_capture(now: dt.datetime | None = None) -> dict:
    """Post-close T-1 capture: only reporters whose report_date falls within
    [today, today+WINDOW] (env IMPLIED_CAPTURE_WINDOW_DAYS, default 1) are even
    considered — rows outside the window are silently filtered (not counted).
    Within that window, a report_date == today whose session ISN'T confirmed
    "amc" is skipped (counted) — either it's "bmo" (already reported this
    morning) or the session is simply unknown (the PRIMARY reporter-list
    source, FMP, carries no session field at all — see `_fmp_reporters`).
    Either way, a post-report capture would store IV-crushed values instead
    of the honest pre-report implied, and a missing snapshot is the honest
    outcome when the session can't be confirmed.

    ── Fiscal-key resolution (Task 4, 2026-08-05) ───────────────────────────
    FMP (the primary reporter-list source) carries no `quarter`/`year` at
    all, so every FMP-sourced row starts with `fiscal_year`/`fiscal_quarter`
    = None — and Task 8b's pairing key needs that identity to ever match a
    history row. Before the per-row capture decision, up to THREE legs try
    to resolve it, cheapest first:
      Leg 1 — the PRIMARY source itself (Finnhub fallback rows already
              carry it; nothing to do).
      Leg 2 — one Finnhub `/calendar/earnings` call PER DISTINCT report_date
              still represented in `in_window` that has at least one row
              missing `fiscal_year`, `fiscal_quarter`, OR `hour`
              (`_finnhub_day_enrichment` / `_merge_day_enrichment`). Capped
              at `window_days + 1` calls by construction — that's the most
              distinct dates `[today, window_end]` can ever contain.
              (Generalized from the old `_finnhub_today_enrichment`, which
              only ever enriched rows dated today — the normal T-1
              capture's rows are dated today+1, so they never got this
              backfill at all before this fix.)
      Leg 3 — for whatever Leg 2 still left without BOTH fields, one bounded
              per-symbol FMP `earning-call-transcript-dates` lookup each
              (`_fmp_fiscal_repair` / `_nearest_fiscal_identity` /
              `_apply_fiscal_repair`), hard-capped at
              `_FISCAL_REPAIR_MAX_SYMBOLS` (20) per night and skipped
              entirely when Leg 2 already resolved everything.
    A row that STILL has `fiscal_year is None or fiscal_quarter is None`
    after all three legs is refused — never written, counted in
    `summary["skipped_no_fiscal"]`, and logged. This store is append-only:
    a permanent row that can never pair with a history row by fiscal
    identity is worse than an absent one (Task 8b's whole point was that
    `report_date` pairing is unreliable — writing a NULL-keyed row would
    just resurrect that exact failure mode). Neither field is ever guessed
    or derived from the report_date's calendar month (the calendar-fiscal
    assumption Task 8b disproved on AAPL, whose fiscal Q1 ends in
    December).

    Never stores a failure; existing (sym, report_date) rows are kept
    (first-write-wins — with the narrow window the first write IS the
    T-1/T-0-pre-report write).
    Deduped by (sym, report_date) BEFORE the window filter (review round 1,
    CRITICAL) — see `_dedupe_reporters` — so a duplicate-fiscal-quarter row
    from Finnhub can never let array order decide which identity a permanent
    snapshot files under; `summary["collisions"]` counts how many resolved,
    across the FULL 14-day reporter list (not just tonight's window).
    Exception isolation: one bad symbol never truncates the batch."""
    now = now or dt.datetime.now(_ET)
    today = now.date()
    today_iso = today.isoformat()
    window_days = int(os.environ.get("IMPLIED_CAPTURE_WINDOW_DAYS", "1"))
    window_end = today + dt.timedelta(days=window_days)

    reporters = upcoming_reporters(days=14, now=now)
    reporters, collisions = _dedupe_reporters(reporters)

    in_window = []
    for rep in reporters:
        try:
            rd = dt.date.fromisoformat(rep.get("report_date") or "")
        except ValueError:
            continue  # malformed date — silently filtered, never counted
        if today <= rd <= window_end:
            in_window.append(rep)

    # Leg 2 — opportunistic day-scoped session/fiscal backfill, one call per
    # DISTINCT report_date still represented that needs it (see
    # _finnhub_day_enrichment). Naturally capped at window_days + 1 calls —
    # that's the most distinct dates [today, window_end] can ever contain. A
    # healthy night (Finnhub-primary, or every FMP row already resolved)
    # spends nothing.
    enrichment_days = sorted({
        r.get("report_date") for r in in_window
        if r.get("fiscal_year") is None or r.get("fiscal_quarter") is None
        or not (r.get("hour") or "").strip()
    })
    if enrichment_days:
        hints_by_day = {day_iso: _finnhub_day_enrichment(day_iso) for day_iso in enrichment_days}
        in_window = _merge_day_enrichment(in_window, hints_by_day)

    # Leg 3 — bounded per-symbol FMP repair for whatever Leg 2 still left
    # without a full fiscal key. Skipped entirely when nothing needs it (the
    # common case once Leg 2 has run). A row that is going to be SKIPPED
    # regardless of its fiscal key (today-dated, session not confirmed
    # "amc" even after Leg 2's backfill) is excluded from this budget — no
    # sense spending one of the scarce 20 per-symbol calls resolving a
    # fiscal identity for a row that will never be captured tonight anyway.
    still_missing_syms: list[str] = []
    seen_syms: set[str] = set()
    for r in in_window:
        if r.get("report_date") == today_iso and (r.get("hour") or "").strip().lower() != "amc":
            continue
        if r.get("fiscal_year") is None or r.get("fiscal_quarter") is None:
            sym = r.get("sym")
            if sym and sym not in seen_syms:
                seen_syms.add(sym)
                still_missing_syms.append(sym)
    if still_missing_syms:
        repaired_by_sym: dict[str, tuple] = {}
        for sym in still_missing_syms[:_FISCAL_REPAIR_MAX_SYMBOLS]:
            entries = _fmp_fiscal_repair(sym)
            if not entries:
                continue
            rd_for_sym = next((r.get("report_date") for r in in_window if r.get("sym") == sym), None)
            if rd_for_sym is None:
                continue
            repaired_by_sym[sym] = _nearest_fiscal_identity(entries, rd_for_sym)
        if repaired_by_sym:
            in_window = _apply_fiscal_repair(in_window, repaired_by_sym)

    # Review round 2, IMPORTANT #2 — the WARNING is scoped tighter than the
    # summary total: only a collision that (a) actually lands in TONIGHT'S
    # capture window and (b) genuinely differed (not a harmless byte-
    # identical repeat, `distinct=False`) is worth a human noticing. The raw
    # 14-day total fires most nights once real reporters accrue (observed
    # live: 3 collisions in the window, 2 of them harmless ties) — an alert
    # that's noise from night one is an alert nobody reads by day thirty.
    # `summary["collisions"]` still carries the unfiltered total below.
    in_window_keys = {(rep.get("sym"), rep.get("report_date")) for rep in in_window}
    noisy = [c for c in collisions
             if c["distinct"] and (c["sym"], c["report_date"]) in in_window_keys]
    if noisy:
        _log.warning(
            "[implied-store] resolved %d duplicate (sym, report_date) reporter "
            "row(s) from Finnhub inside tonight's capture window (rows "
            "genuinely differed, not a harmless repeat): %s",
            len(noisy), ", ".join(f"{c['sym']}/{c['report_date']}" for c in noisy),
        )

    summary = {"captured": 0, "skipped": 0, "failed": 0, "collisions": len(collisions),
               "skipped_no_fiscal": 0}
    captured_at = now.isoformat(timespec="seconds")
    for rep in in_window:
        sym = rep.get("sym")
        report_date = rep.get("report_date")
        hour = (rep.get("hour") or "").lower()
        try:
            # Conservative degrade: only a CONFIRMED "amc" proceeds for a
            # today-dated row. "bmo" (already reported) and "" (session
            # unknown from either provider, even after the backfill above)
            # both skip — an absent snapshot is honest; capturing on an
            # unconfirmed session risks silently storing an IV-crushed value.
            if report_date == today_iso and hour != "amc":
                summary["skipped"] += 1
                continue
            if _has_snapshot(sym, report_date):
                summary["skipped"] += 1
                continue
            # Refuse to write an unpaired permanent row (Task 4) — a
            # snapshot with no fiscal identity can never be matched to a
            # history row by Task 8b's pairing key, and this store is
            # append-only: a permanently-unpairable row is worse than an
            # absent one. Never guessed/defaulted (Number(null)===0 class).
            if rep.get("fiscal_year") is None or rep.get("fiscal_quarter") is None:
                summary["skipped_no_fiscal"] += 1
                _log.warning(
                    "[implied-store] %s/%s: fiscal identity unresolved after all "
                    "enrichment legs -- refusing to write an unpairable snapshot",
                    sym, report_date,
                )
                continue
            payload = implied_move.get_expected_move(sym, report_date)
            if payload is None:
                summary["failed"] += 1
                continue
            record_implied(sym, report_date, payload, captured_at,
                            fiscal_year=rep.get("fiscal_year"),
                            fiscal_quarter=rep.get("fiscal_quarter"))
            summary["captured"] += 1
        except Exception:  # noqa: BLE001 — one bad symbol must never truncate the batch
            _log.warning("[implied-store] capture failed for %s", sym, exc_info=True)
            summary["failed"] += 1
    _log.info("[implied-store] nightly capture: %s", summary)
    return summary


def repair_null_fiscal_keys(limit: int = 200, dry_run: bool = False) -> dict:
    """One-shot, IDEMPOTENT repair for existing `implied_snapshots` rows
    written with a NULL `fiscal_year`/`fiscal_quarter` before Task 4
    (2026-08-05) widened `run_nightly_capture`'s own enrichment to close the
    gap going forward. See `tools/implied_fiscal_backfill.py` for the CLI
    wrapper.

    ── Why this is safely recoverable NOW, and not later ────────────────────
    The module docstring's "unreconstructable" warning is about the IMPLIED
    MOVE value itself — options quotes settle at ~4:15pm ET the day before a
    report, so there is no way to compute what they WERE after the fact.
    The FISCAL IDENTITY is a different fact: a property of the report
    itself, not of a market snapshot. For a report that has NOT happened
    yet, Finnhub/FMP still list it as UPCOMING with its quarter/year
    attached — so a null-fiscal row stays repairable right up until the
    report actually prints. Run this BEFORE the affected reports happen;
    once a report has printed, it falls out of both providers' "upcoming"
    calendars and this function can no longer recover it (the implied-move
    VALUE is already correctly captured — it would just stay permanently
    unpaired).

    ── Safety ────────────────────────────────────────────────────────────
    Every write is `UPDATE ... WHERE fiscal_year IS NULL` (mirrored for
    fiscal_quarter) — a row that already carries a value, from this
    function or a normal nightly capture, is NEVER touched. Re-running this
    function (e.g. after raising `limit`, or on a later night) only ever
    narrows the null-row set further; it can never regress a row that a
    prior run (or the nightly job) already resolved.

    Reuses the EXACT SAME Leg 2 (day-scoped Finnhub enrichment) and Leg 3
    (per-symbol FMP transcript-dates) resolution as `run_nightly_capture` —
    this function cannot drift from the logic the nightly job itself uses.

    `limit` bounds how many distinct symbols spend the per-symbol FMP
    repair leg (Leg 3) in ONE call — the day-scoped Finnhub leg (Leg 2) has
    no such cap; it is naturally bounded by the number of distinct
    report_date values still needing repair. Re-run (optionally raising
    `limit`) to continue past the cap.

    `dry_run=True` computes everything but writes nothing — the returned
    `written` count is always 0 in that case.

    Returns `{"total_null": N, "resolved": N, "written": N}` — `resolved`
    is how many rows got AT LEAST ONE field filled in memory (dry_run-safe
    to compute), `written` is how many of those were actually persisted."""
    _ensure_init()
    with closing(_connect()) as c:
        rows = c.execute(
            "SELECT sym, report_date FROM implied_snapshots "
            "WHERE fiscal_year IS NULL OR fiscal_quarter IS NULL"
        ).fetchall()
    rows = [dict(r) for r in rows]
    result = {"total_null": len(rows), "resolved": 0, "written": 0}
    if not rows:
        return result

    # Reshape each DB row into the same "rep" dict shape run_nightly_capture
    # operates on, so the SAME pure merge functions apply unmodified.
    reps = [{"sym": r["sym"], "report_date": r["report_date"], "hour": "",
             "fiscal_year": None, "fiscal_quarter": None} for r in rows]

    days = sorted({r["report_date"] for r in reps})
    hints_by_day = {day_iso: _finnhub_day_enrichment(day_iso) for day_iso in days}
    reps = _merge_day_enrichment(reps, hints_by_day)

    missing_syms: list[str] = []
    seen_syms: set[str] = set()
    for r in reps:
        if (r["fiscal_year"] is None or r["fiscal_quarter"] is None) and r["sym"] not in seen_syms:
            seen_syms.add(r["sym"])
            missing_syms.append(r["sym"])
    for sym in missing_syms[:limit]:
        entries = _fmp_fiscal_repair(sym)
        if not entries:
            continue
        rd_for_sym = next((r["report_date"] for r in reps if r["sym"] == sym), None)
        if rd_for_sym is None:
            continue
        fy, fq = _nearest_fiscal_identity(entries, rd_for_sym)
        reps = _apply_fiscal_repair(reps, {sym: (fy, fq)})

    for r in reps:
        if r["fiscal_year"] is None and r["fiscal_quarter"] is None:
            continue  # still fully unresolved -- leave the row NULL, never guess
        result["resolved"] += 1
        if dry_run:
            continue
        with closing(_connect()) as c, c:
            if r["fiscal_year"] is not None:
                c.execute(
                    "UPDATE implied_snapshots SET fiscal_year = ? "
                    "WHERE sym = ? AND report_date = ? AND fiscal_year IS NULL",
                    (r["fiscal_year"], r["sym"], r["report_date"]),
                )
            if r["fiscal_quarter"] is not None:
                c.execute(
                    "UPDATE implied_snapshots SET fiscal_quarter = ? "
                    "WHERE sym = ? AND report_date = ? AND fiscal_quarter IS NULL",
                    (r["fiscal_quarter"], r["sym"], r["report_date"]),
                )
        result["written"] += 1
    return result
