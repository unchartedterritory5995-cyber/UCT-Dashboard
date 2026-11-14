"""mem_observe: the watch-only memory observer must measure correctly and never change or break anything."""
from __future__ import annotations

import os
import pathlib
import shutil
import sys
import tempfile
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


# ⛔ POSIX_FADV_DONTNEED cannot evict pages that live in memory-backed or stacked filesystems
# (tmpfs, ramfs, overlay). GitHub runner image ubuntu26/20261101.64 keeps the pages after
# fsync + DONTNEED (gates 42403103754 and 42404906058 read 8388608 three times), while
# .186 evicts them (8 of 8 green). So the eviction tests run in a directory the KERNEL can
# drop, chosen by an oracle independent of mem_observe: the filesystem type in
# /proc/self/mountinfo. On a disk-backed filesystem the assertions are unchanged.
NON_DROPPABLE_FS = {"tmpfs", "ramfs", "overlay"}


def _fs_type_from_mountinfo(text, path):
    """Filesystem type of the longest mount point containing `path` (mountinfo format)."""
    best, fstype = "", None
    for line in text.splitlines():
        parts = line.split(" - ", 1)
        if len(parts) != 2:
            continue
        left, right = parts[0].split(), parts[1].split()
        if len(left) < 5 or not right:
            continue
        mnt = left[4].replace(chr(92) + "040", " ")  # mountinfo escapes a space as backslash-040
        inside = path == mnt or path.startswith(mnt.rstrip("/") + "/")
        if inside and len(mnt) >= len(best):
            best, fstype = mnt, right[0]
    return fstype


def _fs_type(path):
    with open("/proc/self/mountinfo", encoding="utf-8") as fh:
        return _fs_type_from_mountinfo(fh.read(), os.path.realpath(path))


@pytest.fixture
def droppable_dir(tmp_path):
    """A fresh writable directory on a filesystem whose page cache the kernel can drop."""
    seen = []
    for cand in (str(tmp_path), os.environ.get("RUNNER_TEMP"), os.environ.get("GITHUB_WORKSPACE"),
                 os.getcwd(), "/var/tmp"):
        if not cand or not os.path.isdir(cand):
            continue
        fs = _fs_type(cand)
        seen.append(f"{cand}={fs}")
        if not fs or fs in NON_DROPPABLE_FS:
            continue
        try:
            d = tempfile.mkdtemp(prefix="memobs-", dir=cand)
        except OSError:
            continue
        try:
            yield pathlib.Path(d)
        finally:
            shutil.rmtree(d, ignore_errors=True)
        return
    pytest.skip("no writable disk-backed directory; page-cache eviction is not testable here: " + ", ".join(seen))


def test_file_cache_fs_type_reader_reads_mountinfo():
    """The skip oracle itself: longest mount wins, and a name prefix is not a path prefix."""
    text = "\n".join([
        "22 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw",
        "35 22 0:30 / /tmp rw,nosuid,nodev shared:2 - tmpfs tmpfs rw",
        "40 22 0:31 / /home/runner/work rw,relatime - overlay overlay rw,lowerdir=/a",
        "41 22 0:9 / /mnt/my" + chr(92) + "040dir rw - xfs /dev/x rw",
    ])
    assert _fs_type_from_mountinfo(text, "/tmp/pytest-of-runner/x") == "tmpfs"
    assert _fs_type_from_mountinfo(text, "/home/runner/a") == "ext4"
    assert _fs_type_from_mountinfo(text, "/home/runner/work/repo") == "overlay"
    assert _fs_type_from_mountinfo(text, "/tmpfoo/x") == "ext4"
    assert _fs_type_from_mountinfo("", "/x") is None
    assert _fs_type_from_mountinfo(text, "/mnt/my dir/f") == "xfs"   # mountinfo escapes a space


def _drop(path):
    import os
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
        os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
    finally:
        os.close(fd)


_SYS_CACHESTAT = 451   # cachestat(2), Linux >= 6.5; 451 in the unified table (x86_64 and arm64 alike)


def _kernel_cached_bytes(path):
    """Bytes of `path` in the page cache per cachestat(2): the KERNEL'S own count, independent of
    mem_observe (no mmap, no mincore). None when the syscall is absent."""
    import ctypes
    import mmap as _mm

    class _Range(ctypes.Structure):
        _fields_ = [("off", ctypes.c_uint64), ("len", ctypes.c_uint64)]

    class _Stat(ctypes.Structure):
        _fields_ = [(n, ctypes.c_uint64) for n in
                    ("nr_cache", "nr_dirty", "nr_writeback", "nr_evicted", "nr_recently_evicted")]

    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    rng, st = _Range(0, 0), _Stat()          # len 0 = to end of file
    fd = os.open(path, os.O_RDONLY)
    try:
        if libc.syscall(ctypes.c_long(_SYS_CACHESTAT), ctypes.c_uint(fd), ctypes.byref(rng),
                        ctypes.byref(st), ctypes.c_uint(0)) != 0:
            return None
    finally:
        os.close(fd)
    return st.nr_cache * _mm.PAGESIZE


def _measure_between_oracles(path, size):
    """(kernel_before, mem_observe, kernel_after). Nobody else touches this fresh file, so its residency can
    only FALL (reclaim) unless the probe itself faults pages in. A correct probe therefore reads
    before >= probe >= after, and after <= before."""
    before = _kernel_cached_bytes(path)
    got = mem_observe._resident_bytes(path, size)
    after = _kernel_cached_bytes(path)
    return before, got, after


# ⛔ 2026-11-07: POSIX_FADV_DONTNEED is ADVICE. On runner image ubuntu26/20261101.64 (never on .186) the
# kernel kept every page after fsync + DONTNEED and the old test read (8388608, 8388608, 8388608), failing
# the master gate 4 times (42353089775/1, 42355528677/1, 42403103754, 42404906058). Whether eviction
# happened is now asked of the KERNEL (cachestat), not assumed: the probe is checked against the kernel's
# count in both states, and the "dropped" half is skipped, with the kernel's numbers, only when the kernel
# provably declined to drop. A probe that reports pages the kernel does not hold (mincore's
# "everything resident" fallback, a fault-in) still FAILS.
@linux_only
def test_file_cache_sees_a_cached_file_and_not_a_dropped_one(droppable_dir):
    f = droppable_dir / "hot.bin"
    f.write_bytes(b"x" * (8 << 20))
    f.read_bytes()
    size = f.stat().st_size
    path = str(f)
    if _kernel_cached_bytes(path) is None:
        pytest.skip("cachestat(2) unavailable (Linux < 6.5): no kernel oracle to tell eviction from a probe bug")

    k0, hot, k1 = _measure_between_oracles(path, size)
    assert hot is not None and 0 < hot <= size, (k0, hot, k1)
    assert k0 >= hot >= k1, ("hot: probe disagrees with the kernel's page-cache count", k0, hot, k1)

    _drop(path)
    dropped = _kernel_cached_bytes(path)
    if dropped >= size // 4:
        pytest.skip(f"kernel kept {dropped} of {size} bytes cached after fsync + POSIX_FADV_DONTNEED "
                    f"(cachestat); the cold half is untestable on this host. Hot half passed: {(k0, hot, k1)}")

    c0, cold1, c1 = _measure_between_oracles(path, size)
    _, cold2, c2 = _measure_between_oracles(path, size)
    detail = {"hot": (k0, hot, k1), "dropped": dropped, "cold1": (c0, cold1, c1), "cold2": cold2, "kernel_end": c2}
    # the probe reports what the kernel holds, not more (mincore's all-resident fallback would read `size`)
    assert c0 >= cold1 >= c1, ("cold: probe disagrees with the kernel's page-cache count", detail)
    # measuring must not fault the file in: the kernel's own count did not rise across two measurements
    assert c2 <= c0 <= dropped, ("measuring faulted pages in", detail)
    assert cold1 < size // 4 and cold2 < size // 4, detail


@linux_only
def test_file_cache_reports_top_files_and_deleted_open_files(droppable_dir):
    tmp_path = droppable_dir
    # A non-database name: *.db files are never candidates (f0790b6129, test_mem_observe_never_opens_sqlite.py).
    big = tmp_path / "big.bin"
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
    assert any(n.endswith("big.bin") for n in names)
    assert any("gone.tmp" in n for n in names), names      # found through /proc/self/fd although deleted
    assert rec["files_cached_mb"] >= 6


def test_snapshot_with_files_never_raises(tmp_path, monkeypatch):
    monkeypatch.setenv("MEM_OBSERVE_FILE_ROOTS", str(tmp_path))
    rec = mem_observe.snapshot("t", [], with_files=True)
    assert ("files" in rec) or ("files_err" in rec)
