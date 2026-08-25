"""Screener snapshot DB — one precomputed row per ticker for server-side scans.

Built nightly by ``snapshot_builder``; queried by ``query``. All numeric fields
nullable so a ticker missing fundamentals still screens on technicals.
"""
import os
import sqlite3
import threading

_WRITE_LOCK = threading.Lock()

# Canonical column set. Add columns here ONLY (builder + query read this list).
COLUMNS = [
    "ticker", "company", "sector", "industry", "exchange",
    "market_cap", "price", "avg_volume_30d", "dividend_yield",
    # fundamentals
    "pe_ttm", "pe_fwd", "peg", "ps", "pb", "eps_growth", "rev_growth",
    "op_margin", "gross_margin", "net_margin", "roe", "roa",
    "debt_to_equity", "current_ratio", "beta", "inst_pct",
    # provider fundamentals (Wave 2)
    "quick_ratio", "p_fcf", "p_ocf", "payout_ratio", "roic",
    "lt_debt_to_capital", "ipo_date", "ipo_age_days", "country",
    "shares_outstanding", "float_shares", "float_pct", "short_float_pct",
    "short_ratio", "insider_own_pct",
    # 🔴 WAVE 7 — the fields that were ALREADY INSIDE the three bulk
    # FMP calls this snapshot already makes. The 2026-08-23 benchmark put us
    # LAST of thirteen in family 1 (fundamental data fields) while these sat
    # unread in payloads we were already paying for and parsing. No new
    # provider, no new request, no new job — 25 columns for zero marginal
    # data cost. Coverage measured over our own universe before shipping:
    # every one of them is non-null on ≥99.9% of the 3,655 symbols FMP
    # matches, and non-ZERO on 50-100% depending on whether the concept
    # applies to the company (see `rnd_to_revenue`).
    "enterprise_value",
    "revenue_ps",
    "eps_ttm",
    "book_value_ps",
    "fcf_ps",
    "cash_ps",
    "ebitda_margin",
    "ebit_margin",
    "tax_rate",
    "interest_coverage",
    "cash_ratio",
    "asset_turnover",
    "ev_sales",
    "ev_ebitda",
    "ev_fcf",
    "net_debt_to_ebitda",
    "earnings_yield",
    "fcf_yield",
    "income_quality",
    "roce",
    "working_capital",
    "capex_to_revenue",
    "rnd_to_revenue",
    "sbc_to_revenue",
    "cash_conversion_cycle",
    "analyst_consensus", "pt_target", "pt_upside_pct",
    "upgrades_30d", "downgrades_30d", "eps_next_y_growth",
    # ratings components (Wave 2)
    "blended_growth", "sector_rs_pct", "rating_eps", "rating_growth",
    "rating_value", "rating_smr", "sponsorship",
    # uct ratings
    "uct_composite", "rs_rank", "rs_return", "accdis",
    # technical
    "chg_pct_1d", "chg_pct_1w", "chg_pct_1m", "rsi14",
    "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200", "pct_vs_ema20",
    "ma_stack", "adr_pct", "atr_pct", "vol_ratio", "gap_pct",
    "dist_52w_high_pct", "dist_52w_low_pct", "above_50sma", "new_52w_high",
    # performance (Wave 1)
    "chg_pct_3m", "chg_pct_6m", "chg_pct_1y", "chg_pct_ytd",
    "chg_from_open_pct", "adr_pct_1w", "dist_20d_high_pct", "dist_20d_low_pct",
    "dist_ath_pct", "new_ath", "dollar_vol_30d",
    # momentum mechanics (Wave 1)
    "pole_pct", "vol_nweek_low", "vol_updown_ratio", "ema_touch_count",
    "ema10_rising", "ema20_rising", "ema_stack_intact", "candle_score",
    "atr_ext_sma50", "rs_line_trend",
    "prev_day_open", "prev_day_high", "prev_day_low", "prev_day_close",
    # single candle
    "candle_type", "body_pct", "upper_wick_pct", "lower_wick_pct",
    "close_position", "wide_bar", "narrow_bar",
    # ⭐ `candle_matches` holds EVERY pattern the bar satisfied, delimiter-
    # wrapped; `candle_type` holds only the one that renders. The Candle Type
    # FILTER reads `candle_matches` — screening the rendered head would
    # silently drop every hammer that was also an engulfing.
    "candle_label", "candle_matches", "candle_trend",
    # what the bar DID — gaps, structural failures, reversals, volume
    "bar_character", "bar_character_label",
    # the most recent MULTI-BAR pattern within 5 sessions, and its age. 38.5% of
    # rows carry one that today's bar alone cannot see.
    "candle_recent", "candle_recent_bars_ago", "candle_recent_label",
    "candle_recent_status",
    # the WEEKLY bar's structure, resampled from the daily series
    "candle_weekly", "candle_weekly_label",
    "candle_monthly", "candle_monthly_label",
    # multi candle
    "inside_bar_run", "tight_consolidation", "pullback_depth_pct",
    "higher_lows_run", "nr7", "consecutive_up", "consecutive_down",
    "close_cv_pct", "avg_body_pct_5",
    # patterns
    "patterns", "pattern_conf_max",
    # context (Wave 1)
    "theme", "in_uct20", "index_sp500", "index_ndx", "index_dow", "index_r2k",
    "is_etf", "is_leveraged", "stage2", "stage4", "hvc_52w",
    # events (Wave 2)
    "next_earnings_date", "earnings_session", "days_to_earnings",
    "last_report_move_pct", "implied_move_pct", "earnings_setup_grade",
    "insider_cluster_days",
    # patterns + flow (Wave 5)
    "pattern_engine_ids", "pattern_engine_conf", "pattern_engine_dir",
    "pattern_entry_dist_pct", "pattern_stop_dist_pct", "pattern_expectancy_r",
    "dp_notional_1d", "dp_prints_1d", "dp_notional_5d", "dp_level_dist_pct",
    "opt_net_premium_1d", "opt_bull_pct_1d", "opt_net_premium_5d",
    # finviz parity (Wave 6 T6) — the transactions pair is SIGNED percent
    # (net insider/institutional buying vs selling over the trailing window);
    # the two flags are Yes/No -> 1/0 via finviz_universe's bool parse class.
    "insider_trans_pct", "inst_trans_pct", "optionable", "shortable",
    # finviz parity (Wave 6 parity2) — the growth trio, SIGNED percent (a
    # shrinking EPS/sales base prints negative). `eps_next_5y_growth` is an
    # ANALYST ESTIMATE (long-term projected annual growth), not a measurement.
    # ⛔ EPS Q/Q and Sales Q/Q (verified ids 22/23) are DELIBERATELY ABSENT:
    # `eps_growth`/`rev_growth` above already carry those exact facts — see
    # finviz_universe's `_C_IDS` comment.
    "eps_past_5y_growth", "eps_next_5y_growth", "sales_past_5y_growth",
    # per-pattern engine flags (Wave 6) — ONE writer, `pattern_join`, which
    # states the rule in its docstring. 1 = the engine has an active detection
    # of THIS pattern; 0 = it has active detections and none is this one;
    # NULL = it has no active detection for the symbol at all. ⛔ The third
    # case is why these are not defaulted to 0: "the engine says no" and "the
    # engine has not looked" are different facts, and only NULL carries the
    # second. ⚠️ These are the pattern ENGINE's answer, not the always-on
    # `patterns` heuristic beside them — the two vocabularies share the key
    # strings `vcp`/`flat_base` on purpose (pattern_join's D6 note) and are
    # different instruments, which is why the names carry `engine`.
    "pattern_engine_vcp", "pattern_engine_flat_base",
    # meta
    "snapshot_date", "bars_asof", "built_at",
]

_TEXT = {"ticker", "company", "sector", "industry", "exchange", "ma_stack",
         "candle_type", "candle_label", "candle_matches", "candle_trend",
         "bar_character", "bar_character_label",
         "candle_recent", "candle_recent_label", "candle_recent_status",
         "candle_weekly", "candle_weekly_label",
         "candle_monthly", "candle_monthly_label",
         "patterns", "snapshot_date", "bars_asof",
         # Wave 1. `accdis` joins _TEXT here too: it has always held letter
         # grades in a REAL-declared column (latent since v1; SQLite dynamic
         # typing made it harmless). New DBs now declare it TEXT; existing DBs
         # keep the old declaration and keep working.
         "accdis", "rs_line_trend", "theme",
         # Wave 2
         "ipo_date", "country", "next_earnings_date", "earnings_session",
         "earnings_setup_grade", "analyst_consensus", "sponsorship",
         # Wave 5 -- comma-joined DISTINCT pattern-engine ids, same shape as
         # `patterns`. `pattern_engine_dir` is NOT here: the reader re-encodes
         # the store's TEXT direction to a NUMBER (+1/-1/0) before it reaches
         # this table (ruling D4) -- see `_INT` below.
         "pattern_engine_ids"}
_INT = {"uct_composite", "rs_rank", "inside_bar_run", "higher_lows_run",
        "candle_recent_bars_ago",
        "consecutive_up", "consecutive_down", "built_at",
        # bools stored as 0/1
        "above_50sma", "new_52w_high", "wide_bar", "narrow_bar",
        "tight_consolidation", "nr7",
        # Wave 1 ints + bools
        "new_ath", "vol_nweek_low", "ema_touch_count", "candle_score",
        "ema10_rising", "ema20_rising", "ema_stack_intact", "in_uct20",
        "index_sp500", "index_ndx", "index_dow", "index_r2k",
        "is_etf", "is_leveraged", "stage2", "stage4", "hvc_52w",
        # Wave 2
        "ipo_age_days", "days_to_earnings", "upgrades_30d", "downgrades_30d",
        "insider_cluster_days", "sector_rs_pct", "rating_eps",
        "rating_growth", "rating_value", "rating_smr",
        # Wave 5 -- `pattern_engine_dir` is the reader-encoded +1/-1/0
        # (ruling D4, never the store's raw TEXT); `dp_prints_1d` is a count.
        "pattern_engine_dir", "dp_prints_1d",
        # Wave 6 (T6) -- Finviz Yes/No flags stored 0/1 (bool parse class in
        # finviz_universe; anything else is honest-None, never a guessed 0).
        "optionable", "shortable",
        # Wave 6 -- per-pattern engine flags stored 0/1 (never a guessed 0;
        # an unscanned symbol stays NULL -- see `pattern_join`).
        "pattern_engine_vcp", "pattern_engine_flat_base"}


# ---------------------------------------------------------------------------
# The scan results side table, and its receipt. Created in the SAME FILE as
# `screener_rows` -- see `api/services/screener/scan_store.py`, which owns every
# verb over these two tables and states the measurements this decision rests on.
#
# The short version, because a reader here needs it:
#
# * IN `screener.db` because E-A4 joins the results to `screener_rows`, and a
#   cross-database join needs ATTACH -- which `connect()` does not do, and which
#   `query.run_scan` (one SQL string, one connection) has nowhere to put. It is
#   also `signature_coverage`'s precedent exactly: a receipt lives in the same
#   file as the rows it certifies so it cannot outlive them.
#
# * `scan_hits` is HITS-ONLY. The 0 is recoverable -- a ticker inside a
#   `scan_coverage` window and absent from `scan_hits` IS a computed 0 -- and a
#   dense row-per-symbol table is the `alert_shadow_fires` shape, which measured
#   53 B/row with no prune and 279 GB/yr at 10k. Measured here: 182 B per hit row
#   with its index, so dense would be ~1,717 GB/yr at 10k definitions.
#
# * `not_computable` is its OWN column (controller resolution 5). "We could not
#   compute it at the last confirmed bar" and "something broke" are different
#   facts to a member, and folding them is what makes a coverage report
#   untrustworthy. `dropped_json` is the ONE enumeration and carries both kinds,
#   each with its reason; the two counts are what split them.
#
# * `tf` is the BARS-STORE CODE (`D`), never the product label (`1D`), and
#   `as_of` is a normalised YYYYMMDD int. Both are collapsed at `scan_store`'s
#   door: two spellings of one session is two rows and every count stays
#   plausible.
#
# COLUMNS above is UNTOUCHED and so are its 8 indexes. This is a second
# `executescript`, not a widening.
_SCAN_SCHEMA = """
CREATE TABLE IF NOT EXISTS scan_hits (
  def_hash TEXT    NOT NULL,
  tf       TEXT    NOT NULL,
  as_of    INTEGER NOT NULL,
  ticker   TEXT    NOT NULL,
  PRIMARY KEY (def_hash, tf, as_of, ticker)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_scan_hits_ticker ON scan_hits(ticker, as_of DESC);

CREATE TABLE IF NOT EXISTS scan_coverage (
  def_hash        TEXT    NOT NULL,
  tf              TEXT    NOT NULL,
  as_of           INTEGER NOT NULL,
  evaluated       INTEGER NOT NULL,
  answered        INTEGER NOT NULL,
  dropped         INTEGER NOT NULL,
  not_computable  INTEGER NOT NULL,
  dropped_json    TEXT    NOT NULL,
  dropped_listed  INTEGER NOT NULL,
  freshness       TEXT    NOT NULL,
  swept_at        REAL    NOT NULL,
  PRIMARY KEY (def_hash, tf, as_of)
);
"""


# ---------------------------------------------------------------------------
# The LIVE TIER overlay, and why it is a THIRD table in this same file.
#
# Spec: `.superpowers/sdd/live-tier-2026-08-23/00-spec.md` §4.
#
# ⛔ THE TIER WRITES NOTHING INTO `screener_rows`. In-place writes would (i) put
# a SECOND WRITER on 22 columns, and (ii) make "never fabricate a live value"
# unimplementable — you cannot "keep the nightly value" for a symbol whose
# nightly value you overwrote at 10:00 and whose price went stale at 10:15.
# `screener_rows` keeps exactly one writer: `upsert_rows`, called only by
# `snapshot_builder`. That does not change.
#
# SAME FILE, DIFFERENT TABLE — the precedent `_SCAN_SCHEMA` states above, for
# the same reason: the read path LEFT JOINs the overlay to `screener_rows` in
# ONE SQL string on ONE connection, and a cross-database join needs ATTACH,
# which `connect()` does not do.
#
# ⭐ THE SHAPE IS DERIVED FROM `live_tier.LIVE_COLUMNS` AND THIS FILE'S OWN
# `_coldef`, never retyped. A hand-typed overlay column with the wrong declared
# type is a silently-NULL column on a member's screen — and a hand-typed LIST
# is one that drifts the day a 23rd live column lands.
def _live_schema_sql() -> str:
    from api.services.screener import live_tier
    cols = ",\n  ".join(_coldef(c) for c in live_tier.LIVE_COLUMNS)
    return f"""
CREATE TABLE IF NOT EXISTS {live_tier.LIVE_TABLE} (
  ticker             TEXT PRIMARY KEY,
  live_session_ymd   INTEGER NOT NULL,
  live_asof          REAL    NOT NULL,
  anchor_bars_asof   TEXT,
  src_price          REAL    NOT NULL,
  anchor_price       REAL    NOT NULL,
  live_cols          INTEGER NOT NULL,
  {cols}
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_screener_live_session
  ON {live_tier.LIVE_TABLE}(live_session_ymd);
"""


def _live_write_columns() -> list:
    from api.services.screener import live_tier
    return list(live_tier.LIVE_META_COLUMNS) + list(live_tier.LIVE_COLUMNS)


def upsert_live_rows(rows: list) -> int:
    """Write the overlay. ONE writer, and this is it.

    Rows come from `live_tier.derive_row`, which returns all 22 columns for
    every symbol it answers for (a column it could not recompute carries the
    NIGHTLY value verbatim) — so an overlay row is always a complete,
    self-consistent picture and never a half-updated one.

    ⚠️ WRITE VOLUME THE SPEC DID NOT MEASURE — read this before arming. At the
    default 60 s cadence this is ~3,745 `INSERT OR REPLACE` per minute × ~390
    RTH minutes ≈ **1.5M row-writes per session, into the same `screener.db`
    file every member scan reads**. WAL keeps readers unblocked and the
    measured `held_lock_ms` is ~122 ms per cycle, but WAL GROWTH and checkpoint
    churn on the Railway volume were NOT measured. Spec §13's arming receipts
    must add: watch the WAL sidecar's size across a full session next to the
    provider-load check, and if it grows without bounding, the lever is
    `SCREENER_LIVE_INTERVAL_S` (the cadence), not a second writer.

    ⚠️ AND THE COPIED-FORWARD VALUES SHADOW `screener_rows` FOR ONE CADENCE.
    An overlay row carries the nightly value for the columns it could not
    recompute, and the read path COALESCEs the overlay first — so if an admin
    `POST /api/screener/refresh` lands intraday and moves, say, `pt_target` or
    the pattern levels while `bars_asof` stays at D-1, the overlay serves its
    pre-refresh COPY of those columns until the next sweep (≤60 s). Spec §4's
    "complete, self-consistent overlay row" rule chose this and it self-heals,
    but it is a second authority over those columns for the duration of the
    window. ⛔ The fix if it ever matters is to store NULL for a column that was
    not recomputed (COALESCE then falls through to the live nightly value) —
    which is a SPEC change to §4, not a patch here.
    """
    if not rows:
        return 0
    from api.services.screener import live_tier
    cols = _live_write_columns()
    placeholders = ", ".join("?" for _ in cols)
    sql = (f"INSERT OR REPLACE INTO {live_tier.LIVE_TABLE} "
           f"({', '.join(cols)}) VALUES ({placeholders})")
    payload = [[_coerce(c, r.get(c)) for c in cols] for r in rows]
    with _WRITE_LOCK, connect() as conn:
        conn.executemany(sql, payload)
        conn.commit()
    return len(rows)


def prune_live_rows(session_ymd: int) -> int:
    """Drop overlay rows from an earlier session.

    Belt and braces only — the serve predicate (`live_session_ymd >
    CAST(bars_asof AS INTEGER)`) already makes a stale row unservable, which is
    what lets the tier and the nightly build need NO coordination at all. This
    just stops the table carrying yesterday around.
    """
    from api.services.screener import live_tier
    with _WRITE_LOCK, connect() as conn:
        cur = conn.execute(
            f"DELETE FROM {live_tier.LIVE_TABLE} WHERE live_session_ymd < ?",
            (int(session_ymd),))
        conn.commit()
        return cur.rowcount or 0


def get_db_path() -> str:
    p = os.environ.get("SCREENER_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/screener.db"
    os.makedirs("./data", exist_ok=True)
    return "./data/screener.db"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _coldef(name: str) -> str:
    if name == "ticker":
        return "ticker TEXT PRIMARY KEY"
    if name in _TEXT:
        return f"{name} TEXT"
    if name in _INT:
        return f"{name} INTEGER"
    return f"{name} REAL"


def init_db() -> None:
    with _WRITE_LOCK, connect() as conn:
        cols = ", ".join(_coldef(c) for c in COLUMNS)
        conn.execute(f"CREATE TABLE IF NOT EXISTS screener_rows ({cols})")
        # Columns added after a table already exists on disk (prod predates
        # Wave 1) — CREATE TABLE IF NOT EXISTS never widens, so diff the live
        # schema against COLUMNS and ALTER-add what is missing.
        have = {r[1] for r in conn.execute("PRAGMA table_info(screener_rows)")}
        for c in COLUMNS:
            if c not in have:
                conn.execute(f"ALTER TABLE screener_rows ADD COLUMN {_coldef(c)}")
        for idx in ("sector", "market_cap", "uct_composite", "rs_rank",
                    "above_50sma", "chg_pct_1d", "candle_type", "built_at"):
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS idx_sr_{idx} ON screener_rows({idx})")
        # A SECOND executescript, below screener_rows and touching none of it.
        # `CREATE TABLE IF NOT EXISTS` is why a pod holding a nightly snapshot
        # gains the two scan tables on its next init with no migration step and
        # no separate flag -- the same reason `ledger._ensure_init` runs both of
        # its scripts through one call.
        conn.executescript(_SCAN_SCHEMA)
        # A THIRD executescript, below `_SCAN_SCHEMA`, touching neither
        # `screener_rows` nor its eight indexes. `CREATE TABLE IF NOT EXISTS`
        # is why a pod already holding a nightly snapshot gains the overlay on
        # its next init with no migration step and no separate flag — the same
        # reason the scan tables above need none.
        conn.executescript(_live_schema_sql())
        conn.commit()


def _coerce(name, value):
    """Normalize python bools to 0/1 for the INTEGER bool columns."""
    if isinstance(value, bool):
        return 1 if value else 0
    return value


def upsert_rows(rows: list[dict]) -> int:
    if not rows:
        return 0
    placeholders = ", ".join("?" for _ in COLUMNS)
    sql = (f"INSERT OR REPLACE INTO screener_rows ({', '.join(COLUMNS)}) "
           f"VALUES ({placeholders})")
    payload = [[_coerce(c, r.get(c)) for c in COLUMNS] for r in rows]
    with _WRITE_LOCK, connect() as conn:
        conn.executemany(sql, payload)
        conn.commit()
    return len(rows)


def get_row(ticker: str) -> dict | None:
    with connect() as conn:
        r = conn.execute("SELECT * FROM screener_rows WHERE ticker=?",
                         (ticker.upper(),)).fetchone()
        return dict(r) if r else None


def get_rows(tickers: list) -> dict:
    """Batch fetch: {ticker: row-dict} for the given tickers, one connection.
    Tickers are uppercased to match the stored PK; misses are simply absent."""
    tks = [t.upper() for t in tickers if t]
    if not tks:
        return {}
    out = {}
    with connect() as conn:
        # SQLite's variable limit is 999; theme fill-sets are <=50, chunk to be safe.
        for i in range(0, len(tks), 900):
            chunk = tks[i:i + 900]
            ph = ", ".join("?" for _ in chunk)
            for r in conn.execute(
                    f"SELECT * FROM screener_rows WHERE ticker IN ({ph})", chunk):
                out[r["ticker"]] = dict(r)
    return out


def count_rows() -> int:
    with connect() as conn:
        return conn.execute("SELECT COUNT(*) FROM screener_rows").fetchone()[0]


# ---------------------------------------------------------------------------
# 🔴 WHAT DATE IS THIS DATA? `MAX(snapshot_date)` IS A TRUE NUMBER WITH A FALSE
# IMPLICATION, AND IT WAS BEING PRINTED OVER THE MEMBER'S RESULTS.
#
# Measured on the live `C:\data\screener.db` 2026-08-09 -- 3,589 rows:
#
#     2026-08-08      1 row     <- and the MAX is what the member was shown
#     2026-07-11  3,583 rows    <- what the member was actually screening on
#     2026-07-10      5 rows
#
# So the screen said *"snapshot 2026-08-08"* over fundamentals 28 days stale.
# The MAX is not wrong -- it is genuinely the newest row -- which is exactly why
# it is dangerous: it survives every internal consistency check.
#
# ⭐ THE REPRESENTATIVE DATE IS THE **MEDIAN** ROW'S, following E-3's gate
# (`scan_evaluator._median_snapshot_date`, `.superpowers/sdd/phase-e/e3-report.md`
# §3). A rank statistic has NO TUNABLE: there is no percentage-of-rows threshold
# to pick wrong and no knob to drift. It says "most of these rows", and it moves
# the moment half the set stops rebuilding.
#
# ⭐ AND IT IS NOT REPORTED ALONE. One date cannot honestly describe a table
# holding three of them -- collapsing to a single number is how the MAX lied in
# the first place. `describe_rows` returns the representative date TOGETHER WITH
# how many rows actually carry it, the oldest and newest present, how many rows
# carry no date at all, and an explicit `mixed` flag, so a genuinely mixed table
# can SAY it is mixed instead of picking a date that is wrong for somebody.
#
# ⛔ AND IT NEVER FILTERS. `describe_rows` only ever reads the SAME row set the
# caller is serving (`where`/`params` are the caller's own, already registry-
# validated and parametrized). Dropping the off-median rows would turn a
# labelling bug into a missing-data bug -- a screen that quietly returns fewer
# symbols looks like a quiet market, which is strictly worse than a wrong label.
#
# ⚠️ WHY THE TABLE IS MIXED AT ALL, since a reader here will ask: `run_build` is
# CAPPED (`SCREENER_SNAPSHOT_MAX_PER_RUN`, and the admin refresh route defaults
# to 800) and stamps `snapshot_date = date.today()` on ONLY the tickers it
# rebuilt, stalest-first. So every partial or interrupted build leaves a
# permanently mixed table by construction, and `MAX` then reports the last
# partial build as though it were the whole snapshot. That is a property of the
# builder, not an accident of this box.
def describe_rows(conn, where: str = "", params=(),
                  from_sql: str = "screener_rows",
                  date_expr: str = "snapshot_date") -> dict:
    """Describe the `snapshot_date` provenance of the rows `where` selects.

    `conn` is the CALLER'S connection so the description and the result set are
    read from one transaction and cannot disagree. `where`/`params` are the
    caller's own clause -- pass them and the answer describes what is being
    served; omit them and it describes the whole table.

    ONE `GROUP BY` supplies every field, so `rows` here IS the caller's total by
    construction rather than a second count of the same thing.

    ⛔ `from_sql` AND `date_expr` ARE PASSED IN, NEVER REBUILT HERE, and that is
    the whole reason they exist. Once the live overlay is serving,
    `query.run_scan`'s where clause can reference the OVERLAY's alias
    (`COALESCE(l."chg_pct_1d", …) >= ?`), so this statement has to run against
    the SAME `FROM …LEFT JOIN…` the rows came out of -- against `screener_rows`
    alone it would not merely disagree, it would raise `no such column: l.…`.
    Composing a second join here instead of taking the caller's would be a
    second authority over which rows are being described, and `total` and the
    rows it labels are coupled BY DESIGN (`query.run_scan`'s own comment).
    Defaults reproduce the pre-overlay statement byte for byte for every other
    caller (`distribution`, `status`).
    """
    hist = conn.execute(
        f"SELECT {date_expr} d, COUNT(*) n FROM {from_sql}{where} "
        f"GROUP BY {date_expr}", list(params)).fetchall()
    dated = sorted(((r["d"], r["n"]) for r in hist if r["d"] is not None),
                   key=lambda pair: str(pair[0]))
    undated = sum(r["n"] for r in hist if r["d"] is None)
    n_dated = sum(n for _, n in dated)

    # The median row's date: walk the ascending dates until the running count
    # passes index `n_dated // 2`. Deliberately the SAME convention as
    # `scan_evaluator._median_snapshot_date`'s `ORDER BY snapshot_date LIMIT 1
    # OFFSET n // 2` -- two spellings of one statistic must not disagree on
    # parity, and `test_the_median_here_agrees_with_the_evaluators_own_gate`
    # is the rail that says so.
    representative = None
    seen = 0
    for date_str, n in dated:
        seen += n
        if seen > n_dated // 2:
            representative = date_str
            break

    counts = dict(dated)
    return {
        "rows": n_dated + undated,
        "snapshot_date": representative,
        "rows_on_snapshot_date": counts.get(representative, 0),
        "oldest_snapshot_date": dated[0][0] if dated else None,
        "newest_snapshot_date": dated[-1][0] if dated else None,
        "distinct_snapshot_dates": len(dated),
        "rows_missing_snapshot_date": undated,
        "mixed": len(dated) > 1 or (bool(dated) and undated > 0),
    }


def status() -> dict:
    """Coverage + freshness of the whole snapshot.

    ⭐ `snapshot_date` is the honest answer to *"how old is this data?"* -- the
    median row's. `latest_snapshot_date` is kept, still the MAX, and its name is
    the only thing it ever meant: the newest SINGLE row. ⛔ Do not answer "is the
    snapshot fresh?" from it -- on 2026-08-09 that was one row out of 3,589.
    """
    with connect() as conn:
        prov = describe_rows(conn)
        built = conn.execute(
            "SELECT MAX(built_at) b FROM screener_rows").fetchone()["b"]
    # `latest_snapshot_date` is DERIVED from the value already computed, never
    # re-queried: a second authority over one number is how these two drift.
    return {**prov, "latest_built_at": built,
            "latest_snapshot_date": prov["newest_snapshot_date"]}
