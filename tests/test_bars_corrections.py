"""The published corrections ledger for served D/W/M bars (api/services/bars_corrections.py, 2026-11-20).

Every number here is synthetic: shaped like the SPY 2005-10-05 witness (a one-minute 112.09 print under a 119.6 day),
never a copy of vendor data."""
import gzip
import io
import json

import pytest

from api.services import bars_corrections as K
from api.services import bars_rebuild as R
from api.services import bars_sanitize as S


def _days(n, start="2005-09-01"):
    import datetime as dt
    out, d = [], dt.date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


DAYS = _days(40)
BAD = DAYS[20]


def _bar(t, o, h, l, c, v=1000):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def _series(bad_low=112.09):
    out = [_bar(t, 120.0, 121.0, 119.0, 120.0) for t in DAYS]
    out[20] = _bar(BAD, 121.29, 121.31, bad_low, 119.63)
    return out


SET_LOW = {"tf": "D", "src": "store", "d": BAD, "op": "set", "f": {"l": [112.09, 119.57]}, "chk": {"c": 119.63}}


def _publish(root, version, entries_by_sym, retired=()):
    d = root / "bars_corrections" / f"v{version}"
    d.mkdir(parents=True, exist_ok=True)
    for sym, entries in entries_by_sym.items():
        (d / f"{sym}.json.gz").write_bytes(K.encode_payload(sym, version, entries))
    m = {"version": version, "symbols": sorted(entries_by_sym), "retired": sorted(retired)}
    (root / "bars_corrections" / "manifest.json").write_text(json.dumps(m))
    assert K.load_local()


def _reset():
    K._state.update(version=0, symbols=frozenset(), retired=frozenset(), loaded=False)
    K._cache.clear()


@pytest.fixture()
def vol(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(K.ENV_SERVE, raising=False)
    _reset()
    yield tmp_path
    _reset()


# ── compare-and-set ─────────────────────────────────────────────────────────────────────────────────

def test_a_set_moves_the_field_only_while_it_holds_the_old_value(vol):
    _publish(vol, 3, {"SPY": [SET_LOW]})
    out = K.apply("SPY", "D", _series(), "store")
    assert out[20]["l"] == 119.57
    assert [b for i, b in enumerate(out) if i != 20] == [b for i, b in enumerate(_series()) if i != 20]


def test_a_value_that_already_moved_is_left_alone(vol):
    """A re-fetch, a vendor fix or another pod's own copy already holds something else: no-op, same list back."""
    _publish(vol, 3, {"SPY": [SET_LOW]})
    bars = _series(bad_low=119.57)
    assert K.apply("SPY", "D", bars, "store") is bars
    bars = _series(bad_low=111.50)
    assert K.apply("SPY", "D", bars, "store") is bars


def test_per_field_one_field_that_moved_does_not_block_the_other(vol):
    e = dict(SET_LOW, f={"l": [112.09, 119.57], "h": [121.31, 121.30]})
    _publish(vol, 3, {"SPY": [e]})
    bars = _series()
    bars[20] = dict(bars[20], h=121.40)                     # this pod's high differs: only the low moves
    out = K.apply("SPY", "D", bars, "store")
    assert out[20]["l"] == 119.57 and out[20]["h"] == 121.40


def test_chk_refuses_a_replaced_or_rebased_bar(vol):
    _publish(vol, 3, {"SPY": [SET_LOW]})
    bars = _series()
    bars[20] = dict(bars[20], c=59.81, o=60.64, h=60.66)    # the same date on another basis (a 2:1 heal)
    assert K.apply("SPY", "D", bars, "store") is bars
    # Another bar on that date that happens to hold the same low: the result would be a valid bar, so only the
    # check of the undisputed close stops it.
    other = _series()
    other[20] = dict(other[20], o=130.0, h=131.0, c=129.5)
    assert K.apply("SPY", "D", other, "store") is other


def test_a_result_that_is_not_a_bar_is_refused_whole(vol):
    e = dict(SET_LOW, f={"l": [112.09, 125.0]})            # a low above the body is never served
    _publish(vol, 3, {"SPY": [e]})
    bars = _series()
    assert K.apply("SPY", "D", bars, "store") is bars


def test_a_drop_needs_every_value_to_match(vol):
    filler = _bar(DAYS[5], 120.0, 120.0, 120.0, 120.0, 0)
    bars = _series()
    bars[5] = filler
    e = {"tf": "D", "src": "rebuild", "d": DAYS[5], "op": "drop", "old": [120.0, 120.0, 120.0, 120.0, 0]}
    _publish(vol, 3, {"AAPL": [e]})
    out = K.apply("AAPL", "D", bars, "rebuild")
    assert len(out) == len(bars) - 1 and DAYS[5] not in [b["t"] for b in out]
    traded = list(bars)
    traded[5] = dict(filler, v=300)                         # it traded on this pod's copy: kept
    assert K.apply("AAPL", "D", traded, "rebuild") is traded


def test_store_and_rebuild_entries_never_cross(vol):
    _publish(vol, 3, {"SPY": [SET_LOW]})
    bars = _series()
    assert K.apply("SPY", "D", bars, "rebuild") is bars
    assert K.apply("SPY", "W", bars, "store") is bars


def test_the_input_dicts_are_never_mutated(vol):
    _publish(vol, 3, {"SPY": [SET_LOW]})
    bars = _series()
    K.apply("SPY", "D", bars, "store")
    assert bars[20]["l"] == 112.09


def test_off_or_without_a_manifest_nothing_changes(vol, monkeypatch):
    bars = _series()
    assert K.apply("SPY", "D", bars, "store") is bars           # no manifest on the volume
    _publish(vol, 3, {"SPY": [SET_LOW]})
    monkeypatch.setenv(K.ENV_SERVE, "0")
    assert K.apply("SPY", "D", bars, "store") is bars
    assert K.history_epoch("SPY", "D") == 0


def test_a_malformed_payload_serves_the_bars_untouched(vol):
    _publish(vol, 3, {"SPY": [SET_LOW]})
    (vol / "bars_corrections" / "v3" / "SPY.json.gz").write_bytes(b"not gzip")
    K._cache.clear()
    bars = _series()
    assert K.apply("SPY", "D", bars, "store") is bars


# ── on the serve path ───────────────────────────────────────────────────────────────────────────────

def test_the_serve_path_corrects_before_the_clamp(vol, monkeypatch):
    """A >=40% print the clamp would trim to an invented value: the ledger's value is served, not the clamp's."""
    monkeypatch.setattr(S, "_meta_cached", lambda t: None)
    bars = _series(bad_low=60.0)                                # the clamp's own test fires on this low
    e = dict(SET_LOW, f={"l": [60.0, 119.57]})
    _publish(vol, 3, {"SPY": [e]})
    out = S.sanitize_daily_bars("SPY", [dict(b) for b in bars], "D")
    assert out[20]["l"] == 119.57


def test_rebuilt_dailies_are_corrected_before_the_weekly_resample(vol, monkeypatch):
    from api.services import bars_fetch as F
    monkeypatch.delenv(R.ENV_SERVE, raising=False)
    d = vol / "bars_rebuild" / "v2"
    d.mkdir(parents=True)
    rows = [[b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]] for b in _series()]
    (d / "SPY.json.gz").write_bytes(gzip.compress(json.dumps({"sym": "SPY", "end": DAYS[-1], "bars": rows}).encode()))
    (vol / "bars_rebuild" / "manifest.json").write_text(json.dumps({"version": 2, "end": DAYS[-1], "symbols": ["SPY"]}))
    R._state.update(version=0, end=None, symbols=frozenset(), loaded=False)
    R._cache.clear()
    assert R.load_local()
    try:
        _publish(vol, 3, {"SPY": [dict(SET_LOW, src="rebuild")]})
        stored_w = F._resample_weekly_iso(_series())
        out = R.apply("SPY", stored_w, "W", head=True)
        week = [w for w in out if w["t"] >= BAD][0]
        assert week["l"] > 119.0 - 1e-9                          # the week's low is no longer 112.09
        daily = R.apply("SPY", _series(), "D", head=True)
        assert daily[20]["l"] == 119.57
    finally:
        R._state.update(version=0, end=None, symbols=frozenset(), loaded=False)
        R._cache.clear()


def test_the_contract_carries_the_epoch(vol):
    from api.services import bar_contract as C
    _publish(vol, 3, {"SPY": [SET_LOW]})
    out = C.compute("SPY", "D", None, [], meta={"rev": 7, "history_rev": 5})
    assert out["history_rev"] == 5 + 3 * K.EPOCH_STEP


# ── versions only rise ──────────────────────────────────────────────────────────────────────────────

def test_a_revert_is_a_higher_version_and_the_epoch_still_rises(vol):
    _publish(vol, 5, {"SPY": [SET_LOW]})
    assert K.apply("SPY", "D", _series(), "store")[20]["l"] == 119.57
    corrected = K.history_epoch("SPY", "D")
    _publish(vol, 6, {}, retired=["SPY"])                      # the drill: v6 takes SPY's entries back
    bars = _series()
    assert K.apply("SPY", "D", bars, "store") is bars
    assert K.history_epoch("SPY", "D") > corrected              # browsers replace their corrected copy


def test_a_pod_still_syncing_does_not_label_its_bars_with_the_new_epoch(vol):
    _publish(vol, 3, {"SPY": [SET_LOW]})
    (vol / "bars_corrections" / "v3" / "SPY.json.gz").unlink()
    K._cache.clear()
    assert K.history_epoch("SPY", "D") == 0
    assert K.history_epoch("QQQ", "D") == 0


class _Client:
    def __init__(self, objs):
        self.objs, self.got = objs, []

    def get_object(self, Bucket, Key):
        self.got.append(Key)
        if Key not in self.objs:
            raise KeyError(Key)
        return {"Body": io.BytesIO(self.objs[Key])}


def test_sync_fetches_every_payload_and_writes_the_manifest_last(vol):
    m = {"version": 4, "symbols": ["SPY", "AAPL"], "retired": []}
    c = _Client({K.MANIFEST_KEY: json.dumps(m).encode(),
                 f"{K.PREFIX}v4/SPY.json.gz": K.encode_payload("SPY", 4, [SET_LOW]),
                 f"{K.PREFIX}v4/AAPL.json.gz": K.encode_payload("AAPL", 4, [])})
    out = K.sync(c, "b")
    assert out["ok"] and out["fetched"] == 2 and K._state["version"] == 4
    assert json.loads((vol / "bars_corrections" / "manifest.json").read_text())["version"] == 4
    assert (vol / "bars_corrections" / "v4" / "SPY.json.gz").exists()
    assert K.apply("SPY", "D", _series(), "store")[20]["l"] == 119.57


def test_sync_refuses_an_older_version(vol):
    _publish(vol, 7, {"SPY": [SET_LOW]})
    c = _Client({K.MANIFEST_KEY: json.dumps({"version": 6, "symbols": [], "retired": []}).encode()})
    out = K.sync(c, "b")
    assert not out["ok"] and "older" in out["reason"] and K._state["version"] == 7
    assert json.loads((vol / "bars_corrections" / "manifest.json").read_text())["version"] == 7


@pytest.mark.parametrize("body", [b"not gzip", None])
def test_sync_never_keeps_a_bad_body_and_keeps_serving_the_volume(vol, body):
    _publish(vol, 3, {"SPY": [SET_LOW]})
    payload = body if body is not None else K.encode_payload("SPY", 99, [SET_LOW])   # names another version
    c = _Client({K.MANIFEST_KEY: json.dumps({"version": 4, "symbols": ["SPY"]}).encode(), f"{K.PREFIX}v4/SPY.json.gz": payload})
    out = K.sync(c, "b")
    assert not out["ok"] and K._state["version"] == 3
    assert not (vol / "bars_corrections" / "v4" / "SPY.json.gz").exists()
    assert K.apply("SPY", "D", _series(), "store")[20]["l"] == 119.57


def test_the_publisher_and_the_applier_share_one_codec():
    body = K.encode_payload("spy", 9, [SET_LOW])
    doc = K.decode_payload(body)
    assert doc == {"sym": "SPY", "version": 9, "entries": [SET_LOW]}
    with pytest.raises(Exception):
        K.decode_payload(gzip.compress(b'{"sym": "SPY"}'))


def test_the_cache_is_bounded_by_entries_not_only_tickers(vol, monkeypatch):
    """A 2-decimal re-precision ticker carries ~10,000 entries: the cache must not hold dozens of them at once."""
    monkeypatch.setattr(K, "_CACHE_ENTRIES_MAX", 25)
    big = [dict(SET_LOW, d=t, f={"l": [119.0, 118.99]}) for t in DAYS[:20]]
    _publish(vol, 3, {"AAA": big, "BBB": big, "SPY": [SET_LOW]})
    for sym in ("AAA", "BBB", "SPY"):
        K.entries_for(sym, "D", "store")
    assert sum(v[1] for v in K._cache.values()) <= 25
    assert ("AAA", 3) not in K._cache and ("BBB", 3) in K._cache


def test_malformed_and_unknown_entries_are_skipped_not_fatal(vol):
    junk = [{"tf": "D", "src": "store", "d": BAD, "op": "set", "f": {"l": "x"}},
            {"tf": "D", "src": "store", "d": BAD, "op": "teleport"}, "not a dict", SET_LOW]
    _publish(vol, 3, {"SPY": junk})
    assert K.apply("SPY", "D", _series(), "store")[20]["l"] == 119.57
