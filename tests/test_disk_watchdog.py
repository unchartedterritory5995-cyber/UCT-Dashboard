"""Tests for api/services/disk_watchdog.py — the volume-level disk monitor.

Born from the 2026-07-23 incident: the tape spool paused itself on a disk budget
and gap capture stayed dead three trading days, because the only thing watching
disk was a per-feature guard that reported on ITSELF. The real cause — 33GB of
unpruned gap-fill backups in a sibling directory — was never mentioned by anything.
"""
import os
import types

import pytest

from api.services import disk_watchdog as dw


@pytest.fixture
def vol(tmp_path, monkeypatch):
    """A fake /data with a clean watchdog state."""
    monkeypatch.setattr(dw, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(dw, "SERVICE", "test-pod")
    dw._state.update({"level": "ok", "last_alert_at": 0.0, "last_check_at": 0.0,
                      "last_sizes": {}, "last_report": None, "checks": 0,
                      "alerts_sent": 0})
    return tmp_path


def _fill(path, name, size, subdir=False):
    if subdir:
        d = path / name
        d.mkdir(exist_ok=True)
        (d / "blob.bin").write_bytes(b"x" * size)
        return d
    p = path / name
    p.write_bytes(b"x" * size)
    return p


def _fake_usage(total, used):
    return types.SimpleNamespace(total=total, used=used, free=total - used)


def _posts(monkeypatch):
    sent = []
    monkeypatch.setattr(dw, "_post", lambda m: sent.append(m))
    return sent


def test_top_consumers_ranks_dirs_and_files_together(vol):
    _fill(vol, "flow_backups", 3000, subdir=True)
    _fill(vol, "tape_spool", 2000, subdir=True)
    _fill(vol, "flow.db", 1000)
    names = [n for n, _ in dw.top_consumers()]
    assert names[:3] == ["flow_backups", "tape_spool", "flow.db"]


def test_top_consumers_ignores_symlinks(vol):
    """A symlink into another tree would double-count, or worse, cycle."""
    _fill(vol, "real", 500, subdir=True)
    try:
        os.symlink(str(vol / "real"), str(vol / "link"))
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unavailable on this platform/user")
    assert [n for n, _ in dw.top_consumers()] == ["real"]


def test_ok_volume_is_silent(vol, monkeypatch):
    sent = _posts(monkeypatch)
    monkeypatch.setattr(dw.shutil, "disk_usage", lambda p: _fake_usage(1000, 100))
    dw.check_once()
    assert sent == []


def test_crossing_warn_alerts_and_names_the_culprit(vol, monkeypatch):
    """The alert must identify WHO, not just that the disk is full — that is the
    whole difference from the feature-scoped guard that failed us."""
    sent = _posts(monkeypatch)
    _fill(vol, "flow_backups", 4000, subdir=True)
    _fill(vol, "tape_spool", 100, subdir=True)
    monkeypatch.setattr(dw.shutil, "disk_usage", lambda p: _fake_usage(1000, 800))
    dw.check_once()
    assert len(sent) == 1
    assert "DISK WARN" in sent[0]
    assert "test-pod" in sent[0]
    assert "flow_backups" in sent[0], "the biggest consumer must be named"


def test_crit_threshold_escalates(vol, monkeypatch):
    sent = _posts(monkeypatch)
    monkeypatch.setattr(dw.shutil, "disk_usage", lambda p: _fake_usage(1000, 950))
    dw.check_once()
    assert "DISK CRIT" in sent[0]


def test_steady_state_does_not_respam_but_does_re_alert(vol, monkeypatch):
    """Silence-after-one-shot is exactly how the spool sat dead for three days,
    so a persistent problem must keep nagging — just not every cycle."""
    sent = _posts(monkeypatch)
    monkeypatch.setattr(dw.shutil, "disk_usage", lambda p: _fake_usage(1000, 800))
    dw.check_once()
    dw.check_once()
    assert len(sent) == 1, "must not alert on every cycle"

    dw._state["last_alert_at"] = 0.0            # simulate REALERT_SECONDS elapsing
    dw.check_once()
    assert len(sent) == 2, "a still-broken volume must nag again"


def test_recovery_is_announced(vol, monkeypatch):
    sent = _posts(monkeypatch)
    monkeypatch.setattr(dw.shutil, "disk_usage", lambda p: _fake_usage(1000, 800))
    dw.check_once()
    monkeypatch.setattr(dw.shutil, "disk_usage", lambda p: _fake_usage(1000, 100))
    dw.check_once()
    assert "DISK OK" in sent[-1]


def test_runaway_growth_alerts_before_the_volume_is_even_full(vol, monkeypatch):
    """The early warning the incident lacked: flow_backups climbing 2.3GB a run
    should be named days before it starves a neighbour."""
    sent = _posts(monkeypatch)
    monkeypatch.setattr(dw, "GROWTH_ALERT_GB", 0.0000001)   # ~100 bytes
    monkeypatch.setattr(dw.shutil, "disk_usage", lambda p: _fake_usage(1000, 100))
    _fill(vol, "flow_backups", 100, subdir=True)
    dw.check_once()
    assert sent == [], "first observation has no baseline to compare against"

    _fill(vol, "flow_backups", 9000, subdir=True)
    dw.check_once()
    assert len(sent) == 1
    assert "growth" in sent[0].lower() and "flow_backups" in sent[0]


def test_check_once_never_raises_on_a_broken_volume(vol, monkeypatch):
    def boom(path):
        raise OSError("volume gone")
    monkeypatch.setattr(dw.shutil, "disk_usage", boom)
    assert dw.check_once() == {}          # swallowed, not propagated


def test_snapshot_shape(vol, monkeypatch):
    monkeypatch.setattr(dw.shutil, "disk_usage", lambda p: _fake_usage(1000, 250))
    _fill(vol, "bars.db", 200)
    snap = dw.snapshot()
    assert snap["used_pct"] == 25.0
    assert snap["level"] == "ok"
    assert snap["top_consumers"][0]["name"] == "bars.db"
    assert snap["top_consumers"][0]["human"].endswith("GB")


def test_start_is_idempotent(monkeypatch):
    monkeypatch.setattr(dw, "_started", False)
    monkeypatch.setattr(dw, "ENABLED", False)
    assert dw.start() is False           # disabled => never spawns a thread
