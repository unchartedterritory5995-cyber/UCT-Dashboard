import os
import importlib


def _fresh_store(tmp_path, monkeypatch):
    db = tmp_path / "est.db"
    monkeypatch.setenv("FUNDAMENTALS_ESTIMATES_DB_PATH", str(db))
    import api.services.fundamentals_estimates_store as s
    importlib.reload(s)  # re-resolve module-level state against the tmp db
    return s


def test_revision_none_without_history(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    rev = s.revision_for("ZZAAA", 2026, 3.15, 7.8e9, now=1_700_000_000.0)
    assert rev == {"eps": None, "sales": None}


def test_revision_up_when_estimate_raised(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    day = 86400.0
    base = 1_700_000_000.0
    # Snapshot 31 days ago at a lower estimate.
    s.record_snapshot("ZZAAA", 2026, eps_est=3.00, sales_est=7.0e9, now=base - 31 * day)
    rev = s.revision_for("ZZAAA", 2026, eps_est=3.15, sales_est=7.8e9, now=base, lookback_days=30)
    assert rev["eps"] == "up"
    assert rev["sales"] == "up"


def test_revision_down_when_estimate_cut(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    day = 86400.0
    base = 1_700_000_000.0
    s.record_snapshot("ZZAAA", 2026, eps_est=3.30, sales_est=8.0e9, now=base - 40 * day)
    rev = s.revision_for("ZZAAA", 2026, eps_est=3.15, sales_est=7.8e9, now=base, lookback_days=30)
    assert rev["eps"] == "down"
    assert rev["sales"] == "down"


def test_snapshot_dedups_per_day(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    base = 1_700_000_000.0
    s.record_snapshot("ZZBBB", 2026, 3.0, 7.0e9, now=base)
    s.record_snapshot("ZZBBB", 2026, 3.1, 7.1e9, now=base + 3600)  # same day → ignored
    assert s._count("ZZBBB", 2026) == 1
    s.record_snapshot("ZZBBB", 2026, 3.2, 7.2e9, now=base + 2 * 86400)  # 2 days later → kept
    assert s._count("ZZBBB", 2026) == 2


def test_prune_removes_old(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    base = 1_700_000_000.0
    s.record_snapshot("ZZCCC", 2026, 3.0, 7.0e9, now=base - 500 * 86400)
    s.record_snapshot("ZZCCC", 2026, 3.1, 7.1e9, now=base)
    removed = s.prune(now=base, max_age_days=400)
    assert removed == 1
    assert s._count("ZZCCC", 2026) == 1
