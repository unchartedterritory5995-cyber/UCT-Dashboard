"""Rail: the knowledge policy / criteria file caches never serve a STALE file after a rewrite in one mtime tick.

Root cause of the flaky test_r751_mentions_mode_only_serve_flagged_re_admits: the cache was keyed on the float
st_mtime, so two writes to the same path within one mtime tick served the previous policy.
"""
import json
import os
import time

from api.services.uct_agent.knowledge import criteria, policy

PAST_NS = time.time_ns() - 3600 * 10**9            # well outside the racy window


def _write(f, data, ns):
    f.write_text(json.dumps(data), encoding="utf-8")
    os.utime(f, ns=(ns, ns))


def _pol(mode):
    return {"policy_version": 1, "sources": {}, "prefix_classes": [], "tag": mode}


def _reset():
    policy._cache.update(path=None, key=None, data=None)
    criteria._cache.update(path=None, key=None, data=None)


def test_rewrite_in_same_mtime_tick_serves_new_content(monkeypatch, tmp_path):
    f = tmp_path / "policy.json"
    monkeypatch.setenv(policy.ENV_PATH, str(f))
    _reset()
    _write(f, _pol("old"), PAST_NS)
    assert policy.load()["tag"] == "old"
    _write(f, _pol("newer"), PAST_NS)                  # identical mtime_ns, different content
    assert f.stat().st_mtime_ns == PAST_NS
    assert policy.load()["tag"] == "newer"


def test_control_old_mtime_key_serves_stale(monkeypatch, tmp_path):
    """The pre-fix key (float st_mtime) returns the previous policy in the same scenario."""
    monkeypatch.setattr(policy, "file_key", lambda st: st.st_mtime)
    f = tmp_path / "policy.json"
    monkeypatch.setenv(policy.ENV_PATH, str(f))
    _reset()
    _write(f, _pol("old"), PAST_NS)
    assert policy.load()["tag"] == "old"
    _write(f, _pol("newer"), PAST_NS)
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


def test_settled_file_is_served_from_cache(monkeypatch, tmp_path):
    f = tmp_path / "policy.json"
    monkeypatch.setenv(policy.ENV_PATH, str(f))
    _reset()
    _write(f, _pol("cached"), PAST_NS)
    assert policy.load()["tag"] == "cached"

    def boom(*a, **k):
        raise AssertionError("re-read a settled, unchanged file")
    monkeypatch.setattr(type(f), "read_text", boom)
    assert policy.load()["tag"] == "cached"            # hot path: one stat, no read


def test_criteria_rewrite_in_same_mtime_tick_serves_new_content(monkeypatch, tmp_path):
    f = tmp_path / "criteria.json"
    monkeypatch.setenv(criteria.ENV_PATH, str(f))
    _reset()
    _write(f, {"templates": [], "tag": "old"}, PAST_NS)
    assert criteria.load()["tag"] == "old"
    _write(f, {"templates": [], "tag": "newer"}, PAST_NS)
    assert criteria.load()["tag"] == "newer"
