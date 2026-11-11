"""Rail: the knowledge policy / criteria file caches never serve a STALE file after a rewrite in one mtime tick.

Root cause of the flaky test_r751_mentions_mode_only_serve_flagged_re_admits: the cache was keyed on the float
st_mtime, so two writes to the same path within one mtime tick served the previous policy.
"""
import json
import os
import time

import pytest

from api.services.uct_agent.knowledge import criteria, policy

@pytest.fixture
def past_ns():
    """An mtime well outside the racy window, read when the test runs (never at import)."""
    return time.time_ns() - 3600 * 10**9


def _write(f, data, ns):
    f.write_text(json.dumps(data), encoding="utf-8")
    os.utime(f, ns=(ns, ns))


def _pol(mode):
    return {"policy_version": 1, "sources": {}, "prefix_classes": [], "tag": mode}


def _reset():
    policy._cache.update(path=None, key=None, data=None)
    criteria._cache.update(path=None, key=None, data=None)


def test_rewrite_in_same_mtime_tick_serves_new_content(monkeypatch, tmp_path, past_ns):
    f = tmp_path / "policy.json"
    monkeypatch.setenv(policy.ENV_PATH, str(f))
    _reset()
    _write(f, _pol("old"), past_ns)
    assert policy.load()["tag"] == "old"
    _write(f, _pol("newer"), past_ns)                  # identical mtime_ns, different content
    assert f.stat().st_mtime_ns == past_ns
    assert policy.load()["tag"] == "newer"


def test_control_old_mtime_key_serves_stale(monkeypatch, tmp_path, past_ns):
    """The pre-fix key (float st_mtime) returns the previous policy in the same scenario."""
    monkeypatch.setattr(policy, "file_key", lambda st: st.st_mtime)
    f = tmp_path / "policy.json"
    monkeypatch.setenv(policy.ENV_PATH, str(f))
    _reset()
    _write(f, _pol("old"), past_ns)
    assert policy.load()["tag"] == "old"
    _write(f, _pol("newer"), past_ns)
    assert policy.load()["tag"] == "old"               # STALE: the bug


def test_same_size_rewrite_in_racy_window_is_reread(monkeypatch, tmp_path):
    f = tmp_path / "policy.json"
    monkeypatch.setenv(policy.ENV_PATH, str(f))
    _reset()
    now = time.time_ns()
    _write(f, _pol("aaa"), now)
    assert policy.load()["tag"] == "aaa"
    _write(f, _pol("bbb"), now)                        # same size AND same mtime_ns: key cannot tell them apart
    assert policy.load()["tag"] == "bbb"
    # control: without the racy-window rule the same-size rewrite is served stale
    monkeypatch.setattr(policy, "RACY_WINDOW_NS", -10**18)
    _write(f, _pol("ccc"), now)
    assert policy.load()["tag"] == "bbb"


def test_settled_file_is_served_from_cache(monkeypatch, tmp_path, past_ns):
    f = tmp_path / "policy.json"
    monkeypatch.setenv(policy.ENV_PATH, str(f))
    _reset()
    _write(f, _pol("cached"), past_ns)
    assert policy.load()["tag"] == "cached"

    def boom(*a, **k):
        raise AssertionError("re-read a settled, unchanged file")
    monkeypatch.setattr(type(f), "read_text", boom)
    assert policy.load()["tag"] == "cached"            # hot path: one stat, no read


def test_criteria_rewrite_in_same_mtime_tick_serves_new_content(monkeypatch, tmp_path, past_ns):
    f = tmp_path / "criteria.json"
    monkeypatch.setenv(criteria.ENV_PATH, str(f))
    _reset()
    _write(f, {"templates": [], "tag": "old"}, past_ns)
    assert criteria.load()["tag"] == "old"
    _write(f, {"templates": [], "tag": "newer"}, past_ns)
    assert criteria.load()["tag"] == "newer"
