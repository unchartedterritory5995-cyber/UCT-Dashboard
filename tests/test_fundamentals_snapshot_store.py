"""Persistent fundamentals snapshot store + earnings-table stale-while-revalidate."""
import importlib

from api.services import fundamentals_snapshot_store as store


def test_put_get_roundtrip():
    store.put("k1", "aapl", {"x": 1, "arr": [1, 2]}, ttl=600, now=1000.0)
    got = store.get("k1", "AAPL", now=1100.0)
    assert got is not None
    payload, age, ttl = got
    assert payload == {"x": 1, "arr": [1, 2]}
    assert age == 100.0
    assert ttl == 600


def test_get_missing_returns_none():
    assert store.get("k1", "ZZNOPE") is None


def test_replace_updates_payload_and_clock():
    store.put("k2", "MSFT", {"v": 1}, ttl=60, now=1000.0)
    store.put("k2", "MSFT", {"v": 2}, ttl=120, now=2000.0)
    payload, age, ttl = store.get("k2", "MSFT", now=2050.0)
    assert payload == {"v": 2}
    assert age == 50.0
    assert ttl == 120


def test_delete():
    store.put("k3", "NVDA", {"v": 1}, ttl=60, now=1000.0)
    store.delete("k3", "NVDA")
    assert store.get("k3", "NVDA") is None


def test_kinds_are_isolated():
    store.put("kind_a", "TSLA", {"a": 1}, ttl=60, now=1000.0)
    assert store.get("kind_b", "TSLA") is None


def test_prune_drops_old_rows():
    store.put("k4", "OLD", {"v": 1}, ttl=60, now=0.0)
    store.put("k4", "NEW", {"v": 2}, ttl=60, now=89 * 86400.0)
    n = store.prune(max_age_days=90, now=91 * 86400.0)
    assert n == 1
    assert store.get("k4", "OLD") is None
    assert store.get("k4", "NEW") is not None


# ── earnings_table serve path over the store ─────────────────────────────────

def _et(monkeypatch, tmp_path):
    monkeypatch.setenv("FUNDAMENTALS_ESTIMATES_DB_PATH", str(tmp_path / "est.db"))
    import api.services.earnings_table as et
    importlib.reload(et)
    return et


def _stub_build(monkeypatch, et, calls, annual=None):
    annual = annual if annual is not None else [{"year": 2025, "eps": 2.0, "estimate": False}]
    monkeypatch.setattr(et, "get_annual_financials_fn",
                        lambda t, now: calls.append(t) or annual)
    monkeypatch.setattr(et, "_build_quarterly",
                        lambda t, now, fresh=False: [{"label": "2025 Q4", "reported": True}])
    monkeypatch.setattr(et, "_is_fresh_window", lambda t, now: False)


def test_earnings_table_fresh_disk_hit_skips_build(monkeypatch, tmp_path):
    et = _et(monkeypatch, tmp_path)
    calls = []
    _stub_build(monkeypatch, et, calls)
    now = 1_760_000_000.0
    first = et.get_earnings_table("ZZDISK", now=now)          # cold → build + persist
    assert calls == ["ZZDISK"]
    et.cache.invalidate("earnings_table::ZZDISK")             # simulate redeploy (memory gone)
    second = et.get_earnings_table("ZZDISK", now=now + 60)    # within ttl → disk, no rebuild
    assert second == first
    assert calls == ["ZZDISK"]                                # build ran exactly once


def test_earnings_table_stale_serves_old_and_schedules_refresh(monkeypatch, tmp_path):
    et = _et(monkeypatch, tmp_path)
    calls = []
    _stub_build(monkeypatch, et, calls)
    now = 1_760_000_000.0
    first = et.get_earnings_table("ZZSTALE", now=now)
    assert calls == ["ZZSTALE"]
    et.cache.invalidate("earnings_table::ZZSTALE")
    scheduled = []
    monkeypatch.setattr(et, "_schedule_refresh", lambda t: scheduled.append(t))
    # Past the 6h slow TTL but under the 3-day stale ceiling → instant stale serve.
    out = et.get_earnings_table("ZZSTALE", now=now + et._SLOW_TTL + 60)
    assert out == first                                       # served instantly, old payload
    assert scheduled == ["ZZSTALE"]                           # background rebuild queued
    assert calls == ["ZZSTALE"]                               # no synchronous rebuild


def test_earnings_table_too_old_rebuilds_synchronously(monkeypatch, tmp_path):
    et = _et(monkeypatch, tmp_path)
    calls = []
    _stub_build(monkeypatch, et, calls)
    now = 1_760_000_000.0
    et.get_earnings_table("ZZOLD", now=now)
    et.cache.invalidate("earnings_table::ZZOLD")
    out = et.get_earnings_table("ZZOLD", now=now + et._STALE_SERVE_MAX + et._SLOW_TTL + 60)
    assert calls == ["ZZOLD", "ZZOLD"]                        # rebuilt on the request path
    assert out["annual"]


def test_earnings_table_empty_not_persisted(monkeypatch, tmp_path):
    et = _et(monkeypatch, tmp_path)
    calls = []
    _stub_build(monkeypatch, et, calls, annual=[])
    monkeypatch.setattr(et, "_build_quarterly", lambda t, now, fresh=False: [])
    now = 1_760_000_000.0
    out = et.get_earnings_table("ZZEMPTY2", now=now)
    assert out["annual"] == [] and out["quarterly"] == []
    assert store.get("earnings_table", "ZZEMPTY2") is None    # empties never hit disk


def test_invalidate_clears_memory_and_disk(monkeypatch, tmp_path):
    et = _et(monkeypatch, tmp_path)
    calls = []
    _stub_build(monkeypatch, et, calls)
    now = 1_760_000_000.0
    et.get_earnings_table("ZZINV", now=now)
    assert store.get("earnings_table", "ZZINV") is not None
    et.invalidate("ZZINV")
    assert et.cache.get("earnings_table::ZZINV") is None
    assert store.get("earnings_table", "ZZINV") is None


def test_refresh_now_rebuilds_when_stale_and_skips_when_fresh(monkeypatch, tmp_path):
    et = _et(monkeypatch, tmp_path)
    calls = []
    _stub_build(monkeypatch, et, calls)
    now = 1_760_000_000.0
    et.get_earnings_table("ZZRPT", now=now)
    assert calls == ["ZZRPT"]
    # Snapshot is seconds old → no-op.
    assert et.refresh_now("ZZRPT", max_age=600, now=now + 30) is False
    assert calls == ["ZZRPT"]
    # Snapshot past max_age → synchronous rebuild.
    assert et.refresh_now("ZZRPT", max_age=600, now=now + 700) is True
    assert calls == ["ZZRPT", "ZZRPT"]
