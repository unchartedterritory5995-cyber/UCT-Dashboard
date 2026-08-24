"""The earnings modal's Profile and Catalysts tabs asked the bars path for
5000 DAILY bars — ~20 years — to use only the current calendar year (~160
sessions). 5000 is >= `bars_fetch._DEEP_REQUEST_THRESHOLD` (1200), which is
exactly the flag that routes a request away from the fast SQLite layer and
into the synchronous deep-backfill path.

Measured against production 2026-08-23, cold symbols, `/api/bars/{sym}?tf=D`:

    bars=5000   MZTI 31.0s  NCNO 25.2s  GORO 20.4s  GASS 11.5s  DKS -> HTTP 502
    bars=300    NOAH 1.02s  HEI 0.92s   JOYY 0.76s  QFIN 0.75s  FSCO 0.48s

Median 10.5s -> 0.62s. Both call sites sit INSIDE the modal's request path
(`stock_brief.brief` -> `_compute_stats`, `news_catalysts` -> `_hist_and_earnings`),
so that cost was paid synchronously by the reader, and the Profile tab's
description AND its "SO FAR" stat block ride the same payload — which is why
they went blank together.

These tests pin BOTH sides of the fix:
  * the depth asked for must stay UNDER the deep threshold (the speed win), and
  * it must still cover every session back to the floor date (the correctness
    guard — "ask for fewer bars" must not silently become "ask for too few").
"""
from datetime import date, timedelta
from unittest import mock

import pytest

from api.services import bars_fetch
from api.services.news_catalysts import service as nc
from api.services.stock_brief import service as sb


def _weekdays_between(lo: date, hi: date) -> int:
    """Independent lower bound on sessions elapsed. Derived by counting, NOT by
    restating the 252/365 session rate the implementation uses — a guard that
    re-states the formula it is guarding cannot fail when the formula is wrong."""
    n, d = 0, lo
    while d <= hi:
        if d.weekday() < 5:
            n += 1
        d += timedelta(days=1)
    return n


class TestBarDepthHelper:
    def test_ytd_floor_stays_under_the_deep_threshold(self):
        need = bars_fetch.daily_bars_needed_since(f"{date.today().year}-01-01")
        assert need < bars_fetch._DEEP_REQUEST_THRESHOLD, (
            f"{need} bars is a DEEP request — this is the 10-30s path the fix removes"
        )

    def test_ytd_floor_still_covers_every_elapsed_session(self):
        today = date.today()
        lo = date(today.year, 1, 1)
        need = bars_fetch.daily_bars_needed_since(lo.isoformat(), today=today)
        # ~9 market holidays a year; allow margin so this never fails on a
        # holiday-heavy stretch, while still catching a real under-fetch.
        assert need >= _weekdays_between(lo, today) - 15, (
            f"{need} bars cannot reach {lo} — the stat window would be truncated"
        )

    def test_a_full_year_is_covered(self):
        """Late-December case: a full calendar year is ~252 sessions."""
        need = bars_fetch.daily_bars_needed_since("2026-01-01", today=date(2026, 12, 31))
        assert 252 <= need < bars_fetch._DEEP_REQUEST_THRESHOLD

    def test_a_multi_year_floor_is_clamped_below_the_deep_threshold(self):
        """A far-past floor must never reintroduce the deep path."""
        need = bars_fetch.daily_bars_needed_since("2005-01-01", today=date(2026, 8, 23))
        assert need < bars_fetch._DEEP_REQUEST_THRESHOLD

    def test_junk_floor_does_not_raise(self):
        assert bars_fetch.daily_bars_needed_since("") > 0
        assert bars_fetch.daily_bars_needed_since("not-a-date") > 0


def _depth_requested(monkeypatch, call) -> int:
    """Run `call` with `_get_bars_inner` stubbed; return the bar count asked for."""
    seen = {}

    def _spy(sym, tf, bars):
        seen["tf"], seen["bars"] = tf, bars
        return {"bars": []}

    monkeypatch.setattr(bars_fetch, "_get_bars_inner", _spy)
    call()
    assert seen.get("tf") == "D"
    return seen["bars"]


class TestCallSitesAreNotDeep:
    """The regression guard: these are the two fetches the modal blocks on."""

    def test_stock_brief_year_bars_is_not_a_deep_request(self, monkeypatch):
        depth = _depth_requested(monkeypatch, lambda: sb._year_bars("NVDA", date.today().year))
        assert depth < bars_fetch._DEEP_REQUEST_THRESHOLD, (
            f"Profile tab asks for {depth} daily bars — measured 4-31s in prod"
        )

    def test_news_catalysts_daily_bars_is_not_a_deep_request(self, monkeypatch):
        depth = _depth_requested(monkeypatch, lambda: nc._daily_bars_since("NVDA"))
        assert depth < bars_fetch._DEEP_REQUEST_THRESHOLD, (
            f"Catalysts tab asks for {depth} daily bars — measured 4-31s in prod"
        )

    @pytest.mark.parametrize("year_offset", [0, 1])
    def test_year_bars_still_returns_the_whole_year(self, monkeypatch, year_offset):
        """Behavioural: the narrowed fetch must not truncate the year it filters."""
        year = date.today().year - year_offset
        bars = [{"t": f"{year}-{m:02d}-15", "o": 10.0, "c": 11.0,
                 "l": 9.0, "h": 12.0, "v": 1000} for m in range(1, 13)]
        monkeypatch.setattr(bars_fetch, "_get_bars_inner", lambda s, tf, n: {"bars": bars})
        assert len(sb._year_bars("NVDA", year)) == 12


class TestPersistedShapeIsVersioned:
    """A prompt change that only bumps the MEMORY cache key changes nothing for
    the names that matter.

    `earnings_ai_store` persists generated previews/analyses on /data and serves
    them "instantly to every user, forever" — that is what a warmed reporter
    hits. Its path was `{kind}_{SYM}.json`, carrying no notion of what shape the
    text was generated in, so the 2026-08-23 rewrite (long strategist note -> a
    ~120-word note + 3 one-line bullets) would have been invisible on every
    already-warm name for the file's full 3-day/7-day life. A cold ticker would
    have spot-checked correct the whole time.
    """

    def test_the_persisted_path_carries_a_shape_version(self):
        from api.services import earnings_ai_store as store
        p = store._path("preview", "NVDA")
        assert store._SHAPE in p, f"{p} cannot distinguish one prompt shape from another"

    def test_two_shapes_never_collide_on_disk(self, monkeypatch):
        from api.services import earnings_ai_store as store
        monkeypatch.setattr(store, "_SHAPE", "v2")
        old = store._path("preview", "NVDA")
        monkeypatch.setattr(store, "_SHAPE", "v3")
        assert store._path("preview", "NVDA") != old

    def test_kind_still_separates_preview_from_analysis(self):
        from api.services import earnings_ai_store as store
        assert store._path("preview", "NVDA") != store._path("analysis", "NVDA")

    def test_the_memory_key_moved_with_it(self):
        """Both layers must move together — the whole defect is one lagging."""
        import inspect
        from api.services import earnings_ai_store as store
        from api.services import engine
        src = inspect.getsource(engine._generate_earnings_preview)
        assert f"earnings_preview_{store._SHAPE}_" in src, (
            "the in-memory cache key and the on-disk shape version disagree — "
            "one of the two layers will keep serving the previous prompt's output"
        )


class TestPreviewShapeIsEnforcedInCode:
    """The prompt asks for exactly 3 bullets; the CODE is what guarantees it.

    The pre-2026-08-23 prompt mandated five 60-90 word bullets and the slice
    allowed five, so prompt and code agreed on the long form. Cutting only the
    prompt would leave a non-compliant response free to drift straight back.
    """

    def test_bullets_are_capped_at_three(self):
        import inspect
        from api.services import engine
        for fn in (engine._generate_earnings_preview, engine._generate_earnings_analysis):
            src = inspect.getsource(fn)
            # Match the BULLETS expression specifically — a bare '[:5]' check
            # would go red on any unrelated five-slice someone adds later, which
            # is how a guard stops being trusted.
            assert 'parsed.get("bullets", [])[:3]' in src, (
                f"{fn.__name__} does not cap bullets at the 3 the shape specifies"
            )
            assert 'parsed.get("bullets", [])[:5]' not in src, (
                f"{fn.__name__} still admits the pre-2026-08-23 five-bullet form"
            )


class TestReportDateReadsAsProse:
    """The prompt received a raw ISO date and the model echoed it verbatim."""

    def test_iso_becomes_a_spoken_date(self):
        from api.services.engine import _human_report_date
        assert _human_report_date("2026-08-26") == "Wednesday, Aug 26"
        # No zero padding — "Jan 05" is not how anyone says it.
        assert _human_report_date("2026-01-05") == "Monday, Jan 5"

    def test_unparseable_input_degrades_to_itself_and_never_raises(self):
        from api.services.engine import _human_report_date
        assert _human_report_date("") == ""
        assert _human_report_date(None) == ""
        assert _human_report_date("garbage") == "garbage"
        assert _human_report_date("2026-13-99") == "2026-13-99"


class TestTokenCeilingLeavesRoomForANonCompliantReply:
    """A tight max_tokens does not shorten output — it decides whether an
    over-long reply arrives WHOLE or BROKEN.

    Cutting the preview ceiling 2800 -> 1100 alongside the shape change looked
    like a matching cost saving. It wasn't: VEEV came back with a 213-word
    preview (the model overshot the 120-word instruction), exhausted the budget
    mid-bullets-array, and `_salvage_json_fields` — which exists to rescue
    "TRUNCATION at max_tokens mid-string" — kept the preview and dropped two of
    three bullets. The result then PERSISTED to disk in that broken shape, and
    nothing anywhere reported it. ~8% of a 12-name live sample.

    The shape is enforced by the prompt and the [:3] cap. The ceiling only has
    to be generous enough that a verbose reply still closes its JSON.
    """

    def test_the_preview_ceiling_has_real_headroom_over_the_intended_output(self):
        from api.services import engine
        # ~120 words + 3x25 words is roughly 350 tokens with JSON scaffolding.
        # Demand several times that, so a 2x-overshooting reply still completes.
        assert engine._EARNINGS_PREVIEW_AI_MAX_TOKENS >= 1500, (
            "too tight — an over-long reply will be silently salvaged into a "
            "broken shape and persisted (the VEEV case)"
        )

    def test_the_analysis_ceiling_was_not_narrowed_with_the_shape_change(self):
        from api.services import engine
        assert engine._EARNINGS_AI_MAX_TOKENS >= 1500

    def test_the_salvage_path_still_exists_to_be_protected_from(self):
        """If this ever goes away the headroom argument above changes."""
        from api.services import engine
        assert callable(engine._salvage_json_fields)
