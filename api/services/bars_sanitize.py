"""Serve-time normalization of daily/weekly/monthly chart bars.

Fixes three provider data-quality classes on the D/W/M serve path, SOURCE-
AGNOSTIC (works the same whether the bars came from Massive's adjusted feed, the
unadjusted-yfinance deep-history graft, or FMP):

  1. TICKER REUSE — a recycled ticker carries the PRIOR security's history
     (SPCX = SpaceX, but the ticker was Tuttle's SPAC ETF before June 2026;
     DRAM = Roundhill Memory ETF, but was Dataram Corp until ~2017). The old
     security's bars sit before a data gap that resumes at the new listing date.
     We drop everything before that gap.

  2. PROVIDER SPLIT GAPS — Massive's `adjusted=true` feed silently MISSES some
     older splits (e.g. MNST's 2012 2:1), leaving a fake ~Nx cliff at the split
     date; the unadjusted-yfinance deep tail has the same problem. For each known
     split we detect whether the boundary is still un-adjusted (close ratio ≈ the
     split factor) and, if so, apply the missing factor to the pre-split bars so
     the whole series is consistently split-adjusted to the most-recent basis.

  3. LONE BAD BARS — a single erroneous print (e.g. NVDA 2024-06-10 high=195.95
     while open/close ≈ 120, which TradingView/TC2000 don't show). We clamp an
     extreme wick that neither the bar's own body NOR its neighbors corroborate.

Design constraints (honors the bars-pipeline invariants):
  • READ-ONLY transform of the SERVED bars — never touches the SQLite store, so
    newest-bar-wins / delta / weekly-key logic is unaffected.
  • Metadata (listing date + split list) is read from cache ONLY, never fetched
    synchronously on the request path (the 524-outage invariant: no unbounded
    external calls on the serve path). A cold miss serves the un-normalized bars
    for that step and schedules a bounded, deduped background warm; the next
    serve is clean.
  • The common case (a normal ticker with no reuse gap) is a couple of O(bars)
    passes with NO network and NO metadata lookup.

Kill switch: BARS_SANITIZE_ENABLED=0.
"""
from __future__ import annotations

import math
import os
import time
import threading
import logging
import contextlib
import contextvars
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_ENABLED = os.environ.get("BARS_SANITIZE_ENABLED", "1") == "1"

# ── Metadata cache (listing date + splits) ──────────────────────────────────
_META_KEY = "barsan_meta_{}"
# ⚡ ITS OWN CACHE, sized for the universe (2026-11-12). The metadata lived in the SHARED app
# cache, an LRU of 1,000 entries that also holds news, snapshots and per-user bars keys, so a
# 7-day entry was evicted within minutes and re-fetched from FMP (two calls per ticker) all day,
# not once a week; the boot probe showed `barsan-warm` busy through the whole warm-up window.
# Entries are tiny (an IPO date and a few splits).
_META_CACHE_MAX = 20000
_META_CACHE = TTLCache(max_size=_META_CACHE_MAX)
_META_TTL = 7 * 24 * 3600      # success: 7 days (corporate actions rarely change)
_META_FAIL_TTL = 3600         # transient failure: retry in ~1h, don't hammer

_warm_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="barsan-warm")
_warm_inflight: set[str] = set()
_warm_lock = threading.Lock()

# ── The brake on the meta warmer ────────────────────────────────────────────
# 🔴 2026-08-19: a worker boot pass logged ~470 `meta fetch failed` warnings in two
# minutes. FMP answered normally seconds later — a rate-limit burst, not an outage.
# The warmer kept asking after the provider had already refused: two pool threads at
# ~0.04s/call is ~50 calls/sec, far over FMP's per-minute allowance, so once a sweep
# got ahead of the limit it stayed there. Raising MetaUnavailable (see _fetch_meta)
# made that VISIBLE; this makes it STOP.
#
# ⛔ Backing off is not hiding it — the warning still fires, there are just a handful
# per pause instead of hundreds. And a refusal is never cached as "no splits": the
# gate skips the CALL, so nothing is written at all.
_WARM_BACKOFF_MAX = 600.0
_warm_gate_lock = threading.Lock()
_warm_paused_until = 0.0
_warm_fail_streak = 0


def _now() -> float:
    """Indirection so the backoff is testable without sleeping."""
    return time.time()


def _warm_backoff_base() -> float:
    """Seconds for the FIRST pause; doubles per consecutive refusal.
    0 disables the brake (the pre-2026-08-19 behaviour), no deploy needed."""
    try:
        return float(os.environ.get("BARS_SANITIZE_WARM_BACKOFF_SECONDS", "30"))
    except (TypeError, ValueError):
        return 30.0


def _reset_warm_gate() -> None:
    """Test seam — module globals carry between tests and poison later ones."""
    global _warm_paused_until, _warm_fail_streak
    with _warm_gate_lock:
        _warm_paused_until = 0.0
        _warm_fail_streak = 0


def _warm_gate_open() -> bool:
    if _warm_backoff_base() <= 0:
        return True
    with _warm_gate_lock:
        return _now() >= _warm_paused_until


def _warm_note_failure() -> float:
    """The provider refused. Pause, exponentially, capped. Returns the deadline."""
    global _warm_paused_until, _warm_fail_streak
    base = _warm_backoff_base()
    with _warm_gate_lock:
        _warm_fail_streak += 1
        delay = min(base * (2 ** (_warm_fail_streak - 1)), _WARM_BACKOFF_MAX)
        _warm_paused_until = _now() + delay
        return _warm_paused_until


def _warm_note_success() -> None:
    """⛔ Must reset the STREAK, not just the deadline — otherwise one bad minute
    keeps the warmer half-asleep all day and split repair silently lags it."""
    global _warm_paused_until, _warm_fail_streak
    with _warm_gate_lock:
        _warm_fail_streak = 0
        _warm_paused_until = 0.0

# When set, a cold-metadata miss does NOT schedule a background FMP warm — the
# caller wants cache-only sanitize with ZERO provider calls. The bars-pack
# builder sweeps the whole universe; without this, a first build over
# never-served long-tail tickers would schedule thousands of corporate-action
# warms at once. Default False → serve-path behavior is unchanged.
_suppress_warm: contextvars.ContextVar = contextvars.ContextVar("bars_sanitize_suppress_warm", default=False)


@contextlib.contextmanager
def suppress_meta_warm():
    """Within this context, cold-metadata misses use the metadata-free sanitize
    path and never schedule a provider fetch. Used by the bars-pack builder so a
    universe sweep costs zero FMP calls; the metadata cache still warms naturally
    on the normal serve/prewarm path."""
    token = _suppress_warm.set(True)
    try:
        yield
    finally:
        _suppress_warm.reset(token)

# ── Tunables ────────────────────────────────────────────────────────────────
_GAP_MIN_DAYS = 21            # a gap this big + a listing-date match ⇒ reuse
_GAP_STANDALONE_DAYS = 150    # a gap this big ⇒ reuse even without listing metadata
_GAP_ALIGN_TOL_DAYS = 12      # gap must resume within this many days of the listing
_REUSE_PRICE_FACTOR = 4.0    # a gap WITH a ≥4× (or ≤¼×) price jump ⇒ reuse, no metadata
#: The calendar days one bar of each timeframe spans when NOTHING is missing. A gap is measured as the
#: EXCESS over it, so every threshold above means "days of missing history" on every timeframe.
#: ⚰️ 2026-11-18: the gap was a raw step, and a MONTHLY series' every step (28-31 days) is >= 21. Its
#: "largest gap" was simply its first 31-day step, resuming on the month after the listing month (RDDT
#: 2024-04-01, SPY 1993-02-01), which sits within the alignment tolerance of the cached ipoDate (2024-03-21,
#: 1993-01-29): the cut dropped the LISTING MONTH (TradingView's 1M chart has it: RDDT from 2024-03-01, 33
#: months). Only where the profile was cached, so it came and went with the metadata cache; the
#: metadata-free price-ratio branch could cut the same false gap on a volatile month. Daily is unchanged.
_NOMINAL_STEP_DAYS = {"D": 0, "W": 7, "M": 31}
_SPLIT_TOL = 0.15            # |observed/expected − 1| ≤ this ⇒ boundary is unadjusted
_WICK = 1.40                 # a wick > body*this AND > neighbor*this is a lone spike

#: 🔴 THE DECLARED SPLIT DATE IS NOT THE SESSION THE PRICE STEPPED ON, AND DD
#: IS THE MEASUREMENT. FMP declares DuPont's 1-for-3 on **2026-06-24**; the step
#: in our store is on **2026-06-18** (`47.95 → 143.13`), four sessions earlier —
#: providers publish a record/payable date where the tape moved on the ex-date.
#: A date-EXACT boundary lookup therefore compared `20260623 c=140.01` against
#: `20260624 c=137.82`, read a ratio of 1.016 against an expected 0.3333, and
#: declined — so DD's split was healed NOWHERE, chart included. Measured: 0 rows
#: changed by this module for DD, `SMA200 = 50.19` against an independent
#: 133.89.
#:
#: ⛔ THE WINDOW ONLY SAYS WHERE TO LOOK — THE RATIO TEST IS STILL WHAT
#: AUTHORISES A CHANGE. Nothing is adjusted unless some boundary inside the
#: window shows a close step matching the DECLARED factor to `_SPLIT_TOL`, so a
#: ticker with no declared split is never scanned at all and a declared split
#: whose factor nothing matches is still left alone.
#:
#: ⚠️ AND THE BOUNDARY IT FINDS IS THE ONE THAT GETS APPLIED, NOT THE DECLARED
#: DATE. Applying DD's factor at 2026-06-24 would have multiplied the six
#: sessions 06-18…06-23 — already at the post-split scale — by three, turning
#: $143 into $429. Finding the true boundary is the correctness of the repair,
#: not a nicety.
_SPLIT_BOUNDARY_WINDOW = 7   # sessions either side of the DECLARED split date

#: F3b' (2026-11-20): the observed step must ALSO lie in a band sized by the SPLIT ITSELF,
#: `|ln(observed / r)| <= _SPLIT_SIZE_TOL * |ln r|`, ANDed with the `_SPLIT_TOL` band (never looser).
#: ⚰️ MEASURED ON PRODUCTION 2026-11-20. 15% of r admits an ordinary down day for every small r:
#:   - BBD: 1.2 declared, a 6.4% and a 4.4% day matched, so 2002-2019 were served x1/1.2 and x1/1.44.
#:   - CIG: 1.25 declared, so 1996-2012 were served x0.8.
#:   - HUBB: 4:3 declared, a 1.1675 stale-quote step matched, so 1977 was served x0.75.
#:   The vendor already carried every one of these. The real heals all match their ratio closely:
#:   DD (0.33501 vs 1/3), ABTC, AXIA (exact), MNST's 2012 2:1.
#: ⚠️ THE COST, stated: an unadjusted small split whose session ALSO moved more than r ** 0.25
#: (1.2 -> 4.66%) is declined. It is reported (`declined`) and logged by name, not lost silently.
#: Rails: tests/test_split_heal_guards.py.
_SPLIT_SIZE_TOL = 0.25


def adjudicable(ratio: float, tol: float = _SPLIT_TOL) -> bool:
    """Can the ratio test tell this corporate action apart from an ORDINARY DAY?

    🔴 MEASURED, 2026-08-09, against the live store. The test is
    ``|observed/ratio − 1| <= _SPLIT_TOL`` — a **relative** tolerance, so the band
    it accepts is ``ratio × [1−tol, 1+tol]``. For DD's 3-for-1 (`ratio 0.3333`)
    that is `[0.2833, 0.3833]`: tight, and the real step measured `0.33501`. For a
    **1.03 stock dividend** it is `[0.8755, 1.1845]` — **a flat day (1.0) is inside
    it**, and `_SPLIT_BOUNDARY_WINDOW` offers fifteen sessions to find one. A match
    is therefore not likely but CERTAIN, for every small declared action, whether
    or not the series was ever unadjusted.

    What that cost, measured before this guard existed: a universe dry run
    proposed **251,506 rows**; checked against an independent vendor, **72 of its
    74 daily hits were already correct on both sides of the claimed boundary** —
    **239,632 rows** that rescaling would have corrupted. `split_factor`
    multiplies every matched boundary before a bar, so the error COMPOUNDS:
    Tootsie Roll declares 32 annual 3% stock dividends and `1.03**32 = 2.575`.

    ⭐ THE THRESHOLD IS DERIVED FROM `_SPLIT_TOL`, NOT TYPED BESIDE IT. A second
    hand-tuned constant here would drift the first time somebody widened the
    tolerance on one side — this repo's most-repeated defect. The rule is simply:
    **1.0 must lie OUTSIDE the accept band**, i.e. "already adjusted" must be a
    hypothesis this test is capable of rejecting. Move `_SPLIT_TOL` and this moves
    with it, by construction.

    ⚠️ WHAT THIS GIVES UP, STATED. A genuinely un-back-adjusted 3% stock dividend
    is now left alone. That is the correct trade: the error it declines to fix is
    3%, and the error it prevents is 258%. A small action needs a different
    instrument (a vendor cross-check), not a looser tolerance.
    """
    try:
        ratio = float(ratio)
    except (TypeError, ValueError):
        return False
    if not (ratio > 0):
        return False
    lo, hi = ratio * (1.0 - tol), ratio * (1.0 + tol)
    return not (lo <= 1.0 <= hi)


def _pd(s) -> date | None:
    try:
        return date.fromisoformat(str(s)[:10])
    except (ValueError, TypeError):
        return None


# ── Metadata fetch (background only) ────────────────────────────────────────
class MetaUnavailable(RuntimeError):
    """The provider did not ANSWER. Distinct from "it answered: no splits"."""


# ⚰️ D5 CP4's dual-compute (FMP's split list vs `reference_corp_actions.confirmed_splits`) was REMOVED
# on 2026-11-20. Its evidence was vacuous: nothing writes that ledger in production
# (`refresh_confirmed_splits` has no caller), so `read_confirmed_splits` returned [] on the pod and every
# sampled line read FMP_ONLY. A comparison against an empty table looks like an instrument and measures
# nothing. The ledger's read/write functions and their tests stay; wiring a vendor split feed is a later
# unit, not this one.


def _fetch_meta(ticker: str) -> dict:
    """Listing date + split list for `ticker`. RAISES when the provider refused.

    🔴 "NO SPLITS DECLARED" AND "THE PROVIDER WOULD NOT SAY" ARE DIFFERENT FACTS,
    AND `_fmp_get` COLLAPSES THEM. It catches every error and returns `None`, so a
    **429 used to arrive here as `{"splits": []}`** — indistinguishable from a
    ticker with no corporate actions. The caller then cached that as a SUCCESS
    (`_META_TTL`, seven days) and every sweep for a week reported the ticker
    clean without ever having asked.

    Measured on 2026-08-09: during one universe sweep, **72 requests 429'd across
    38 tickers**, each silently marked clean; and a targeted re-run on `DD`/`ABTC`
    — two tickers PROVEN minutes earlier to carry an unadjusted split — printed
    `0 (ticker, tf) carry an unadjusted split; 0 rows rewritten`. A green line
    over a run that asked nothing.

    ⭐ Only the SPLITS call is load-bearing. A failed `/stable/profile` degrades
    `ipo` to `None`, which `_apply_listing_cutoff` already handles by falling back
    to its standalone-gap rule — so that one stays best-effort rather than
    failing the whole fetch.

    Every caller already has an `except` that caches a short-lived empty sentinel
    (`_META_FAIL_TTL`, 1h) or counts `meta_failed`, so raising here turns a silent
    seven-day lie into a bounded retry.
    """
    ipo = None
    splits: list[tuple[str, float]] = []
    try:
        from api.services.earnings_estimates import _fmp_get
        prof = _fmp_get("/stable/profile", {"symbol": ticker})
        if isinstance(prof, list) and prof:
            ipo = (prof[0] or {}).get("ipoDate") or None
        raw = _fmp_get("/stable/splits", {"symbol": ticker, "limit": 40})
        if raw is None:
            raise MetaUnavailable(
                f"corporate-action fetch for {ticker} returned no answer "
                f"(rate limit, transport error, or missing FMP_API_KEY) — "
                f"this is NOT 'no splits declared'"
            )
        if isinstance(raw, list):
            for s in raw:
                d = str(s.get("date") or "")[:10]
                num, den = s.get("numerator"), s.get("denominator")
                try:
                    r = float(num) / float(den)
                except (TypeError, ValueError, ZeroDivisionError):
                    continue
                if d and r > 0:
                    splits.append((d, r))
    except Exception as e:  # noqa: BLE001
        _log.warning("bars_sanitize meta fetch failed for %s: %s", ticker, e)
        raise
    return {"ipo": ipo, "splits": splits}


def _warm_meta(ticker: str) -> None:
    if _suppress_warm.get():
        return  # caller wants cache-only sanitize (e.g. the bars-pack builder)
    if not _warm_gate_open():
        # The provider just refused. A burst of identical refusals carries no more
        # information than the first one, and asking through a rate limit is what
        # keeps us inside it. Returning here writes NOTHING — the ticker stays a
        # cold miss and is retried once the gate reopens.
        return

    def _run():
        try:
            meta = _fetch_meta(ticker)
            _META_CACHE.set(_META_KEY.format(ticker), meta, ttl=_META_TTL)
            _warm_note_success()
        except Exception:
            _warm_note_failure()
            # Cache an empty sentinel briefly so we retry later without hammering.
            _META_CACHE.set(_META_KEY.format(ticker), {"ipo": None, "splits": []},
                      ttl=_META_FAIL_TTL)
        finally:
            with _warm_lock:
                _warm_inflight.discard(ticker)

    with _warm_lock:
        if ticker in _warm_inflight:
            return
        _warm_inflight.add(ticker)
    try:
        _warm_pool.submit(_run)
    except Exception:
        with _warm_lock:
            _warm_inflight.discard(ticker)


def _meta_cached(ticker: str) -> dict | None:
    """Return cached metadata dict, or None (and schedule a warm) on a cold miss."""
    m = _META_CACHE.get(_META_KEY.format(ticker))
    if m is not None:
        return m
    _warm_meta(ticker)
    return None


# ── Step 1: ticker-reuse listing cutoff ─────────────────────────────────────
def _resume_aligns_with_listing(resume_d, ipo, tf: str) -> bool:
    """Does the bar that resumes after the gap open the new listing? Within the tolerance of the
    listing day, or (M) the listing day lies inside the resume bar's own month: a monthly bar is keyed
    on its month's 1st, so a listing late in the month is still that month's. (A weekly bar is keyed on
    its Friday, and every day of its week is within the tolerance already.)"""
    if abs((resume_d - ipo).days) <= _GAP_ALIGN_TOL_DAYS:
        return True
    return tf == "M" and (resume_d.year, resume_d.month) == (ipo.year, ipo.month)


def _apply_listing_cutoff(bars: list[dict], meta: dict | None, tf: str = "D") -> list[dict]:
    """Drop the OLD security's bars from a recycled ticker.

    A reused ticker has a large data gap whose resumption aligns with the new
    security's listing date. Normal continuously-traded tickers have no such gap,
    so this is a fast no-op for them (single O(bars) scan, no metadata needed
    unless a suspicious gap is present).

    ⭐ PERIOD-AWARE (2026-11-18): a gap is the EXCESS of a step over one bar's span
    (`_NOMINAL_STEP_DAYS`: a month's 31 days, a week's 7, a day's 0), so a monthly
    series' ordinary month-to-month step is no gap, and the listing alignment reads
    the resume bar's PERIOD (a monthly bar is keyed on its month's 1st, a weekly one
    on its Friday, while the listing day falls anywhere inside it)."""
    if len(bars) < 2:
        return bars
    # The series starts at the bar after the NEWEST listing break, the store's own rule
    # (`listing_break.is_break`, so the chart and the RS Rating / screener agree on where a
    # symbol's history starts):
    #   * a gap >= _GAP_MIN_DAYS WITH a >= _REUSE_PRICE_FACTOR close jump either way (SPCX:
    #     ~$22 SPAC ETF -> ~$150 SpaceX; DRAM: ~$1 Dataram -> ~$50 ETF). A multi-week HALT of
    #     the same company resumes near its pre-halt price, and a reverse split is same-day.
    #     Metadata-free, so it cuts on the FIRST serve, before the ipoDate metadata warms;
    #   * a gap >= _GAP_STANDALONE_DAYS on its own;
    #   * and, the chart's own third branch, a gap >= _GAP_MIN_DAYS that resumes within
    #     _GAP_ALIGN_TOL_DAYS of the provider's listing date (a halt of the SAME company keeps
    #     its old ipoDate, so it never aligns).
    # ⚰️ 2026-11-18, production: this judged only the LARGEST gap. A symbol held by three
    # securities lost the oldest one and kept the middle one: ADPT served Adeptus Health
    # 2014-06 .. 2017-04 ($1.41) in front of Adaptive Biotechnologies (2019-06-27, $40.30),
    # while the store readers already cut at the newest break.
    # ⭐ PERIOD-AWARE (2026-11-18): every gap below is the EXCESS of a step over one bar's span
    # (`_NOMINAL_STEP_DAYS`), so `is_break` is asked about days of MISSING history on every timeframe
    # (a daily step is unchanged; a monthly series' 31-day step is no gap), and a monthly resume bar
    # aligns with a listing inside its own month (`_resume_aligns_with_listing`).
    step = _NOMINAL_STEP_DAYS.get(tf, 0)
    from api.services import listing_break as _lb
    ipo = _pd((meta or {}).get("ipo"))
    cut = 0
    prev_d = _pd(bars[0]["t"])
    for i in range(1, len(bars)):
        d = _pd(bars[i]["t"])
        if prev_d and d:
            g = (d - prev_d).days - step
            if g >= _GAP_MIN_DAYS and (
                    _lb.is_break(g, bars[i - 1].get("c"), bars[i].get("c"))
                    or (ipo is not None and _resume_aligns_with_listing(d, ipo, tf))):
                cut = i
        prev_d = d
    return bars[cut:] if cut else bars


# ── Step 2: split-adjustment self-heal ──────────────────────────────────────
def _within_split_size(observed: float, ratio: float) -> bool:
    """F3b': is the observed step the size of THIS split? `|ln(observed/r)| <= _SPLIT_SIZE_TOL * |ln r|`.
    The `_SPLIT_TOL` band is checked separately and both must hold (see `_SPLIT_SIZE_TOL`)."""
    return abs(math.log(observed / ratio)) <= _SPLIT_SIZE_TOL * abs(math.log(ratio))


def _declared_after(splits: list[tuple[str, float]], end) -> list[tuple[str, float]]:
    """F3a: the declared splits dated after a rebuilt series' `end` (none when `end` is unknown)."""
    if not end:
        return []
    e = str(end)[:10]
    return [(d, r) for d, r in (splits or ()) if str(d)[:10] > e]


#: (ticker, tf, declared, ratio) already logged by `_note_declined` in this process: a chart serves the
#: same series many times, and the name needs saying once. Bounded: cleared when it grows past the cap.
_DECLINED_SEEN: set[tuple] = set()
_DECLINED_SEEN_MAX = 20_000


def _note_declined(ticker: str, tf: str, declined: list) -> None:
    """Log each heal F3b' declined, by name, once per process, so a missed real small split is visible
    (tools/bars_rescale_check.py reports the same from a store). Never raises."""
    for d in declined or ():
        try:
            key = (str(ticker).upper(), tf, d["declared"], round(float(d["ratio"]), 6))
            if key in _DECLINED_SEEN:
                continue
            if len(_DECLINED_SEEN) >= _DECLINED_SEEN_MAX:
                _DECLINED_SEEN.clear()
            _DECLINED_SEEN.add(key)
            _log.warning("[split-heal declined] %s tf=%s declared %s r=%.4f: the step at %s is %.4f, "
                         "outside the split-size band (F3b'); not healed", key[0], tf, d["declared"],
                         float(d["ratio"]), d["at"], float(d["observed"]))
        except Exception:  # noqa: BLE001 - a log line never breaks a serve
            continue


def unadjusted_splits(bars: list[dict],
                      splits: list[tuple[str, float]],
                      *, window: int = _SPLIT_BOUNDARY_WINDOW,
                      declined: list | None = None,
                      ) -> list[tuple[date, float]]:
    """`[(boundary_date, ratio)]` — the declared splits this SERIES has NOT had
    applied, each paired with the date of the FIRST bar at the post-split scale.

    ⭐ THIS IS THE ONE DETECTOR. `bars_sanitize` heals the SERVED copy and
    `bars_split_repair` heals the STORE, and both ask this function — so the
    chart and the alert/scan/screener lanes cannot come to different conclusions
    about whether a split was applied. A second implementation of this judgement
    is the *second authority over one value* defect that has cost this repo
    three separate outages; there is deliberately only one.

    For each declared split we look for a boundary in `± window` sessions of the
    declared date where `close[i-1] / close[i]` matches the declared factor to
    `_SPLIT_TOL`. A boundary that is continuous (ratio ≈ 1) means the provider
    already adjusted it; anything that matches nothing is ambiguous and is left
    alone. Only real, QUANTIFIED, split-sized discontinuities are reported, so
    genuine earnings/news gaps never appear here.

    ⛔ IDEMPOTENT BY CONSTRUCTION, WHICH IS WHY IT IS SAFE TO RUN OVER A LIVE
    STORE. The evidence it fires on is the discontinuity itself; once a series is
    adjusted the observed ratio at that boundary is ≈ 1 and no factor matches, so
    a second pass reports nothing and rewrites nothing.

    ⛔ TWO MORE CONDITIONS (2026-11-20, tests/test_split_heal_guards.py):
      * F3b': the step must also be the size of THIS split (`_within_split_size`). A candidate the
        `_SPLIT_TOL` band accepts and this rejects is appended to `declined` (when given) as
        `{"declared", "ratio", "at", "observed"}`, so a caller can name it instead of losing it.
      * F3c: a zero-volume bar is never evidence. Each bar that traded is compared with the previous bar
        that TRADED (a filler carries the prior close, so a split right after one is still seen); `v`
        absent is unknown, not zero (session closes built from intraday bars carry none).
    """
    if not splits or len(bars) < 2:
        return []
    bar_dates = [_pd(b["t"]) for b in bars]
    # F3c: the previous bar that traded, for every bar (None before the first one).
    live = [b.get("v") is None or b.get("v") != 0 for b in bars]
    prev_live: list[int | None] = []
    last = None
    for i, ok in enumerate(live):
        prev_live.append(last)
        if ok:
            last = i
    out: list[tuple[date, float]] = []
    for sd_str, ratio in splits:
        sd = _pd(sd_str)
        try:
            ratio = float(ratio)
        except (TypeError, ValueError):
            continue
        if not sd or not (ratio > 0):
            continue
        # ⛔ A declared action whose accept band contains 1.0 cannot be told from
        # an ordinary session — see `adjudicable`. Skipping it is the difference
        # between healing DD and multiplying Tootsie Roll's history by 2.575.
        if not adjudicable(ratio):
            continue
        # The declared date's own boundary: the first bar on/after it.
        anchor = None
        for i, bd in enumerate(bar_dates):
            if bd is not None and bd >= sd:
                anchor = i
                break
        if anchor is None or anchor < 1:
            continue  # split outside the data range (after last / before first)
        lo, hi = max(1, anchor - window), min(len(bars) - 1, anchor + window)
        best: tuple[float, date, float] | None = None
        best_declined: tuple[float, date, float] | None = None
        for i in range(lo, hi + 1):
            j = prev_live[i]
            # F3c: only a bar that traded, against the previous bar that traded inside the window.
            if not live[i] or j is None or j < lo - 1:
                continue
            if bar_dates[i] is None or bar_dates[j] is None:
                continue
            c_prev, c_cur = bars[j].get("c"), bars[i].get("c")
            if not c_prev or not c_cur or c_prev <= 0 or c_cur <= 0:
                continue
            observed = c_prev / c_cur
            err = abs(observed / ratio - 1.0)
            if err > _SPLIT_TOL:
                continue
            if not _within_split_size(observed, ratio):
                if best_declined is None or err < best_declined[0]:
                    best_declined = (err, bar_dates[i], observed)
                continue
            if best is None or err < best[0]:
                best = (err, bar_dates[i], ratio)
        if best is not None:
            out.append((best[1], best[2]))
        elif best_declined is not None and declined is not None:
            declined.append({"declared": sd.isoformat(), "ratio": ratio,
                             "at": best_declined[1].isoformat(), "observed": best_declined[2]})
    return out


def session_closes(bars: list[dict]) -> list[dict]:
    """Collapse an INTRADAY series (`t` = unix seconds) to one bar per ET session:
    `{"t": "YYYY-MM-DD", "c": <the session's last close>}`, oldest-first.

    Pure. A bar whose `t` cannot be read is skipped, never guessed. The session is
    the America/New_York calendar date, the same convention as
    `bars_fetch._payload_last_session_yyyymmdd`."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    last: dict[str, float] = {}
    for b in bars:
        try:
            d = datetime.fromtimestamp(int(b["t"]), tz=et).date().isoformat()
        except (KeyError, TypeError, ValueError, OverflowError, OSError):
            continue
        c = b.get("c")
        if c is None:
            continue
        last[d] = c          # oldest-first input ⇒ the session's LAST close wins
    return [{"t": d, "c": last[d]} for d in sorted(last)]


def intraday_unadjusted_splits(bars: list[dict],
                               splits: list[tuple[str, float]],
                               ) -> list[tuple[date, float]]:
    """TERM-055 — the intraday split detector. `[(boundary_session, ratio)]` for each
    declared split an INTRADAY series shows as an unapplied, split-sized cliff.

    ⭐ NOT A SECOND DETECTOR. The judgement is `unadjusted_splits` (the one detector),
    asked of the series' per-session closes: a split happens between two sessions,
    so the last close before it and the last close after it carry the factor exactly
    as two daily closes do. Same `_SPLIT_TOL`, same `adjudicable` guard (a 3% stock
    dividend is never reported), same ± window around the DECLARED date.

    Pure: no store, no network, no metadata fetch. A split outside the series' range
    is not reported (the series does not contain it, so it cannot show a cliff)."""
    if not splits or len(bars) < 2:
        return []
    return unadjusted_splits(session_closes(bars), splits)


def split_factor(bar_date: date, unadjusted: list[tuple[date, float]]) -> float:
    """The factor a bar dated `bar_date` must be divided by to reach the
    post-split basis. `1.0` means the bar is already on it."""
    f = 1.0
    for boundary, ratio in unadjusted:
        if bar_date < boundary:
            f *= ratio
    return f


def scale_bar(bar: dict, f: float) -> dict:
    """Rescale one bar IN PLACE by split factor `f` and return it.

    ⛔ THE ROUNDING LIVES HERE, ONCE. The served copy and the stored rows must
    land on the same digits or the chart and the screener disagree by a rounding
    step — which is the very split-brain this module exists to close.
    """
    if f == 1.0:
        return bar
    for k in ("o", "h", "l", "c"):
        v = bar.get(k)
        if v is not None:
            bar[k] = round(v / f, 4)
    v = bar.get("v")
    if v:
        bar["v"] = round(v * f)
    return bar


def _apply_split_adjust(bars: list[dict], splits: list[tuple[str, float]],
                        unadjusted: list[tuple[date, float]] | None = None,
                        ) -> list[dict]:
    """Make the series consistently split-adjusted to the most-recent basis."""
    if unadjusted is None:
        unadjusted = unadjusted_splits(bars, splits)
    if not unadjusted:
        return bars
    for b in bars:
        bd = _pd(b["t"])
        if bd is None:
            continue
        scale_bar(b, split_factor(bd, unadjusted))
    return bars


# ── Step 3: lone bad-bar wick clamp (daily only) ────────────────────────────
def _clamp_wicks(bars: list[dict], keep: dict | None = None) -> list[dict]:
    """Clamp a single absurd wick the body AND both neighbors disagree with —
    a provider bad print (e.g. NVDA 2024-06-10 high=195.95 vs body ~121). Very
    rare (≈1 bar in NVDA's 23-year history), so the conservative threshold never
    touches a genuinely volatile bar (whose neighbors would also be elevated).

    ⭐ D1 (owner decision 2026-11-20): `keep` = {date: {field: value}} from the corrections ledger
    (`bars_corrections.keep_wicks`): wicks a second vendor independently shows (PG's 2010-05-06 flash-crash low).
    The clamp never trims those while the bar still holds that value. Everything else is trimmed as before,
    including pre-vendor (Yahoo-sourced) bars, which no second vendor can confirm."""
    n = len(bars)
    keep = keep or {}
    for i in range(n):
        b = bars[i]
        o, h, l, c = b.get("o"), b.get("h"), b.get("l"), b.get("c")
        if None in (o, h, l, c) or h <= 0 or l <= 0:
            continue
        body_hi, body_lo = max(o, c), min(o, c)
        ph = bars[i - 1]["h"] if i > 0 else h
        nh = bars[i + 1]["h"] if i < n - 1 else h
        pl = bars[i - 1]["l"] if i > 0 else l
        nl = bars[i + 1]["l"] if i < n - 1 else l
        kd = keep.get(str(b.get("t"))[:10]) if keep else None
        # Upper wick: high far above the body AND above both neighbors' highs.
        if body_hi > 0 and h > body_hi * _WICK and h > max(ph, nh) * _WICK:
            if not (kd and _kept(kd.get("h"), h)):
                b["h"] = round(max(body_hi, ph, nh), 4)
        # Lower wick: low far below the body AND below both neighbors' lows.
        if l > 0 and body_lo > 0 and l < body_lo / _WICK and l < min(pl, nl) / _WICK:
            if not (kd and _kept(kd.get("l"), l)):
                b["l"] = round(min(body_lo, pl, nl), 4)
    return bars


def _kept(value, current) -> bool:
    """Does the ledger's keep value still describe this bar's wick?"""
    if value is None:
        return False
    from api.services import bars_corrections as _cor
    return _cor.same_value(current, value)


# ── Store repair hand-off ───────────────────────────────────────────────────
_repair_inflight: set[tuple[str, str]] = set()


def _schedule_store_repair(ticker: str, tf: str) -> None:
    """Hand a detected un-back-adjusted split to the STORE repairer.

    Best-effort, deduped, and OFF the request path — it rides the same bounded
    2-worker pool the metadata warm already uses, so a chart serve never waits
    on a SQLite write. Never raises: a repair that fails leaves the store exactly
    as stale as it was, and the served copy is already correct.
    """
    key = (ticker.upper(), tf)
    with _warm_lock:
        if key in _repair_inflight:
            return
        _repair_inflight.add(key)

    def _run():
        try:
            from api.services import bars_split_repair
            bars_split_repair.repair_ticker(ticker, tf, apply=True)
        except Exception as e:  # noqa: BLE001
            _log.warning("split store repair failed for %s tf=%s: %s", ticker, tf, e)
        finally:
            with _warm_lock:
                _repair_inflight.discard(key)

    try:
        _warm_pool.submit(_run)
    except Exception:  # noqa: BLE001
        with _warm_lock:
            _repair_inflight.discard(key)


def split_adjust_active() -> bool:
    """Does the SERVE path apply a missing split factor right now?

    ⭐ ONE ANSWER, TWO READERS: `sanitize_daily_bars` below asks it before
    adjusting, and `adjustment_basis` asks it before telling a member the chart
    is split-adjusted. They used to decide separately, and the label kept saying
    "adjusted by UCT" after `BARS_SPLIT_REPAIR_ENABLED=0` had stopped the
    adjustment (measured on production 2026-09-30)."""
    from api.services import bars_split_repair as _bsr
    return _ENABLED and _bsr.enabled()


def _identity_source(symbol: str, tf: str) -> list[dict]:
    """A source symbol's stored D/W/M bars, formatted, NOT sanitized (no ticker: its own listing
    cutoff would drop exactly the earlier life being borrowed, e.g. FB's Meta years)."""
    from api.services import bars_fetch as _bf
    rows = _bf._sqlite.get_bars(symbol, tf, 20000)
    return _bf._fmt_sqlite_bars(rows, tf, None) if rows else []


# ── Step 4: a W/M series is never shallower than the daily series ──────────────
# ⚰️ MEASURED ON PRODUCTION 2026-11-18. Weekly META started 2022-06-10, but daily META started at
# Facebook's 2012 IPO. XYZ weekly started in 2025 (Square's daily: 2015). WBD, TFC and ELV (monthly)
# showed the same thing. Each of these symbols was renamed or merged. Massive keys a symbol's
# aggregates from the rename, and the W/M rows carry a gap there, so the reuse cutoff (step 1) cut
# every week before it. The daily store holds the whole lineage with no gap, so its cutoff kept
# the history. One company, two depths, depending on the timeframe.
# The older W/M bars are built from the served daily series with the one W/M resampler, and only
# when both series agree where they meet.
#: A W/M series starting this many days after the stored daily series is shallow.
_DEEPEN_MIN_DAYS = {"W": 14, "M": 62}
#: The newest built bar must sit this close before the first stored one: no hole at the join.
_DEEPEN_JOIN_DAYS = {"W": 10, "M": 40}
#: Closes of the stored bars right after the first (the first can be a partial period) must agree.
_DEEPEN_CHECK_BARS = 3
_DEEPEN_TOL = 0.02
#: The W/M series built from the daily series, per (ticker, tf), as tuples: a fill reads and resamples
#: the daily store (30-60 ms for META, measured on the local store copy 2026-11-18) once per TTL, not
#: on every uncached W/M read. Tuples keep an entry small (~120 bytes a period); only renamed or
#: holed series ever get here.
_BUILT_CACHE = TTLCache(max_size=128)
_BUILT_TTL = 600


def _store_first(symbol: str, tf: str) -> date | None:
    """The first stored bar's date for (symbol, tf), or None."""
    from api.services import bars_fetch as _bf
    v = _bf._sqlite.get_first_ts(symbol, tf)
    if v is None:
        return None
    s = str(v)
    return _pd(f"{s[:4]}-{s[4:6]}-{s[6:8]}")


def _reaches_store_head(ticker: str, bars: list[dict], tf: str) -> bool:
    """Do these W/M bars start at the store's first row? A slice of the newest N rows does not, and
    it is never deepened: a 600-bar first paint of AAPL weekly starts in 2015 on purpose."""
    try:
        first = _store_first(ticker, tf)
    except Exception:  # noqa: BLE001 - no answer: not deepened
        return False
    b0 = _pd(bars[0].get("t")) if bars else None
    return first is not None and b0 is not None and b0 <= first


def _close_agrees(a: dict, b: dict) -> bool:
    try:
        x, y = float(a["c"]), float(b["c"])
    except (KeyError, TypeError, ValueError):
        return False
    return x > 0 and y > 0 and abs(y / x - 1) <= _DEEPEN_TOL


def _holes(bars: list[dict], tf: str) -> list[int]:
    """Indexes `i` where a hole longer than the join limit sits between bars[i-1] and bars[i]."""
    out, prev = [], _pd(bars[0].get("t")) if bars else None
    for i in range(1, len(bars)):
        d = _pd(bars[i].get("t"))
        if prev and d and (d - prev).days > _DEEPEN_JOIN_DAYS[tf]:
            out.append(i)
        prev = d or prev
    return out


def _agree(stored: list[dict], by_t: dict) -> bool | None:
    """True: every stored bar the built series also holds agrees on its close (one at least).
    False: one disagrees. None: no bar in common, nothing proven."""
    agreed = 0
    for b in stored:
        s = by_t.get(str(b.get("t"))[:10])
        if s is None:
            continue
        if not _close_agrees(b, s):
            return False
        agreed += 1
    return True if agreed else None


def _whole(b: dict, by_t: dict) -> dict:
    """The built bar for a stored bar's period when the stored one is a partial period (the rename
    week: META's first weekly bar held Thursday and Friday only); else the stored bar."""
    s = by_t.get(str(b.get("t"))[:10])
    if s is not None and _close_agrees(b, s) and float(s.get("v") or 0) > float(b.get("v") or 0):
        return s
    return b


def _built_periods(ticker: str, tf: str) -> list[dict]:
    """The served daily series resampled to `tf` with `bars_fetch._resample_*_iso` (fresh dicts)."""
    key = f"{ticker}:{tf}"
    hit = _BUILT_CACHE.get(key)
    if hit is None:
        daily = sanitize_daily_bars(ticker, _identity_source(ticker, "D"), "D")
        from api.services import bars_fetch as _bf
        resample = _bf._resample_weekly_iso if tf == "W" else _bf._resample_monthly_iso
        built = resample(daily, ticker=ticker) if daily else []
        hit = tuple((str(b["t"])[:10], b["o"], b["h"], b["l"], b["c"], b.get("v")) for b in built)
        _BUILT_CACHE.set(key, hit, ttl=_BUILT_TTL)
    return [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": v} for t, o, h, l, c, v in hit]


def _deepen_from_daily(ticker: str, bars: list[dict], tf: str, head: bool = True) -> list[dict]:
    """`bars` (a sanitized W/M series) with the periods the served daily series holds and they lack,
    built with `bars_fetch._resample_*_iso`: the older periods when the series starts at its store's
    head (`head`) and the daily series reaches further back, and the periods inside a hole. Each
    fill needs the stored bars next to it to agree with the built ones, and must close its gap;
    otherwise that part is unchanged. A partial period at a fill's edge becomes the whole one."""
    w0 = _pd(bars[0].get("t")) if bars else None
    if w0 is None:
        return bars
    lead = False
    if head:
        d0 = _store_first(ticker, "D")
        lead = d0 is not None and (w0 - d0).days >= _DEEPEN_MIN_DAYS[tf]
    holes = _holes(bars, tf)
    if not lead and not holes:
        return bars
    built = _built_periods(ticker, tf)
    if not built:
        return bars
    by_t = {str(b["t"])[:10]: b for b in built}
    keys = [str(b["t"])[:10] for b in built]
    n = _DEEPEN_CHECK_BARS
    out = list(bars)
    # Interior holes, newest first so earlier indexes stay valid.
    for i in reversed(holes):
        lo, hi = str(out[i - 1]["t"])[:10], str(out[i]["t"])[:10]
        inside = [by_t[k] for k in keys if lo < k < hi]
        if not inside or _agree(out[max(0, i - n):i] + out[i:i + n], by_t) is not True:
            continue
        if _holes([out[i - 1]] + inside + [out[i]], tf):
            continue  # the fill must close the hole, all of it
        out[i:i] = inside
        j = i + len(inside)
        if j < len(out) - 1:   # never the newest bar: the live, developing period stays as served
            out[j] = _whole(out[j], by_t)
    if lead:
        first_t = str(out[0]["t"])[:10]
        older = [by_t[k] for k in keys if k < first_t]
        # The head itself can be a partial period: the bars after it prove the series.
        if (older and _agree(out[1:1 + n], by_t) is True
                and (w0 - _pd(older[-1]["t"])).days <= _DEEPEN_JOIN_DAYS[tf]):
            out = older + [_whole(out[0], by_t)] + out[1:]
    return out


# ── The stored series' repairs (steps 1, 2 and 4) ───────────────────────────
def _repair_stored(ticker: str, bars: list[dict], tf: str) -> list[dict]:
    """The STORED D/W/M series with the patchwork repaired: another security's bars cut, another
    company's window replaced, an unapplied split healed, a W/M series deepened from the daily one.
    Not run over a rebuilt history (`sanitize_daily_bars`). The wick clamp (step 3) is NOT here: it
    is `sanitize_daily_bars`' one clamp, run on every daily series, rebuilt or stored.

    Never raises: a failure returns the bars as far as they got."""
    try:
        # Read before step 1 changes the head: only a series that starts at its store's first row
        # gets older periods from the daily series (step 4).
        head = tf in ("W", "M") and _reaches_store_head(ticker, bars, tf)
        meta = _meta_cached(ticker)                      # None on cold miss (+warm)
        bars = _apply_listing_cutoff(bars, meta, tf)
        # Another company's bars INSIDE the series (bars_identity: META's 2021-06-30 .. 2022-01-28
        # was the Roundhill ETF at ~$15): replaced by the company's own bars under the symbol it
        # traded as then, or dropped. Before the split repair, so a filled window is adjusted with
        # the rest of the series.
        from api.services import bars_identity as _bid
        bars = _bid.apply(ticker, bars, tf, _identity_source)
        # 🔴 THE KILL SWITCH HAS TO REACH HERE, AND FOR WEEKS IT DID NOT.
        # `BARS_SPLIT_REPAIR_ENABLED=0` was set after the split heuristic was found
        # to fire on ordinary flat days, and the incident report recorded the damage
        # as "frozen and bounded" on the strength of it. It was not. The flag is
        # checked inside `bars_split_repair.repair_ticker`, so it stopped the STORE
        # WRITES — while the identical false-positive detection kept running on this
        # line and rescaling **every response**, for every member, on every request.
        #
        # ⭐ MEASURED 2026-08-10, and this is the proof the flag was not holding:
        # EGBN and BF-A's production ROWS are byte-identical to the verified-clean
        # local store, and production still SERVED them at 1.0993x and 3.3475x. A
        # deep refetch could not fix them because nothing was wrong with the rows —
        # the corruption was being manufactured on the way out.
        #
        # ⛔ So the switch now gates the ADJUSTMENT, not just the persistence. A kill
        # switch that leaves the faulty computation running and only declines to save
        # its output is not a kill switch; it is the `lesson_gate_that_cannot_fail`
        # shape, and it cost a repair attempt that looked like a no-op.
        if meta and meta.get("splits") and split_adjust_active():
            declined: list = []
            unadjusted = unadjusted_splits(bars, meta["splits"], declined=declined)
            _note_declined(ticker, tf, declined)
            if unadjusted:
                bars = _apply_split_adjust(bars, meta["splits"], unadjusted)
                # ⭐ THE SERVED COPY IS NOW RIGHT AND THE STORE IS STILL WRONG,
                # AND THAT IS THE DEFECT THIS LINE CLOSES. Everything that does
                # NOT come through here — the alert evaluator, the nightly
                # screener build, the universe scan, and every SQL aggregate in
                # `bars_sqlite` — reads the rows directly. Detecting the gap and
                # healing only the response is what let DD's SMA200 read 50.19
                # on the alert lane while the chart drew 133.89.
                _schedule_store_repair(ticker, tf)
        if tf in ("W", "M") and bars:
            try:
                bars = _deepen_from_daily(ticker, bars, tf, head)
            except Exception as e:  # noqa: BLE001 - the stored depth is still a chart
                _log.warning("W/M deepen failed for %s tf=%s: %s", ticker, tf, e)
        return bars
    except Exception as e:  # noqa: BLE001
        _log.warning("sanitize_daily_bars failed for %s tf=%s: %s", ticker, tf, e)
        return bars


# ── Public entry point ──────────────────────────────────────────────────────
def sanitize_daily_bars(ticker: str, bars: list[dict], tf: str) -> list[dict]:
    """Normalize a D/W/M bars list (list of {t,o,h,l,c,v}, ascending by t).

    Best-effort + never raises: any failure returns the input bars unchanged so a
    bug here can never blank a chart. Intraday timeframes pass through untouched."""
    if not _ENABLED or not bars or tf not in ("D", "W", "M"):
        return bars
    # ⭐ THE PUBLISHED CORRECTIONS LEDGER (bars_corrections), FIRST: its entries were measured on the STORED rows, so
    # they compare-and-set against the rows as stored, before any repair moves them (listing cutoff, identity, split
    # heal) and before the clamp. A rebuilt series gets its own entries inside bars_rebuild.apply.
    # ⚠️ ROWS READ FROM THE STORE ALREADY PASSED THE READ DOOR (bars_sqlite._door, the same applier), so for them this
    # finds nothing left to change (compare-and-set; tests/test_bars_store_door.py proves twice = once). It STAYS for the
    # bars that reach here WITHOUT the store: bars_fetch._get_bars_inner's first-fetch path serves the provider's answer
    # (`result_bars = raw[-bars:]`) straight through sanitize_daily_bars, and that answer carries the bad print too.
    try:
        from api.services import bars_corrections as _cor
        bars = _cor.apply(ticker, tf, bars, "store")
    except Exception as e:  # noqa: BLE001 - the uncorrected bars still serve
        _log.warning("corrections skipped for %s tf=%s: %s", ticker, tf, e)
    # ⭐ A ticker whose history was REBUILT from one checked source (bars_rebuild: the vendor's official
    # daily files per company, one split basis, checked day by day against an independent vendor) serves
    # it through the rebuild's last session, and its W / M from it. The stored-patchwork repairs
    # (`_repair_stored`: another security's or another company's bars, unapplied splits) are not run over
    # it again. Not on the served list -> nothing changes here.
    served = None
    src = "store"
    try:
        from api.services import bars_rebuild as _reb
        if _reb.active(ticker):
            rebuilt = _reb.apply(ticker, bars, tf, head=_reaches_store_head(ticker, bars, tf))
            if rebuilt is not None:
                # ⛔ EXCEPT the split heal. The rebuild is on the basis of the day it was built; a split
                # after that puts the store's newer bars on a new basis and the rebuilt ones not, and the
                # chart would draw the cliff. The one detector finds it the same way it does in the store.
                # ⛔ F3a (2026-11-20): ONLY the splits declared after the rebuild's `end`. The rebuild
                # already carries every split up to it (one split basis). Re-running the heal over
                # those rescaled production's HUBB 1977 x0.75 on a stale-quote step (tests/
                # test_split_heal_guards.py).
                meta = _meta_cached(ticker)
                if meta and meta.get("splits") and split_adjust_active():
                    later = _declared_after(meta["splits"], _reb.status().get("end"))
                    declined: list = []
                    unadjusted = unadjusted_splits(rebuilt, later, declined=declined) if later else []
                    _note_declined(ticker, tf, declined)
                    if unadjusted:
                        rebuilt = _apply_split_adjust(rebuilt, later, unadjusted)
                served = rebuilt
                src = "rebuild"
    except Exception as e:  # noqa: BLE001 - the stored path below still serves
        _log.warning("rebuilt history skipped for %s tf=%s: %s", ticker, tf, e)
    if served is None:
        served = _repair_stored(ticker, bars, tf)
    # ⛔ THE ONE WICK CLAMP, for EVERY daily series, rebuilt or stored: no path returns before it.
    # ⚰️ 2026-11-18 .. 2026-11-20: the rebuilt branch returned early, on the belief that the rebuild was
    # "already" free of lone bad wicks. It is not: the rebuild is the vendor's official daily files, and
    # those carry the same one-minute gross prints (one print far from a minute whose open and close sat
    # at the day's level). 403 bars on the 551 rebuilt tickers met this clamp's own test and were served
    # unclamped (CSCO's 2008-09-19 low at under half the day's price, in production). The rule is
    # unchanged; what it runs on is every daily series. Rails: tests/test_bars_sanitize.py
    # TestRebuiltSeriesGetsTheOneClamp.
    if tf == "D":
        try:
            keep = {}
            try:
                from api.services import bars_corrections as _cor_keep
                keep = _cor_keep.keep_wicks(ticker, src)
                if src == "rebuild":
                    # A rebuilt series carries the STORE's rows after the rebuild's `end`: their D1 verdicts were
                    # measured on store rows.
                    from api.services import bars_rebuild as _reb_end
                    end = str(_reb_end._state.get("end") or "")
                    keep = {**{d: v for d, v in _cor_keep.keep_wicks(ticker, "store").items() if end and d > end}, **keep}
            except Exception:  # noqa: BLE001 - no ledger answer: the clamp trims as before
                keep = {}
            served = _clamp_wicks(served, keep)
        except Exception as e:  # noqa: BLE001 - never blank a chart
            _log.warning("wick clamp failed for %s: %s", ticker, e)
    return served
