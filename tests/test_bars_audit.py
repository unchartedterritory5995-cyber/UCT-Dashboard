import json
import pytest

from api.services import bars_disk_cache, bar_quarantine, bars_audit


@pytest.fixture
def tmp_cache(tmp_path, monkeypatch):
    cache_dir = tmp_path / "bars_cache"
    cache_dir.mkdir()
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()
    return cache_dir


def test_audit_ticker_finds_planted_corruption(tmp_cache):
    """Plant a known-bad bar and verify the audit finds it."""
    payload = {
        "bars": [
            {"t": 1715080700, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
            {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
        ]
    }
    (tmp_cache / "QQQ_30_100.json").write_text(json.dumps(payload))

    report = bars_audit.audit_ticker("QQQ", tfs=["30"], bars_counts=[100])
    assert report["bars_scanned"] == 2
    assert report["issues_found"] >= 1
    assert any(
        i["bar_time"] == 1715080800 and ("deviation" in i["reason"].lower() or "volume" in i["reason"].lower())
        for i in report["issues"]
    )


def test_audit_ticker_clean_returns_no_issues(tmp_cache):
    payload = {
        "bars": [
            {"t": 1715080700, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
            {"t": 1715080800, "o": 702, "h": 707, "l": 701, "c": 706, "v": 1100000},
        ]
    }
    (tmp_cache / "QQQ_30_100.json").write_text(json.dumps(payload))
    report = bars_audit.audit_ticker("QQQ", tfs=["30"], bars_counts=[100])
    assert report["issues_found"] == 0


import os


def test_audit_universe_scans_multiple_tickers(tmp_cache, tmp_path, monkeypatch):
    audits_dir = tmp_path / "audits"
    monkeypatch.setattr(bars_audit, "_AUDIT_DIR", str(audits_dir))
    monkeypatch.setattr(bars_audit, "_DB_PATH", str(tmp_path / "auth.db"))
    bars_audit._init_audit_runs_table()

    for sym in ("QQQ", "SPY", "AAPL"):
        clean = {"bars": [{"t": 1715080800, "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 1000}]}
        (tmp_cache / f"{sym}_30_100.json").write_text(json.dumps(clean))
    # Plant corruption in QQQ
    bad = {"bars": [{"t": 1715080800, "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 1000},
                    {"t": 1715080900, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}]}
    (tmp_cache / "QQQ_30_100.json").write_text(json.dumps(bad))

    report = bars_audit.audit_universe(
        tickers=["QQQ", "SPY", "AAPL"],
        tfs=["30"],
        bars_counts=[100],
        parallelism=2,
    )
    assert report["tickers_scanned"] == 3
    assert report["issues_found"] >= 1
    assert os.path.exists(report["report_path"])
    with open(report["report_path"]) as f:
        on_disk = json.load(f)
    assert on_disk["issues_found"] == report["issues_found"]


def test_latest_report_returns_highest_run_id(tmp_cache, tmp_path, monkeypatch):
    """Without numeric sort, lexicographic order would return audit-9 over audit-10."""
    audits_dir = tmp_path / "audits"
    audits_dir.mkdir()
    monkeypatch.setattr(bars_audit, "_AUDIT_DIR", str(audits_dir))
    monkeypatch.setattr(bars_audit, "_DB_PATH", str(tmp_path / "auth.db"))
    bars_audit._init_audit_runs_table()

    # Plant 11 fake audit reports so we cross the 9 -> 10 lexicographic boundary
    for i in range(1, 12):
        path = audits_dir / f"audit-{i}.json"
        path.write_text(json.dumps({"run_id": i, "marker": f"run-{i}"}))
        # Record in DB so latest_report() can find them via SQL ORDER BY id
        with __import__('sqlite3').connect(bars_audit._DB_PATH) as db:
            db.execute(
                "INSERT INTO audit_runs (id, started_at, scope, report_path) VALUES (?, ?, ?, ?)",
                (i, 1715000000 + i, "test", str(path)),
            )

    rep = bars_audit.latest_report()
    assert rep is not None
    assert rep["run_id"] == 11  # NOT 9 (lexicographic) NOT 1 (FIFO)


# --- Report retention (2026-07-23 disk incident) ------------------------------
# /data/audits had NO retention: one JSON per run, kept forever. 11,850 files /
# 1.0GB on the web volume, back to audit-1.json.

import os as _os
import time as _time

from api.services import bars_audit as _ba


def _report(d, run_id, size, age_days):
    p = _os.path.join(d, f"audit-{run_id}.json")
    with open(p, "wb") as f:
        f.write(b"x" * size)
    t = _time.time() - age_days * 86400
    _os.utime(p, (t, t))
    return p


def test_prune_reports_keeps_newest_and_drops_expired(tmp_path, monkeypatch):
    d = str(tmp_path / "audits")
    _os.makedirs(d)
    monkeypatch.setattr(_ba, "_AUDIT_DIR", d)
    for i in range(10):
        _report(d, i, 10, age_days=100 - i)        # all ancient, ascending recency
    removed = _ba.prune_reports(keep=3, max_age_days=30)
    assert removed == 7
    left = sorted(_os.listdir(d))
    assert len(left) == 3
    assert "audit-9.json" in left                  # newest always survives


def test_prune_reports_spares_recent_beyond_keep(tmp_path, monkeypatch):
    """Age still gates deletion — a burst of runs this week isn't garbage."""
    d = str(tmp_path / "audits")
    _os.makedirs(d)
    monkeypatch.setattr(_ba, "_AUDIT_DIR", d)
    for i in range(10):
        _report(d, i, 10, age_days=1)
    assert _ba.prune_reports(keep=3, max_age_days=30) == 0
    assert len(_os.listdir(d)) == 10


def test_prune_reports_ignores_foreign_files(tmp_path, monkeypatch):
    d = str(tmp_path / "audits")
    _os.makedirs(d)
    monkeypatch.setattr(_ba, "_AUDIT_DIR", d)
    _report(d, 1, 10, age_days=999)
    keep_me = _os.path.join(d, "NOTES.md")
    with open(keep_me, "w") as f:
        f.write("hand-written")
    _os.utime(keep_me, (0, 0))                     # ancient, but not ours
    _ba.prune_reports(keep=0, max_age_days=30)
    assert _os.path.exists(keep_me)


def test_prune_reports_missing_dir_is_a_noop(tmp_path, monkeypatch):
    monkeypatch.setattr(_ba, "_AUDIT_DIR", str(tmp_path / "nope"))
    assert _ba.prune_reports() == 0
