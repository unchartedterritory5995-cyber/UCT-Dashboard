"""mem_observe: the watch-only memory observer must measure correctly and never change or break anything."""
from __future__ import annotations

import sys
import threading
import time
import types
from collections import deque

import pytest

from api.services import mem_observe
from api.services.cache import TTLCache


@pytest.fixture
def fake_mod(monkeypatch):
    m = types.ModuleType("memobs_fake")
    now = time.time()
    m.ts = {"fresh": (now, {"a": 1}), "old": (now - 2 * 86400, {"b": [1, 2, 3]})}
    m.dq = {"live": deque([(int(now * 1e9), 1.0)]), "quiet": deque([(int((now - 3 * 86400) * 1e9), 2.0)])}
    m.plain = {i: i for i in range(5)}
    m.aset = {"x", "y"}
    m.cache = TTLCache()
    m.cache.set("k1", {"bars": [1] * 10}, 60)
    monkeypatch.setitem(sys.modules, "memobs_fake", m)
    return m


TARGETS = [("ts", "memobs_fake", "ts", "ts_tuple"), ("dq", "memobs_fake", "dq", "deque_ts_ns"),
           ("plain", "memobs_fake", "plain", "len"), ("aset", "memobs_fake", "aset", "len"),
           ("cache", "memobs_fake", "cache", "ttlcache")]


def test_sizes_and_24h_ages_are_counted(fake_mod):
    rec = mem_observe.snapshot("t", TARGETS, with_size=True)
    s = rec["structs"]
    assert s["ts"]["n"] == 2 and s["ts"]["aged24"] == 1
    assert s["dq"]["n"] == 2 and s["dq"]["aged24"] == 1
    assert s["plain"] == {"n": 5, "est_mb": s["plain"]["est_mb"]}
    assert s["aset"]["n"] == 2
    assert s["cache"]["n"] == 1 and s["cache"]["est_mb"] is not None
    assert "rss_mb" in rec and "would" in rec


def test_it_never_imports_and_never_mutates(fake_mod):
    before = (dict(fake_mod.ts), {k: list(v) for k, v in fake_mod.dq.items()}, dict(fake_mod.plain))
    rec = mem_observe.snapshot("t", TARGETS + [("ghost", "memobs_not_loaded_module", "x", "len")], with_size=True)
    assert "memobs_not_loaded_module" not in sys.modules
    assert "ghost" not in rec["structs"]
    assert before == (dict(fake_mod.ts), {k: list(v) for k, v in fake_mod.dq.items()}, dict(fake_mod.plain))


def test_a_bad_value_is_skipped_not_raised(fake_mod):
    fake_mod.ts["junk"] = "not-a-tuple"
    fake_mod.weird = object()
    rec = mem_observe.snapshot("t", TARGETS + [("weird", "memobs_fake", "weird", "ttlcache")])
    assert rec["structs"]["ts"]["n"] == 3 and rec["structs"]["ts"]["aged24"] == 1
    assert "weird" not in rec["structs"]


def test_probing_while_another_thread_writes_never_raises(fake_mod):
    stop = threading.Event()
    big = {i: (time.time(), i) for i in range(20000)}
    fake_mod.big = big

    def writer():
        i = 20000
        while not stop.is_set():
            big[i] = (time.time(), i)
            big.pop(i - 20000, None)
            i += 1

    t = threading.Thread(target=writer, daemon=True)
    t.start()
    try:
        for _ in range(20):
            rec = mem_observe.snapshot("t", [("big", "memobs_fake", "big", "ts_tuple")])
            assert "err" not in rec["structs"]["big"], rec["structs"]["big"]
    finally:
        stop.set()
        t.join(2)


def test_bump_counts_and_is_reported():
    mem_observe._WOULD.pop("unit_test_counter", None)
    mem_observe.bump("unit_test_counter")
    mem_observe.bump("unit_test_counter", 2)
    assert mem_observe.snapshot("t", [])["would"]["unit_test_counter"] == 3
    mem_observe._WOULD.pop("unit_test_counter", None)


def test_off_switch(monkeypatch):
    monkeypatch.setenv("MEM_OBSERVE_ENABLED", "0")
    assert mem_observe.start("t", []) is False


def test_the_real_targets_name_attributes_that_exist():
    """A renamed structure would silently drop out of the report; fail here instead."""
    import importlib
    for label, mod, attr, _ in mem_observe.FLOW_WORKER_TARGETS + mem_observe.WORKER_TARGETS:
        m = importlib.import_module(mod)
        assert hasattr(m, attr), f"{label}: {mod}.{attr} does not exist"


def test_the_ws_quiet_counter_sits_only_on_an_existing_history():
    """The hot-path hook must count a print only when it reads >24 h-old history, and must not move the append."""
    import inspect
    from api import massive_ws_worker as ws
    src = inspect.getsource(ws)
    i = src.index("_RAW_T_HISTORY[sym] = hist")
    block = src[i:i + 600]
    assert "elif hist and ts_ms * 1_000_000 - hist[-1][0] > _MEMOBS_QUIET_NS:" in block
    assert block.index("_memobs_bump(\"raw_t_quiet24_prints\")") < block.index("hist.append((ts_ms * 1_000_000, price))")
    assert ws._MEMOBS_QUIET_NS == 24 * 3600 * 1_000_000_000


# ---- per-file page-cache residency (Linux only: mincore + /proc) ----
linux_only = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="mincore and /proc are Linux-only")


def _drop(path):
    import os
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
        os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
    finally:
        os.close(fd)


@linux_only
def test_file_cache_sees_a_cached_file_and_not_a_dropped_one(tmp_path):
    f = tmp_path / "hot.bin"
    f.write_bytes(b"x" * (8 << 20))
    f.read_bytes()
    size = f.stat().st_size
    hot = mem_observe._resident_bytes(str(f), size)
    assert hot is not None and 0 < hot <= size
    _drop(str(f))
    cold1 = mem_observe._resident_bytes(str(f), size)
    cold2 = mem_observe._resident_bytes(str(f), size)
    # measuring must not fault the file in: a second measurement of a dropped file is still (near) empty
    assert cold1 < size // 4 and cold2 < size // 4, (hot, cold1, cold2)


@linux_only
def test_file_cache_reports_top_files_and_deleted_open_files(tmp_path):
    import os
    big = tmp_path / "big.db"
    big.write_bytes(b"y" * (4 << 20))
    big.read_bytes()
    gone = tmp_path / "gone.tmp"
    gone.write_bytes(b"z" * (3 << 20))
    fh = open(gone, "rb")
    fh.read()
    os.unlink(gone)
    try:
        rec = mem_observe.file_cache([str(tmp_path)])
    finally:
        fh.close()
    names = [r[0] for r in rec["files"]]
    assert any(n.endswith("big.db") for n in names)
    assert any("gone.tmp" in n for n in names), names      # found through /proc/self/fd although deleted
    assert rec["files_cached_mb"] >= 6


def test_snapshot_with_files_never_raises(tmp_path, monkeypatch):
    monkeypatch.setenv("MEM_OBSERVE_FILE_ROOTS", str(tmp_path))
    rec = mem_observe.snapshot("t", [], with_files=True)
    assert ("files" in rec) or ("files_err" in rec)
