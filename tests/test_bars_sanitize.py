"""Serve-time bar normalization — ticker-reuse cutoff, split self-heal, wick clamp.

All deterministic + offline: corporate-action metadata is seeded straight into
the cache (production warms it in the background off the request path).
Every price here is SYNTHETIC; no vendor data is committed.
"""
import ast
import copy
import datetime
import gzip
import inspect
import json
import textwrap

import pytest

from api.services import bars_sanitize as bs
from api.services.cache import cache


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    # A cold-meta path must never spawn a real FMP warm in tests.
    monkeypatch.setattr(bs, "_warm_meta", lambda ticker: None)


def _seed(ticker, ipo=None, splits=None):
    bs._META_CACHE.set(bs._META_KEY.format(ticker), {"ipo": ipo, "splits": splits or []}, ttl=3600)


def _day(d):
    return d.isoformat()


def _series(start, n, price=10.0):
    """n consecutive weekday bars from `start`, flat-ish."""
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append({"t": _day(d), "o": price, "h": price * 1.01,
                        "l": price * 0.99, "c": price, "v": 1000})
        d += datetime.timedelta(days=1)
    return out


# ── Ticker-reuse listing cutoff ─────────────────────────────────────────────
class TestListingCutoff:
    def test_reused_ticker_dropped_at_gap_aligned_with_ipo(self):
        old = _series(datetime.date(2015, 1, 5), 40)              # old security
        new_start = datetime.date(2026, 4, 2)
        new = _series(new_start, 20, price=50.0)                  # relisted security
        _seed("DRAM", ipo="2026-04-02", splits=[])
        out = bs.sanitize_daily_bars("DRAM", old + new, "D")
        assert out[0]["t"] == new_start.isoformat()
        assert len(out) == 20

    def test_normal_continuous_history_untouched(self):
        bars = _series(datetime.date(2020, 1, 2), 200)
        _seed("AAPL", ipo="1980-12-12", splits=[])
        out = bs.sanitize_daily_bars("AAPL", list(bars), "D")
        assert len(out) == len(bars)
        assert out[0]["t"] == bars[0]["t"]

    def test_legit_long_halt_same_company_not_cut(self):
        # A 40-day gap but the ipo is years earlier → NOT a relisting → keep all.
        a = _series(datetime.date(2021, 1, 4), 30)
        b = _series(datetime.date(2021, 4, 1), 30)               # ~40d gap
        _seed("HALT", ipo="2005-06-01", splits=[])
        out = bs.sanitize_daily_bars("HALT", a + b, "D")
        assert len(out) == 60

    def test_reuse_cut_without_metadata_on_price_jump(self, monkeypatch):
        # SPCX-style: a sub-standalone (~70-day) gap with a big price jump (old
        # ~$22 ETF → new ~$150 listing) is cut on the FIRST serve — no metadata,
        # no ~1s pre-IPO flash.
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        old = _series(datetime.date(2026, 2, 2), 45, price=22.0)
        new = _series(datetime.date(2026, 6, 12), 20, price=150.0)
        out = bs.sanitize_daily_bars("SPCX", old + new, "D")
        assert out[0]["t"] == "2026-06-12" and len(out) == 20

    def test_halt_without_price_jump_not_cut_without_metadata(self, monkeypatch):
        # Same-company halt: a ~70-day gap but the price resumes near where it left
        # off (no big jump) and no listing metadata → NOT cut (don't chop a halt).
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        a = _series(datetime.date(2026, 2, 2), 45, price=22.0)
        b = _series(datetime.date(2026, 6, 12), 20, price=24.0)  # ~1.1× — not reuse
        out = bs.sanitize_daily_bars("HALT2", a + b, "D")
        assert len(out) == 65

    def test_huge_gap_cut_without_metadata(self, monkeypatch):
        # Cold metadata (meta None) but an unmistakable multi-year gap ⇒ still cut.
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        old = _series(datetime.date(2010, 1, 4), 30)
        new = _series(datetime.date(2026, 4, 2), 20, price=50.0)
        out = bs.sanitize_daily_bars("XYZ", old + new, "D")
        assert out[0]["t"] == "2026-04-02"

    # ⚰️ 2026-11-18, production: ADPT (three securities, the largest gap the OLDEST) served
    # Adeptus Health 2014-06 .. 2017-04 at $1.41 in front of Adaptive Biotech (2019-06-27, $40.30).
    def test_three_securities_the_series_starts_at_the_newest_break(self, monkeypatch):
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        first = _series(datetime.date(2000, 1, 3), 30, price=5.0)
        middle = _series(datetime.date(2014, 6, 25), 40, price=1.41)     # 14-year gap before it
        current = _series(datetime.date(2019, 6, 27), 25, price=40.3)    # 2-year gap, 28x
        out = bs.sanitize_daily_bars("ADPT", first + middle + current, "D")
        assert out[0]["t"] == "2019-06-27" and len(out) == 25

    def test_a_smaller_newer_break_cuts_after_a_larger_older_one(self, monkeypatch):
        # A larger gap that is NOT a break (a same-price halt) and a newer, smaller one that is:
        # the series starts after the newer.
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        a = _series(datetime.date(2020, 1, 2), 30, price=20.0)
        b = _series(datetime.date(2020, 6, 1), 30, price=21.0)          # ~120 days, ~1.05x: a halt
        c = _series(datetime.date(2020, 9, 1), 20, price=100.0)         # ~45 days, ~4.8x: a break
        out = bs.sanitize_daily_bars("NEWER", a + b + c, "D")
        assert out[0]["t"] == "2020-09-01" and len(out) == 20

    def test_the_ipo_aligned_gap_cuts_even_when_an_older_gap_is_larger(self):
        old = _series(datetime.date(2005, 1, 3), 30, price=10.0)
        mid = _series(datetime.date(2015, 1, 5), 30, price=11.0)        # 10 years after `old`
        new = _series(datetime.date(2015, 4, 1), 20, price=12.0)        # ~60 days, same price, listing day
        _seed("ALIGN", ipo="2015-04-01", splits=[])
        out = bs.sanitize_daily_bars("ALIGN", old + mid + new, "D")
        assert out[0]["t"] == "2015-04-01" and len(out) == 20

    def test_the_chart_and_the_store_readers_start_a_series_on_the_same_bar(self, monkeypatch):
        # One rule: the store readers' `listing_break.start_index` and the chart agree.
        from api.services import listing_break as lb
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        bars = (_series(datetime.date(2001, 1, 2), 25, price=3.0) + _series(datetime.date(2009, 3, 2), 25, price=30.0)
                + _series(datetime.date(2009, 8, 3), 25, price=31.0) + _series(datetime.date(2012, 5, 1), 25, price=2.0))
        ts = [int(b["t"].replace("-", "")) for b in bars]
        i = lb.start_index(ts, [b["c"] for b in bars])
        out = bs.sanitize_daily_bars("ONE", [dict(b) for b in bars], "D")
        assert out[0]["t"] == bars[i]["t"] == "2012-05-01"


# ── Split self-heal ─────────────────────────────────────────────────────────
class TestSplitAdjust:
    def _split_series(self, pre_price, post_price):
        pre = _series(datetime.date(2012, 1, 3), 20, price=pre_price)
        # relabel pre dates strictly before the split; post on/after
        post = _series(datetime.date(2012, 2, 16), 20, price=post_price)
        return pre + post

    def test_unadjusted_2for1_is_healed(self):
        bars = self._split_series(pre_price=20.0, post_price=10.0)  # provider MISSED it
        _seed("MNST", ipo="1995-01-01", splits=[("2012-02-16", 2.0)])
        out = bs.sanitize_daily_bars("MNST", bars, "D")
        pre_last = [b for b in out if b["t"] < "2012-02-16"][-1]
        post_first = [b for b in out if b["t"] >= "2012-02-16"][0]
        # pre halved to ~10 → continuous across the boundary
        assert abs(pre_last["c"] / post_first["c"] - 1.0) < 0.1

    def test_already_adjusted_left_alone(self):
        bars = self._split_series(pre_price=10.0, post_price=10.0)  # already smooth
        before = [dict(b) for b in bars]
        _seed("OK", ipo="1995-01-01", splits=[("2012-02-16", 2.0)])
        out = bs.sanitize_daily_bars("OK", bars, "D")
        assert [b["c"] for b in out] == [b["c"] for b in before]

    def test_real_gap_not_matching_ratio_left_alone(self):
        # A 30% gap at the split date does NOT match a 2:1 → ambiguous → untouched.
        bars = self._split_series(pre_price=13.0, post_price=10.0)
        _seed("GAP", ipo="1995-01-01", splits=[("2012-02-16", 2.0)])
        out = bs.sanitize_daily_bars("GAP", bars, "D")
        pre_last = [b for b in out if b["t"] < "2012-02-16"][-1]
        assert abs(pre_last["c"] - 13.0) < 0.01  # unchanged


# ── Lone bad-bar wick clamp ─────────────────────────────────────────────────
class TestWickClamp:
    def test_extreme_lone_upper_wick_clamped(self):
        bars = _series(datetime.date(2024, 6, 3), 10, price=120.0)
        bars[5]["h"] = 195.95                      # NVDA-style bad print
        _seed("NVDA", ipo="1999-01-22", splits=[])
        out = bs.sanitize_daily_bars("NVDA", bars, "D")
        assert out[5]["h"] < 130

    def test_real_big_move_body_not_clamped(self):
        # A genuine +60% move is a big BODY (o→c), not a wick → untouched.
        bars = _series(datetime.date(2024, 6, 3), 10, price=10.0)
        bars[5].update(o=10.0, c=16.0, h=16.1, l=9.9)
        _seed("RUN", ipo="2000-01-01", splits=[])
        out = bs.sanitize_daily_bars("RUN", bars, "D")
        assert out[5]["h"] == 16.1

    def test_wick_corroborated_by_neighbors_kept(self):
        bars = _series(datetime.date(2024, 6, 3), 10, price=10.0)
        for i in (4, 5, 6):
            bars[i]["h"] = 15.0                    # a real multi-day spike
        _seed("VOL", ipo="2000-01-01", splits=[])
        out = bs.sanitize_daily_bars("VOL", bars, "D")
        assert out[5]["h"] == 15.0


# ── A REBUILT history gets the same one clamp (2026-11-20) ──────────────────
# ⚰️ 2026-11-18 .. 2026-11-20 the rebuilt branch (bars_rebuild, step 5) returned before the clamp, so
# the rebuilt tickers' one-minute gross prints were served unclamped (403 bars met the clamp's own test).
REB_SYM, PLAIN_SYM = "ZZRB", "ZZPL"      # synthetic: ZZRB on the served list, ZZPL never
REB_DAYS = 60                             # the rebuild covers these sessions; the store has the rest


def _wavy(start, n, base):
    """n weekday bars of ordinary, SYNTHETIC trading: a body and a real wick on each side every day,
    none anywhere near the clamp's 1.40x test."""
    out, d, i = [], start, 0
    while len(out) < n:
        if d.weekday() < 5:
            o = base * (1 + 0.02 * ((i % 7) - 3) / 3)
            c = o * (1.006 if i % 2 else 0.994)
            out.append({"t": _day(d), "o": round(o, 4), "h": round(max(o, c) * 1.012, 4),
                        "l": round(min(o, c) * 0.988, 4), "c": round(c, 4), "v": 1000 + i})
            i += 1
        d += datetime.timedelta(days=1)
    return out


START = datetime.date(2008, 8, 4)


def _stored():
    """The STORE's series: the first REB_DAYS sessions on the wrong scale (the patchwork the rebuild
    replaces), then the sessions after the rebuild's end."""
    full = _wavy(START, REB_DAYS + 20, 20.0)
    for b in full[:REB_DAYS]:
        for k in ("o", "h", "l", "c"):
            b[k] = round(b[k] / 10, 4)
    return full


@pytest.fixture()
def rebuilt_volume(tmp_path, monkeypatch):
    """`serve(rows)` puts `rows` on a private volume as REB_SYM's rebuilt history, through its last
    session. The rebuild is OFF under pytest (conftest); this opts in against tmp_path only."""
    from api.services import bars_rebuild as R
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(R.ENV_SERVE, raising=False)
    monkeypatch.setattr(bs, "_reaches_store_head", lambda t, b, tf: True)   # a whole-history read
    monkeypatch.setattr(bs, "_meta_cached", lambda t: None)                 # no listing date, no splits
    saved_state, saved_cache = dict(R._state), dict(R._cache)

    def serve(rows):
        end = rows[-1]["t"]
        d = tmp_path / "bars_rebuild" / "v1"
        d.mkdir(parents=True, exist_ok=True)
        body = {"sym": REB_SYM, "end": end,
                "bars": [[b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]] for b in rows]}
        (d / f"{REB_SYM}.json.gz").write_bytes(gzip.compress(json.dumps(body).encode()))
        (tmp_path / "bars_rebuild" / "manifest.json").write_text(
            json.dumps({"version": 1, "end": end, "symbols": [REB_SYM]}))
        R._cache.clear()
        assert R.load_local() and R.active(REB_SYM) and not R.active(PLAIN_SYM)
        return R

    yield serve
    R._state.clear()
    R._state.update(saved_state)
    R._cache.clear()
    R._cache.update(saved_cache)


class TestRebuiltSeriesGetsTheOneClamp:
    def _gross(self):
        """The rebuilt history with two vendor-style one-minute gross prints (SYNTHETIC numbers, the
        shape of the ones found in production): a low under half the day's price, a high near double."""
        rows = _wavy(START, REB_DAYS, 20.0)
        rows[30]["l"] = 9.0
        rows[45]["h"] = 38.0
        return rows

    def test_a_gross_wick_in_a_rebuilt_series_is_clamped_exactly_as_a_stored_one(self, rebuilt_volume):
        R = rebuilt_volume(self._gross())
        stored = _stored()
        stored[70]["l"] = 8.5                                 # and one in the store's sessions after `end`
        joined = R.apply(REB_SYM, copy.deepcopy(stored), "D", head=True)   # what step 5 served, unclamped
        assert [b["t"] for b in joined] == [b["t"] for b in stored]

        served = bs.sanitize_daily_bars(REB_SYM, copy.deepcopy(stored), "D")
        as_stored = bs.sanitize_daily_bars(PLAIN_SYM, copy.deepcopy(joined), "D")

        # ⛔ NOT VACUOUS: the three gross bars WERE changed, by the clamp's own rule, and nothing else was.
        gross = {30: "l", 45: "h", 70: "l"}
        for i, k in gross.items():
            assert served[i][k] != joined[i][k], f"bar {i} {k} served unclamped"
        assert served[30]["l"] == round(min(joined[30]["o"], joined[30]["c"], joined[29]["l"], joined[31]["l"]), 4)
        assert served[45]["h"] == round(max(joined[45]["o"], joined[45]["c"], joined[44]["h"], joined[46]["h"]), 4)
        assert [b for i, b in enumerate(served) if i not in gross] == \
               [b for i, b in enumerate(joined) if i not in gross]
        # ⭐ THE RULING: a rebuilt series is clamped EXACTLY as a non-rebuilt series with the same bars.
        assert served == as_stored == bs._clamp_wicks(copy.deepcopy(joined))

    def test_a_rebuilt_series_with_no_gross_wick_is_served_byte_identical(self, rebuilt_volume):
        rows = _wavy(START, REB_DAYS, 20.0)
        for i in (20, 21, 22):
            rows[i]["h"] = 30.0                               # a real 3-day spike: neighbours corroborate it
        rows[40].update(o=20.0, c=29.0, h=29.2, l=19.8)       # a real big move is a BODY, not a wick
        rows[41].update(o=29.0, c=20.0, h=29.3, l=19.9)
        rows[50]["l"] = round(min(rows[50]["o"], rows[50]["c"]) / 1.39, 4)   # just inside the 1.40x test
        R = rebuilt_volume(rows)
        stored = _stored()
        from api.services import bars_fetch as F
        for tf, src in (("D", stored), ("W", F._resample_weekly_iso(stored)), ("M", F._resample_monthly_iso(stored))):
            before = json.dumps(R.apply(REB_SYM, copy.deepcopy(src), tf, head=True))   # what step 5 served
            assert json.dumps(bs.sanitize_daily_bars(REB_SYM, copy.deepcopy(src), tf)) == before, tf

    def test_every_daily_series_rebuilt_or_stored_passes_the_one_clamp(self, rebuilt_volume, monkeypatch):
        """⛔ ONE clamp call path for daily bars. Behaviourally: each served D series, rebuilt or stored,
        went through `_clamp_wicks` exactly once and IS what it returned (an early return in the rebuilt
        branch makes the rebuilt count 0). Structurally: one call site in the module, in
        `sanitize_daily_bars`, whose only return before it is the input guard (a second clamp beside an
        early return would satisfy the count and still be two paths)."""
        rebuilt_volume(self._gross())
        real, seen = bs._clamp_wicks, []

        def spy(bars, keep=None):                     # keep: D1's ledger verdicts (bars_corrections.keep_wicks)
            seen.append(bars)
            return real(bars, keep)

        monkeypatch.setattr(bs, "_clamp_wicks", spy)
        out_reb = bs.sanitize_daily_bars(REB_SYM, _stored(), "D")
        assert len(seen) == 1 and seen[0] is out_reb, "the rebuilt daily series skipped the clamp"
        out_plain = bs.sanitize_daily_bars(PLAIN_SYM, _stored(), "D")
        assert len(seen) == 2 and seen[1] is out_plain, "the stored daily series skipped the clamp"
        from api.services import bars_fetch as F
        for tf, resample in (("W", F._resample_weekly_iso), ("M", F._resample_monthly_iso)):
            bs.sanitize_daily_bars(REB_SYM, resample(_stored()), tf)    # the rule stays daily-only
        assert len(seen) == 2

        mod = ast.parse(inspect.getsource(bs))
        sites = [(fn.name, n) for fn in mod.body if isinstance(fn, ast.FunctionDef)
                 for n in ast.walk(fn) if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Name) and n.func.id == "_clamp_wicks"]
        assert [name for name, _ in sites] == ["sanitize_daily_bars"], sites
        fn = ast.parse(textwrap.dedent(inspect.getsource(bs.sanitize_daily_bars))).body[0]
        clamp_line = next(n.lineno for n in ast.walk(fn) if isinstance(n, ast.Call)
                          and isinstance(n.func, ast.Name) and n.func.id == "_clamp_wicks")
        early = [n.lineno for n in ast.walk(fn) if isinstance(n, ast.Return) and n.lineno < clamp_line]
        guard = fn.body[1] if isinstance(fn.body[0], ast.Expr) else fn.body[0]
        assert early == [guard.body[0].lineno], f"a return before the one clamp: lines {early}"


# ── Guards / passthrough ────────────────────────────────────────────────────
class TestPassthrough:
    def test_intraday_untouched(self):
        bars = [{"t": 1_700_000_000, "o": 1, "h": 9, "l": 1, "c": 1, "v": 1}]
        out = bs.sanitize_daily_bars("X", bars, "5")
        assert out == bars

    def test_cold_metadata_returns_bars(self, monkeypatch):
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        bars = _series(datetime.date(2020, 1, 2), 50)
        out = bs.sanitize_daily_bars("COLD", list(bars), "D")
        assert len(out) == 50   # no crash; served as-is (bg warm populates for next)

    def test_disabled_flag_passthrough(self, monkeypatch):
        monkeypatch.setattr(bs, "_ENABLED", False)
        bars = _series(datetime.date(2015, 1, 5), 40) + _series(datetime.date(2026, 4, 2), 5)
        _seed("DRAM", ipo="2026-04-02", splits=[])
        out = bs.sanitize_daily_bars("DRAM", list(bars), "D")
        assert len(out) == 45   # untouched when disabled
