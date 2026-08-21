"""Nightly FMP earnings-calendar pull — chunked past the 4,000-row silent
truncation, ONE DAY PER CALL.

Why ONE-DAY chunks (not 7-day): a single `stable/earnings-calendar` call
spanning multiple days silently truncates at a MEASURED ~4,000-row response
cap, and the truncation is not date-fair — see `implied_store._fmp_reporters`'s
docstring for the live-probe numbers this module cites: a call spanning
`[today, today+1]` (just TWO days) returned EXACTLY 4000 rows with ZERO of
them dated `today` (the whole earlier day dropped, not merely thinned), and a
14-day-wide call dropped days 0-1 entirely while concentrating rows on days
7-14. Single-day global volume on this endpoint runs ~1,400-2,200 rows —
comfortably under the cap — which is exactly why a 7-day window (safely
under the cap "on average") still overflows on essentially every real window:
7 days x ~1,400-2,200 rows/day is 9,800-15,400 rows, 2.5x-4x the cap, and the
2-day probe above proves FMP does not thin proportionally when a range
overflows — it drops whole days. Only a ONE-DAY window keeps every single
call's own volume safely under the cap regardless of which day is busy. This
mirrors two existing precedents that chunk this exact endpoint the same way:
`implied_store._fmp_reporters_for_day` / `_fmp_reporters` and
`api/routers/calendar.py::_fmp_calendar_day` / `_fmp_range_week`. 84 one-day
requests is trivially cheap (small ThreadPoolExecutor, same pattern as those
two precedents) — there is no cost reason to ever chunk wider than a day on
this endpoint.

Per-chunk at-cap detection: even at one-day granularity, a single freak day
COULD still legitimately hit the cap (a historically bad news day, a data
anomaly). A chunk returning >= `_FMP_CAP_THRESHOLD` rows is not silently
trusted — the calendar day itself is recorded in the receipt's
`chunks_at_cap` (naming the day, not just counting it) so an operator can see
which day is suspect. The chunk's rows are still kept and folded into the
result: a response at the cap is evidence of possible truncation, never
evidence the day is empty, and dropping real rows because they *might* be
incomplete would trade a visible partial answer for an invisible wrong one.

Row shape mirrors `implied_store._fmp_reporters_for_day`'s handling of this
exact endpoint (read it first): `row["symbol"]` / `row["date"]`. FMP's
`stable/earnings-calendar` carries NO bmo/amc session field at all — a
documented gap (see `implied_store`'s module docstring: "FMP's calendar
carries NEITHER a bmo/amc session NOR a quarter/year fiscal identity"). This
module still threshold-parses a time/hour field on the row DEFENSIVELY, in
case FMP ever adds one — but on every real pull observed to date every row
degrades to "tbd" and the receipt's `sessions_resolved` reads 0, so the gap
is VISIBLE in the receipt rather than silently absorbed into a confident
"tbd" nobody can distinguish from "we asked and nobody knew."

Dates are parsed defensively (`[:10]` + `date.fromisoformat` in a try) even
though FMP's own dates are clean ISO `YYYY-MM-DD` — other calendar-adjacent
feeds in this codebase carry mixed `8/6/2026` / `08/06/2026` forms, and a
malformed row here must cost only that one row, never the whole chunk.

EARLIEST FUTURE report date per symbol wins: a symbol can appear more than
once across the 84-day window (a correction, or two chunks disagreeing) —
the soonest date, not the latest, is what a screener column called
"next earnings date" means.

ET clock: `run_pull`'s injectable `now` defaults to `_now_et()` (real ET
now), NOT the pod's naive local clock. A Railway pod's system clock is UTC;
between roughly 8pm and midnight ET, a naive `datetime.datetime.now()`'s
local date is already ET's tomorrow, so a report dated ET's actual today was
silently discarded as `rd < today`. Anchoring on `_ET` (mirrors
`scan_evaluator._now_et` / `analyst_pass._now_et` / `implied_store
.run_nightly_capture`'s `now or dt.datetime.now(_ET)`) fixes the default
path; tests inject an aware `now` directly and never reach `_now_et()`.

Artifact: `<DATA_DIR or /data>/screener_earnings_dates.json`,
`{as_of, rows: {TICKER: {date, session}}}`, written atomically (tmp ->
os.replace). Env override `SCREENER_EDATES_ARTIFACT` points the whole module
at a different path — tests always use it; production never sets it, so it
resolves to the real data directory unchanged.

Reader `read_earnings_dates` mirrors the finviz-pull idiom used elsewhere in
Wave 2 (see the wave-2 plan's Task 3 design): a missing/unparsable artifact
is a whole-source miss (`_note(..., "missing")` -> `{}`); an artifact older
than `_STALE_DAYS` is still SERVED (a screen with slightly stale earnings
dates beats one with none) but COUNTED (`_note(..., f"stale:{age_days}d")`)
so staleness is visible in the builder's census, never silent; a ticker
absent from the pull's `rows` is simply absent from the output (the column
stays None downstream) — never a fabricated "tbd" for a symbol the pull
never saw at all.
"""
import concurrent.futures
import datetime
import json
import logging
import os

from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

_CHUNK_DAYS = 1
_TOTAL_DAYS = 84
_STALE_DAYS = 4  # served but counted once the artifact ages past this — mirrors finviz_universe's threshold

_FMP_CAP_THRESHOLD = 3900  # near the measured ~4,000-row response cap — see module docstring
_FMP_CHUNK_MAX_WORKERS = 6  # mirrors implied_store._fmp_reporters / calendar._fmp_range_week


def _now_et() -> datetime.datetime:
    """Real ET now — the ONLY place `run_pull` reads the real clock when no
    `now` is injected (see module docstring's ET-clock section). Tests inject
    `now` directly and never reach this function, so freezing it here is
    what makes the default path testable without mocking the system clock."""
    return datetime.datetime.now(_ET)


def _note(failures, source, outcome):
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def _artifact_path() -> str:
    override = os.environ.get("SCREENER_EDATES_ARTIFACT")
    if override:
        return override
    data_dir = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else "./data")
    return os.path.join(data_dir, "screener_earnings_dates.json")


def _chunk_windows(start: datetime.date, total_days: int = _TOTAL_DAYS,
                    chunk_days: int = _CHUNK_DAYS) -> list[tuple[datetime.date, datetime.date]]:
    """`ceil(total_days / chunk_days)` contiguous, non-overlapping
    `chunk_days`-wide windows covering `[start, start + total_days - 1]` —
    with the defaults, 84 windows of exactly 1 calendar day each. CEILING
    division, not floor: `total_days // chunk_days` silently drops the
    remainder days whenever `total_days` isn't an exact multiple of
    `chunk_days` (e.g. `10 // 3 == 3` windows, dropping day 9 entirely). The
    final window is clamped to the range's actual last day so it never reads
    past `start + total_days - 1` even when `chunk_days` doesn't divide
    evenly. Each call to FMP stays scoped to one window's own (small)
    volume, which is the entire point (see the module docstring)."""
    windows = []
    last_day = start + datetime.timedelta(days=total_days - 1)
    n = -(-total_days // chunk_days)  # ceiling division
    for i in range(n):
        d0 = start + datetime.timedelta(days=i * chunk_days)
        d1 = min(d0 + datetime.timedelta(days=chunk_days - 1), last_day)
        windows.append((d0, d1))
    return windows


def _window_label(d0: datetime.date, d1: datetime.date) -> str:
    """Names a window for the receipt/log — just the day for the (default,
    1-day) common case, a range if `_CHUNK_DAYS` is ever widened again."""
    return d0.isoformat() if d0 == d1 else f"{d0.isoformat()}..{d1.isoformat()}"


def _fetch_window(d0: datetime.date, d1: datetime.date) -> list | None:
    """One FMP `stable/earnings-calendar` call scoped to a single window.
    Returns the raw row list, or `None` on any failure or malformed response
    — the caller treats `None` as "this chunk contributed nothing" (never a
    whole-run failure; one bad chunk costs only that chunk's rows)."""
    from api.services import earnings_estimates

    try:
        data = earnings_estimates._fmp_get(
            "/stable/earnings-calendar",
            {"from": d0.isoformat(), "to": d1.isoformat()})
    except Exception as e:  # noqa: BLE001 — one chunk's failure must never kill the batch
        log.warning("[screener] earnings_dates: chunk %s raised: %s", _window_label(d0, d1), e)
        return None
    if not isinstance(data, list):
        return None
    return data


def _parse_session(raw) -> str:
    """Threshold-parse a raw time-of-day value into bmo/amc/tbd:
    `< 09:30` -> bmo (before market open) · `>= 16:00` -> amc (after market
    close) · else -> tbd. A THRESHOLD, never an equality — a sentinel/boundary
    clock (exactly 09:30, exactly 16:00) must land on the correct SIDE, never
    fall through because nothing equals it exactly. Accepts "HH:MM",
    "HH:MM:SS", or a compact 3-4 digit "HHMM"/"HMM" form; anything blank,
    unparsable, or out of range degrades to "tbd" — the honest answer when
    the row's own time value can't be trusted, matching the module's default
    for an endpoint that carries no session field at all."""
    if not raw:
        return "tbd"
    s = str(raw).strip()
    try:
        if ":" in s:
            parts = s.split(":")
            hour, minute = int(parts[0]), int(parts[1])
        else:
            digits = s.zfill(4)
            hour, minute = int(digits[:2]), int(digits[2:4])
    except (ValueError, IndexError):
        return "tbd"
    if not (0 <= hour < 24 and 0 <= minute < 60):
        return "tbd"
    t = (hour, minute)
    if t < (9, 30):
        return "bmo"
    if t >= (16, 0):
        return "amc"
    return "tbd"


def _row_session(row: dict) -> str:
    """FMP's `stable/earnings-calendar` carries no session field on any row
    observed to date (see module docstring) — `time`/`hour` are checked
    defensively in case that ever changes, but resolve to "tbd" today on
    every real pull, which is exactly what makes `sessions_resolved` in the
    receipt read 0: a visible, honest gap, not an invented session."""
    return _parse_session(row.get("time") or row.get("hour"))


def _atomic_write(artifact: dict) -> None:
    path = _artifact_path()
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(artifact, fh)
    os.replace(tmp, path)  # atomic on both POSIX and Windows (NTFS ReplaceFile)


def run_pull(now: datetime.datetime | None = None) -> dict:
    """Chunked FMP `stable/earnings-calendar` pull over the next 84 days
    (84 requests, 1 day each — see module docstring), fetched via a small
    ThreadPoolExecutor mirroring `implied_store._fmp_reporters` /
    `calendar._fmp_range_week`. EARLIEST FUTURE report date per symbol wins.
    Writes the artifact atomically ONLY when at least one symbol was found —
    an empty/total-failure result never overwrites a prior good artifact (the
    same direction as every other Wave-2 pull). Never raises: one bad chunk
    costs only that chunk's rows, never the run.

    `now` defaults to `_now_et()` (real ET now, not the pod's naive local
    clock — see module docstring's ET-clock section); pass an aware
    datetime in tests.

    Returns the receipt: `{as_of, requests, chunks_failed, chunks_at_cap,
    rows_seen, rows, sessions_resolved, wrote}` — `rows` is the SAME deduped
    `{TICKER: {date, session}}` mapping written into the artifact (not merely
    its count), so a caller can verify the dedup directly off the receipt
    without re-reading the file. `chunks_at_cap` NAMES the calendar day(s)
    (ISO date strings) whose chunk returned >= `_FMP_CAP_THRESHOLD` rows —
    empty when nothing was near the cap. Those days' rows are kept, never
    dropped; the field only makes the possible truncation visible.
    """
    now = now or _now_et()
    today = now.date()
    windows = _chunk_windows(today)

    results: list[list | None] = [None] * len(windows)
    with concurrent.futures.ThreadPoolExecutor(
            max_workers=min(_FMP_CHUNK_MAX_WORKERS, len(windows))) as pool:
        future_to_idx = {pool.submit(_fetch_window, d0, d1): i
                          for i, (d0, d1) in enumerate(windows)}
        for fut in concurrent.futures.as_completed(future_to_idx):
            i = future_to_idx[fut]
            try:
                results[i] = fut.result()
            except Exception as e:  # noqa: BLE001 — a worker-thread failure isolates to its own chunk
                log.warning("[screener] earnings_dates: chunk worker failed: %s", e)
                results[i] = None

    by_sym: dict[str, dict] = {}
    requests_made = 0
    chunks_failed = 0
    rows_seen = 0
    sessions_resolved = 0
    chunks_at_cap: list[str] = []

    for (d0, d1), data in zip(windows, results):
        requests_made += 1
        if data is None:
            chunks_failed += 1
            continue
        if len(data) >= _FMP_CAP_THRESHOLD:
            label = _window_label(d0, d1)
            chunks_at_cap.append(label)
            log.warning(
                "[screener] earnings_dates: chunk %s returned %d rows (>= cap threshold %d) — "
                "FMP may have truncated this day; rows are kept but the day is suspect",
                label, len(data), _FMP_CAP_THRESHOLD)
        for row in data:
            if not isinstance(row, dict):
                continue
            rows_seen += 1
            sym = str(row.get("symbol") or "").strip().upper()
            date_raw = row.get("date")
            if not sym or not date_raw:
                continue
            try:
                rd = datetime.date.fromisoformat(str(date_raw)[:10])
            except (TypeError, ValueError):
                continue
            if rd < today:
                continue  # a past date is never "next earnings" — silently filtered, never counted as a miss
            session = _row_session(row)
            if session != "tbd":
                sessions_resolved += 1
            prev = by_sym.get(sym)
            if prev is None or rd < datetime.date.fromisoformat(prev["date"]):
                by_sym[sym] = {"date": rd.isoformat(), "session": session}

    as_of = today.isoformat()
    wrote = False
    if by_sym:
        _atomic_write({"as_of": as_of, "rows": by_sym})
        wrote = True

    receipt = {
        "as_of": as_of,
        "requests": requests_made,
        "chunks_failed": chunks_failed,
        "chunks_at_cap": chunks_at_cap,
        "rows_seen": rows_seen,
        "rows": by_sym,
        "sessions_resolved": sessions_resolved,
        "wrote": wrote,
    }
    log.info("[screener] earnings_dates pull: as_of=%s requests=%s chunks_failed=%s chunks_at_cap=%s "
             "rows_seen=%s symbols=%s sessions_resolved=%s wrote=%s",
             as_of, requests_made, chunks_failed, chunks_at_cap, rows_seen, len(by_sym),
             sessions_resolved, wrote)
    return receipt


def read_earnings_dates(targets, failures=None) -> dict:
    """`{TICKER: {"next_earnings_date": iso, "earnings_session":
    "bmo"|"amc"|"tbd"}}` for every ticker in `targets` the last pull's
    artifact has a row for.

    Healthy / missing / stale (mirrors the other Wave-2 whole-market pulls):
      - artifact absent, unreadable, or carrying no usable `rows` -> whole-
        source miss (`_note(..., "missing")`) -> `{}`.
      - artifact older than `_STALE_DAYS` -> still SERVED (counted via
        `_note(..., f"stale:{age_days}d")`, never silently swallowed).
      - a ticker absent from `rows` -> simply absent from the output — never
        a fabricated "tbd" entry for a symbol the pull never saw.
    """
    path = _artifact_path()
    try:
        with open(path) as fh:
            blob = json.load(fh)
    except (FileNotFoundError, OSError, ValueError):
        _note(failures, "earnings_dates", "missing")
        return {}
    if not isinstance(blob, dict):
        _note(failures, "earnings_dates", "missing")
        return {}
    rows = blob.get("rows")
    if not isinstance(rows, dict) or not rows:
        _note(failures, "earnings_dates", "missing")
        return {}

    age_days = None
    try:
        as_of_date = datetime.date.fromisoformat(str(blob.get("as_of"))[:10])
        age_days = (datetime.date.today() - as_of_date).days
    except (TypeError, ValueError):
        pass
    if age_days is not None and age_days > _STALE_DAYS:
        _note(failures, "earnings_dates", f"stale:{age_days}d")

    out = {}
    for t in targets:
        tu = (t or "").upper()
        entry = rows.get(tu)
        if not entry or not entry.get("date"):
            continue
        out[tu] = {"next_earnings_date": entry["date"],
                   "earnings_session": entry.get("session") or "tbd"}
    return out
