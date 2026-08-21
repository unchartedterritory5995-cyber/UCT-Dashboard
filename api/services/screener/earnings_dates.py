"""Nightly FMP earnings-calendar pull — chunked past the 4,000-row silent
truncation.

Why chunked: a single `stable/earnings-calendar` call spanning multiple days
silently truncates at a MEASURED ~4,000-row response cap, and the truncation
is not date-fair — see `implied_store._fmp_reporters`'s docstring for the
live-probe numbers: a call spanning `[today, today+1]` returned EXACTLY 4000
rows with ZERO of them dated `today` (the whole earlier day dropped, not
merely thinned), and a 14-day-wide call dropped days 0-1 entirely while
concentrating rows on days 7-14. Splitting the pull into 7-day chunks over the
next 84 days (12 requests total) keeps every single call's own volume safely
under the cap regardless of which days are busy — this is the ENTIRE reason
this module chunks instead of firing one wide request.

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
import datetime
import json
import logging
import os

log = logging.getLogger(__name__)

_CHUNK_DAYS = 7
_TOTAL_DAYS = 84
_STALE_DAYS = 4  # served but counted once the artifact ages past this — mirrors finviz_universe's threshold


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
    """`total_days // chunk_days` contiguous, non-overlapping `chunk_days`-wide
    windows covering `[start, start + total_days - 1]` — with the defaults,
    12 windows of 7 calendar days each, exactly covering the next 84 days.
    Each call to FMP stays scoped to one window's own (small) volume, which
    is the entire point (see the module docstring)."""
    windows = []
    n = total_days // chunk_days
    for i in range(n):
        d0 = start + datetime.timedelta(days=i * chunk_days)
        d1 = d0 + datetime.timedelta(days=chunk_days - 1)
        windows.append((d0, d1))
    return windows


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
    (12 requests, 7 days each — see module docstring). EARLIEST FUTURE report
    date per symbol wins. Writes the artifact atomically ONLY when at least
    one symbol was found — an empty/total-failure result never overwrites a
    prior good artifact (the same direction as every other Wave-2 pull).
    Never raises: one bad chunk costs only that chunk's rows, never the run.

    Returns the receipt: `{as_of, requests, chunks_failed, rows_seen, rows,
    sessions_resolved, wrote}` — `rows` is the SAME deduped `{TICKER: {date,
    session}}` mapping written into the artifact (not merely its count), so a
    caller can verify the dedup directly off the receipt without re-reading
    the file.
    """
    from api.services import earnings_estimates

    now = now or datetime.datetime.now()
    today = now.date()
    windows = _chunk_windows(today)

    by_sym: dict[str, dict] = {}
    requests_made = 0
    chunks_failed = 0
    rows_seen = 0
    sessions_resolved = 0

    for d0, d1 in windows:
        requests_made += 1
        try:
            data = earnings_estimates._fmp_get(
                "/stable/earnings-calendar",
                {"from": d0.isoformat(), "to": d1.isoformat()})
        except Exception as e:  # noqa: BLE001 — one chunk's failure must never kill the batch
            log.warning("[screener] earnings_dates: chunk %s..%s raised: %s", d0, d1, e)
            chunks_failed += 1
            continue
        if not isinstance(data, list):
            chunks_failed += 1
            continue
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
        "rows_seen": rows_seen,
        "rows": by_sym,
        "sessions_resolved": sessions_resolved,
        "wrote": wrote,
    }
    log.info("[screener] earnings_dates pull: as_of=%s requests=%s chunks_failed=%s "
             "rows_seen=%s symbols=%s sessions_resolved=%s wrote=%s",
             as_of, requests_made, chunks_failed, rows_seen, len(by_sym),
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
