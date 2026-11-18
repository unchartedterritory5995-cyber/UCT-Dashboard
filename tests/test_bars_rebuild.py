"""Rebuilt deep daily history, served per ticker (api/services/bars_rebuild.py, 2026-11-18)."""
import gzip
import io
import json

import pytest

from api.services import bars_rebuild as R
from api.services import bars_sanitize as S


def _days(n, start="2003-09-10"):
    import datetime as dt
    out, d = [], dt.date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


DAYS = _days(80)
END = DAYS[59]                               # the rebuild ends here; the store has the rest


def _bar(t, c, v=100):
    return {"t": t, "o": c, "h": c, "l": c, "c": c, "v": v}


@pytest.fixture()
def vol(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(R.ENV_SERVE, raising=False)
    d = tmp_path / "bars_rebuild" / "v3"
    d.mkdir(parents=True)
    series = {"sym": "ASB", "end": END, "bars": [[t, 32.0, 32.0, 32.0, 32.0, 100] for t in DAYS[:60]]}
    (d / "ASB.json.gz").write_bytes(gzip.compress(json.dumps(series).encode()))
    (tmp_path / "bars_rebuild" / "manifest.json").write_text(json.dumps({"version": 3, "end": END, "symbols": ["ASB"]}))
    R._state.update(version=0, end=None, symbols=frozenset(), loaded=False)
    R._cache.clear()
    assert R.load_local()
    yield tmp_path
    R._state.update(version=0, end=None, symbols=frozenset(), loaded=False)
    R._cache.clear()


STORED = [_bar(t, 2.0) for t in DAYS[:60]] + [_bar(t, 33.0) for t in DAYS[60:]]   # ASB 2006: ~$2 where it traded at $32


def test_daily_is_the_rebuild_through_its_end_and_the_store_after(vol):
    out = R.apply("ASB", STORED, "D", head=True)
    assert [b["c"] for b in out] == [32.0] * 60 + [33.0] * 20
    assert [b["t"] for b in out] == DAYS


def test_a_window_read_stays_its_window(vol):
    """A first paint of the newest N stored bars is never turned into the whole rebuilt history."""
    out = R.apply("ASB", STORED[50:], "D", head=False)
    assert out[0]["t"] == DAYS[50] and len(out) == 30


def test_weekly_and_monthly_come_from_the_rebuild_until_end_s_period(vol):
    from api.services import bars_fetch as F
    stored_w = F._resample_weekly_iso(STORED)
    out = R.apply("ASB", stored_w, "W", head=True)
    cut = R._period_start(END, "W")
    assert all(b["c"] == 32.0 for b in out if R._period_start(b["t"], "W") < cut)
    assert [b for b in out if R._period_start(b["t"], "W") >= cut] == [b for b in stored_w if R._period_start(b["t"], "W") >= cut]
    stored_m = F._resample_monthly_iso(STORED)
    out_m = R.apply("ASB", stored_m, "M", head=True)
    assert out_m[0]["c"] == 32.0 and out_m[-1] == stored_m[-1]


def test_a_ticker_not_on_the_served_list_is_never_touched(vol):
    assert R.apply("AAPL", STORED, "D", head=True) is None
    assert R.history_epoch("AAPL", "D") == 0


def test_the_kill_switch_serves_the_stored_bars(vol, monkeypatch):
    monkeypatch.setenv(R.ENV_SERVE, "0")
    assert R.apply("ASB", STORED, "D", head=True) is None
    assert R.history_epoch("ASB", "D") == 0


def test_the_epoch_moves_only_while_the_series_is_on_this_volume(vol):
    assert R.history_epoch("ASB", "D") == 3 * R.EPOCH_STEP and R.history_epoch("ASB", "M") == 3 * R.EPOCH_STEP
    assert R.history_epoch("ASB", "5") == 0
    (vol / "bars_rebuild" / "v3" / "ASB.json.gz").unlink()
    R._cache.clear()
    assert R.history_epoch("ASB", "D") == 0 and R.apply("ASB", STORED, "D", head=True) is None


def test_the_serve_path_uses_it_and_skips_the_stored_repairs(vol, monkeypatch):
    monkeypatch.setattr(S, "_reaches_store_head", lambda t, b, tf: True)
    out = S.sanitize_daily_bars("ASB", [dict(b) for b in STORED], "D")
    assert [b["c"] for b in out[:60]] == [32.0] * 60


def test_a_split_after_the_rebuild_is_healed_over_the_rebuilt_history(vol, monkeypatch):
    """The rebuild is on the basis of the day it was built. A served ticker that splits LATER: the store's bars
    after the split are on the new basis, the rebuilt ones are not, and the chart would draw a cliff. The
    serve-time split heal (the one detector) still runs over the rebuilt history."""
    split_day = DAYS[60]
    stored = [_bar(t, 2.0) for t in DAYS[:60]] + [_bar(t, 16.0) for t in DAYS[60:]]   # 2:1 on DAYS[60]
    monkeypatch.setattr(S, "_reaches_store_head", lambda t, b, tf: True)
    monkeypatch.setattr(S, "_meta_cached", lambda t: {"ipo": None, "splits": [(split_day, 2.0)]})
    monkeypatch.setattr(S, "split_adjust_active", lambda: True)
    monkeypatch.setattr(S, "_schedule_store_repair", lambda t, tf: None)
    out = S.sanitize_daily_bars("ASB", [dict(b) for b in stored], "D")
    assert {b["c"] for b in out} == {16.0}                       # 32 / 2 before the split, 16 after: no cliff


def test_the_contract_carries_the_epoch(vol):
    from api.services import bar_contract as C
    out = C.compute("ASB", "D", None, [], meta={"rev": 7, "history_rev": 5})
    assert out["history_rev"] == 5 + 3 * R.EPOCH_STEP


class _Client:
    def __init__(self, objs):
        self.objs, self.got = objs, []

    def get_object(self, Bucket, Key):
        self.got.append(Key)
        if Key not in self.objs:
            raise KeyError(Key)
        return {"Body": io.BytesIO(self.objs[Key])}


def test_sync_fetches_the_named_series_and_writes_the_manifest_last(vol):
    m = {"version": 4, "end": END, "symbols": ["ASB", "BCPC"]}
    body = gzip.compress(json.dumps({"sym": "X", "end": END, "bars": [[END, 1, 1, 1, 1, 1]]}).encode())
    c = _Client({R.MANIFEST_KEY: json.dumps(m).encode(), "daily-rebuild/v4/ASB.json.gz": body,
                 "daily-rebuild/v4/BCPC.json.gz": body})
    out = R.sync(c, "b")
    assert out["ok"] and out["fetched"] == 2 and R._state["version"] == 4
    assert c.got[0] == R.MANIFEST_KEY
    assert json.loads((vol / "bars_rebuild" / "manifest.json").read_text())["version"] == 4


def test_a_failed_sync_keeps_serving_what_is_on_the_volume(vol):
    m = {"version": 5, "end": END, "symbols": ["ASB"]}
    c = _Client({R.MANIFEST_KEY: json.dumps(m).encode(), "daily-rebuild/v5/ASB.json.gz": b"not gzip"})
    out = R.sync(c, "b")
    assert not out["ok"] and R._state["version"] == 3
    assert R.apply("ASB", STORED, "D", head=True)[0]["c"] == 32.0
