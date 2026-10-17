"""Chart base boxes (`base_catalog.base_geometry` / `current_base_structures`).

DISPLAY-ONLY. Every number on a box must equal the number the structure's
EXISTING state function computed — the test calls the state function itself and
compares — and a box exists only when the structure's own `detect` fires.

Fixtures are synthetic and reused from the structures' own test files (each of
those builders already has an "is ACCEPTED" case proving it fires), re-dated to
real YYYYMMDD calendar ints so `start_t`/`end_t` can be checked against the bar
`t` values: a bar INDEX (0..n) can never equal one of those.
"""
import copy

import pytest

from api.services.pattern_engine.primitives import cup
from api.services.screener import base_catalog as bc
from api.services.screener import bases
from tests.detector_fixtures import walk, ymd_t
from tests.pattern_engine.primitives import test_ascending_and_box as _box_fx
from tests.pattern_engine.primitives import test_base_on_base as _bob_fx
from tests.pattern_engine.primitives import test_cup_with_handle as _cup_fx
from tests.pattern_engine.primitives import test_flat_base as _flat_fx
from tests.pattern_engine.primitives import test_high_tight_flag as _htf_fx
from tests.pattern_engine.primitives import test_vcp as _vcp_fx
import tests.test_three_weeks_tight as _twt_fx


def _redate(bars):
    return [dict(b, t=ymd_t(i)) for i, b in enumerate(bars)]


def _twt_bars():
    tight = _twt_fx.series(_twt_fx.TIGHT)          # real Mondays already
    return _twt_fx._lead(min(b["c"] for b in tight),
                         _twt_fx._first_monday(tight)) + tight


def _darvas_bars():
    # walk(0) truncated at 120 bars frames a LIVE Darvas box (searched once,
    # pinned here; the non-vacuity assertion below fails if it stops firing).
    return walk(0, bars=300)[:120]


FIXTURES = {
    "flat-base": lambda: _redate(_flat_fx._advance() + _flat_fx._flat()),
    "square-box": lambda: _redate(_box_fx._box()),
    "three-weeks-tight": _twt_bars,
    "base-on-base": lambda: _redate(_bob_fx._stacked(0.10)),
    "cup-with-handle": lambda: _redate(_cup_fx._series(_cup_fx._cosine_cup(60, 0.20))),
    "high-tight-flag": lambda: _redate(_htf_fx._htf()),
    "vcp": lambda: _redate(_vcp_fx._vcp()),
    "darvas-box": _darvas_bars,
}


def _ctx(bars):
    return bases._context(bars, bars)


def _ts(bars):
    return [int(b["t"]) for b in bars]


# ── non-vacuity: every fixture really fires its structure ─────────────────

@pytest.mark.parametrize("key", sorted(FIXTURES))
def test_the_fixture_fires_its_structure(key):
    bars = FIXTURES[key]()
    assert bc.by_key(key).detect(_ctx(bars)), f"{key} fixture no longer fires"
    box = bc.base_geometry(bars, key)
    assert box is not None
    assert box["structure_key"] == key


def test_every_supported_structure_has_a_fixture():
    from api.services.screener import base_geometry as bg
    assert set(bg.BOX_MAPPERS) == set(FIXTURES)


# ── box numbers == the state function's numbers ───────────────────────────

def _assert_window(box, bars, start_i, end_i):
    ts = _ts(bars)
    assert box["start_t"] == ts[start_i]
    assert box["end_t"] == ts[end_i]
    assert box["start_t"] in ts and box["end_t"] in ts      # real times, never indices


def test_flat_base_box_is_the_states_numbers():
    bars = FIXTURES["flat-base"]()
    st = bc.flat_base_state(bars)
    box = bc.base_geometry(bars, "flat-base")
    n = len(bars)
    _assert_window(box, bars, n - st["bars"], n - 1)
    assert (box["top"], box["floor"], box["pivot"], box["bars"]) == \
        (st["high"], st["low"], st["pivot"], st["bars"])
    assert box["label"] == f"Flat base · {st['bars']} bars · pivot {st['pivot']:.2f}"


def test_square_box_is_the_states_numbers():
    bars = FIXTURES["square-box"]()
    st = bc.square_box_state(bars)
    box = bc.base_geometry(bars, "square-box")
    n = len(bars)
    _assert_window(box, bars, n - st["bars"], n - 1)
    assert (box["top"], box["floor"], box["pivot"]) == (st["high"], st["low"], st["pivot"])


def test_three_weeks_tight_box_is_the_states_numbers():
    bars = FIXTURES["three-weeks-tight"]()
    st = bc.three_weeks_tight_state(bars)
    box = bc.base_geometry(bars, "three-weeks-tight")
    n = len(bars)
    _assert_window(box, bars, n - st["bars"], n - 1)
    assert box["top"] == st["high"]
    assert box["floor"] == min(st["closes"])
    assert box["pivot"] == st["pivot"]


def test_base_on_base_box_is_the_newer_base_with_the_older_as_a_sub_box():
    bars = FIXTURES["base-on-base"]()
    st = bc.base_on_base_state(bars)
    b2 = bc.flat_base_state(bars)                       # the state's own `b2`
    box = bc.base_geometry(bars, "base-on-base")
    n = len(bars)
    _assert_window(box, bars, n - st["base2_bars"], n - 1)
    assert (box["top"], box["floor"], box["pivot"]) == (b2["high"], b2["low"], st["pivot2"])
    e1, k1 = st["base1_end"], st["base1_bars"]
    b1 = bc.flat_base_state(bars, end=e1)
    ts = _ts(bars)
    assert box["sub_boxes"] == [{"start_t": ts[e1 - k1], "end_t": ts[e1 - 1],
                                 "top": b1["high"], "floor": b1["low"]}]


def test_cup_with_handle_box_is_the_states_numbers():
    bars = FIXTURES["cup-with-handle"]()
    st = cup.cup_with_handle_state(bars)
    box = bc.base_geometry(bars, "cup-with-handle")
    n = len(bars)
    _assert_window(box, bars, st["cup_start"], n - 1)
    assert box["top"] == max(st["left_rim"], st["right_rim"])
    assert box["floor"] == st["low"]
    assert box["pivot"] == st["pivot"]
    ts = _ts(bars)
    cup_box, handle_box = box["sub_boxes"]
    assert (cup_box["start_t"], cup_box["end_t"]) == (ts[st["cup_start"]], ts[st["cup_end"] - 1])
    assert (handle_box["start_t"], handle_box["end_t"]) == (ts[st["cup_end"]], ts[n - 1])
    assert (handle_box["top"], handle_box["floor"]) == (st["handle_high"], st["handle_low"])


def test_high_tight_flag_box_is_the_flag_and_the_pole_is_a_sub_box():
    bars = FIXTURES["high-tight-flag"]()
    st = bc.high_tight_flag_state(_ctx(bars))
    box = bc.base_geometry(bars, "high-tight-flag")
    n = len(bars)
    peak_i = n - 1 - st["flag_bars"]
    origin = peak_i - st["pole_bars"]
    _assert_window(box, bars, peak_i, n - 1)
    assert (box["top"], box["floor"], box["pivot"]) == \
        (st["pole_high"], st["flag_low"], st["pivot"])
    # the peak bar really carries the pole high, and the origin the pole low
    assert max(b["h"] for b in bars[origin:peak_i + 1]) == st["pole_high"]
    ts = _ts(bars)
    assert box["sub_boxes"] == [{"start_t": ts[origin], "end_t": ts[peak_i],
                                 "top": st["pole_high"], "floor": st["pole_low"]}]


def test_vcp_box_and_contraction_sub_boxes_are_the_states_numbers():
    bars = FIXTURES["vcp"]()
    st = bc.vcp_state(_ctx(bars))
    box = bc.base_geometry(bars, "vcp")
    n = len(bars)
    _assert_window(box, bars, (n - 1) - st["bars"], n - 1)
    assert (box["top"], box["floor"], box["pivot"]) == (st["top"], st["floor"], st["pivot"])
    spans = st["contraction_spans"]
    assert len(spans) == st["contractions"] >= bc.VCP_MIN_CONTRACTIONS
    ts = _ts(bars)
    assert box["sub_boxes"] == [{"start_t": ts[s["start"]], "end_t": ts[s["end"]],
                                 "top": s["high"], "floor": s["low"]} for s in spans]
    # the spans ARE the depths the state reports
    assert [round((s["high"] - s["low"]) / s["high"], 12) for s in spans] == \
        [round(d, 12) for d in st["depths"]]


def test_darvas_box_is_the_states_numbers():
    bars = FIXTURES["darvas-box"]()
    st = bc.darvas_box_state(bars)
    box = bc.base_geometry(bars, "darvas-box")
    n = len(bars)
    _assert_window(box, bars, st["top_set_at"], n - 1)
    assert (box["top"], box["floor"]) == (st["top"], st["bottom"])
    assert box["pivot"] is None                    # Darvas publishes no pivot
    assert "pivot" not in box["label"]


# ── only when detect fires ────────────────────────────────────────────────

def test_no_box_when_the_structure_does_not_fire(monkeypatch):
    bars = FIXTURES["flat-base"]()
    real = bc.by_key

    class _Off:
        def __init__(self, s):
            self._s = s

        def __getattr__(self, name):
            return getattr(self._s, name)

        @staticmethod
        def detect(ctx):
            return False

    monkeypatch.setattr(bc, "by_key", lambda k: _Off(real(k)) if k == "flat-base" else real(k))
    assert bc.base_geometry(bars, "flat-base") is None
    # control: the same bars with the real detect DO produce a box
    monkeypatch.setattr(bc, "by_key", real)
    assert bc.base_geometry(bars, "flat-base") is not None


def test_an_unsupported_key_answers_none():
    assert bc.base_geometry(FIXTURES["flat-base"](), "climax-top") is None


# ── the 10-day range fallback ──────────────────────────────────────────────

def test_range_fallback_when_nothing_fires():
    # A short, steadily FALLING series fires none of the eight base structures.
    bars = [{"t": ymd_t(i), "o": 100 - i * 0.5, "h": 100 - i * 0.5 + 0.8,
             "l": 100 - i * 0.5 - 0.8, "c": 100 - i * 0.5 - 0.2, "v": 1_000_000}
            for i in range(70)]
    from api.services.screener import base_geometry as bg
    assert all(bc.base_geometry(bars, k) is None for k in bg.BOX_MAPPERS)   # control
    out = bc.current_base_structures(bars)
    assert len(out) == 1
    rb = out[0]
    win = bars[-10:]
    assert rb["structure_key"] == "range-10"
    assert rb["name"] == "10-day range"
    assert rb["top"] == max(b["h"] for b in win)
    assert rb["floor"] == min(b["l"] for b in win)
    assert rb["pivot"] == rb["top"]
    assert (rb["start_t"], rb["end_t"]) == (win[0]["t"], win[-1]["t"])
    assert rb["label"] == f"10-day range · high {rb['top']:.2f}"
    assert rb["source"] == "range10"


def test_no_range_fallback_when_a_base_fires():
    out = bc.current_base_structures(FIXTURES["flat-base"]())
    keys = [b["structure_key"] for b in out]
    assert "flat-base" in keys
    assert "range-10" not in keys


# ── no lookahead ───────────────────────────────────────────────────────────

def test_boxes_never_reach_past_the_last_bar_and_ignore_later_bars():
    full = walk(3, bars=420)
    for cut in (150, 260, 380):
        window = copy.deepcopy(full[:cut])
        boxes = bc.current_base_structures(window)
        assert boxes, "a window always answers with at least the 10-day range"
        last_t, first_t = window[-1]["t"], window[0]["t"]
        for box in boxes:
            assert first_t <= box["start_t"] <= box["end_t"] <= last_t
            for sb in box["sub_boxes"]:
                assert first_t <= sb["start_t"] <= sb["end_t"] <= last_t
        # the same window computed again after the caller's series GREW is identical
        again = bc.current_base_structures(copy.deepcopy(full[:cut]))
        assert again == boxes


@pytest.mark.parametrize("key", sorted(FIXTURES))
def test_a_box_on_a_truncation_equals_the_box_on_that_truncation_alone(key):
    """Bars appended AFTER the window cannot move a box computed on it."""
    bars = FIXTURES[key]()
    box = bc.base_geometry(bars, key)
    future = [dict(bars[-1], t=ymd_t(10_000 + i), h=bars[-1]["h"] * 3,
                   l=bars[-1]["l"] * 0.2) for i in range(30)]
    extended = bars + future
    assert bc.base_geometry(extended[:len(bars)], key) == box


# ── never raises ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(6))
def test_never_raises_on_random_walks(seed):
    bars = walk(seed, bars=600)
    for cut in (40, 200, 600):
        out = bc.current_base_structures(bars[:cut])
        assert isinstance(out, list)


def test_never_raises_on_garbage():
    assert bc.current_base_structures([]) == []
    assert bc.current_base_structures(None) == []
    assert bc.base_geometry([{"t": 1}], "flat-base") is None
