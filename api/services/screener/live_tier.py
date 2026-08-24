"""Screener LIVE TIER — recompute the price-anchored columns intraday, honestly.

Spec: ``.superpowers/sdd/live-tier-2026-08-23/00-spec.md``. Read it before
changing anything here; where it says a column is NOT derivable, it is not
derived here either, and §2.5 records the reason for each refusal.

ONE SENTENCE: during the regular session only, re-derive the twenty-two
snapshot columns that are a pure function of *(live price, a level the 03:00
build already stored)* into a **side table** (``screener_live``) that the read
path overlays — with zero new provider calls, zero writes into
``screener_rows``, and a per-row, per-column statement of which is which.

THE FIVE CONSTRAINTS, AND WHERE THIS FILE DISCHARGES EACH
---------------------------------------------------------
1. **Never fabricate a live value.** ``sanity_reason`` is the whole gate: a
   symbol that fails ANY of its seven checks is **absent from the overlay**,
   which — because the read path LEFT JOINs — is *literally* the nightly row.
   Never a partial row, never a zero, never a guess. And inside a row that
   passes, a column whose anchor could not be recovered **keeps its nightly
   value verbatim** (`derive_row` seeds `out` from the nightly row and only
   ever overwrites), with ``live_cols`` counting how many were genuinely
   recomputed.
2. **A member can tell live from nightly.** Every overlay row carries
   ``live_asof``, ``anchor_bars_asof``, ``src_price``, ``anchor_price`` and
   ``live_cols`` — the provenance surfaces (spec §8, Lane B) read those. This
   module's job is to make sure the facts exist to disclose.
3. **Never corrupt the snapshot.** This file writes exactly one table,
   ``screener_live``, and it is the ONLY writer of it. ``screener_rows`` keeps
   its one writer (``snapshot_db.upsert_rows``, called only by
   ``snapshot_builder``). Mutual exclusion is the **shared**
   ``snapshot_builder._BUILD_LOCK`` — ⛔ do not invent a second lock.
4. **Flag-gated off by default.** ``SCREENER_LIVE_TIER_ENABLED``, default
   ``"0"``, read **per call** at the top of ``sweep_job``. Rollback = unset it;
   the next tick answers ``skipped_reason="disabled"`` with no deploy.
5. **No new provider storm.** The ONLY market read in this module is
   ``scan_volume.full_market_snapshot()`` — a 30 s shared cache over a call the
   pod already makes every 30–60 s during market hours for the /charts preset
   scans (spec §1.2). ⛔ Never ``massive._get_client()``, never
   ``get_full_market_snapshot`` directly, never ``/api/live-prices`` or
   ``live_prices._fetch_snapshots`` (that is the per-row fanout constraint 5
   forbids). ``tests/test_screener_live_tier.py`` asserts this with an **AST**
   over this file, never a grep.

⚠️ THE ANCHOR CONTRACT (spec §1.5), stated once so nobody relaxes it by feel:

    Every live column is ``f(live tick, a level computed from COMPLETED
    SESSIONS THROUGH bars_asof)``. Today's developing session is NEVER folded
    into a level.

So *"−2.4% vs the 50-day"* at 10:42 means *"−2.4% vs the 50-day average of the
50 sessions through the previous close"*. That is what Finviz-class screeners
mean by the phrase, and it is what the Seal says in those words.

⚠️ KNOWN GAP AT SHIP — the ``day_open`` / ``day_high`` widening (spec §3.2) is
``api/services/massive.py``'s, and that file is NOT this lane's. Until it
lands, ``get_full_market_snapshot`` emits only ``last_price``/``prev_close``/
``today_vol``/``prev_vol``, so four of the twenty-two —
``chg_from_open_pct``, ``gap_pct``, ``new_52w_high``, ``new_ath`` — have no
feed input and **keep their nightly value**, counted in ``live_cols`` as not
recomputed. That is the honest degradation, not a bug: the moment the parse
widens (three additive extractions, zero provider cost) they light up with no
change here.

⛔⛔ AND THE DISCLOSURE MUST NOT NAME THEM. ``LIVE_COLUMNS`` is what the tier
*aspires* to recompute; ``live_columns_effective()`` is what it **measured
itself recomputing on the last cycle**, and the provenance surface (spec §8,
Lane B) must read the second one. Naming a column "live as of 10:42" while it
carries the prior session's value is an honest value under a dishonest label —
constraint 2's exact failure mode, and worse than no overlay at all, because a
member filtering ``gap_pct > 3`` during RTH would read yesterday's gappers as
today's. The receipt carries ``columns_not_recomputed`` **by name** (never a
count) so no surface has to subtract anything to get this right, and the
fallback before the first sweep of a process UNDER-claims rather than over-.
"""
import logging
import math
import os
import sqlite3
import time
from datetime import date, timedelta

from api.services.screener import snapshot_db, technicals

log = logging.getLogger(__name__)

#: The overlay table. Same FILE as ``screener_rows`` (a cross-database join
#: needs ATTACH, which ``snapshot_db.connect()`` does not do), a DIFFERENT
#: table — the schema lives in ``snapshot_db.init_db``'s third executescript.
LIVE_TABLE = "screener_live"

#: THE LIVE SET — 22 columns, in the spec's §2.1 order. The selection rule,
#: stated once so nobody grows it by feel:
#:
#:   ⭐ The live set is the transitive closure of `price` under "would visibly
#:   contradict a live price on the same row." Nothing enters because it COULD
#:   be derived; a column enters because leaving it nightly puts two numbers on
#:   one row that cannot both be true.
#:
#: ⛔ Adding to this list is a SPEC change, not a code change. §2.3/§2.5 name
#: every rejected column WITH its reason, and the reasons are different from
#: each other — `vol_ratio`'s denominator is not recoverable AND a partial-day
#: ratio is a different quantity; `pe_ttm`'s numerator is FMP's price at FMP's
#: as-of; `dollar_vol_30d` is a liquidity FLOOR whose purpose is stability.
LIVE_COLUMNS = (
    "price",                    # 1  P₁
    "chg_pct_1d",               # 2  feed only — correct even on a stale row
    "chg_pct_ytd",              # 3  calendar baseline; does not roll daily
    "chg_from_open_pct",        # 4  feed only (needs day_open — see the gap note)
    "gap_pct",                  # 5  feed only (needs day_open)
    "pct_vs_sma20",             # 6
    "pct_vs_sma50",             # 7
    "pct_vs_sma200",            # 8
    "pct_vs_ema20",             # 9
    "above_50sma",              # 10 DERIVED FROM #7, never recomputed
    "ma_stack",                 # 11 §2.2 — 2-dp tie keeps the nightly label
    "atr_ext_sma50",            # 12 (P₁ − s50)/ATR, ATR = atr_pct·P₀/100
    "dist_52w_high_pct",        # 13
    "dist_52w_low_pct",         # 14
    "new_52w_high",             # 15 needs feed day_high
    "dist_20d_high_pct",        # 16
    "dist_20d_low_pct",         # 17
    "dist_ath_pct",             # 18
    "new_ath",                  # 19 needs feed day_high
    "pattern_entry_dist_pct",   # 20 ⛔ THE ALGEBRA FLIPS — see _recover_pattern_level
    "pattern_stop_dist_pct",    # 21 ⛔ same
    "pt_upside_pct",            # 22 pt_target is a stored column, not an anchor
)

#: ⭐ THE COLUMNS THAT NEED A FEED FIELD THE SNAPSHOT PARSE MAY NOT EMIT, and
#: the field each one needs. Everything else in ``LIVE_COLUMNS`` derives from
#: ``last_price`` + ``prev_close`` + a stored anchor, all three of which the
#: sanity gate already guarantees before ``derive_row`` runs — so this dict IS
#: the complete list of ways a passing row can still keep a nightly value for
#: a *structural* reason rather than a per-symbol one (a null anchor or a 2-dp
#: ``ma_stack`` tie are per-symbol; these four are per-DEPLOY).
#:
#: ⛔ This is a DECLARATION, not the authority. The authority is what the sweep
#: measured (``live_columns_effective()``); this only decides what the very
#: first cycle of a process is allowed to claim before it has measured
#: anything, and it is pinned against ``derive_row`` by
#: ``test_the_feed_dependency_declaration_matches_what_derive_row_actually_does``
#: — a fifth dependency added to ``derive_row`` and not to this dict goes RED.
FEED_FIELD_DEPENDENCIES = {
    "chg_from_open_pct": "day_open",
    "gap_pct":           "day_open",
    "new_52w_high":      "day_high",
    "new_ath":           "day_high",
}

#: Stored columns the derivation READS that are not themselves live.
#: ``bars_asof`` dates the anchor (the freshness gate + the disclosure);
#: ``atr_pct`` is the denominator of #12; ``pt_target`` is the numerator of #22.
#: ⭐ `atr_pct` staying NIGHTLY is correct, not a compromise — a volatility
#: level from completed sessions is exactly what belongs under an extension
#: measure (spec §2.3).
ANCHOR_COLUMNS = ("bars_asof", "atr_pct", "pt_target")

#: The one SELECT the sweep runs against `screener_rows`. Derived from the two
#: lists above so a 23rd live column cannot be forgotten here.
READ_COLUMNS = ("ticker",) + LIVE_COLUMNS + ANCHOR_COLUMNS

#: The overlay row's own columns, ahead of the 22. ``live_cols`` is how many of
#: the 22 were GENUINELY recomputed for that symbol — the per-row half of the
#: honesty the receipt reports in aggregate.
LIVE_META_COLUMNS = ("ticker", "live_session_ymd", "live_asof",
                     "anchor_bars_asof", "src_price", "anchor_price",
                     "live_cols")

#: Every per-symbol refusal reason, in gate order. ⛔ ONE reason per symbol —
#: the FIRST that fails — so ``rows_considered == rows_written + Σskipped``
#: closes by construction. A receipt whose arithmetic does not close is not a
#: receipt.
SKIP_REASONS = ("no_feed", "not_traded", "no_price", "no_prev_close",
                "bad_anchor", "stale_anchor", "insane_deviation")


# --------------------------------------------------------------------------- #
# flags — every one read PER CALL (the `scan_evaluator.enabled()` idiom), so a
# controller can arm or roll back with an env var and no deploy.
# --------------------------------------------------------------------------- #

def enabled() -> bool:
    """Master switch. Default OFF. Read per call on the writer AND the reader."""
    return os.environ.get("SCREENER_LIVE_TIER_ENABLED", "0") == "1"


#: What the LAST cycle that wrote anything actually recomputed, or ``None``
#: before this process has measured. Per-process, like every other status
#: surface on this single-uvicorn pod.
_EFFECTIVE_COLUMNS: tuple | None = None


def live_columns_effective() -> tuple:
    """⭐ THE COLUMN LIST THE DISCLOSURE MAY NAME AS LIVE. Read THIS, never
    ``LIVE_COLUMNS``, in any surface that says "live as of 10:42".

    ``LIVE_COLUMNS`` is the set this tier aspires to recompute; this is the set
    it *measured itself recomputing* on the last cycle that wrote a row — so a
    column the feed cannot answer for (spec §3.2 unlanded), or one no row in
    the universe has an anchor for, is **structurally absent from the claim**
    rather than absent from a hand-maintained subtraction somewhere downstream.

    Before the first writing sweep of a process it falls back to the DECLARED
    set (``LIVE_COLUMNS`` minus everything in ``FEED_FIELD_DEPENDENCIES``),
    which **under-claims**: it names 18 even on a pod whose parse emits all the
    feed fields, and the first sweep corrects that within one cadence. That
    direction is deliberate — a column silently missing from the claim is a
    smaller lie than a nightly column wearing a live label, and it self-heals.
    """
    if _EFFECTIVE_COLUMNS is not None:
        return _EFFECTIVE_COLUMNS
    return tuple(c for c in LIVE_COLUMNS if c not in FEED_FIELD_DEPENDENCIES)


def columns_not_recomputed() -> tuple:
    """The complement of :func:`live_columns_effective`, **by name** — what the
    overlay is carrying forward from the 03:00 build. Named, never counted:
    "4 of 22 are nightly" tells a member nothing they can act on
    (``lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report``)."""
    live = set(live_columns_effective())
    return tuple(c for c in LIVE_COLUMNS if c not in live)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(float(os.environ.get(name, "") or default))
    except (TypeError, ValueError):
        return default


def interval_s() -> int:
    """Sweep cadence. Below 30 buys nothing — the shared snapshot's TTL is 30 s,
    so a 60 s sweep reads an entry ≤30 s old and the worst-case age of a live
    column is 90 s, which is the number the Seal states."""
    return max(5, _env_int("SCREENER_LIVE_INTERVAL_S", 60))


def max_age_s() -> float:
    """⭐ THE DEAD-SWEEPER CONTRACT. In-session, an overlay older than this is
    not served: if the sweeper stops mid-session the screener silently and
    correctly reverts to nightly within three minutes, and the Seal says so."""
    return _env_float("SCREENER_LIVE_MAX_AGE_S", 180.0)


def max_deviation_pct() -> float:
    """The insane-price gate. ⚠️ A real 3:1 split trips this (P₁/P₀ ≈ 0.33) and
    that is the CORRECT direction: we refuse to publish −67% as a day move, the
    symbol keeps its nightly values, the count appears in the receipt under
    ``insane_deviation``, and tonight's build re-anchors. ⛔ Do not "fix" a
    split day by raising the threshold."""
    return _env_float("SCREENER_LIVE_MAX_DEVIATION_PCT", 50.0)


def min_traded_fraction() -> float:
    """Whole-sweep holiday abort — see ``_abort_reason``."""
    return _env_float("SCREENER_LIVE_MIN_TRADED_FRACTION", 0.5)


def max_anchor_age_sessions() -> int:
    """Refuse to hang a live price on a very old level."""
    return _env_int("SCREENER_LIVE_MAX_ANCHOR_AGE_SESSIONS", 5)


# --------------------------------------------------------------------------- #
# the clock — ONE session authority
# --------------------------------------------------------------------------- #

def _now_et():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York"))


def _session() -> str:
    """``massive._detect_session()`` and nothing else.

    ⛔ Do not write a second clock. That function is the repo's one answer to
    "what session is it", and the tier runs REGULAR ONLY because outside RTH
    the two price authorities in this codebase diverge (spec §1.3): the
    screener's live price and the price the member's own watchlist/chart shows
    are the same number BY CONSTRUCTION during the regular session, and only
    then. ⚠️ Relaxing this to extended hours to catch pre-market gaps needs a
    ruling on which of the two price rules the screener speaks — a separate
    decision with a separate receipt.
    """
    from api.services import massive
    return massive._detect_session()


def session_ymd(now=None) -> int:
    """The ET session date as a ``YYYYMMDD`` int — directly comparable with
    ``bars_asof``, which ``snapshot_builder`` stamps from a daily bar's ``t``
    and which ``bars_sqlite`` documents as a ``YYYYMMDD`` int."""
    n = now or _now_et()
    return int(n.strftime("%Y%m%d"))


# --------------------------------------------------------------------------- #
# the serve predicate (spec §4.1) — declared here, consumed by the read path
# --------------------------------------------------------------------------- #

def serve_predicate_sql(live_alias: str = "l", rows_alias: str = "r",
                        min_asof_param: str | None = None) -> str:
    """``serve the overlay for a row ⟺ it describes a session strictly newer
    than the row's own anchor session.``

    ⭐ Everything this buys is free of coordination with the nightly build:

    * tonight's build advances ``bars_asof`` to today's session ⇒ today's
      overlay STOPS BEING SERVED automatically — no truncate, no callback into
      ``snapshot_builder``, no ordering requirement between the two jobs;
    * yesterday's leftover rows can never be served today;
    * a MIXED snapshot resolves correctly PER ROW — a row rebuilt tonight
      ignores the overlay, a row three days stale still gets a live price;
    * a ``bars_asof`` that is NULL or non-numeric never satisfies it ⇒
      honest-nightly.

    ``min_asof_param`` adds the in-session freshness half (the dead-sweeper
    contract). Pass the caller's own placeholder; this function does not choose
    a parameter style for the caller.
    """
    # ⚠️ THE `> 0` HALF IS NOT DECORATION. The spec says a NULL or NON-NUMERIC
    # `bars_asof` "never satisfies the predicate", and for NULL that is true for
    # free (NULL comparisons are not true). For a NON-NUMERIC string it is NOT:
    # SQLite's `CAST('not-a-date' AS INTEGER)` is **0**, and `20260824 > 0` is
    # TRUE — so the bare predicate would serve a live overlay against a row
    # whose anchor session is unreadable, which is the one case the sentence
    # exists to rule out. The sweep already refuses to WRITE such a row, but the
    # row's `bars_asof` can change under the overlay between two builds, so the
    # READ side has to hold the claim on its own.
    pred = (f'CAST({rows_alias}.bars_asof AS INTEGER) > 0'
            f' AND {live_alias}.live_session_ymd > '
            f'CAST({rows_alias}.bars_asof AS INTEGER)')
    if min_asof_param:
        pred += f' AND {live_alias}.live_asof >= {min_asof_param}'
    return pred


def min_serve_asof(now=None) -> float | None:
    """The in-session freshness cutoff, or ``None`` outside the regular session.

    Outside RTH the age check deliberately does NOT apply: the last sweep's
    values are that day's CLOSING prints, which are strictly more current than
    the D−1 values underneath them, and the session-date predicate already
    stops them being served once tonight's build lands.
    """
    if _session() != "regular":
        return None
    return (time.time() if now is None else now) - max_age_s()


# --------------------------------------------------------------------------- #
# the anchor algebra (spec §1.4) — and the ONE place it flips
# --------------------------------------------------------------------------- #

def _num(value):
    """A finite float, or ``None``. Bools are not numbers here."""
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _recover_level(p0: float, d):
    """``A = P₀ / (1 + d/100)`` — the level a stored distance was measured
    against, recovered exactly.

    Error budget, because this is the whole feasibility argument and it is a
    BOUND, not an adjective: ``d`` carries at most ±0.005 pp of rounding, so
    re-deriving the live distance costs ``|Δd'| ≤ 0.005 pp · (P₁/P₀)`` — the
    same half-ulp the stored column already carries, and nothing more.

    ⛔ ALL THREE GUARDS, EVERY TIME: a stored ``price > 0`` (``usable_bars``
    admits ``c == 0`` and one such row exists in the daily store today), a
    non-null ``d``, and ``1 + d/100 > 0`` (``d = −100`` is a division by zero,
    not a level).
    """
    dv = _num(d)
    if dv is None or not p0 or p0 <= 0:
        return None
    denom = 1.0 + dv / 100.0
    if denom <= 0:
        return None
    level = p0 / denom
    return level if math.isfinite(level) and level > 0 else None


def _recover_pattern_level(p0: float, d):
    """``E = P₀ · (1 + d/100)`` — the pattern pair's INVERTED form.

    ⛔ THIS IS THE ONE PLACE THE RECOVERY ALGEBRA FLIPS. ``snapshot_builder``
    writes ``pattern_entry_dist_pct = (entry/price − 1)·100`` — i.e.
    ``_pct(entry, price)``, the operands the other way round from every
    ``_pct(price, anchor)`` distance beside it. Copying the ``P₀/(1+d/100)``
    form onto this pair produces a level wrong by ``(1+d/100)²``, silently, in
    the right ballpark, on a column that names a trigger price.
    """
    dv = _num(d)
    if dv is None or not p0 or p0 <= 0:
        return None
    level = p0 * (1.0 + dv / 100.0)
    return level if math.isfinite(level) and level > 0 else None


# --------------------------------------------------------------------------- #
# the sanity gate (spec §5) — what "missing / stale / insane" means, per symbol
# --------------------------------------------------------------------------- #

def _weekday_sessions_between(d0: date, d1: date) -> int:
    """Weekdays in ``(d0, d1]``. A holiday calendar would only make this
    SMALLER, so counting weekdays ages an anchor slightly FAST — and the
    failure direction of ageing fast is "refuse and keep the nightly value",
    which is the safe one."""
    if d1 <= d0:
        return 0
    days = (d1 - d0).days
    weeks, rem = divmod(days, 7)
    n = weeks * 5
    cur = d0
    for _ in range(rem):
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            n += 1
    return n


def _to_date(ymd) -> date | None:
    try:
        v = int(str(ymd)[:8])
        return date(v // 10000, (v // 100) % 100, v % 100)
    except (TypeError, ValueError):
        return None


def anchor_age_sessions(bars_asof, ymd: int):
    """How many sessions old the row's anchor is, or ``None`` when the row does
    not say. ``None`` reads as STALE — a row whose anchor date we cannot parse
    can never satisfy the serve predicate either, so writing an overlay for it
    would produce a row nothing will ever show."""
    d0, d1 = _to_date(bars_asof), _to_date(ymd)
    if d0 is None or d1 is None:
        return None
    return _weekday_sessions_between(d0, d1)


def sanity_reason(anchor_row: dict, quote, ymd: int) -> str | None:
    """``None`` if this symbol may be written; otherwise the ONE reason it may
    not, named exactly as the receipt reports it.

    ⛔ EVERY gate must hold. A symbol failing any of them is ABSENT from the
    overlay — never a partial row, never a zero, never a guess — and the
    LEFT JOIN then serves it its nightly row, byte for byte.
    """
    if not isinstance(quote, dict):
        return "no_feed"
    today_vol = _num(quote.get("today_vol")) or 0.0
    day_open = _num(quote.get("day_open")) or 0.0
    if not (today_vol > 0 or day_open > 0):
        return "not_traded"
    p1 = _num(quote.get("last_price"))
    if p1 is None or p1 <= 0:
        return "no_price"
    prev_close = _num(quote.get("prev_close"))
    if prev_close is None or prev_close <= 0:
        return "no_prev_close"
    p0 = _num(anchor_row.get("price"))
    if p0 is None or p0 <= 0:
        return "bad_anchor"
    age = anchor_age_sessions(anchor_row.get("bars_asof"), ymd)
    if age is None or age > max_anchor_age_sessions():
        return "stale_anchor"
    if abs(p1 / p0 - 1.0) > max_deviation_pct() / 100.0:
        return "insane_deviation"
    return None


# --------------------------------------------------------------------------- #
# the derivation (spec §2.1/§2.2) — pure, no I/O
# --------------------------------------------------------------------------- #

def derive_row(anchor_row: dict, quote, ymd: int, live_asof: float,
               recomputed_out: set | None = None) -> dict | None:
    """One overlay row, or ``None`` when the sanity gate refuses the symbol.

    ⭐ THE WRITE RULE IS "COPY THE NIGHTLY VALUE FORWARD". An overlay row
    carries a value for ALL 22 columns; a column that could not be recomputed
    for this symbol (null anchor, 2-dp ``ma_stack`` tie, missing ``pt_target``,
    a feed field the snapshot parse does not yet emit) stores the NIGHTLY value
    verbatim, and ``live_cols`` counts how many were genuinely recomputed. That
    makes the overlay row a complete, self-consistent picture that can be read
    and audited on its own, and it is constraint 1 spelled literally: *not
    computable live ⇒ keeps its nightly value.*

    ``recomputed_out``, when given, is filled with the NAMES of the columns
    this row genuinely recomputed. ⭐ That is what makes the disclosure
    measured rather than declared: ``live_cols`` says HOW MANY kept 03:00, and
    only the names say WHICH — and a surface cannot subtract a count.
    """
    if sanity_reason(anchor_row, quote, ymd) is not None:
        return None

    p0 = float(_num(anchor_row.get("price")))
    p1 = float(_num(quote.get("last_price")))
    prev_close = float(_num(quote.get("prev_close")))
    day_open = _num(quote.get("day_open"))
    day_high = _num(quote.get("day_high"))
    day_open = day_open if (day_open or 0) > 0 else None
    day_high = day_high if (day_high or 0) > 0 else None

    # Seed from the nightly row: every overwrite below is an IMPROVEMENT on a
    # value that was already honest, never a hole being filled with a guess.
    out = {c: anchor_row.get(c) for c in LIVE_COLUMNS}
    recomputed = 0

    def put(col, value):
        nonlocal recomputed
        if value is None:
            return
        out[col] = value
        recomputed += 1
        if recomputed_out is not None:
            recomputed_out.add(col)

    pct = technicals._pct   # ONE rounding/None convention, the builder's own

    # levels recovered from what the 03:00 build stored
    s20 = _recover_level(p0, anchor_row.get("pct_vs_sma20"))
    s50 = _recover_level(p0, anchor_row.get("pct_vs_sma50"))
    s200 = _recover_level(p0, anchor_row.get("pct_vs_sma200"))
    e20 = _recover_level(p0, anchor_row.get("pct_vs_ema20"))
    ytd_base = _recover_level(p0, anchor_row.get("chg_pct_ytd"))
    h52 = _recover_level(p0, anchor_row.get("dist_52w_high_pct"))
    l52 = _recover_level(p0, anchor_row.get("dist_52w_low_pct"))
    h20 = _recover_level(p0, anchor_row.get("dist_20d_high_pct"))
    l20 = _recover_level(p0, anchor_row.get("dist_20d_low_pct"))
    hath = _recover_level(p0, anchor_row.get("dist_ath_pct"))
    p_entry = _recover_pattern_level(p0, anchor_row.get("pattern_entry_dist_pct"))
    p_stop = _recover_pattern_level(p0, anchor_row.get("pattern_stop_dist_pct"))

    put("price", p1)                                        # 1
    put("chg_pct_1d", pct(p1, prev_close))                  # 2
    put("chg_pct_ytd", pct(p1, ytd_base))                   # 3
    if day_open is not None:
        put("chg_from_open_pct", pct(p1, day_open))         # 4
        put("gap_pct", pct(day_open, prev_close))           # 5
    put("pct_vs_sma20", pct(p1, s20))                       # 6
    live_vs_s50 = pct(p1, s50)
    put("pct_vs_sma50", live_vs_s50)                        # 7
    put("pct_vs_sma200", pct(p1, s200))                     # 8
    put("pct_vs_ema20", pct(p1, e20))                       # 9

    # 10 — DERIVED FROM #7, never recomputed. Two spellings of "is it above the
    # 50-day" is exactly the second-authority defect this repo keeps paying for:
    # a row reading `pct_vs_sma50 = -0.01` beside `above_50sma = 1` is worse
    # than either number alone.
    if live_vs_s50 is not None:
        put("above_50sma", 1 if live_vs_s50 > 0 else 0)

    put("ma_stack", _live_ma_stack(anchor_row, p1, s20, s50, s200))   # 11

    # 12 — ATR is a LEVEL from completed sessions; only the numerator moves.
    atr_pct = _num(anchor_row.get("atr_pct"))
    if s50 is not None and atr_pct is not None and atr_pct > 0:
        atr = atr_pct * p0 / 100.0
        if atr > 0:
            put("atr_ext_sma50", round((p1 - s50) / atr, 2))

    put("dist_52w_high_pct", pct(p1, h52))                  # 13
    put("dist_52w_low_pct", pct(p1, l52))                   # 14
    if day_high is not None and h52 is not None:
        put("new_52w_high", 1 if day_high >= h52 else 0)    # 15
    put("dist_20d_high_pct", pct(p1, h20))                  # 16
    put("dist_20d_low_pct", pct(p1, l20))                   # 17
    put("dist_ath_pct", pct(p1, hath))                      # 18
    if day_high is not None and hath is not None:
        put("new_ath", 1 if day_high >= hath else 0)        # 19

    # 20/21 — the builder's own form, `(level/price − 1)·100`, NOT `_pct`.
    if p_entry is not None:
        put("pattern_entry_dist_pct", round((p_entry / p1 - 1) * 100, 2))
    if p_stop is not None:
        put("pattern_stop_dist_pct", round((p_stop / p1 - 1) * 100, 2))

    # 22 — `pt_target` is a STORED COLUMN, so nothing is recovered; this is the
    # builder's own derivation, including its both-factors-positive guard
    # (0.0 is `analyst_pass`'s not-computable sentinel, not a $0 target).
    pt_target = _num(anchor_row.get("pt_target"))
    if pt_target is not None and pt_target > 0:
        put("pt_upside_pct", round((pt_target / p1 - 1) * 100, 2))

    row = {
        "ticker": anchor_row.get("ticker"),
        "live_session_ymd": int(ymd),
        "live_asof": float(live_asof),
        "anchor_bars_asof": anchor_row.get("bars_asof"),
        "src_price": p1,
        "anchor_price": p0,
        "live_cols": recomputed,
    }
    row.update(out)
    return row


def _live_ma_stack(anchor_row, p1, s20, s50, s200):
    """``ma_stack`` at the live price — exactly derivable, with the tie rule
    that keeps it honest.

    The MUTUAL ORDERING of the three MAs did not change since the build (they
    are levels), and because ``A = P₀/(1+d/100)`` is strictly DECREASING in
    ``d``::

        s20 > s50   ⟺   pct_vs_sma20 < pct_vs_sma50

    — a comparison of two STORED, ROUNDED numbers, exact whenever they differ.

    ⛔ IF A NEEDED PAIR IS EQUAL AT 2 dp, KEEP THE NIGHTLY LABEL. A tie means
    the two MAs are within ~0.01% of each other, which is exactly the case
    where the member cannot see a contradiction either — the two live
    percentages they are shown are also equal. The tie is invisible by
    construction; guessing it is not.
    """
    d20 = _num(anchor_row.get("pct_vs_sma20"))
    d50 = _num(anchor_row.get("pct_vs_sma50"))
    d200 = _num(anchor_row.get("pct_vs_sma200"))
    if None in (d20, d50, d200) or None in (s20, s50, s200):
        return None
    if d20 == d50 or d50 == d200:          # the needed pairs, tied at 2 dp
        return None
    ascending = d20 < d50 < d200           # ⇒ s20 > s50 > s200
    descending = d20 > d50 > d200          # ⇒ s20 < s50 < s200
    if ascending and p1 > s20:
        return "full-bull"
    if descending and p1 < s20:
        return "bear"
    return "partial"


# --------------------------------------------------------------------------- #
# the sweep (spec §6)
# --------------------------------------------------------------------------- #

def _blank_receipt(**over) -> dict:
    """Every cycle returns the SAME KEY SET. A receipt whose shape depends on
    which branch it took is a receipt nobody can diff across cycles."""
    r = {
        "swept_at": time.time(),
        "as_of": None,
        "session": None,
        "session_ymd": None,
        "enabled": enabled(),
        "skipped_reason": None,
        "aborted": None,
        "feed_symbols": 0,
        "rows_considered": 0,
        "rows_matched": 0,
        "rows_written": 0,
        "rows_kept_nightly": 0,
        "cols_recomputed_total": 0,
        # WHICH columns, not just how many — the disclosure reads these, and a
        # count cannot be subtracted from a column list.
        "cols_recomputed_by_column": {c: 0 for c in LIVE_COLUMNS},
        "columns_not_recomputed": tuple(LIVE_COLUMNS),
        "skipped": {k: 0 for k in SKIP_REASONS},
        "dead_cycle": False,
        "feed_blackout": False,
        "lock_wait_ms": 0.0,
        "held_lock_ms": 0.0,
        "duration_ms": 0.0,
    }
    r.update(over)
    return r


def _abort_reason(matched: int, traded: int) -> str | None:
    """⛔ THE HOLIDAY ABORT, and it is not optional.

    ``massive._detect_session()`` is a CLOCK, not a calendar — on a market
    holiday it says ``"regular"`` while the feed returns ``day`` empty for
    everybody and ``last_price`` falls through to ``prevDay.c``. Without this,
    the sweep would publish ``chg_pct_1d = 0.00`` FOR THE ENTIRE UNIVERSE and
    every "up 3% today" screen would return nothing, confidently. Leaving the
    previous overlay to age out is the safe direction.

    ⚠️ WHAT THIS GATE CANNOT SEE, stated so a receipt is read correctly. It
    measures ``traded/matched`` — never ``matched/rows_considered`` — so a feed
    that answers for 3 of 3,745 symbols PASSES it and the sweep writes a 3-row
    overlay. Per row that is honest (the other 3,742 stay nightly and are
    counted under ``no_feed``), and a near-total provider outage is therefore a
    LARGE ``no_feed``, not an abort. The receipt exposes the denominator
    directly as ``rows_matched`` for exactly this reading, and the total case —
    ``rows_matched == 0`` with rows to sweep — raises ``feed_blackout`` and
    logs at WARNING. ⛔ Do not "fix" this by adding a second abort threshold on
    the match rate: symbol-form drift (spec §3.1, dot vs hyphen) and a provider
    outage look identical here, and refusing to write on drift would take the
    overlay down for a bug that costs nobody a wrong number.
    """
    if matched <= 0:
        return None
    if traded / matched < min_traded_fraction():
        return "not_a_trading_session"
    return None


def run_sweep() -> dict:
    """One cycle. Returns the receipt (spec §6); never raises for a data
    condition — a refusal is an ANSWER, and it says which one."""
    t0 = time.time()
    from api.services import scan_volume
    from api.services.screener import snapshot_builder

    if not enabled():
        return _finish(_blank_receipt(skipped_reason="disabled"), t0)

    session = _session()
    now = _now_et()
    ymd = session_ymd(now)
    receipt = _blank_receipt(session=session, session_ymd=ymd)
    if session != "regular":
        receipt["skipped_reason"] = "not_regular_session"
        return _finish(receipt, t0)

    # DDL before the lock: it is idempotent, it is not derivation, and doing it
    # under the lock would inflate `held_lock_ms` — the one number that keeps
    # "sharing the build lock is safe" a MEASUREMENT rather than a claim.
    # ⭐ And ONCE PER PROCESS, not once per cycle: `init_db` takes the global
    # `snapshot_db._WRITE_LOCK` for a CREATE TABLE + PRAGMA table_info + the
    # ALTER-add loop + 8 CREATE INDEX + two executescripts, and at ~390 cycles
    # per session that is a needless per-minute serialization point against the
    # nightly builder's own writes.
    _ensure_schema()

    # ⛔ THE SHARED LOCK, ACQUIRED NON-BLOCKING, AND NEVER QUEUED. A queued
    # sweep would run against anchors the build is rewriting underneath it.
    #
    # ⭐ WHY SHARING IT IS SAFE, WITH THE NUMBER (measured 2026-08-23 on a
    # synthetic 3,745-row universe, 5 consecutive cycles): held_lock_ms median
    # **122 ms** (121-140) for read + derive + write of the whole universe —
    # a ~0.2% duty cycle at the 60 s cadence. The 03:00 nightly can never
    # collide (this tier is RTH-only); the only reachable collision is an admin
    # `POST /api/screener/refresh` landing inside a sweep, which already answers
    # `already_in_flight` honestly and is retryable. `held_lock_ms` is on EVERY
    # receipt so this stays a measurement rather than a claim.
    t_lock = time.time()
    if not snapshot_builder._BUILD_LOCK.acquire(blocking=False):
        receipt["skipped_reason"] = "build_in_flight"
        receipt["lock_wait_ms"] = round((time.time() - t_lock) * 1000, 2)
        return _finish(receipt, t0)
    receipt["lock_wait_ms"] = round((time.time() - t_lock) * 1000, 2)

    # ⛔ RELEASE IN `finally`, AND MEASURE THERE TOO. The body returns nothing —
    # it mutates the receipt — so an early abort and a full pass leave the lock
    # and `held_lock_ms` in exactly the same state, with one release site.
    t_held = time.time()
    try:
        _sweep_locked(receipt, ymd, scan_volume)
    except sqlite3.OperationalError:
        # The one thing a once-per-process DDL flag can get wrong: the file it
        # was true of is gone (a wiped volume, a fresh mount, a test swapping
        # `SCREENER_DB_PATH` under us). Forget it so the next cycle re-runs the
        # DDL instead of failing forever on a missing table.
        _forget_schema()
        raise
    finally:
        snapshot_builder._BUILD_LOCK.release()
        receipt["held_lock_ms"] = round((time.time() - t_held) * 1000, 2)
    return _finish(receipt, t0)


#: Which screener.db files this PROCESS has already run the DDL against, keyed
#: by the resolved path so a test (or a re-pointed volume) gets its own.
_SCHEMA_READY: set = set()


def _ensure_schema() -> None:
    path = snapshot_db.get_db_path()
    if path in _SCHEMA_READY:
        return
    snapshot_db.init_db()
    _SCHEMA_READY.add(path)


def _forget_schema() -> None:
    _SCHEMA_READY.discard(snapshot_db.get_db_path())


def _sweep_locked(receipt: dict, ymd: int, scan_volume) -> None:
    """The derivation and the write, both UNDER the build lock — the anchors
    must be read from a snapshot that is not being rewritten underneath us."""
    rows = _read_anchor_rows()
    receipt["rows_considered"] = len(rows)
    snap = scan_volume.full_market_snapshot() or {}
    receipt["feed_symbols"] = len(snap)

    # Pass 1 — ONE reason per symbol, so `considered == written + Σskipped`
    # closes by construction rather than by a second count agreeing.
    graded = []
    matched = traded = 0
    for row in rows:
        quote = scan_volume._snap_lookup(snap, str(row.get("ticker") or ""))
        reason = sanity_reason(row, quote, ymd)
        if reason != "no_feed":
            matched += 1
            if reason != "not_traded":
                traded += 1
        graded.append((row, quote, reason))

    receipt["rows_matched"] = matched

    abort = _abort_reason(matched, traded)
    if abort:
        receipt["aborted"] = abort
        return                      # WRITE NOTHING; the overlay ages out.

    as_of = time.time()
    out_rows = []
    per_col = {c: 0 for c in LIVE_COLUMNS}
    for row, quote, reason in graded:
        if reason is not None:
            receipt["skipped"][reason] += 1
            continue
        got: set = set()
        derived = derive_row(row, quote, ymd, as_of, recomputed_out=got)
        if derived is None:          # defensive; the gate already answered
            receipt["skipped"]["no_feed"] += 1
            continue
        receipt["cols_recomputed_total"] += derived["live_cols"]
        for c in got:
            per_col[c] += 1
        out_rows.append(derived)

    receipt["as_of"] = as_of
    receipt["rows_written"] = snapshot_db.upsert_live_rows(out_rows)
    snapshot_db.prune_live_rows(ymd)

    # ⭐ THE DISCLOSURE IS MEASURED HERE, from the same pass that wrote the
    # rows — never declared, never a second count. A column no written row
    # recomputed is NOT live this cycle, whatever `LIVE_COLUMNS` aspires to,
    # and the surface reads `live_columns_effective()` so it structurally
    # cannot name it. Only a cycle that actually wrote something gets to move
    # the claim: a cycle that wrote nothing has measured nothing.
    receipt["cols_recomputed_by_column"] = per_col
    receipt["columns_not_recomputed"] = tuple(
        c for c in LIVE_COLUMNS if per_col[c] == 0)
    if receipt["rows_written"] > 0:
        global _EFFECTIVE_COLUMNS
        _EFFECTIVE_COLUMNS = tuple(c for c in LIVE_COLUMNS if per_col[c] > 0)


def _finish(receipt: dict, t0: float) -> dict:
    receipt["duration_ms"] = round((time.time() - t0) * 1000, 2)
    receipt["rows_kept_nightly"] = sum(receipt["skipped"].values())
    receipt["dead_cycle"] = (
        receipt["skipped_reason"] is None
        and receipt["aborted"] is None
        and receipt["rows_written"] == 0
        and receipt["rows_kept_nightly"] == 0
    )
    # ⭐ A TOTAL FEED BLACKOUT IS NOT A DEAD CYCLE, AND IT MUST STILL SHOUT.
    # `dead_cycle` is 0-written AND 0-kept; a cycle where the feed returned {}
    # has `no_feed == rows_considered`, so `rows_kept_nightly` is the whole
    # universe and `dead_cycle` is False. Members are safe (the overlay ages
    # out in SCREENER_LIVE_MAX_AGE_S), but with nothing else the ONLY tell is
    # an INFO line reading `updated=0 kept_nightly=3745` — which is precisely
    # the silent-failure shape `sweep_job`'s own docstring cites
    # (`built=3708 skipped=0 errors=0`). So it gets its own flag and its own
    # WARNING.
    receipt["feed_blackout"] = (
        receipt["skipped_reason"] is None
        and receipt["rows_considered"] > 0
        and receipt["rows_matched"] == 0
    )
    return receipt


def _read_anchor_rows() -> list[dict]:
    """The anchors for every row, in ONE query, read from a snapshot that is
    not being rewritten underneath us (we hold the build lock)."""
    cols = ", ".join(f'"{c}"' for c in READ_COLUMNS)
    with snapshot_db.connect() as conn:
        return [dict(r) for r in
                conn.execute(f"SELECT {cols} FROM screener_rows")]


#: The last receipt, for `GET /api/screener/live-status` (spec §8.3) — the
#: thing the controller reads before arming. Per-process, like every other
#: status surface on this single-uvicorn pod.
_LAST_RECEIPT: dict | None = None


def last_receipt() -> dict | None:
    return dict(_LAST_RECEIPT) if _LAST_RECEIPT else None


def sweep_job() -> dict:
    """The scheduled entry point: run one cycle, remember it, LOG IT.

    ⛔ ``rows_written`` ALONE IS NOT A RECEIPT. ``snapshot_builder``'s own
    docstring records the 2026-08-09 build that logged
    ``built=3708 skipped=0 errors=0`` while writing NULL into ``market_cap`` on
    all 3,708 rows. The per-reason ``skipped`` map and ``cols_recomputed_total``
    are what make a silent failure visible — and a cycle that updated NOBODY
    and skipped NOBODY is a DEAD JOB, so it does not get to look like a quiet
    market: it logs at WARNING and says the words.

    THREE things get a WARNING, because three different things can go quiet:

    * ``feed_blackout`` — the snapshot answered for nobody. Reads as
      ``updated=0 kept_nightly=3745`` at INFO otherwise, which is the exact
      shape of the build above.
    * ``dead_cycle`` — 0 updated AND 0 kept: the job answered for no one at all.
    * a raised cycle — stamped into ``_LAST_RECEIPT`` before it re-raises, so
      the status endpoint cannot keep showing the last good sweep.

    The INFO line names ``not_live=`` — the columns this cycle carried forward
    from 03:00, BY NAME — so the log and the member-facing disclosure are
    reading the same measurement.
    """
    global _LAST_RECEIPT
    try:
        receipt = run_sweep()
    except Exception as exc:
        # ⛔ A THROWN CYCLE MUST NOT LEAVE THE LAST GOOD RECEIPT STANDING. The
        # scheduler wrapper swallows this so the job survives, and without a
        # stamp here `GET /api/screener/live-status` would keep serving the
        # last successful cycle with only a slowly-ageing `swept_at` as the
        # tell — a status surface reading healthy through a total failure.
        _LAST_RECEIPT = _blank_receipt(skipped_reason="error",
                                       aborted=f"{type(exc).__name__}: {exc}")
        log.warning("[screener-live] cycle RAISED (%s: %s) — the overlay ages "
                    "out and the status endpoint now says so", type(exc).__name__, exc)
        raise
    _LAST_RECEIPT = receipt
    if receipt["skipped_reason"]:
        log.info("[screener-live] cycle skipped: %s (session=%s)",
                 receipt["skipped_reason"], receipt["session"])
        return receipt
    reasons = " ".join(f"{k}={receipt['skipped'][k]}" for k in SKIP_REASONS)
    not_live = ",".join(receipt["columns_not_recomputed"]) or "-"
    line = (
        f"as_of={receipt['as_of']} session_ymd={receipt['session_ymd']} "
        f"updated={receipt['rows_written']} "
        f"kept_nightly={receipt['rows_kept_nightly']} ({reasons}) "
        f"cols_recomputed={receipt['cols_recomputed_total']} "
        f"not_live={not_live} "
        f"rows_considered={receipt['rows_considered']} "
        f"rows_matched={receipt['rows_matched']} "
        f"feed_symbols={receipt['feed_symbols']} "
        f"aborted={receipt['aborted']} "
        f"lock_wait_ms={receipt['lock_wait_ms']} "
        f"held_lock_ms={receipt['held_lock_ms']} "
        f"duration_ms={receipt['duration_ms']}"
    )
    if receipt["feed_blackout"]:
        log.warning("[screener-live] FEED BLACKOUT — the snapshot answered for "
                    "0 of %d symbols; every row keeps its nightly value and the "
                    "overlay ages out. %s", receipt["rows_considered"], line)
    elif receipt["dead_cycle"]:
        log.warning("[screener-live] DEAD CYCLE — 0 updated and 0 kept-nightly: "
                    "this sweep answered for NOBODY. %s", line)
    elif receipt["aborted"]:
        log.warning("[screener-live] ABORTED (%s) — wrote nothing, the previous "
                    "overlay ages out. %s", receipt["aborted"], line)
    else:
        log.info("[screener-live] %s", line)
    return receipt
