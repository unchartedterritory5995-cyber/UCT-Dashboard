"""D1: the serve-time wick clamp never trims a wick a second vendor independently shows (bars_sanitize._clamp_wicks +
bars_corrections.keep_wicks, 2026-11-20). Synthetic numbers shaped like PG 2010-05-06 (a real flash-crash low)."""
import json

import pytest

from api.services import bars_corrections as K
from api.services import bars_sanitize as S


def _days(n, start="2010-04-01"):
    import datetime as dt
    out, d = [], dt.date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


DAYS = _days(30)
CRASH = DAYS[15]


def _series(low=39.37, high=62.67):
    out = [{"t": t, "o": 61.0, "h": 61.5, "l": 60.5, "c": 61.0, "v": 1000} for t in DAYS]
    out[15] = {"t": CRASH, "o": 61.91, "h": high, "l": low, "c": 60.75, "v": 5000}
    return out


@pytest.fixture()
def vol(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(K.ENV_SERVE, raising=False)
    monkeypatch.setattr(S, "_meta_cached", lambda t: None)
    K._state.update(version=0, symbols=frozenset(), retired=frozenset(), loaded=False)
    K._cache.clear()
    yield tmp_path
    K._state.update(version=0, symbols=frozenset(), retired=frozenset(), loaded=False)
    K._cache.clear()


def _publish(root, entries, sym="PG", version=2):
    d = root / "bars_corrections" / f"v{version}"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{sym}.json.gz").write_bytes(K.encode_payload(sym, version, entries))
    (root / "bars_corrections" / "manifest.json").write_text(json.dumps({"version": version, "symbols": [sym]}))
    assert K.load_local()


KEEP_LOW = {"tf": "D", "src": "store", "d": CRASH, "op": "keep_wick", "field": "l", "value": 39.37}


def test_without_a_ledger_the_clamp_trims_as_before(vol):
    out = S.sanitize_daily_bars("PG", _series(), "D")
    assert out[15]["l"] == 60.5                     # min(body, neighbours' lows): today's behaviour


def test_a_wick_the_second_vendor_confirms_is_never_trimmed(vol):
    _publish(vol, [KEEP_LOW])
    out = S.sanitize_daily_bars("PG", _series(), "D")
    assert out[15]["l"] == 39.37


def test_a_keep_only_holds_while_the_bar_has_that_value(vol):
    _publish(vol, [KEEP_LOW])
    out = S.sanitize_daily_bars("PG", _series(low=30.0), "D")     # a different print on this pod: trimmed
    assert out[15]["l"] == 60.5


def test_a_kept_low_does_not_protect_the_high(vol):
    _publish(vol, [KEEP_LOW])
    out = S.sanitize_daily_bars("PG", _series(high=99.0), "D")
    assert out[15]["l"] == 39.37 and out[15]["h"] == 61.91


def test_a_rebuild_keep_does_not_protect_a_stored_series(vol):
    _publish(vol, [dict(KEEP_LOW, src="rebuild")])
    out = S.sanitize_daily_bars("PG", _series(), "D")
    assert out[15]["l"] == 60.5


def test_the_kill_switch_trims_as_before(vol, monkeypatch):
    _publish(vol, [KEEP_LOW])
    monkeypatch.setenv(K.ENV_SERVE, "0")
    out = S.sanitize_daily_bars("PG", _series(), "D")
    assert out[15]["l"] == 60.5


def test_the_clamp_alone_keeps_its_old_signature_and_behaviour():
    out = S._clamp_wicks([dict(b) for b in _series()])
    assert out[15]["l"] == 60.5
