"""Nightly builder: one precomputed screener row per ticker.

``build_row`` is pure (takes already-column-keyed dicts) and unit-tested.
The ``_read_*`` wrappers reuse data we ALREADY store — NO yfinance:
  - bars     -> ``bars_sqlite.get_bars`` (tuples -> dicts); technicals/candles/patterns
  - ratings  -> ``research_ratings.db`` stored metrics -> ``enrich.ratings_fields``
                (eps/rev growth, peg, fwd P/E, margin, ROE, accdis + computed
                 uct_composite via the same percentile path as the research page;
                 Wave 2 adds the rating_eps/growth/value/smr components,
                 sector_rs_pct and sponsorship — see that module's docstring)
  - RS       -> ``rs_ranking``'s warmed universe rankings (``rs_rank``/``rs_return``);
                computes once on a cold cache — see ``_read_rs_map``
  - meta     -> ``ticker_meta`` cache (name/sector/industry)
  - mkt cap  -> ``massive.get_market_cap`` (Massive ticker details)
  - bulk fun -> ``fundamentals_bulk.fetch_bulk`` — the ten Group-A columns
                (dividend_yield/pe_ttm/ps/pb/gross_margin/net_margin/roa/
                 debt_to_equity/current_ratio/beta) plus ``exchange``, from
                THREE FMP bulk endpoints in SIX requests for the whole market.
                ⭐ Not per-ticker: the research page computes the same figures
                one symbol at a time, and doing that here would be ~3,700
                provider calls a night.
  - market    -> six Wave 2 whole-market/nightly readers, each ONE read per
                build, merged per-ticker into ``market_row``: ``finviz_universe``
                (float/short/ownership incl. ``inst_pct``, its sole writer now
                that ``enrich.ratings_fields`` handed it over), ``earnings_dates``
                (next earnings date/session), ``earnings_context`` (last-report
                move + implied move/setup grade — two readers, two stores),
                ``analyst_pass`` (consensus/price-target/grade-actions/eps
                growth — ``pt_upside_pct`` is derived HERE from ``pt_target``
                and the bar-derived ``price``, beside ``dollar_vol_30d``), and
                ``insider_capture`` (days since the latest cluster buy).
  - patterns/flow -> three Wave 5 readers, same ``market_row`` merge, ONE
                read per build each: ``pattern_join`` (active 7-day
                pattern-engine detections + regime-blind expectancy — its two
                CARRIER keys ``pattern_entry_px``/``pattern_stop_px`` never
                become columns; ``pattern_entry_dist_pct``/
                ``pattern_stop_dist_pct`` are derived HERE, beside
                ``pt_upside_pct``, from those carriers and the bar-derived
                ``price``), ``darkpool_agg`` (block-print notional/prints +
                signature-DPL distance — needs last night's close, read via
                ONE ``screener_rows`` query into ``prev_closes`` before the
                per-ticker loop), and ``opt_flow`` (the flow-worker's
                per-ticker options aggregate, bridged via R2).

🔴 EVERY COLUMN THIS BUILDER CAN WRITE IS COUNTED, AND THE COUNTS ARE THE
RETURN VALUE. On 2026-08-09 the 03:05 build wrote 3,708 rows in which
``market_cap`` was NULL on **every single one** — not because the code was
wrong (it fills 15/15 when exercised) but because the process had no
``MASSIVE_API_KEY``, so ``_read_fundamentals``'s ``except Exception: pass``
swallowed the same ``RuntimeError`` 3,708 times and the build logged
``built=3708 skipped=0 errors=0``. A total provider outage and a healthy run
printed the SAME LINE. `run_build` now returns ``populated`` (per-column
non-null counts) and ``sources`` (per-reader failure counts) and logs any
column that came out 0/N by NAME. See ``tests/test_scalar_population_rail.py``.
"""
import datetime
import logging
import os
import threading
import time

from . import (snapshot_db, candles, bar_character, bases, technicals, enrich, setup_score,
              context_joins, finviz_universe, earnings_dates, earnings_context,
              analyst_pass, insider_capture, pattern_join, darkpool_agg, opt_flow)

log = logging.getLogger(__name__)


# ── the row's price date, and how old is too old ──────────────────────────────
#
# 🔴 THE DEFECT THIS SECTION EXISTS FOR (accuracy audit 2026-08-23, #4).
# `price` is the last daily close we hold, stamped beside `bars_asof`, and
# NOTHING gated on that stamp. Measured on `C:\data\screener.db`,
# `snapshot_date='2026-08-23'`: **805 of 3,707 rows (21.7%) carry bars older
# than 2026-08-01**, RDDT publishes $174.96 off a 2026-06-18 bar, BABA $112.33
# off 2026-07-10. Ages in weekday sessions behind 2026-08-23, all 3,714 rows:
# 2,749 at 0 · 137 at 1 · 5 at 2-9 · 11 at 10-20 · **812 at 21+**. A healthy row
# is 0-1 sessions behind and then there is a cliff.
#
# ⭐ WHAT IS AND IS NOT WITHHELD, AND WHY — this is a definition choice, so it
# is written down rather than left in the diff:
#
#   * A stale row's BAR-DERIVED family (price, the MAs, RSI, the 52-week and
#     20-day extremes, `dollar_vol_30d`) is KEPT. Every one of those is measured
#     at the SAME `bars_asof`, so the family is internally consistent — it is
#     *stale*, not *wrong*, and for the 961-of-965 stale rows that have no newer
#     bar anywhere in `bars.db` (delisted/halted) the last close is the only
#     honest number that will ever exist. Withholding it would delete the record
#     rather than date it. What those rows are owed is a LABEL, and the label
#     already exists per row: `bars_asof`. Publishing it to a member is a read-
#     path job (see this module's report) — deleting the value here would put
#     the label permanently out of reach.
#   * A stale row's CROSS-CLOCK derivations are WITHHELD. `pt_upside_pct` and
#     `pattern_entry_dist_pct`/`pattern_stop_dist_pct` are the only three
#     columns this builder computes by dividing a CURRENT-clock number (last
#     night's analyst target; a detection from the last 7 days) by the row's
#     `price`. Those are not stale, they are *arithmetic between two different
#     dates* — a confident percentage that describes no session that ever
#     happened. An honest absence beats it, and the coverage line already knows
#     how to say "not computable".
#   * WHAT IT COSTS THE OTHER SIDE: a name halted for three weeks that resumes
#     trading loses its analyst-upside and pattern-distance columns until the
#     next build catches its bars up. Measured cost on the current snapshot at
#     the shipped threshold: **0 rows** (`pt_upside_pct` is 0/3,714 non-null on
#     this box — no `FMP_API_KEY`; `pattern_entry_dist_pct` is 2,889/3,714
#     non-null and exactly **2** of those rows are more than 5 sessions stale,
#     0 more than 10). The gate cannot fire on a healthy row: the nearest
#     populated age bucket below it holds 5 rows.


def stale_price_sessions() -> int:
    """Completed sessions after which this builder stops dividing a
    current-clock number by the row's ``price``.

    ⛔ THIS IS DELIBERATELY NOT ``live_tier.max_anchor_age_sessions()`` (5),
    and the two must not be merged. That one answers *"may we hang a LIVE TICK
    on this level"* — an intraday question about whether a level still describes
    the tape. This one answers *"may we divide last night's analyst target by
    this price"* — a nightly question about two clocks in one row. They will
    usually sit close together and are allowed to move apart; wiring the live
    sweeper's tuning knob to what the nightly build publishes is the
    second-authority-over-one-value defect in a new place.

    10 is chosen off the measured distribution above: it sits inside the gap
    between the healthy population (2,886 of 3,714 rows at ≤1 session) and the
    coverage-hole population (812 rows at 21+), so any value in 5..20 separates
    them and none of them can misfire on a normal weekend or holiday.
    """
    try:
        return int(os.environ.get("SCREENER_STALE_PRICE_SESSIONS") or 10)
    except (TypeError, ValueError):
        return 10


def _asof_of(usable_bars_list):
    """``bars_asof`` for an ALREADY-SANITIZED bar list — the ONE expression
    that turns bars into the row's price date, so nothing computes a second
    answer to *"what day is this row's price from?"*"""
    if not usable_bars_list:
        return None
    t = usable_bars_list[-1].get("t")
    return str(t) if t is not None else None


def anchor_asof(bars):
    """The ``bars_asof`` a row built from these RAW bars will carry.

    For the one caller that has to know a row's price date BEFORE ``build_row``
    runs (``_run_build_locked``, deciding whether to hand a stale close to
    ``massive.get_market_cap``'s shares×price fallback). It reruns the same pure
    filter ``build_row`` applies — ``usable_bars(bars[-400:])`` — and funnels
    through the same ``_asof_of``, so the two cannot disagree.
    ``test_the_market_cap_price_is_the_row_s_own_price`` is the rail on that.
    """
    return _asof_of(technicals.usable_bars((bars or [])[-400:]))


def price_age_sessions(bars_asof, today_ymd=None):
    """Completed sessions between the row's price date and today, or ``None``.

    ⛔ THE MEASUREMENT HAS ONE AUTHORITY and it is not here:
    ``live_tier.anchor_age_sessions`` already counts weekday sessions in
    ``(bars_asof, ymd]`` and is the number the live overlay's own staleness gate
    reads. A private copy in this file would be two answers to *"how old is this
    anchor"*, which is exactly what the audit that produced this code found
    everywhere else. Only the POLICY (``stale_price_sessions``) is this
    module's; the arithmetic is borrowed whole.
    """
    if today_ymd is None:
        today_ymd = int(datetime.date.today().strftime("%Y%m%d"))
    try:
        from . import live_tier  # lazy: same package, keeps import order flat
        return live_tier.anchor_age_sessions(bars_asof, today_ymd)
    except Exception:  # noqa: BLE001
        # An unreadable age reads as STALE below, which withholds rather than
        # publishes — the safe direction, and the same convention
        # `anchor_age_sessions` documents for its own `None`.
        log.warning("[screener] could not age bars_asof=%r; treating the price "
                    "as stale for cross-clock derivations", bars_asof,
                    exc_info=True)
        return None


def price_is_stale(bars_asof, today_ymd=None) -> bool:
    """True when the row's price is too old to divide a current-clock number by.

    ``None`` (absent or unparseable ``bars_asof``) reads as STALE — a row that
    will not say what day its price is from cannot be shown to be fresh, and
    the failure direction of guessing wrong here is a published percentage
    between two different dates.
    """
    age = price_age_sessions(bars_asof, today_ymd)
    return age is None or age > stale_price_sessions()


def identity_row_cap() -> int:
    """How many rows one PROOF identity may blank in a single build.

    ⭐ THE CAP IS THE WHOLE SAFETY ARGUMENT. A free identity firing on a
    handful of rows is what it was built for: those rows contradict themselves
    and their columns are withheld. The SAME identity firing on two thousand
    rows is not two thousand bad rows — it is a changed upstream, a renamed
    provider field, a units drift — and blanking a column across the universe
    is a far worse answer to that than saying so loudly. Past the cap the
    identity stops withholding for the rest of the build and is marked
    ``systemic`` in the receipt, where the morning ritual reads it.

    200 is chosen off the measured distribution, the same way
    ``stale_price_sessions`` is: the worst proof identity on the 2026-08-24
    snapshot fired on **81** rows before the `single_candle` repair and on
    **0** after it, against a universe of 3,714. 200 sits above the observed
    per-row population and an order of magnitude below anything systemic.
    """
    try:
        return int(os.environ.get("SCREENER_IDENTITY_MAX_ROWS") or 200)
    except (TypeError, ValueError):
        return 200


def _refuse_contradictions(row, state):
    """Blank the columns of every PROOF identity this row contradicts.

    ⭐ THE POLICY IS HERE, THE ARITHMETIC IS BORROWED — the same split
    ``price_age_sessions`` states. ``identities.proof_violations`` decides what
    a violation IS (and its ``verdict`` is the single evaluator the audit
    receipt also runs through, so the nightly and the report can never disagree
    about a row); this function decides what the BUILD does about one.

    ⛔ ADVISORY IDENTITIES NEVER REACH HERE. ``roe``/``roa`` have a measured
    population of legitimate exceptions — they do not share a balance-sheet
    vintage — so refusing on one would blank correct values. Advisories are for
    the receipt; proofs are for the gate.

    ⛔ ALL OF THE IDENTITY'S COLUMNS ARE WITHHELD, not one. A violation of
    ``gross_margin >= op_margin`` proves that at least one of the two is wrong
    and says nothing about WHICH, so publishing either would be picking a
    winner by coin-toss and calling it data.

    ⚠️ A row is still WRITTEN. This withholds columns, never the row — the
    reason the ``_step`` guard above exists at all: a dropped row is not an
    absence, it is last month's row staying live.
    """
    if state is None:
        return
    try:
        from . import identities as _identities
        fired = _identities.proof_violations(row)
    except Exception as e:  # noqa: BLE001
        # The rail failing must never cost the build. Counted by name, like
        # every other degradation in this file.
        state.setdefault("_rail_errors", {})
        k = type(e).__name__
        state["_rail_errors"][k] = state["_rail_errors"].get(k, 0) + 1
        log.warning("[screener] identity rail raised for %s; the row is written "
                    "unrefused", row.get("ticker"), exc_info=True)
        return
    if not fired:
        return
    for ident in fired:
        _withhold(row, state, ident.name, ident.columns)


def _withhold(row, state, name, columns) -> bool:
    """Blank ``columns`` on ``row``, counted under ``name``, under the cap.

    ⛔ ONE PLACE, because there are now two refusals that mean the same thing —
    the cross-column identities and the self-contradicting price series — and
    two copies of a cap is two caps that drift.
    """
    if state is None:
        return False
    cap = state.setdefault("_cap", identity_row_cap())
    c = state.setdefault(name, {"rows": 0, "withheld": 0, "systemic": False,
                                "columns": sorted(columns)})
    c["rows"] += 1
    c["columns"] = sorted(set(c["columns"]) | set(columns))
    if c["rows"] > cap:
        if not c["systemic"]:
            c["systemic"] = True
            log.error("[screener] %s fired on more than %d rows — NOT "
                      "withholding further; this is an upstream change, not "
                      "%d bad rows", name, cap, c["rows"])
        return False
    for col in columns:
        row[col] = None
    c["withheld"] += 1
    return True


def rs_fields(rs_row) -> dict:
    """``rs_ranking`` entry -> snapshot columns. ``{}`` when there is no entry.

    ⭐ THE ONE MAPPING between the RS authority and the screener's two RS
    columns, so "which field becomes which column" is stated once.

    ``rs_score`` -> ``rs_return`` is not a rename of convenience: it is the
    40%·3m + 20%·6m + 20%·1m + 20%·1w weighted return
    (``rs_ranking._compute_returns``), which is the same quantity
    ``research.ratings._weighted_rs_return`` computes and the same number
    ``rs_rank`` is the universe percentile OF. Writing both from one entry is
    what makes the rank and the return beside it consistent by construction.
    """
    if not rs_row:
        return {}
    out = {}
    rank = rs_row.get("rs_rank")
    if rank is not None:
        out["rs_rank"] = int(rank)
    score = rs_row.get("rs_score")
    if score is not None:
        out["rs_return"] = float(score)
    # Period returns ride in the SAME entry the rank came from — zero extra
    # cost, and the 3m/6m the member sees are the exact inputs their RS rank
    # was computed from (consistency by construction, like rs_return above).
    returns = rs_row.get("returns") or {}
    r3 = returns.get("3m")
    if r3 is not None:
        out["chg_pct_3m"] = round(float(r3), 2)
    r6 = returns.get("6m")
    if r6 is not None:
        out["chg_pct_6m"] = round(float(r6), 2)
    return out


def build_row(ticker, bars, ratings_row, fundamentals, rs_row=None,
              bulk_row=None, spy_closes=None, context_row=None,
              market_row=None, failures=None, identity_state=None) -> dict:
    """Merge all field groups into one snapshot row. Inputs are dicts whose
    keys are already snapshot COLUMNS (the readers do source-name mapping).

    ``bulk_row`` is one ticker's slice of ``fundamentals_bulk.fetch_bulk`` — the
    ten Group-A columns plus ``exchange``. It is merged as a PEER, not layered
    over anything: its key set is disjoint from every other source's by
    construction, and ``test_the_bulk_map_is_disjoint_from_every_other_source``
    is the rail that keeps it that way. In particular it does not carry
    ``market_cap`` (Massive owns that column) — so unlike the RS pair there is
    no ordering question to get right here, and none is implied.

    ``market_row`` is one ticker's merge of the SIX Wave 2 readers — Finviz
    float/short/ownership (``finviz_universe``, and the sole writer of
    ``inst_pct`` now that ``enrich.ratings_fields`` has handed it over — see
    that module's docstring), next-earnings date/session (``earnings_dates``),
    last-report move + implied move/setup-grade (``earnings_context``'s two
    readers), analyst consensus/price-target/grade-actions/eps-growth
    (``analyst_pass``), and insider cluster-days (``insider_capture``) —
    PLUS the THREE Wave 5 readers, same shape: ``pattern_join`` (pattern-engine
    ids/confidence/direction/expectancy — see below), ``darkpool_agg``
    (block-print notional/prints + signature-DPL distance), and ``opt_flow``
    (the flow-worker options aggregate). Disjoint from every other source by
    construction (each reader owns its own columns). Merged AFTER
    ``ratings_row`` and BEFORE ``context_row``.

    🔑 ``pattern_join`` rides TWO non-column CARRIER keys into ``market_row``
    on purpose — ``pattern_entry_px``/``pattern_stop_px``, the best active
    detection's raw entry/stop (K5: either, or both, may be absent). They are
    deliberately absent from ``snapshot_db.COLUMNS``, so the generic merge
    loop below drops them from ``row`` by construction (``if k in row``) —
    they never persist under their own name. The pattern-distance derivation
    block below reads them off the ``market_row`` PARAMETER directly, for
    exactly that reason.

    ``context_row`` is one ticker's merge of the four ``context_joins`` readers
    (breadth/uct20/index/etf) — classification flags, disjoint from every other
    source by construction (each reader owns its own columns; see the module
    docstring). Merged BEFORE ``rs_fields``, which stays last/authoritative.

    ``failures`` is the same optional ``{source: {outcome: count}}`` out-dict
    every ``_read_*`` in this file already reports into; ``run_build`` passes
    its ``sources`` census so a bar consumer that raises is COUNTED BY NAME
    rather than costing the row (see the ``_step`` comment below).
    """
    row = {c: None for c in snapshot_db.COLUMNS}
    row["ticker"] = (ticker or "").upper()
    # ⚠️ ORDER IS AUTHORITY. Later sources win, so `rs_fields` is LAST and owns
    # `rs_rank`/`rs_return` outright. `enrich.ratings_fields` no longer emits
    # either (see its docstring) — this ordering is the belt to that braces, so
    # the day somebody re-adds them there the rank still comes from one place.
    for src in (fundamentals or {}, bulk_row or {}, ratings_row or {},
                market_row or {}, context_row or {}, rs_fields(rs_row)):
        for k, v in src.items():
            if k in row and v is not None:
                row[k] = v
    # ONE sanitize for all four bar consumers below. Each of them does bare
    # OHLC arithmetic, so a single null close (halt, thin tape, provider gap)
    # used to raise out of whichever ran first and lose the whole row — the
    # ticker's fundamentals and ratings included, which had nothing to do with
    # the bad bar. See technicals.usable_bars.
    #
    # `_read_daily_bars` now fetches DEEP_BARS (5000) of history so ath_fields
    # can see the ticker's whole stored life. Every OTHER consumer below still
    # gets EXACTLY what it got pre-Wave-1: the RAW last-400 sessions, sanitized
    # ALONE (never backfilled from deeper history). Sanitizing `bars_full` first
    # and then slicing its tail would reach past session 400 to replace any
    # invalid bar in the raw window — silently deepening the lookback for every
    # window-sensitive column (rsi14, atr_pct, pct_vs_sma200, dist_52w_high_pct,
    # the MAs) on exactly the tickers usable_bars exists to protect. `bars` on
    # the right below is still the RAW parameter — it has not been reassigned
    # yet — so this is "raw tail, then sanitize", never "sanitize, then tail".
    # `bars_full` is the full sanitized series; only ath_fields reads it.
    # Task 9 adds more consumers of both names.
    bars_full = technicals.usable_bars(bars)
    bars = technicals.usable_bars(bars[-400:])

    # 🔴 A CONSUMER THAT RAISES MUST COST ITS COLUMNS, NEVER THE ROW — because
    # a lost row is NOT an absence, it is LAST MONTH'S ROW STAYING LIVE.
    # `run_build`'s per-ticker `except` increments an anonymous `errors` and
    # moves on; the previously-upserted row is never touched, so the member
    # keeps being served a complete, confident, months-old row while its
    # neighbours are stamped today. Measured 2026-08-23: HCICU raises
    # `ZeroDivisionError` out of `setup_score.compute` (line 99 — 8 consecutive
    # zero-volume down days make `sum(down_vols)/len(down_vols)` zero), so its
    # whole row is discarded every night and the served row is
    # `snapshot_date=2026-08-10, bars_asof=20260709` — 30 sessions stale — while
    # `bars.db` holds bars through 20260820.
    #
    # ⭐ This is the same seam-guard idiom as `_read_market_source` below, moved
    # one level in: a raise degrades to `{}`, is COUNTED under its own label in
    # the same `sources` census, and the row is still written — with the failed
    # consumer's columns honestly NULL and, crucially, with `bars_asof` ADVANCED.
    # Fixing whichever consumer raised is the other lane's job and does not make
    # this guard redundant: the next zero-volume window will land on a different
    # name next week, and freezing a row is the failure mode that hides.
    def _note_step(label, exc):
        if failures is not None:
            failures.setdefault(label, {})
            k = type(exc).__name__
            failures[label][k] = failures[label].get(k, 0) + 1
        log.warning("[screener] %s raised for %s; its columns are NULL this "
                    "build (the row is still written, and re-dated)",
                    label, row["ticker"], exc_info=True)

    def _step(label, fn):
        try:
            return fn() or {}
        except Exception as e:                                 # noqa: BLE001
            _note_step(label, e)
            return {}

    if bars:
        row.update(_step("bars_technicals",
                         lambda: technicals.compute_technicals(bars)))
        row.update(_step("bars_ath_fields",
                         lambda: technicals.ath_fields(bars_full)))
        row.update(_step("bars_single_candle",
                         lambda: candles.single_candle(bars)))
        row.update(_step("bars_multi_candle",
                         lambda: candles.multi_candle(bars)))
        row.update(_step("bars_character",
                         lambda: bar_character.classify(bars)))
        row.update(_step("bars_recent_pattern",
                         lambda: candles.recent_relation(bars)))
        # ⭐ The WEEKLY structure is resampled from these same daily bars — no
        # provider fetch and nothing added to the bars pipeline. `bars_full` is
        # used so the weekly series has real depth rather than 400 sessions.
        row.update(_step("bars_weekly_candle",
                         lambda: candles.weekly_candle(bars_full)))
        row.update(_step("bars_monthly_candle",
                         lambda: candles.monthly_candle(bars_full)))
        # ⭐ MULTI-WEEK STRUCTURE. Takes `bars_full` as well as the working
        # window because Green Line Breakout reaches back over every month we
        # hold — a 400-bar window would silently turn its all-time high into a
        # one-year high and the label would be wrong without being empty.
        row.update(_step("bars_structure",
                         lambda: bases.classify(bars, bars_full=bars_full)))
        row.update(_step("bars_setup_score",
                         lambda: setup_score.compute(
                             bars, pole_pct=row.get("pole_pct"))))
        if row.get("avg_volume_30d") is None:
            vols = [b.get("v") or 0 for b in bars[-30:]]
            if vols:
                row["avg_volume_30d"] = sum(vols) / len(vols)
        if spy_closes:
            try:
                closes = [b["c"] for b in bars]
                row["rs_line_trend"] = technicals.rs_line_trend(closes, spy_closes)
            except Exception as e:                             # noqa: BLE001
                _note_step("bars_rs_line_trend", e)
        # ⛔ STAMPED OUTSIDE EVERY GUARD, ON PURPOSE. Whatever failed above, the
        # row still says which session its bars came from — a row that cannot
        # date itself is the one shape no downstream label can rescue.
        row["bars_asof"] = _asof_of(bars)
        # 🔴 A SERIES THAT CONTRADICTS ITSELF POISONS EVERY WINDOW OVER
        # IT — see `technicals.series_contradicts_itself` for the measurement
        # and for why the test is a direction REVERSAL rather than a seam
        # count. This is the audit addendum's honest interim: withheld and
        # counted, never published. It is counted in the SAME receipt as the
        # identity refusals because it is the same statement — "this value
        # contradicts something we also hold" — just within one column's own
        # history instead of across two columns.
        _seam_cols = _step("bars_seam_scan",
                           lambda: {"c": technicals.seam_withheld_columns(bars)}
                           ).get("c") or set()
        if _seam_cols:
            _withhold(row, identity_state, "series_contradicts_itself",
                      sorted(_seam_cols))

    # How old this row's price is, decided ONCE and read by every cross-clock
    # derivation below. See the module-level block above for what this does and
    # does not withhold, and why.
    _stale_price = price_is_stale(row.get("bars_asof"))
    # Pure derivation — its factors are already columns; this is the ONE
    # writer for dollar_vol_30d (spec: this number exists nowhere else in the
    # platform).
    #
    # ⛔ NOT GATED ON STALENESS, deliberately: BOTH factors are `bars_asof`
    # quantities, so on a stale row this is a correct dollar volume for a past
    # session — one clock, not two. It is stale, and the row's `bars_asof` says
    # so. (Its published as-of over-claiming `snapshot_date` is real and is the
    # technicals lane's finding; the fix for a wrong LABEL is the label.)
    if row.get("price") is not None and row.get("avg_volume_30d") is not None:
        row["dollar_vol_30d"] = row["price"] * row["avg_volume_30d"]
    # Pure derivation, single writer: analyst price-target upside vs today's
    # price. `analyst_pass.read_analyst_fields` deliberately does NOT emit
    # this — it has no price — so the builder is the one place `pt_target`
    # and `price` are both in hand (see that module's docstring).
    #
    # ⚠️ FIX ROUND 1 (2026-08-22 review, Important 3): BOTH factors must be
    # POSITIVE, not merely present — `pt_target=0.0, price=100` used to
    # compute a confident `-100.0`, which is not "the analyst target implies
    # a 100% decline", it is a target FMP never supplied (0.0 is
    # `analyst_pass`'s own not-computable sentinel; see that module's
    # `_fetch_pt_target`) mislabeled as a number. A non-positive price is
    # equally not-computable — the ratio is undefined, not merely large.
    #
    # 🔴 FIX ROUND 2 (accuracy audit 2026-08-23, #4): AND THE TWO FACTORS MUST
    # SHARE A CLOCK. `pt_target` is last night's analyst consensus; `price` can
    # be a bar from June. `1 - 174.96/240` is not "the target implies 27%
    # upside", it is a percentage between two dates, and it is INVISIBLE — it
    # sorts, it filters, and it looks exactly like the fresh row beside it. On a
    # stale price this column is not computable, so it is absent.
    pt_target = row.get("pt_target")
    price = row.get("price")
    if (pt_target is not None and price is not None
            and pt_target > 0 and price > 0 and not _stale_price):
        row["pt_upside_pct"] = round((pt_target / price - 1) * 100, 2)
    # Pure derivations, single writers: distance to the best active pattern
    # detection's entry/stop (pattern_join supplies the raw levels as CARRIER
    # keys that are deliberately not columns; K5 — either may be absent).
    # Distances are vs THIS row's price; both factors must be positive AND
    # share a clock — `pattern_join` serves detections from the last 7 days, so
    # on a stale price these are the same cross-clock fiction as
    # `pt_upside_pct` above, and absent for the same reason.
    _pe = (market_row or {}).get("pattern_entry_px")
    _ps = (market_row or {}).get("pattern_stop_px")
    price = row.get("price")
    if (_pe is not None and price is not None and _pe > 0 and price > 0
            and not _stale_price):
        row["pattern_entry_dist_pct"] = round((_pe / price - 1) * 100, 2)
    if (_ps is not None and price is not None and _ps > 0 and price > 0
            and not _stale_price):
        row["pattern_stop_dist_pct"] = round((_ps / price - 1) * 100, 2)
    # Pure derivation, single writer: age from the profile-bulk listing date.
    if row.get("ipo_date"):
        try:
            listed = datetime.date.fromisoformat(str(row["ipo_date"])[:10])
            row["ipo_age_days"] = max(0, (datetime.date.today() - listed).days)
        except (TypeError, ValueError):
            pass
    # Pure derivation, single writer: days until the next reported earnings
    # date (from earnings_dates.read_earnings_dates via market_row). Can go
    # negative once the date has passed — that's honest (the last pull's date
    # simply hasn't rolled forward yet), never hidden.
    if row.get("next_earnings_date"):
        try:
            nxt = datetime.date.fromisoformat(str(row["next_earnings_date"])[:10])
            row["days_to_earnings"] = (nxt - datetime.date.today()).days
        except (TypeError, ValueError):
            pass
    row["snapshot_date"] = datetime.date.today().isoformat()
    row["built_at"] = int(time.time())
    # LAST, on the finished row: the free identities are relationships BETWEEN
    # columns, so they can only be read once every writer above has had its say.
    _refuse_contradictions(row, identity_state)
    return row


# ── source readers (network/disk; thin; monkeypatchable) ──────────────────────

# One deep read per ticker: the tail 400 feed every existing consumer
# unchanged; only ath_fields sees the full depth. 5000 matches the bars
# API ceiling.
DEEP_BARS = 5000


def _read_daily_bars(ticker):
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(ticker, "D", DEEP_BARS) or []
    out = []
    for r in rows:
        try:
            out.append({"t": r[0], "o": r[1], "h": r[2], "l": r[3],
                        "c": r[4], "v": r[5]})
        except Exception:
            continue
    return out


def _read_spy_closes():
    """The benchmark series for rs_line_trend — ONE read per build.

    Alignment note: the trend zips the positional tails of both series,
    exactly as the scanner did — a ticker with recent halts pairs slightly
    offset sessions. Accepted deviation carried over from the ported
    definition; date-alignment would be a definition CHANGE and belongs to
    the owner.
    """
    # Guarded like every other reader in this file: a dead/uninitialized
    # bars store must cost only rs_line_trend, never the whole build. The
    # caller already treats an empty result as a countable miss
    # (`sources["spy_bars"]["none"]`) — that path has to be reachable
    # without an exception ever getting there first.
    try:
        from api.services import bars_sqlite
        rows = bars_sqlite.get_bars("SPY", "D", 60) or []
    except Exception:
        log.warning("[screener] SPY bars unavailable; rs_line_trend will be "
                    "NULL for this build", exc_info=True)
        return []
    return [r[4] for r in rows if r[4] is not None]


def _read_fundamentals(ticker, price=None, failures=None):
    """Company name/sector/industry from the ticker_meta cache + market cap from
    Massive (shares*price fallback). No yfinance.

    ⛔ THE `except` CLAUSES STILL SWALLOW — one bad ticker must never cost the
    build — BUT THEY NO LONGER SWALLOW SILENTLY. `failures` is an optional
    `{source: {outcome: count}}` out-dict; `run_build` passes one and reports it.

    🔴 AND IT COUNTS **MISSES**, NOT ONLY RAISES — which is the whole reason this
    works. The first cut of this census counted `except` arms only, and the
    negative control (`fix_empty_scalars_measure.py --no-key`) proved it could
    never fire: `massive.get_ticker_details` has its OWN `except: return {}`, so
    a missing `MASSIVE_API_KEY` reaches here as a polite `None`, not as an
    exception. A counter that cannot count the thing it exists for is worse than
    no counter. `{'massive_market_cap': {'none': 60}}` out of 60 tickers is a
    credential or plan problem; `{'none': 9}` out of 397 is nine odd symbols.
    """
    out = {}

    def _note(source, outcome):
        if failures is None:
            return
        key = outcome if isinstance(outcome, str) else type(outcome).__name__
        failures.setdefault(source, {})
        failures[source][key] = failures[source].get(key, 0) + 1

    try:
        from api.services.ticker_meta import get_ticker_meta
        meta = get_ticker_meta(ticker) or {}
        if meta.get("name"):
            out["company"] = meta["name"]
        if meta.get("industry"):
            out["industry"] = meta["industry"]
        if meta.get("sector"):
            out["sector"] = meta["sector"]
        else:
            _note("ticker_meta", "none")
        if meta.get("theme"):
            out["theme"] = meta["theme"]
        # no miss-note for theme: most of the universe is outside the UCT
        # taxonomy, so a None theme is the NORMAL case — counting it would
        # flood the census with noise that buries real provider misses
    except Exception as e:
        _note("ticker_meta", e)
    try:
        from api.services.massive import get_market_cap
        mc = get_market_cap(ticker, price=price)
        if mc is not None:
            out["market_cap"] = mc
        else:
            _note("massive_market_cap", "none")
    except Exception as e:
        _note("massive_market_cap", e)
    return out


def _read_ratings(ticker, failures=None):
    """Reuse the nightly-stored ratings metrics (research_ratings.db) — no
    network. Returns column-keyed fundamentals + computed uct_composite,
    plus (Wave 2) the ratings components/sector-RS/sponsorship additions —
    see `enrich.ratings_fields`'s docstring for the `inst_pct` handover.

    ⚠️ AN EMPTY `research_ratings.db` LOOKS EXACTLY LIKE A UNIVERSE OF UNRATED
    TICKERS from inside this function — both are `{}` — so the MISS is counted
    (`{'ratings_db': {'no_metrics': N}}`) and left for `run_build` to report
    rather than guessed at here. `ratings_db.get_ticker_metrics` swallows its
    own errors and returns `None`, so counting only `except` arms would count
    nothing. Its only writer is `research.ratings_universe.nightly_job`,
    registered only under `RATINGS_PERCENTILE_ENABLED` (default `0`); on
    2026-08-09 the file was 0 bytes.

    Both `load_distributions()` and `load_sector_distributions()` are called
    ONCE per ticker here and threaded straight into `ratings_fields` — each is
    already memoized in-process for 10 min inside `ratings_db`, so this is not
    a per-ticker DB read across a nightly universe pass, just a cheap memo hit.
    """
    def _note(outcome):
        if failures is None:
            return
        key = outcome if isinstance(outcome, str) else type(outcome).__name__
        failures.setdefault("ratings_db", {})
        failures["ratings_db"][key] = failures["ratings_db"].get(key, 0) + 1

    try:
        from api.services.research import ratings_db
        metrics = ratings_db.get_ticker_metrics(ticker)
    except Exception as e:
        _note(e)
        metrics = None
    if not metrics:
        _note("no_metrics")
        return {}
    return enrich.ratings_fields(
        metrics, enrich.load_distributions(), enrich.load_sector_distributions())


def _read_rs_map():
    """``{TICKER: rs_row}`` from `rs_ranking`'s warmed cache — COMPUTING ON
    COLD, but only on this nightly-build path.

    ⛔ ONE READ PER BUILD. See `rs_ranking.cached_rank_map`'s own docstring for
    why it itself never computes: that rationale is about REQUEST-path callers
    racing the boot warmers with a fetch herd. It does NOT bind this function —
    the 3 a.m. scheduler thread that calls it isn't racing anything, and a
    ~17s compute here is cheap insurance against a universe-wide NULL night.

    ⚠️ 2026-08-22 RECEIPT (the motivating incident): the 03:04 ET build logged
    ``rs_map=0``, ``sources["rs_ranking"] == {"no_rank": 3741}`` — rs_rank,
    rs_return, chg_pct_3m and chg_pct_6m NULL for the ENTIRE universe.
    Mechanism, proven: `rs_ranking`'s cache lives under ONE key in the shared
    bounded LRU (`api/services/cache.py`, max 1000 entries); the 06:41Z warm
    (of the 05:50/06:41/07:31Z 50-min cadence) was evicted by the overnight
    job flood before the 07:00Z build ran — the build landed squarely in that
    gap. Not a broken mechanism: the SAME deployment cached 3,646 rankings
    fine at 09:12Z. So: when the warmed cache is cold, THIS reader (and only
    this reader) calls `rs_ranking.compute_rs_scores()` once (``force=False``
    — an untouched cold cache entry is exactly what `force=False` already
    recomputes, so there is nothing to force) and re-reads
    `cached_rank_map()`. A compute failure degrades to the pre-existing ``{}``
    + warning, never raises — honest-None is preserved either way.
    `cached_rank_map` ITSELF is unchanged: request-path callers keep the
    no-compute contract.

    The receipt must say which source answered — logged as
    ``rs_map source=cache-warm`` or ``rs_map source=computed-on-cold``.
    """
    try:
        from api.services import rs_ranking
        rs_map = rs_ranking.cached_rank_map()
        if rs_map:
            log.info("[screener] rs_map source=cache-warm n=%d", len(rs_map))
            return rs_map
        log.warning("[screener] rs_ranking cache cold at build time — "
                    "computing on cold (nightly-build path only, see "
                    "_read_rs_map docstring)")
        try:
            rs_ranking.compute_rs_scores(force=False)
        except Exception:
            log.warning("[screener] rs_ranking compute-on-cold failed; "
                        "rs_rank/rs_return will be NULL for this build",
                        exc_info=True)
            return {}
        rs_map = rs_ranking.cached_rank_map()
        log.info("[screener] rs_map source=computed-on-cold n=%d", len(rs_map))
        return rs_map
    except Exception:
        log.warning("[screener] rs_ranking unavailable; rs_rank/rs_return "
                    "will be NULL for this build", exc_info=True)
        return {}


def _read_bulk_fundamentals(targets, failures=None):
    """``{TICKER: {column: value}}`` for the ten Group-A columns + ``exchange``.

    ⭐ ONE PULL PER BUILD FOR THE WHOLE UNIVERSE — six HTTP requests, not one
    per ticker. The research page computes these same figures a symbol at a
    time; doing that here would be ~3,700 provider calls a night, and a bulk
    job that starves a shared provider budget is a measured defect in this
    repo. See `fundamentals_bulk` for which endpoints, why, and the rule that
    keeps FMP's "undefined" zeros out of the table.

    Never raises: a dead provider costs these eleven columns and nothing else,
    and the reason is COUNTED into `failures` rather than swallowed.
    """
    try:
        from . import fundamentals_bulk
        return fundamentals_bulk.fetch_bulk(targets, failures=failures)
    except Exception as e:                                     # noqa: BLE001
        if failures is not None:
            failures.setdefault("fmp_bulk", {})
            key = type(e).__name__
            failures["fmp_bulk"][key] = failures["fmp_bulk"].get(key, 0) + 1
        # ⛔ NAMED FROM THE MODULE'S OWN MAP, not from a count typed here — the
        # sibling line in `fundamentals_bulk` went stale exactly this way.
        try:
            from . import fundamentals_bulk
            names = ", ".join(sorted(fundamentals_bulk.COLUMNS_WRITTEN))
        except Exception:                                      # noqa: BLE001
            names = "the bulk fundamentals"
        log.warning("[screener] bulk fundamentals unavailable; these will be "
                    "NULL: %s", names, exc_info=True)
        return {}


def _read_market_source(label, reader, targets, failures=None) -> dict:
    """Call one ``market_row`` reader, guarded at the CONSUMER SEAM.

    Used by EVERY ``market_row`` reader ``run_build`` joins (Wave 2's six,
    Wave 5's three, and whatever joins next — no count here on purpose;
    counts beside lists drift).

    🔴 FIX ROUND 1 (2026-08-22 review, Critical 1). Every one of the
    Wave 2 readers already guards its OWN internal work — but
    ``insider_capture.read_insider_fields`` calls ``_init_db()`` BEFORE its
    own try/except (insider_capture.py:178, init at :83-94), so a dead store
    (e.g. ``_connect`` raising) escaped the reader entirely and reached
    ``run_build`` unguarded — and ``run_build`` called all six readers with
    nothing catching that escape. Reproduced: monkeypatching
    ``insider_capture._connect`` to raise crashed the ENTIRE nightly build
    (zero rows), not just insider_cluster_days.

    This mirrors ``_read_bulk_fundamentals``'s guard immediately above,
    per-reader: a raise degrades to ``{}`` and is COUNTED under ``label`` in
    the same ``failures``/``sources`` census every reader already reports
    into — a dead source must be REPORTED, never silent, never fatal — and,
    because each call site is wrapped independently, one bad source can
    never hide the others.
    """
    try:
        return reader(targets, failures=failures) or {}
    except Exception as e:                                     # noqa: BLE001
        if failures is not None:
            failures.setdefault(label, {})
            key = type(e).__name__
            failures[label][key] = failures[label].get(key, 0) + 1
        log.warning("[screener] %s unavailable; its market_row columns will "
                    "be NULL this build", label, exc_info=True)
        return {}


# ── orchestration ─────────────────────────────────────────────────────────────

def _load_universe():
    import json
    for p in ("api/data/cap_universe.json",
              os.path.join(os.path.dirname(__file__), "..", "..", "data",
                           "cap_universe.json")):
        if os.path.exists(p):
            with open(p) as fh:
                data = json.load(fh)
            # file is a flat list of ticker strings
            return [t for t in data if isinstance(t, str)]
    return []


def _stalest(tickers, limit):
    """Order tickers by stalest built_at (never-built first), capped to limit.

    🔴 THE TARGET SET IS THE UNIVERSE **UNION THE ROWS WE ALREADY SERVE** —
    accuracy audit 2026-08-23, #4. This used to iterate `cap_universe.json`
    alone, so a ticker dropped from the universe kept its last row FOREVER: the
    row is still selected by every scan, still sorts, still filters, and nothing
    ever revisits it. Measured on `C:\\data\\screener.db`: **ACA, APGE, CRNX and
    NUVL** are absent from `cap_universe.json` and still carry rows stamped
    `snapshot_date = 2026-07-10, bars_asof = 20260618` — and `bars.db` holds
    bars for three of them through **20260821**:

        CRNX  row price 35.87   vs 8/21 close  84.69   (+136.1%)
        APGE  row price 90.38   vs 8/21 close 134.75   ( +49.1%)
        ACA   row price 135.84  vs 8/21 close 144.90   (  +6.7%)

    That is the single largest freshness error in the audit, and its cause is
    this function's target set, not a provider. A row that exists is a rebuild
    target whether or not the universe still lists it; the rebuild is what makes
    it honest, and a delisted name with no bars simply lands in `skipped` as it
    always has.

    ⛔ THE UNION IS SKIPPED WHEN THE UNIVERSE IS EMPTY. `_load_universe` returns
    `[]` when the file is missing or unreadable, and "no universe" must keep
    meaning "build nothing" — turning it into "rebuild every row we hold" would
    make a missing config file silently launch a whole-universe run.

    ⚠️ THIS DOES NOT PRUNE, deliberately. A ticker with **0 bars** (EWCZ, MCW —
    rows from 2026-08-09, `bars_asof` 20260515/20260608) is `skipped` by the
    build and its row still persists; only a DELETE reaches those, and deleting
    member-visible rows is an owner decision, recorded in this lane's report.
    """
    try:
        with snapshot_db.connect() as conn:
            built = {r["ticker"]: r["built_at"] for r in
                     conn.execute("SELECT ticker, built_at FROM screener_rows")}
    except Exception:
        built = {}
    tickers = list(tickers or [])
    if tickers:
        have = {t.upper() for t in tickers}
        orphans = sorted(t for t in built if t and t.upper() not in have)
        if orphans:
            log.info("[screener] %d row(s) outside the universe queued for "
                     "rebuild: %s", len(orphans), ", ".join(orphans[:20]))
            tickers += orphans
    ordered = sorted(
        tickers,
        key=lambda t: (built.get(t.upper()) is not None, built.get(t.upper()) or 0))
    return ordered[:limit] if limit else ordered


def _read_prev_closes() -> dict:
    """``{TICKER: price}`` off last night's already-persisted ``screener_rows``
    -- ONE query, before the per-ticker loop.

    This is `darkpool_agg.read_darkpool_fields`'s ``closes`` argument (its DPL
    distance needs a close price per ticker). The PREVIOUS build's `price` is
    the honest anchor available at read time: this build's own bar-derived
    price for a given ticker does not exist yet when the market-row readers
    run (they run once, up front, before the per-ticker bar-fetch loop below)
    -- reaching for it would mean a second pass or a per-ticker query, either
    of which this file's other whole-market readers deliberately avoid (K4).
    A cold/empty table (first-ever build) degrades to `{}`, same as every
    other reader in this file -- `darkpool_agg` already treats `closes=None`
    as "skip DPL for everyone, still emit the aggregates."
    """
    try:
        with snapshot_db.connect() as conn:
            return {r["ticker"]: r["price"] for r in
                    conn.execute("SELECT ticker, price FROM screener_rows")
                    if r["price"] is not None}
    except Exception:
        log.warning("[screener] prev_closes unavailable; darkpool dp_level_dist_pct "
                    "will be NULL for this build", exc_info=True)
        return {}


# ⛔ ONE BUILD AT A TIME, PROCESS-WIDE — and the guard lives HERE, not in the
# route, because there are two callers: the 03:00 ET nightly job and the admin
# `POST /api/screener/refresh`. A guard in either caller alone still allows the
# other to start a second one.
#
# 🔴 MEASURED 2026-08-23, and it is why this exists: the refresh route spawned a
# fresh daemon thread per call with nothing stopping a second. Three manual
# triggers in twenty minutes produced THREE concurrent whole-universe builds —
# `fundamentals_bulk` fetches the entire universe regardless of `max_tickers`,
# so "just 60 tickers" is not a small build — and none of the three ever
# finished. The snapshot went 5 hours without a completed build while every
# trigger politely answered `{"started": true}`. A silent daemon thread that
# loses a race reports nothing, which is exactly how this hid.
_BUILD_LOCK = threading.Lock()


def build_in_flight() -> bool:
    """True while a build holds the lock. Read-only; for status surfaces."""
    return _BUILD_LOCK.locked()


def run_build(max_tickers=None) -> dict:
    """Build + upsert the snapshot, and REPORT WHAT ACTUALLY LANDED.

    Returns ``{built, skipped, errors, populated, empty_columns, sources}``:

      * ``populated`` — ``{column: non_null_rows}`` over the rows THIS run
        built. Counted off the rows themselves, never re-queried from the DB: a
        second count of the same thing is how two numbers start disagreeing.
      * ``empty_columns`` — the columns that came out 0/N, sorted. This is the
        one line an operator has to read.
      * ``sources`` — ``{reader: {ExceptionName: count}}`` from the readers.

    🔴 WHY: the 2026-08-09 03:05 build logged ``built=3708 skipped=0 errors=0``
    while writing NULL into ``market_cap`` on all 3,708 rows. Nothing in that
    line could have told anyone. ``errors`` counts rows LOST; it has never
    counted a column that silently came back empty on every row that survived.
    """
    if not _BUILD_LOCK.acquire(blocking=False):
        # ⛔ REFUSE, never queue: a queued second build would run the whole
        # universe again the moment the first finished, doubling provider spend
        # for a snapshot that is already fresh. The caller gets a receipt that
        # SAYS SO — `{"skipped": "..."}` is an answer, `{"started": true}` on a
        # thread that will lose a race is not.
        log.warning("[screener] build REFUSED — another build already in flight")
        return {"skipped_reason": "a build is already in flight", "built": 0,
                "skipped": 0, "errors": 0, "populated": {}, "empty_columns": [],
                "sources": {}, "identity_refusals": {}}
    try:
        return _run_build_locked(max_tickers)
    finally:
        _BUILD_LOCK.release()


def _run_build_locked(max_tickers=None) -> dict:
    snapshot_db.init_db()
    universe = _load_universe()
    cap = max_tickers or int(os.environ.get("SCREENER_SNAPSHOT_MAX_PER_RUN", "4000"))
    targets = _stalest(universe, cap)
    built = skipped = errors = 0
    batch = []
    # ⛔ DERIVED FROM THE SCHEMA, never a hand-listed set — a 66th column is
    # counted the day it lands, with nothing to remember to add here.
    populated = {c: 0 for c in snapshot_db.COLUMNS}
    sources: dict = {}
    identity_state: dict = {}
    rs_map = _read_rs_map()
    spy_closes = _read_spy_closes()
    if not spy_closes:
        sources.setdefault("spy_bars", {})["none"] = 1
    # ⭐ ONE bulk pull, scoped to the symbols this run will actually build, so
    # the 71,370-row provider file is never materialised beyond our universe.
    bulk_map = _read_bulk_fundamentals(targets, failures=sources)
    # ⭐ ONE read per build per context source (breadth/uct20/index/etf) — same
    # shape as rs_map/bulk_map above, never a per-ticker call. See
    # context_joins's module docstring for the disjoint-key-set contract.
    breadth_map = context_joins.read_breadth_flags(targets, failures=sources)
    uct20_map = context_joins.read_uct20(targets, failures=sources)
    index_map = context_joins.read_index_flags(targets, failures=sources)
    etf_map = context_joins.read_etf_flags(targets, failures=sources)
    # ⭐ Six Wave 2 readers, ONE read per build each — same shape as the four
    # context maps above, never a per-ticker call. Each call is wrapped by
    # `_read_market_source` (mirrors `_read_bulk_fundamentals` above): a dead
    # source degrades to {} and is COUNTED, never allowed to raise out and
    # take the whole build down with it (fix round 1, 2026-08-22 review —
    # see that helper's docstring). See each reader's own module docstring
    # for its honesty contract (absent key = not computable, never a
    # fabricated value).
    finviz_map = _read_market_source(
        "finviz_universe", finviz_universe.read_finviz_fields, targets, sources)
    edates_map = _read_market_source(
        "earnings_dates", earnings_dates.read_earnings_dates, targets, sources)
    lastmove_map = _read_market_source(
        "wire_last_report_move", earnings_context.read_last_report_move, targets, sources)
    implied_map = _read_market_source(
        "earnings_context_implied", earnings_context.read_implied_context, targets, sources)
    analyst_map = _read_market_source(
        "analyst_pass", analyst_pass.read_analyst_fields, targets, sources)
    insider_map = _read_market_source(
        "insider_capture", insider_capture.read_insider_fields, targets, sources)
    # ⭐ Three Wave 5 readers, same shape as the six above -- each wrapped by
    # `_read_market_source` so a dead source degrades to {} and is COUNTED,
    # never fatal. `darkpool_agg` additionally needs a close price per ticker
    # for its DPL-distance leg; `prev_closes` is the ONE query documented on
    # `_read_prev_closes` above, read once here (never per-ticker) and closed
    # over by the lambda below.
    #
    # ⚠️ DIVERGENCE FROM THE TASK BRIEF'S SKETCH: `_read_market_source` calls
    # `reader(targets, failures=failures)` -- ONE positional arg plus the
    # KEYWORD `failures`, not `reader(targets, failures)` positionally. A
    # `lambda t, f: ...` wrap (the brief's literal sketch) would raise
    # `TypeError: unexpected keyword argument 'failures'` the first time this
    # runs, because `f` is not the keyword name `failures`. The wrap below
    # names its second parameter `failures` (with a default, so it also
    # tolerates a bare-positional call) to match the real call shape exactly.
    pattern_map = _read_market_source(
        "pattern_join", pattern_join.read_pattern_fields, targets, sources)
    prev_closes = _read_prev_closes()
    dp_map = _read_market_source(
        "darkpool_agg",
        lambda tt, failures=None: darkpool_agg.read_darkpool_fields(
            tt, closes=prev_closes, failures=failures),
        targets, sources)
    optflow_map = _read_market_source(
        "opt_flow", opt_flow.read_opt_flow_fields, targets, sources)
    for t in targets:
        try:
            bars = _read_daily_bars(t)
            if not bars:
                skipped += 1
                continue
            price = bars[-1].get("c")
            # 🔴 ONE NAME, ONE MEANING (accuracy audit 2026-08-23, #4).
            # `massive.get_market_cap` prefers the provider's own `market_cap`
            # field (a CURRENT figure) and falls back to
            # `shares_outstanding × the price WE hand it`. On a stale row those
            # two paths publish different quantities under one column name —
            # one dated today, one dated a June bar — and nothing on the row
            # tells them apart. Handing it no price on a stale row collapses
            # that to a single meaning: `market_cap` is the provider's current
            # figure, or it is honestly absent. The cost, stated: a stale row
            # whose provider has no `market_cap` field loses the column.
            # ⚠️ UNMEASURABLE ON THIS BOX — `market_cap` is 0/3,714 non-null
            # locally (no `MASSIVE_API_KEY`), so this is reasoned from
            # `massive.get_market_cap`'s source, not from an observed value.
            mc_price = None if price_is_stale(anchor_asof(bars)) else price
            rs_row = rs_map.get(t.upper())
            if not rs_row:
                # Counted like any other provider miss: an empty `rs_ranking`
                # cache and a symbol genuinely outside the ranked universe are
                # both "no rank", and only the RATIO tells them apart.
                sources.setdefault("rs_ranking", {})
                sources["rs_ranking"]["no_rank"] = \
                    sources["rs_ranking"].get("no_rank", 0) + 1
            bulk_row = bulk_map.get(t.upper())
            if not bulk_row:
                # Counted for the same reason as `no_rank`: an empty bulk map
                # (dead endpoint, absent key) and a symbol FMP genuinely has no
                # statements for are both "no row", and only the RATIO tells
                # them apart. 3,700/3,700 is a provider problem; 60/3,700 is
                # sixty odd symbols.
                sources.setdefault("fmp_bulk", {})
                sources["fmp_bulk"]["no_row"] = \
                    sources["fmp_bulk"].get("no_row", 0) + 1
            T = t.upper()
            context_row = {**breadth_map.get(T, {}), **uct20_map.get(T, {}),
                           **index_map.get(T, {}), **etf_map.get(T, {})}
            market_row = {**finviz_map.get(T, {}), **edates_map.get(T, {}),
                          **lastmove_map.get(T, {}), **implied_map.get(T, {}),
                          **analyst_map.get(T, {}), **insider_map.get(T, {}),
                          **pattern_map.get(T, {}), **dp_map.get(T, {}),
                          **optflow_map.get(T, {})}
            row = build_row(t, bars,
                            _read_ratings(t, failures=sources),
                            _read_fundamentals(t, mc_price, failures=sources),
                            rs_row, bulk_row, spy_closes=spy_closes,
                            context_row=context_row, market_row=market_row,
                            failures=sources, identity_state=identity_state)
            for col, val in row.items():
                if val is not None and col in populated:
                    populated[col] += 1
            batch.append(row)
            built += 1
            if len(batch) >= 200:
                snapshot_db.upsert_rows(batch)
                batch = []
        except Exception as e:
            errors += 1
            log.warning("[screener] build %s failed: %s", t, e)
    if batch:
        snapshot_db.upsert_rows(batch)

    empty_columns = sorted(c for c in snapshot_db.COLUMNS
                           if built and populated[c] == 0)
    log.info("[screener] build done built=%s skipped=%s errors=%s "
             "rs_map=%s bulk_map=%s empty_columns=%s",
             built, skipped, errors, len(rs_map), len(bulk_map),
             ",".join(empty_columns) or "none")
    if sources:
        # NAMED, never a count alone: "RuntimeError x3708 from massive_market_cap"
        # is a credential problem; "HTTPError x9" is a flaky provider.
        log.warning("[screener] reader failures: %s", sources)
    if identity_state:
        # ⭐ NAMED AND SPLIT, never a total: "3 rows withheld on
        # candle_parts_close_to_one" is a normal night; the same identity marked
        # `systemic` is an upstream change and the loudest line in the receipt.
        log.warning("[screener] identity refusals: %s", identity_state)
    return {"built": built, "skipped": skipped, "errors": errors,
            "populated": populated, "empty_columns": empty_columns,
            "sources": sources, "identity_refusals": identity_state}
