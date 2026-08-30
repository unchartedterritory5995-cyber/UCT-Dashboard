"""Sourcing a RESTATED row — and the discipline that stops it gaming the gate.

`breadth_collector.backfill()` recomputes every past session from ONE frame (the
one downloaded on the day the backfill ran: `closes.loc[:date_str]` then
`adv_decline_parts`) and re-pushes it. A row written that way was measured over
a LATER day's universe on a LATER day's adjusted prices, so its own day's cached
frame no longer reproduces it and `apply_adv_dec_counts` correctly refuses the
pair — which is what happened to 2026-03-16..03-20 (all five reproduce to the
unit from the 2026-03-22 frame).

`counts_from_slice` reads the pair the way that backfill computed it. `survey`
reports which later frames reproduce a refused row.

⛔ WHY THE SURVEY MAY NOT DRIVE THE APPLY. The identity gate is strong because a
wrong pair would have to be wrong by the same amount in advancers AND decliners
at once. Searching over ~20 candidate frames until one matches spends exactly
that strength: neighbouring frames' nets sit within a few units of each other,
so a spurious single-date match is likely rather than rare. The signal that is
still worth something is ONE frame reproducing a RUN of consecutive dates, which
is a mechanism and not a coincidence — so the survey prints evidence, `--apply`
requires a hand-named `--restated-from`, and the two flags refuse to run
together.
"""
import importlib.util
from pathlib import Path

import pandas as pd
import pytest

_SPEC = importlib.util.spec_from_file_location(
    "backfill_adv_dec_counts",
    Path(__file__).resolve().parents[1] / "scripts" / "backfill_adv_dec_counts.py")
bf = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(bf)


SESSIONS = ["2026-03-16", "2026-03-17", "2026-03-18", "2026-03-19", "2026-03-20"]


def _write_frame(cache: Path, frame_date: str, closes: pd.DataFrame) -> Path:
    """A cached collector frame: a {Close,Volume} column-MultiIndex pickle, the
    shape `_download_ohlcv` writes."""
    vol = pd.DataFrame(1_000_000.0, index=closes.index, columns=closes.columns)
    combined = pd.concat({"Close": closes, "Volume": vol}, axis=1)
    p = cache / f"breadth_ohlcv_{frame_date}.pkl"
    combined.to_pickle(p)
    return p


def _closes(dates, cols, values):
    return pd.DataFrame(values, index=pd.to_datetime(dates), columns=cols)


@pytest.fixture
def cache(tmp_path):
    d = tmp_path / "massive_cache"
    d.mkdir()
    return d


def test_a_slice_of_a_later_frame_is_the_pair_that_backfill_computed(cache):
    """Three names, one session: the arithmetic is checkable by eye."""
    cols = ["AAA", "BBB", "CCC"]
    closes = _closes(["2026-03-19", "2026-03-20", "2026-03-23"], cols,
                     [[10.0, 10.0, 10.0],
                      [11.0, 9.0, 10.0],     # 03-20: one up, one down, one flat
                      [12.0, 8.0, 10.0]])
    p = _write_frame(cache, "2026-03-23", closes)
    assert bf.counts_from_slice(str(p), "2026-03-20") == (1, 1, 3)


def test_a_slice_measures_the_LATER_frames_population_not_the_days_own(cache):
    """The whole reason a restated row disagrees with its own frame: the later
    frame carries a name the day's frame never had, and it counts."""
    own = _write_frame(cache, "2026-03-20",
                       _closes(["2026-03-19", "2026-03-20"], ["AAA", "BBB"],
                               [[10.0, 10.0], [11.0, 9.0]]))
    later = _write_frame(cache, "2026-03-23",
                         _closes(["2026-03-19", "2026-03-20", "2026-03-23"],
                                 ["AAA", "BBB", "NEW"],
                                 [[10.0, 10.0, 5.0],
                                  [11.0, 9.0, 6.0],
                                  [12.0, 8.0, 7.0]]))
    assert bf.counts_from_frame(str(own), "2026-03-20") == (1, 1, 2)
    assert bf.counts_from_slice(str(later), "2026-03-20") == (2, 1, 3)


def test_a_slice_refuses_a_date_the_frame_does_not_hold(cache):
    """⛔ The slice must not answer with the PRIOR session's counts under the
    asked-for date. `.loc[:date]` happily returns a shorter frame when the date
    is missing, and there are two rows here, so the length guard cannot catch
    it — only checking that the last row IS the target can. That is exactly the
    phantom-session defect the collector's `_is_fresh_trading_day` exists for."""
    p = _write_frame(cache, "2026-03-23",
                     _closes(["2026-03-18", "2026-03-19", "2026-03-23"], ["AAA"],
                             [[10.0], [11.0], [12.0]]))
    assert bf.counts_from_slice(str(p), "2026-03-19") == (1, 0, 1)   # control
    assert bf.counts_from_slice(str(p), "2026-03-20") is None


def test_a_slice_refuses_a_date_with_no_prior_close_to_change_against(cache):
    p = _write_frame(cache, "2026-03-23",
                     _closes(["2026-03-20", "2026-03-23"], ["AAA"], [[10.0], [11.0]]))
    assert bf.counts_from_slice(str(p), "2026-03-20") is None


# ── the survey ──────────────────────────────────────────────────────────────

def _restated_cache(cache):
    """Five sessions whose OWN frames say one thing and whose rows were written
    from a single later frame — the 2026-03 shape, in miniature.

    CCC and DDD rise on EVERY session and exist only in the later frame, so the
    later frame's net is the own frame's net + 2 on every date. Without that the
    fixture could not tell the two sources apart and the survey assertions would
    pass for the wrong reason.
    """
    cols = ["AAA", "BBB", "CCC", "DDD"]
    walk = {
        "2026-03-13": [10.0, 10.0, 10.0, 10.0],
        "2026-03-16": [11.0, 9.0, 10.5, 10.5],
        "2026-03-17": [12.0, 8.0, 11.0, 11.0],
        "2026-03-18": [11.5, 7.0, 11.5, 11.5],
        "2026-03-19": [13.0, 6.5, 12.0, 12.0],
        "2026-03-20": [12.0, 6.0, 12.5, 12.5],
    }
    dates = list(walk)
    # each session's OWN frame: only the first two names existed then
    for i, d in enumerate(dates[1:], start=1):
        sub = dates[:i + 1]
        _write_frame(cache, d, _closes(sub, cols[:2], [walk[x][:2] for x in sub]))
    # the later frame the backfill actually ran off: all four names
    _write_frame(cache, "2026-03-22",
                 _closes(dates, cols, [walk[x] for x in dates]))
    return cols, walk, dates


def test_the_fixture_can_tell_the_two_sources_apart(cache):
    """A rail that cannot distinguish is not a rail. Every session's own frame
    and the later frame must disagree, or the survey tests below prove nothing."""
    _restated_cache(cache)
    later = str(cache / "breadth_ohlcv_2026-03-22.pkl")
    for d in SESSIONS:
        own = bf.counts_from_frame(str(cache / f"breadth_ohlcv_{d}.pkl"), d)
        via = bf.counts_from_slice(later, d)
        assert (via[0] - via[1]) == (own[0] - own[1]) + 2, d


def test_the_survey_names_the_one_frame_that_explains_a_whole_run(cache):
    _restated_cache(cache)
    src = str(cache / "breadth_ohlcv_2026-03-22.pkl")
    stored = {d: (lambda p: p[0] - p[1])(bf.counts_from_slice(src, d)[:2])
              for d in SESSIONS}

    out = bf.survey(str(cache), stored, window_days=21)
    for d in SESSIONS:
        assert [h["source"] for h in out[d]["hits"]] == ["2026-03-22"], d
        assert out[d]["frames_tried"] >= 1


def test_the_survey_reports_nothing_when_no_frame_reproduces_the_row(cache):
    """The honest outcome, and the one 2026-07-09 actually gets: the frame the
    row came from is not on disk, so the survey must say so rather than offer
    the nearest thing."""
    _restated_cache(cache)
    out = bf.survey(str(cache), {"2026-03-18": 99_999}, window_days=21)
    assert out["2026-03-18"]["hits"] == []
    assert out["2026-03-18"]["frames_tried"] > 0      # it really did look


def test_the_survey_never_offers_the_targets_own_frame(cache):
    """A control: the own frame is excluded by construction, so a survey hit is
    always a claim about a DIFFERENT day's download."""
    _restated_cache(cache)
    own = str(cache / "breadth_ohlcv_2026-03-18.pkl")
    own_net = (lambda p: p[0] - p[1])(bf.counts_from_frame(own, "2026-03-18")[:2])
    out = bf.survey(str(cache), {"2026-03-18": own_net}, window_days=21)
    assert "2026-03-18" not in [h["source"] for h in out["2026-03-18"]["hits"]]


def test_the_survey_window_bounds_how_far_it_looks(cache):
    _restated_cache(cache)
    src = str(cache / "breadth_ohlcv_2026-03-22.pkl")
    stored = {"2026-03-16": (lambda p: p[0] - p[1])(bf.counts_from_slice(src, "2026-03-16")[:2])}
    assert bf.survey(str(cache), stored, window_days=21)["2026-03-16"]["hits"]
    near = bf.survey(str(cache), stored, window_days=1)["2026-03-16"]
    assert near["hits"] == []
    assert near["frames_tried"] > 0        # it looked, and found nothing in range


# ── the flags that keep a search from becoming a write ──────────────────────

def test_survey_and_apply_refuse_to_run_together(capsys):
    assert bf.main(["--survey", "--apply", "--secret", "x"]) == 2
    assert "never writes" in capsys.readouterr().err


def test_restated_from_and_restated_dates_are_required_together(capsys):
    assert bf.main(["--restated-from", "2026-03-22", "--secret", "x"]) == 2
    assert "together" in capsys.readouterr().err
    assert bf.main(["--restated-dates", "2026-03-16", "--secret", "x"]) == 2
    assert "together" in capsys.readouterr().err
