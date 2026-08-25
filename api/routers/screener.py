"""Screener + scanner surfaces — the full-market screen, the UCT scanner
candidates, and the pooled scanner universe.

⛔ EVERYTHING HERE IS PAID EXCEPT ONE DELIBERATE, TOKEN-AUTHENTICATED DOOR.
Owner ruling 2026-08-06, reaffirmed 08-07: *"everything is paid, almost nothing
is accessible for free"* — with a free trial granting paid access for a period,
which `is_paid_user` already honours (admin OR paid plan OR in-trial).

Measured 2026-08-08, before this file was gated:
  * `GET /api/candidates` answered an ANONYMOUS caller 200 with 32,610 bytes —
    the UCT scanner's candidate list, the firm's proprietary morning output.
  * `/api/screener` and `/api/scanner/universe` had no dependency at all.
  * `/api/screener/{meta,scan,snapshot-status,saved-screens}` were gated with
    `get_current_user` ONLY — "logged in" is not "paid", and a free member could
    run the whole 4,000-ticker precomputed screen.

⛔ `require_paid` IS DECLARED PER HANDLER, NOT ON THE ROUTER. `main.py` calls
`include_router(screener.router)` with no router-level dependency, so a route
that omits its own gate is reachable by anybody. The shape is copied from
`api/routers/signature.py:174`, which defines its OWN `require_paid` with its own
402 sentence and repeats it on every route — a shared dependency would change
four other routers' behaviour as a side effect of gating this one, and the
distinct sentence is what makes "which surface refused me" answerable.

⛔ AND THE COVERAGE TEST IS DERIVED FROM `router.routes` WITH THE COUNT ASSERTED —
`tests/test_scan_screener_auth.py`. Phase C Task 13 MEASURED the alternative: it
dropped `Depends(require_paid)` from `/confluence` and the shipped test stayed
GREEN because it hand-listed THREE paths while the router had FIVE.

✋ THE ONE ROUTE THAT STAYS OPEN, AND WHY.
`GET /api/screener/shared/{share_token}` is token-authenticated public sharing,
by design, not by omission:
  * `saved_screens.update` mints `share_token = secrets.token_urlsafe(8)` ONLY
    when the screen's owner sets `is_public`, and `get_public` re-checks
    `is_public=1` in the WHERE clause — so an un-shared screen is unreachable
    even with a guessed id;
  * the design doc lists it as such —
    `docs/superpowers/plans/2026-06-19-full-market-screener.md:1413`,
    "`GET /api/screener/shared/{share_token}` (public read)";
  * and it serves a saved FILTER SPEC, never scan output: no ticker rows, no
    prices, nothing the paid screen computes. A recipient still needs a paid
    plan to RUN it, because `/api/screener/scan` is gated below.
Gating it would break every share link already in the wild. It is named in
`tests/test_scan_screener_auth.py::PUBLIC_BY_DESIGN`, whose size is asserted, so
a SECOND open route cannot join it quietly.
"""
from fastapi import APIRouter, HTTPException, Body, Depends
from pydantic import BaseModel
from api.services.engine import get_screener, get_candidates
from api.services import breadth_monitor as bm_svc
from api.services.screener import (
    query as scr_query,
    filters as scr_filters,
    snapshot_db as scr_db,
    saved_screens as scr_saved,
)
from api.middleware.auth_middleware import (
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The screener requires a paid plan")
    return user


@router.get("/api/screener")
def screener(_user: dict = Depends(require_paid)):
    try:
        return get_screener()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/candidates")
def candidates(_user: dict = Depends(require_paid)):
    try:
        result = get_candidates()
        try:
            from api.routers.bars import warm_bars_async
            cands = result.get("candidates") or result
            tickers = []
            for group in cands.values():
                if isinstance(group, list):
                    for c in group:
                        sym = (c.get("sym") or c.get("ticker")) if isinstance(c, dict) else None
                        if sym:
                            tickers.append(sym.upper())
            if tickers:
                warm_bars_async(list(dict.fromkeys(tickers)), tf="D", bars=8000)
        except Exception:
            pass
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/scanner/universe")
def scanner_universe(_user: dict = Depends(require_paid)):
    """Pool all breadth list fields (52W highs, Stage 2, HVC, etc.) into a unified scanner universe."""
    try:
        return bm_svc.get_universe_stocks()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


# ─── Full-market screener (precomputed snapshot, server-side query) ───────────

class ScanSpec(BaseModel):
    filters: list[dict] = []
    sort: dict | None = None
    view: str = "overview"
    columns: list[str] | None = None
    page: int = 1
    page_size: int = 50


@router.get("/api/screener/meta")
def screener_meta(user=Depends(require_paid)):
    """Filter registry + result views + filter categories (frontend-ready)."""
    return scr_filters.meta(user_id=user["id"])


class ScreenAlertSub(BaseModel):
    def_hash: str
    def_id: str = ""
    name: str = "Untitled screen"
    mode: str = "both"


@router.get("/api/screener/methodology")
def screener_methodology(column: str = "", user=Depends(require_paid)):
    """How the composite columns are computed — benchmark metric 552.

    Zacks publishes a definition and a measured range on all 136 criteria;
    Stock Rover ships a 182-page reference and a Metric Browser. We published
    the scores and not the method, which is the family we finished LAST in.
    """
    from api.services.screener import methodology
    if column:
        found = methodology.for_column(column)
        if found is None:
            raise HTTPException(status_code=404,
                                detail=f"no published method for {column!r}")
        return found
    return methodology.all_methods()


@router.get("/api/screener/alerts")
def screener_alerts_list(user=Depends(require_paid)):
    from api.services.screener import screen_alerts
    return {"subscriptions": screen_alerts.list_subs((user or {}).get("id"))}


@router.post("/api/screener/alerts")
def screener_alerts_subscribe(body: ScreenAlertSub, user=Depends(require_paid)):
    """Be told when a name enters or leaves this screen.

    ⚠️ The diff is NIGHTLY by construction — the sweep runs once, off a 03:00
    snapshot. The copy the member receives says "overnight" for that reason.
    """
    from api.services.screener import screen_alerts
    try:
        return screen_alerts.subscribe((user or {}).get("id"), body.def_hash,
                                       body.def_id, body.name, body.mode)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/api/screener/alerts/{def_hash}")
def screener_alerts_unsubscribe(def_hash: str, user=Depends(require_paid)):
    from api.services.screener import screen_alerts
    return {"removed": screen_alerts.unsubscribe((user or {}).get("id"),
                                                 def_hash)}


@router.post("/api/screener/count")
def screener_count(spec: ScanSpec, user=Depends(require_paid)):
    """How many rows this spec would return — benchmark metric 450.

    ⛔ Same gate as `/scan` and the same `user_id` source: the spec may carry a
    `list` filter naming the member's own watchlists, so a count route reading
    the id off the body would leak exactly what the scan route refuses to.
    """
    try:
        return scr_query.preview_count(spec.model_dump(),
                                       user_id=(user or {}).get("id"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/screener/scan")
def screener_scan(spec: ScanSpec, user=Depends(require_paid)):
    try:
        # ⛔ THE USER ID COMES FROM THE DEPENDENCY, NOT THE BODY. `{key:"list"}`
        # resolves a member's own watchlists, flags and colour tags; reading the
        # id off the client-supplied spec would let any member screen any other
        # member's lists.
        return scr_query.run_scan(spec.model_dump(),
                                  user_id=(user or {}).get("id"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/screener/snapshot-status")
def screener_snapshot_status(user=Depends(require_paid)):
    """Coverage + freshness of the precomputed snapshot.

    ⭐ READ `snapshot_date` — the MEDIAN row's date, i.e. how old this data
    actually is — beside `rows_on_snapshot_date` / `rows` and the `mixed` flag.
    ⛔ `latest_snapshot_date` is the MAX and answers only *"when was the newest
    single row built?"*. It is kept because that question is real and its name
    is honest, but it is NOT the snapshot's age: measured 2026-08-09, the MAX
    was carried by ONE row out of 3,589 while 3,583 were 28 days stale, and a
    gate reading it waved a month-old universe through (E-3 report §3).

    ⭐ `live` IS THE SAME QUESTION FOR THE OTHER TIER, ON THE SAME ENDPOINT.
    During the regular session a flag-gated overlay re-derives a named subset
    of these columns from the live price. This block carries that tier's state,
    the OVERLAY's as-of, the last CYCLE's clock, and its per-cycle RECEIPT
    verbatim (`live.receipt` — the counts and the per-reason `skipped` map the
    sweeper logged), so the surface, the controller arming the flag, and this
    endpoint all read ONE source instead of three.

    ⛔ `live.as_of` AND `live.swept_at` ARE DIFFERENT FACTS — read the right one
    (spec §13 receipt 2 reads this endpoint, so getting it wrong here is what
    the controller arms against). `as_of` is when the values an overlay row
    carries were DERIVED; `swept_at` is when the last cycle ran, and every
    cycle stamps it — including the ones that skip and write nothing. At 19:24
    on a day whose last real sweep was 15:59, `swept_at` is 19:24 and `as_of`
    is 15:59 (or absent, if the newest receipt is a skip). Dating the overlay
    with `swept_at` manufactures a freshness claim four hours out.

    ⛔ IT IS ONE ENDPOINT ON PURPOSE. A separate `/live-status` beside this one
    would be a second authority over "how fresh is the screener", and the two
    would answer differently the moment a caller polled one and not the other.

    ⛔ `live.state == "unreadable"` IS NOT `"off"`. Enabled-but-unreadable means
    the overlay may be writing while this surface is blind to it; the honest
    answer is "I cannot tell", and the member-facing screen renders that as
    nightly WITH the reason rather than as silence. The whole block is built by
    `query.live_tier_state()` — read the block comment above it before changing
    any of these words.
    """
    return {**scr_db.status(), "live": scr_query.live_tier_state()}


@router.post("/api/screener/refresh")
def screener_refresh(max_tickers: int = 800, user=Depends(require_admin)):
    """Admin: warm the snapshot now (background, capped) instead of waiting for
    the 03:00 ET nightly. Returns immediately.

    Stays `require_admin` — STRICTER than paid, not an exception to it. A paid
    member gets 403 here, and that is the point: this is the only route in the
    router that spends provider budget.

    ⛔ ANSWERS `already_in_flight` RATHER THAN STARTING A SECOND ONE. Measured
    2026-08-23: this route used to spawn a thread per call with nothing stopping
    a second, and three triggers in twenty minutes produced three concurrent
    whole-universe builds that starved each other — the snapshot went five hours
    without a completed build while every call cheerfully returned
    `{"started": true}`. The guard itself lives in `snapshot_builder` (the
    nightly job is the other caller and needs the same protection); this reads
    it so the CALLER learns the truth instead of watching a timestamp that never
    moves.
    """
    import threading
    from api.services.screener import snapshot_builder
    if snapshot_builder.build_in_flight():
        return {"started": False, "already_in_flight": True,
                "detail": "a snapshot build is already running; this call did "
                          "nothing rather than start a competing one"}
    threading.Thread(
        target=lambda: snapshot_builder.run_build(max_tickers=max_tickers),
        daemon=True, name="screener-refresh").start()
    return {"started": True, "max_tickers": max_tickers}


@router.post("/api/screener/finviz-refresh")
def screener_finviz_refresh(user=Depends(require_admin)):
    """Admin: re-run the whole-market Finviz pull NOW and return its receipt
    SYNCHRONOUSLY, instead of waiting for the 02:45 ET job.

    ⭐ WHY THIS EXISTS (2026-08-23): the pull writes the artifact the 03:00
    build joins, so a code fix to `_C_IDS`/`_HEADERS` cannot reach members
    until the next nightly cycle — a header correction shipped at 10:45 sat
    dark for sixteen hours purely because nothing could re-run the pull. The
    snapshot side already had `POST /api/screener/refresh`; this is its
    missing upstream half, and the pair together turn "wait for tonight"
    into two calls.

    ⛔ SYNCHRONOUS ON PURPOSE, unlike the snapshot refresh: this is ONE
    outbound request and the whole point is to read `missing_headers` back —
    a fire-and-forget version would hand you `{"started": true}` and hide the
    exact fact you ran it for. It is `require_admin` (stricter than paid) and
    it spends provider budget, same posture as the snapshot refresh beside it.

    ⚠️ The pull's own guards still apply and are the safety net: a result
    under `_MIN_ROWS` is treated as a failed pull and the prior artifact is
    left completely alone, so the worst case of calling this is a wasted
    request, never a blanked artifact. Follow it with
    `POST /api/screener/refresh` to join the fresh columns into the rows.
    """
    from api.services.screener import finviz_universe
    return finviz_universe.run_pull()


# ─── Earnings-context diagnostic (admin, STRICTLY READ-ONLY) ─────────────────

#: How many names any one sample list in the diagnostic payload may carry. The
#: COUNT beside each sample is always the full one — a sample is for reading,
#: never for counting (`lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report`).
_EC_SAMPLE = 25

#: 🔑 THE FOUR WORLDS THIS ENDPOINT EXISTS TO TELL APART, and world 0 for the
#: case where nothing is wrong. The payload carries the NUMBER and the SENTENCE
#: off this one mapping, so the handler docstring can point at an artifact
#: instead of restating it (a restated verdict list is a second authority over
#: one value — this repo's most repeated defect).
#:
#: ⛔ THESE SENTENCES NAME NO FIELD AND NO SCHEDULE. A world is the same shape
#: for both sources; WHERE to look is not, so every pointer lives in
#: `EARNINGS_CONTEXT_POINTERS` keyed by source. One mapping used for both
#: sources is how `grade.reading` came to send an operator to
#: `implied.max_captured_at` (the grade block carries `grade.max_date`) and to
#: the implied capture's clock (the grade snapshot runs on its own, later one).
EARNINGS_CONTEXT_WORLDS = {
    0: ("HEALTHY — the store and the screener agree on real keys and the "
        "column is populated. Nothing to diagnose."),
    1: ("WORLD 1 — THE STORE IS EMPTY. Zero rows, so no join could ever hit. "
        "The writer is not running, or has never written."),
    2: ("WORLD 2 — KEYS DISAGREE. The store holds rows under keys the screener "
        "also asks about, yet not one joins. That is a normalisation/format "
        "mismatch on the SYMBOL side, not a coverage problem."),
    3: ("WORLD 3 — SCOPE MISMATCH. The store holds rows, but under keys the "
        "screener never asks about."),
    4: ("WORLD 4 — BOTH AGREE AND THE COLUMN IS STILL EMPTY. Real keys exist "
        "in both, so the loss is DOWNSTREAM of the join: the reader's wiring, "
        "an exception counted in the build's `sources`, or a build that has "
        "not re-run since the store filled."),
}

#: 🔑 WHERE TO LOOK, PER SOURCE — appended to the world sentence to make
#: `reading`. Every name here is a field this same payload carries, so a
#: pointer can be followed without a second call. The two sources share a DB
#: FILE and an enable flag and nothing else: different table, different key,
#: different writer, different schedule.
EARNINGS_CONTEXT_POINTERS = {
    "implied": {
        1: ("Read config.implied_store_enabled, config.capture_due_by_now and "
            "implied.max_captured_at (null = nothing was EVER written), then "
            "check that the capture job (config.capture_hour_et:"
            "config.capture_minute_et ET) is registered on the pod holding "
            "config.implied_store_db."),
        2: ("Read join.normalisation_gap — snapshot tickers that match the "
            "store under the WRITER's `_canon` (upper + dot→hyphen) but not "
            "under the plain `.upper()` the READER uses; a non-zero there is "
            "the bug, named — plus implied.symbols_sample and "
            "snapshot.next_earnings_dates_sample."),
        3: ("The capture only ever covers [today, "
            "today+config.capture_window_days] while the reader asks for every "
            "reporter inside 14 days — read join.dates_ask_only for what is "
            "asked and never covered, against implied.report_dates."),
        4: ("The join is (symbol, report_date) and it HITS — read "
            "`earnings_context.read_implied_context`'s wiring and the build's "
            "`sources`, and check the build has re-run since "
            "implied.max_captured_at."),
    },
    "grade": {
        1: ("Read config.implied_store_enabled, config.grade_snapshot_due_by_now "
            "and grade.max_date (null = nothing was EVER written for the asked "
            "surface), then check that the grade-snapshot job "
            "(config.grade_snapshot_hour_et:config.grade_snapshot_minute_et ET "
            "— its OWN job, later than the implied capture, same file "
            "config.implied_store_db) is registered on that pod."),
        2: ("This source carries NO date key — `_latest_grades` matches on "
            "SYMBOL alone — so 'keys' here means the symbol. Rows exist under "
            "config.grade_surface AND under "
            "grade.surfaces_present_but_not_asked, yet no symbol overlaps: "
            "read grade.symbols_sample against snapshot, and "
            "join.snapshot_tickers_in_grade_store."),
        3: ("Rows exist under grade.surface_asked and not one symbol overlaps "
            "the snapshot — read grade.symbols_sample, "
            "grade.rows_by_date_recent and config.grade_snapshot_max_symbols "
            "(the snapshot is capped, so a name outside the cap is never "
            "graded at all)."),
        4: ("The symbol join HITS — read `earnings_context._latest_grades`'s "
            "wiring and the build's `sources`, and check the build has re-run "
            "since grade.max_date."),
    },
}


def _ec_ro_sqlite(path: str):
    """Open `path` STRICTLY for reading. Returns ``(conn, readonly, error)``.

    ``mode=ro`` refuses to CREATE the file, which is what makes this route's
    "no writes" property structural rather than a promise. A WAL database whose
    -wal still needs recovery can refuse a pure read-only handle; in that one
    case a normal handle is used instead, but ONLY when the file already exists
    — nothing here can ever bring a database into being, and the payload says
    which of the two happened (`readonly_open`).
    """
    import os
    import sqlite3
    if not os.path.exists(path):
        return None, None, f"no such file: {path}"
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        return conn, True, None
    except sqlite3.Error as ro_err:
        try:
            conn = sqlite3.connect(path, timeout=5)
            conn.row_factory = sqlite3.Row
            return conn, False, None
        except sqlite3.Error as rw_err:  # pragma: no cover — both opens failing
            return None, None, f"{type(ro_err).__name__}: {ro_err} / {rw_err}"


def _ec_implied_facts(conn) -> dict:
    """What `implied_snapshots` actually holds — counts, extremes, and the KEY
    SET (`report_dates`) the join depends on. Everything is read off the table;
    nothing is inferred."""
    import sqlite3
    try:
        head = conn.execute(
            "SELECT COUNT(*) AS rows, COUNT(DISTINCT sym) AS syms, "
            "MAX(captured_at) AS max_captured_at, MIN(report_date) AS min_rd, "
            "MAX(report_date) AS max_rd FROM implied_snapshots").fetchone()
        by_date = conn.execute(
            "SELECT report_date, COUNT(*) AS n FROM implied_snapshots "
            "GROUP BY report_date ORDER BY report_date").fetchall()
        syms = [r["sym"] for r in
                conn.execute("SELECT DISTINCT sym FROM implied_snapshots ORDER BY sym")]
        pairs = {(r["sym"], r["report_date"]) for r in
                 conn.execute("SELECT sym, report_date FROM implied_snapshots")}
    except sqlite3.Error as e:
        return {"readable": False, "error": f"{type(e).__name__}: {e}",
                "rows": None, "report_dates": [], "_syms": set(), "_pairs": set()}
    return {
        "readable": True, "error": None,
        "rows": head["rows"], "symbols": head["syms"],
        "max_captured_at": head["max_captured_at"],
        "min_report_date": head["min_rd"], "max_report_date": head["max_rd"],
        "rows_by_report_date": {r["report_date"]: r["n"] for r in by_date},
        "report_dates": [r["report_date"] for r in by_date],
        "symbols_sample": syms[:_EC_SAMPLE],
        "_syms": set(syms), "_pairs": pairs,
    }


def _ec_grade_facts(conn, surface: str) -> dict:
    """The SEPARATE grade source, in the same shape. ⛔ `grade_snapshots` is not
    the implied-move store's table in disguise: it has its own writer
    (`setup_grade.run_daily_grade_snapshot`), its own schedule (16:40 ET) and
    its own key (`surface`). `rows_by_surface` is here because a grade written
    under a surface the reader does not ask for is world 2 for THIS source and
    invisible from the implied side."""
    import sqlite3
    try:
        head = conn.execute(
            "SELECT COUNT(*) AS rows, COUNT(DISTINCT sym) AS syms, MAX(date) AS max_date "
            "FROM grade_snapshots WHERE surface = ?", (surface,)).fetchone()
        all_surfaces = conn.execute(
            "SELECT surface, COUNT(*) AS n, MAX(date) AS max_date FROM grade_snapshots "
            "GROUP BY surface ORDER BY surface").fetchall()
        by_date = conn.execute(
            "SELECT date, COUNT(*) AS n FROM grade_snapshots WHERE surface = ? "
            "GROUP BY date ORDER BY date DESC LIMIT 14", (surface,)).fetchall()
        syms = [r["sym"] for r in conn.execute(
            "SELECT DISTINCT sym FROM grade_snapshots WHERE surface = ? ORDER BY sym",
            (surface,))]
    except sqlite3.Error as e:
        return {"readable": False, "error": f"{type(e).__name__}: {e}",
                "surface_asked": surface, "rows": None, "_syms": set()}
    return {
        "readable": True, "error": None,
        "surface_asked": surface,
        "rows": head["rows"], "symbols": head["syms"], "max_date": head["max_date"],
        "rows_by_surface": {r["surface"]: r["n"] for r in all_surfaces},
        "surfaces_present_but_not_asked": sorted(
            r["surface"] for r in all_surfaces if r["surface"] != surface),
        "rows_by_date_recent": {r["date"]: r["n"] for r in by_date},
        "symbols_sample": syms[:_EC_SAMPLE],
        "_syms": set(syms),
    }


def _ec_snapshot_facts(conn) -> dict:
    """The member-facing side: how empty the two columns actually are, and the
    screener's OWN forward earnings dates.

    ⭐ `next_earnings_date` is a provider-FREE proxy for what the join wants —
    it is written by `earnings_dates` (a different reader from
    `implied_store.upcoming_reporters`) and is therefore reported as a
    CORROBORATING probe, never as the reader's own ask. It is what makes this
    endpoint answer on a cold reporter cache instead of shrugging.
    """
    import sqlite3
    try:
        head = conn.execute(
            "SELECT COUNT(*) AS rows, "
            "SUM(implied_move_pct IS NOT NULL) AS implied_non_null, "
            "SUM(earnings_setup_grade IS NOT NULL) AS grade_non_null, "
            "SUM(next_earnings_date IS NOT NULL) AS ned_non_null "
            "FROM screener_rows").fetchone()
        rows = conn.execute(
            "SELECT ticker, next_earnings_date FROM screener_rows "
            "WHERE next_earnings_date IS NOT NULL").fetchall()
        tickers = [r["ticker"] for r in conn.execute(
            "SELECT ticker FROM screener_rows WHERE ticker IS NOT NULL")]
    except sqlite3.Error as e:
        return {"readable": False, "error": f"{type(e).__name__}: {e}",
                "rows": None, "_pairs": set(), "_tickers": set(),
                "next_earnings_dates": []}
    dates = sorted({r["next_earnings_date"] for r in rows})
    return {
        "readable": True, "error": None,
        "rows": head["rows"],
        "implied_move_pct_non_null": head["implied_non_null"] or 0,
        "earnings_setup_grade_non_null": head["grade_non_null"] or 0,
        "next_earnings_date_non_null": head["ned_non_null"] or 0,
        "next_earnings_date_count": len(dates),
        "next_earnings_dates_sample": dates[:_EC_SAMPLE],
        "_pairs": {((r["ticker"] or "").upper(), r["next_earnings_date"]) for r in rows},
        "_tickers": {(t or "").upper() for t in tickers},
        "_dates": set(dates),
    }


def _ec_reporter_ask(implied_store, today_iso: str) -> dict:
    """The (symbol, report_date) pairs `earnings_context.read_implied_context`
    WOULD ask the store for — read out of `implied_store`'s OWN reporter cache.

    ⭐ THE PAIRS, NOT JUST THE DATES. The reader builds
    `report_date_by_sym[sym.upper()] = rep["report_date"]` and looks that pair
    up in `get_implied_for_date`, so a date-only ask can name the right world
    for the wrong reason: the snapshot's `next_earnings_date` comes from a
    DIFFERENT reader (`earnings_dates`) and can carry a different forward date
    for the same symbol. Both normalisations are the READER's (`.upper()`),
    never the writer's — the writer/reader gap is measured separately as
    `join.normalisation_gap`.

    ⛔ NO PROVIDER CALL. `upcoming_reporters` fetches on a miss, so this peeks
    at the cache the store itself populates (16:35 capture, 16:40 grade
    snapshot, 03:00 build) rather than calling it. The keys found are REPORTED,
    not assumed, so a cache-key format that drifts is visible in the payload
    instead of silently reading as "cold". A cold cache is answered honest-None
    (`report_dates: null`), never a fabricated empty set — and the verdict then
    falls back to the snapshot's own forward dates, which is stated in
    `join.basis`.
    """
    cache = implied_store._REPORTERS_CACHE
    prefix = "impstore::reporters::"
    try:
        keys = sorted(cache.keys_with_prefix(prefix))
    except Exception:  # noqa: BLE001 — a diagnostic must never fail on its own probe
        keys = []
    # `read_implied_context` asks for days=14; prefer that entry for today, then
    # any entry for today. `cache.get` is the cache's OWN expiry authority — the
    # one and only side effect anywhere in this route is its expiry reap.
    ordered = ([k for k in keys if k.endswith("::" + today_iso) and "::14::" in k]
               + [k for k in keys if k.endswith("::" + today_iso) and "::14::" not in k])
    for key in ordered:
        reporters = cache.get(key)
        if not reporters:
            continue
        dates = sorted({r.get("report_date") for r in reporters if r.get("report_date")})
        syms = {(r.get("sym") or "").upper() for r in reporters if r.get("sym")}
        pairs = {((r.get("sym") or "").upper(), r.get("report_date"))
                 for r in reporters if r.get("sym") and r.get("report_date")}
        return {"state": "warm", "key_used": key, "keys_present": keys,
                "reporters": len(reporters), "symbols": len(syms),
                "report_dates": dates, "pairs": len(pairs),
                "_dates": set(dates), "_syms": syms, "_pairs": pairs}
    return {"state": "cold", "key_used": None, "keys_present": keys,
            "reporters": None, "symbols": None, "report_dates": None,
            "pairs": None, "_dates": None, "_syms": None, "_pairs": None,
            "note": ("no live reporter list is cached for today, and this route "
                     "will not call a provider to make one. The store's own jobs "
                     "warm it and it holds for 6h; until then the whole verdict "
                     "— dates AND (symbol, date) pairs — is computed against the "
                     "snapshot's own next_earnings_date set, which is a "
                     "different reader. See join.basis / join.pairs_basis.")}


def _ec_reading(source: str, world: int) -> str:
    """The world sentence plus THAT SOURCE's pointer — the one place the two
    mappings are joined, so neither can be shipped without the other."""
    pointer = EARNINGS_CONTEXT_POINTERS.get(source, {}).get(world)
    sentence = EARNINGS_CONTEXT_WORLDS[world]
    return f"{sentence} {pointer}" if pointer else sentence


def _ec_verdict(*, source, readable, snapshot_readable, store_rows, snapshot_rows,
                dates_overlap, join_hits, column_non_null):
    """The four-worlds decision, as ONE pure function so both sources are judged
    by the same rule and the rule can be tested without a database.

    Returns ``(world, sentence)`` — the sentence off `EARNINGS_CONTEXT_WORLDS`
    with `source`'s own pointer appended; ``(None, …)`` when the inputs cannot
    support a verdict at all.

    ⛔ `snapshot_readable` IS SEPARATE FROM `snapshot_rows`. `_ec_snapshot_facts`
    answers an unreadable snapshot honest-None (`rows: None`), which the
    emptiness branch cannot tell apart from a genuinely empty table — so
    checking it there would name "the snapshot is empty" as the cause of a
    sqlite error. An unreadable source is checked the same way, first.
    """
    if not readable:
        return None, ("UNDECIDABLE — the source could not be read; see its "
                      "`error`. Nothing below this line means anything yet.")
    if not snapshot_readable:
        return None, ("UNDECIDABLE — the screener snapshot could not be READ "
                      "(which is not the same fact as its being empty); see "
                      "`snapshot.error`.")
    if not snapshot_rows:
        return None, ("UNDECIDABLE — the screener snapshot itself is empty, so "
                      "there is no member-facing column to explain.")
    if not store_rows:
        return 1, _ec_reading(source, 1)
    if join_hits:
        return (0, _ec_reading(source, 0)) if column_non_null else (4, _ec_reading(source, 4))
    return (2, _ec_reading(source, 2)) if dates_overlap else (3, _ec_reading(source, 3))


@router.get("/api/screener/earnings-context-status")
def screener_earnings_context_status(user=Depends(require_admin)):
    """Admin: WHY are `implied_move_pct` and `earnings_setup_grade` empty?

    ⭐ WHY THIS EXISTS (2026-08-23): those two are the last empty columns in the
    snapshot — non-null on 0 of 3,745 prod rows — and a flagship starter
    (`starter_earnings_momentum`) had to stop filtering on the first one because
    the clause was an unsatisfiable AND. Nobody could say WHY: `railway ssh` is
    blocked in this environment and there is no HTTP surface over
    `implied_store`, so the question was unanswerable rather than merely
    unanswered. This is that surface.

    ⛔ STRICTLY READ-ONLY, AND STRUCTURALLY SO. Every database is opened
    `mode=ro` (which refuses to create a file), no `_ensure_init` / `init_db` is
    called, and NO provider is contacted — the reporter list is PEEKED out of
    `implied_store`'s own TTL cache, never fetched. The single side effect
    anywhere in this handler is that cache's own expiry reap on read.

    ⛔ IT OBSERVES AND DOES NOT REPAIR. A diagnostic that also changes behaviour
    cannot be trusted to describe it.

    🔑 HOW TO READ THE ANSWER — `implied.world` / `grade.world` carry a number
    and a `reading`: the world sentence out of `EARNINGS_CONTEXT_WORLDS` plus
    THAT SOURCE's pointer out of `EARNINGS_CONTEXT_POINTERS`. Both mappings
    ship whole in the payload (`worlds`, `world_pointers`); they are the ONE
    place those readings are written down, so this docstring names no field —
    restating them here is how the grade lane came to be told to read a field
    only the implied lane carries. `implied.max_captured_at` is read straight
    off the table because the store's `latest_capture_date` helper runs
    `_ensure_init` and would WRITE schema.

    ⚠️ TWO SOURCES, JUDGED SEPARATELY. `implied_move_pct` comes from
    `implied_snapshots` keyed by (sym, report_date); `earnings_setup_grade`
    comes from `grade_snapshots` keyed by (sym, date, surface) with a different
    writer and a different schedule. They are reported side by side and never
    merged — one filling tells you nothing about the other.

    ⭐ THE VERDICT IS COMPUTED AGAINST ONE ARTIFACT ON BOTH AXES, and it says
    which. A warm reporter cache is the reader's OWN source, so the dates AND
    the (symbol, date) pairs both come from it. Only on a cold cache does the
    snapshot's `next_earnings_date` — written by `earnings_dates`, a different
    reader — stand in, which is what lets this route answer at all without
    calling a provider. Mixing the two (reader dates, snapshot pairs) would
    name the wrong world in exactly the case this endpoint exists to resolve:
    the same symbol carrying a different forward date on each side reads as
    "the dates agree and the symbols do not". `join.basis` and
    `join.pairs_basis` name the artifact behind each axis, and the other side's
    counts ship BESIDE them (`join.snapshot_*`) as a corroborating probe.
    """
    import datetime as dt
    import os

    from api.services import implied_store, setup_grade
    from api.services.screener import snapshot_db as _scr_db

    now_et = dt.datetime.now(implied_store._ET)
    surface = setup_grade.SURFACE

    # ── the two stores, both read-only ───────────────────────────────────────
    imp_conn, imp_ro, imp_err = _ec_ro_sqlite(implied_store.DB_PATH)
    if imp_conn is None:
        implied = {"readable": False, "error": imp_err, "rows": None,
                   "report_dates": [], "_syms": set(), "_pairs": set()}
        grades = {"readable": False, "error": imp_err, "surface_asked": surface,
                  "rows": None, "_syms": set()}
    else:
        try:
            implied = _ec_implied_facts(imp_conn)
            grades = _ec_grade_facts(imp_conn, surface)
        finally:
            imp_conn.close()
        implied["readonly_open"] = imp_ro

    scr_path = _scr_db.get_db_path()
    scr_conn, scr_ro, scr_err = _ec_ro_sqlite(scr_path)
    if scr_conn is None:
        snapshot = {"readable": False, "error": scr_err, "rows": None,
                    "_pairs": set(), "_tickers": set(), "_dates": set()}
    else:
        try:
            snapshot = _ec_snapshot_facts(scr_conn)
        finally:
            scr_conn.close()
        snapshot["readonly_open"] = scr_ro

    # ── what the screener's own path WOULD ask for ───────────────────────────
    # `upcoming_reporters` keys its cache off a NAIVE local date, so the peek
    # has to use the same clock or it would look permanently cold.
    ask = _ec_reporter_ask(implied_store, dt.datetime.now().date().isoformat())

    # ── the join, both ways ──────────────────────────────────────────────────
    # ⛔ ONE ARTIFACT DECIDES BOTH AXES. A warm reporter cache is the reader's
    # own source, so it supplies the dates AND the (symbol, date) pairs; only a
    # cold one falls back to the snapshot's `next_earnings_date`, for BOTH. A
    # split basis (reader dates, snapshot pairs) turns "the same symbol carries
    # a different forward date on each side" into a false WORLD 2 — the exact
    # confusion this endpoint exists to remove.
    store_dates = set(implied.get("report_dates") or [])
    snap_dates = snapshot.get("_dates") or set()
    snap_pairs = snapshot.get("_pairs") or set()
    ask_dates = ask.get("_dates")
    ask_pairs = ask.get("_pairs")
    if ask_dates is None:
        basis = ("snapshot.next_earnings_date — the live reporter list is not "
                 "cached and this route will not fetch one")
        pairs_basis = basis
        compare_dates = snap_dates
        compare_pairs = snap_pairs
    else:
        basis = "implied_store.upcoming_reporters (cached) — the reader's own source"
        pairs_basis = ("implied_store.upcoming_reporters (cached) — (sym.upper(), "
                       "report_date) built the way `read_implied_context` builds it")
        compare_dates = ask_dates
        compare_pairs = ask_pairs
    join = {
        "basis": basis,
        "pairs_basis": pairs_basis,
        "dates_in_both": sorted(store_dates & compare_dates),
        "dates_ask_only": sorted(compare_dates - store_dates)[:_EC_SAMPLE],
        "dates_store_only": sorted(store_dates - compare_dates)[:_EC_SAMPLE],
        "dates_in_both_count": len(store_dates & compare_dates),
        "dates_ask_only_count": len(compare_dates - store_dates),
        "dates_store_only_count": len(store_dates - compare_dates),
    }

    # Pair-level: the actual (symbol, date) join, plus the normalisation the
    # WRITER uses vs the one the READER uses. `_canon` is imported, never
    # re-implemented — a second copy of that rule is how the two sides drift.
    store_pairs = implied.get("_pairs") or set()
    pair_hits = sorted(compare_pairs & store_pairs)
    canon_pairs = {(implied_store._canon(t), d) for t, d in compare_pairs}
    canon_hits = canon_pairs & store_pairs
    store_syms = implied.get("_syms") or set()
    snap_tickers = snapshot.get("_tickers") or set()
    canon_tickers = {implied_store._canon(t) for t in snap_tickers}
    join["pairs_joining_reader_normalisation"] = len(pair_hits)
    join["pairs_joining_writer_normalisation"] = len(canon_hits)
    join["pairs_sample"] = [f"{s}@{d}" for s, d in pair_hits[:_EC_SAMPLE]]
    join["normalisation_gap"] = len(canon_hits) - len(pair_hits)
    join["snapshot_tickers_in_implied_store"] = len(snap_tickers & store_syms)
    join["snapshot_tickers_in_implied_store_canon"] = len(canon_tickers & store_syms)
    grade_syms = grades.get("_syms") or set()
    # The grade join is symbol-only and the reporter list is not its ask — the
    # reader hands `_latest_grades` the BUILD's tickers — so this axis stays on
    # the snapshot's tickers whatever the reporter cache is doing.
    join["snapshot_tickers_in_grade_store"] = len(snap_tickers & grade_syms)
    if ask_dates is not None:
        # Reported BESIDE the verdict basis, never folded into it: the reader's
        # own ask and the snapshot's forward dates are two different artifacts,
        # and a disagreement between them is itself a finding.
        join["snapshot_dates_in_store"] = len(store_dates & snap_dates)
        join["snapshot_dates_ask_only"] = len(snap_dates - store_dates)
        join["snapshot_pairs_in_store"] = len(snap_pairs & store_pairs)
        join["pairs_ask_only_snapshot_disagrees"] = len(
            {(s, d) for s, d in compare_pairs
             if s in {t for t, _ in snap_pairs} and (s, d) not in snap_pairs})

    # ── the two verdicts ─────────────────────────────────────────────────────
    imp_world, imp_reading = _ec_verdict(
        source="implied",
        readable=implied.get("readable"),
        snapshot_readable=snapshot.get("readable"),
        store_rows=implied.get("rows") or 0,
        snapshot_rows=snapshot.get("rows") or 0,
        dates_overlap=join["dates_in_both_count"],
        join_hits=len(pair_hits),
        column_non_null=snapshot.get("implied_move_pct_non_null") or 0,
    )
    # The grade join carries NO date key — `_latest_grades` matches on symbol
    # alone — so "keys agree" for this source means the surface exists, and the
    # join hit is a symbol overlap.
    grd_world, grd_reading = _ec_verdict(
        source="grade",
        readable=grades.get("readable"),
        snapshot_readable=snapshot.get("readable"),
        store_rows=grades.get("rows") or 0,
        snapshot_rows=snapshot.get("rows") or 0,
        dates_overlap=bool(grades.get("surfaces_present_but_not_asked")),
        join_hits=join["snapshot_tickers_in_grade_store"],
        column_non_null=snapshot.get("earnings_setup_grade_non_null") or 0,
    )

    for d in (implied, grades, snapshot):
        for k in [k for k in d if k.startswith("_")]:
            d.pop(k)

    return {
        "generated_at": now_et.isoformat(timespec="seconds"),
        "implied": {**implied, "world": imp_world, "reading": imp_reading},
        "grade": {**grades, "world": grd_world, "reading": grd_reading},
        "snapshot": snapshot,
        "screener_ask": {k: v for k, v in ask.items() if not k.startswith("_")},
        "join": join,
        "config": {
            "implied_store_enabled": os.environ.get("IMPLIED_STORE_ENABLED"),
            "implied_store_db": implied_store.DB_PATH,
            "screener_db": scr_path,
            "capture_hour_et": implied_store.CAPTURE_HOUR_ET,
            "capture_minute_et": implied_store.CAPTURE_MINUTE_ET,
            "capture_window_days": os.environ.get("IMPLIED_CAPTURE_WINDOW_DAYS", "1"),
            "capture_due_by_now": implied_store.capture_due_by(now_et),
            "grade_surface": surface,
            "grade_snapshot_hour_et": setup_grade.GRADE_SNAPSHOT_HOUR_ET,
            "grade_snapshot_minute_et": setup_grade.GRADE_SNAPSHOT_MINUTE_ET,
            "grade_snapshot_due_by_now": setup_grade.grade_snapshot_due_by(now_et),
            "grade_snapshot_max_symbols": setup_grade.MAX_SNAPSHOT_SYMBOLS,
        },
        "worlds": EARNINGS_CONTEXT_WORLDS,
        "world_pointers": EARNINGS_CONTEXT_POINTERS,
    }


@router.get("/api/screener/saved-screens")
def screener_saved_list(user=Depends(require_paid)):
    scr_saved.init()
    return {"saved": scr_saved.list_for(user["id"]), "starters": scr_saved.starters()}


@router.post("/api/screener/saved-screens")
def screener_saved_create(payload: dict = Body(...), user=Depends(require_paid)):
    scr_saved.init()
    if not payload.get("name") or payload.get("spec") is None:
        raise HTTPException(status_code=400, detail="name and spec required")
    return scr_saved.create(user["id"], payload["name"], payload["spec"],
                            bool(payload.get("is_public")))


@router.put("/api/screener/saved-screens/{sid}")
def screener_saved_update(sid: int, payload: dict = Body(...), user=Depends(require_paid)):
    rec = scr_saved.update(sid, user["id"], **payload)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    return rec


@router.delete("/api/screener/saved-screens/{sid}")
def screener_saved_delete(sid: int, user=Depends(require_paid)):
    return {"deleted": scr_saved.delete(sid, user["id"])}


@router.get("/api/screener/shared/{share_token}")
def screener_shared(share_token: str):
    """✋ PUBLIC BY DESIGN — the token IS the credential. See the module docstring:
    the token only exists for a screen its owner marked public, `get_public`
    re-checks `is_public=1`, and the payload is a filter SPEC, not scan output.
    Do NOT add `Depends(require_paid)` here — it would break every share link
    already in the wild."""
    rec = scr_saved.get_public(share_token)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    return rec
