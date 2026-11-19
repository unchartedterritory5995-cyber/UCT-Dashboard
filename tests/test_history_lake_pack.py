"""Pack mode (build.py --packs, pack.py, publish.py): the packs hold exactly the pieces the
piece-file builder writes, the indexes publish.py derives are its indexes (plus each piece's
offset), and nothing is lost or invented across runs, pools or crashes.

Run: python -m pytest tests/test_history_lake_pack.py -q -p no:cacheprovider
"""
import gzip
import json
import random

import pytest

from tools.history_lake import build as BLD
from tools.history_lake import pack as PK
from tools.history_lake import piece
from tools.history_lake import publish as PUB
from tests.test_history_lake_merge import DAYS_A, DAYS_B, HEADER, QUIET, _tree, _ts, _write_day

ALL = "2026-01-01..2027-12-31"


@pytest.fixture()
def raw(tmp_path):
    r = tmp_path / "raw"
    rng = random.Random(123)
    for day in DAYS_A + DAYS_B:
        _write_day(r, day, rng)
    return r


def _publish_tree(roots, out, **kw):
    packs = PUB.collect_packs(roots)
    idx = PUB.build_indexes(packs, log=lambda *_: None)
    PUB.explode(packs, idx, out)
    return packs, idx


def _pieces_and_indexes(tree):
    return {k: v for k, v in tree.items() if k.startswith("v1/")}


def test_packs_hold_exactly_the_piece_files(raw, tmp_path):
    files = tmp_path / "files"
    one = BLD.Builder(raw, files, quality=5, **QUIET).run(ALL)
    for jobs in (1, 3):
        out = tmp_path / f"packs{jobs}"
        s = BLD.Builder(raw, out, quality=5, packs=True, jobs=jobs, chunk_rows=500, **QUIET).run(ALL)
        assert not (out / "v1").exists()                          # pack mode writes no piece files or indexes
        assert {k: s[k] for k in ("pieces_written", "bytes_written", "series")} == \
               {k: one[k] for k in ("pieces_written", "bytes_written", "series")}
        assert json.loads((out / "ledger.json").read_text()) == json.loads((files / "ledger.json").read_text())
        packs, idx = _publish_tree([out], tmp_path / f"exploded{jobs}")
        assert _pieces_and_indexes(_tree(tmp_path / f"exploded{jobs}")) == _pieces_and_indexes(_tree(files))
        assert len(packs) == len({(k.split("/")[1], k.split("/")[3][:-4]) for k in _tree(files) if k.endswith(".ubh")})
    # the pool changes no byte of any pack
    assert _tree(tmp_path / "packs1") == _tree(tmp_path / "packs3")


def test_the_index_offset_reads_the_piece_out_of_its_pack(raw, tmp_path):
    out = tmp_path / "p"
    BLD.Builder(raw, out, quality=5, packs=True, **QUIET).run(ALL)
    packs = PUB.collect_packs([out])
    idx = PUB.build_indexes(packs, log=lambda *_: None)
    checked = 0
    for sym, doc in idx.items():
        for series, periods in doc["series"].items():
            for period, e in periods.items():
                data = (out / PK.pack_relpath(series, period)).read_bytes()[e["off"]:e["off"] + e["bytes"]]
                h = piece.read_header(data)
                assert (h["symbol"], h["series"], h["period"], h["crc"], h["bars"]) == (sym, series, period, e["crc"], e["bars"])
                checked += 1
    assert checked > 40


def test_a_period_split_across_runs_keeps_symbols_the_later_run_did_not_see(tmp_path):
    raw = tmp_path / "raw"
    rng = random.Random(5)
    _write_day(raw, "2026-11-27", rng)                            # all four symbols
    # a later day of the same YEAR (15/30/60/60e pieces) with one symbol only
    rows = [("AAA", "100.000000", f"{412.5:.6f}", f"{412.7:.6f}", f"{412.8:.6f}", f"{412.4:.6f}",
             _ts("2026-12-31", 10, m) * 1_000_000_000, 5) for m in range(0, 30)]
    (raw / "2026").mkdir(exist_ok=True)
    with gzip.open(raw / "2026" / "2026-12-31.csv.gz", "wt", encoding="ascii", newline="") as f:
        f.write(HEADER)
        for r in rows:
            f.write(",".join(str(x) for x in r) + "\n")
    whole = tmp_path / "whole"
    BLD.Builder(raw, whole, quality=5, packs=True, **QUIET).run("2026-11-27..2026-12-31")
    split = tmp_path / "split"
    BLD.Builder(raw, split, quality=5, packs=True, jobs=2, **QUIET).run("2026-11-27")
    BLD.Builder(raw, split, quality=5, packs=True, jobs=2, **QUIET).run("2026-12-31")
    _publish_tree([whole], tmp_path / "ew")
    _publish_tree([split], tmp_path / "es")
    assert _pieces_and_indexes(_tree(tmp_path / "es")) == _pieces_and_indexes(_tree(tmp_path / "ew"))
    with PK.PackReader(PK.pack_path(split, "15", "2026")) as r:
        assert set(r.symbols()) == {"AAA", "BB.C", "BBpC", "CON"}     # CON traded only on the first day
    # and folding the same days again changes no piece
    again = BLD.Builder(raw, split, quality=5, packs=True, rebuild=True, **QUIET).run("2026-11-27..2026-12-31")
    assert again["pieces_unchanged"] == again["pieces_written"] > 0


def test_a_crash_leaves_nothing_a_later_run_trusts(raw, tmp_path):
    out = tmp_path / "p"
    BLD.Builder(raw, out, quality=5, packs=True, **QUIET).run("2026-11-27")
    want = _tree(out)
    # a half-written pack from a killed flush is never read and is replaced
    junk = PK.pack_path(out, "1", "2026-12").with_name("2026-12.pack.tmp")
    junk.parent.mkdir(parents=True, exist_ok=True)
    junk.write_bytes(b"half a pack")
    BLD.Builder(raw, out, quality=5, packs=True, **QUIET).run("2026-12-31")
    assert not junk.exists()
    assert PK.read_trailer(PK.pack_path(out, "1", "2026-12"))["pieces"]
    # a pack that is not whole stops the build instead of being merged into
    p = PK.pack_path(out, "15", "2026")
    good = p.read_bytes()
    for bad in (good[:-1], good[:len(good) // 2], b"", good[:-8] + b"UBHPACK0"):
        p.write_bytes(bad)
        with pytest.raises(BLD.BuildError, match="move it aside"):
            BLD.Builder(raw, out, quality=5, packs=True, rebuild=True, **QUIET).run("2026-12-31")
        assert not (out / "build.lock").exists()
    p.write_bytes(good)
    assert {k: v for k, v in _tree(out).items() if k in want} is not None


def test_pack_reader_refuses_what_is_not_whole(tmp_path):
    w = PK.PackWriter(tmp_path, "60", "2026")
    blob = piece.encode_piece("AAA", "60", "2026", piece.bars_from_floats(
        [1794234600], [10.0], [11.0], [9.0], [10.5], [100.0], [3]), quality=5)
    h = piece.read_header(blob)
    w.add("AAA", blob, h)
    with pytest.raises(PK.PackError, match="twice"):
        w.add("AAA", blob, h)
    with pytest.raises(PK.PackError, match="does not belong"):
        w.add("BBB", blob, h)                                     # the blob is AAA's
    w.close()
    path = PK.pack_path(tmp_path, "60", "2026")
    with PK.PackReader(path) as r:
        assert r.get("AAA") == blob and r.get("ZZZ") is None
    data = path.read_bytes()
    tr = PK.read_trailer(path)
    assert tr["pieces"]["AAA"][:2] == [0, len(blob)] and tr["body_bytes"] == len(blob)
    for bad, why in ((data[:-1], "end marker"), (b"x" * 4, "too short"),
                     (data[:-16] + (10 ** 9).to_bytes(8, "little") + b"UBHPACK1", "does not fit")):
        path.write_bytes(bad)
        with pytest.raises(PK.PackError, match=why):
            PK.read_trailer(path)
    # an entry that reaches past the pieces
    doc = json.loads(data[len(blob):-16])
    doc["pieces"]["AAA"][1] += 1
    t = json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
    path.write_bytes(blob + t + len(t).to_bytes(8, "little") + b"UBHPACK1")
    with pytest.raises(PK.PackError, match="past the pieces"):
        PK.read_trailer(path)
    # a pack under another period's name is refused by name
    path.write_bytes(data)
    other = PK.pack_path(tmp_path, "60", "2025")
    other.write_bytes(data)
    with pytest.raises(PK.PackError, match="holds 60/2026, not 60/2025"):
        PK.PackReader.open(tmp_path, "60", "2025")
    assert PK.PackReader.open(tmp_path, "60", "2024") is None                 # absent is not an error
    # a pack cut short after it was opened: the read says so instead of returning part of a piece
    r = PK.PackReader.open(tmp_path, "60", "2026")
    with open(path, "r+b") as f:
        f.truncate(len(blob) - 3)
    with pytest.raises(PK.PackError, match="cut short"):
        r.get("AAA")
    r.close()
    with pytest.raises(PK.PackError):
        PK.pack_relpath("7", "2026")
    with pytest.raises(piece.PieceError):
        PK.pack_relpath("1", "2026")                              # a 1m pack is a month


def test_publish_checks_merges_stamps_and_uploads_in_order(raw, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    BLD.Builder(raw, a, quality=5, packs=True, **QUIET).run("2026-01-01..2026-12-31")
    BLD.Builder(raw, b, quality=5, packs=True, **QUIET).run("2027-01-01..2027-12-31")
    whole = tmp_path / "whole"
    BLD.Builder(raw, whole, quality=5, packs=True, **QUIET).run(ALL)
    packs = PUB.collect_packs([a, b])
    idx = PUB.build_indexes(packs, log=lambda *_: None)
    assert idx == PUB.build_indexes(PUB.collect_packs([whole]), log=lambda *_: None)
    # the same pack in two trees: fine when identical, refused when not
    PUB.collect_packs([a, a])
    (b / "packs" / "15").mkdir(parents=True, exist_ok=True)
    clash = b / "packs" / "15" / "2026.pack"
    clash.write_bytes((a / "packs" / "15" / "2026.pack").read_bytes()[:-1] + b"2")
    with pytest.raises(BLD.BuildError, match="different contents"):
        PUB.collect_packs([a, b])
    clash.unlink()
    # a piece header that disagrees with its trailer is caught by the check
    p = a / "packs" / "60" / "2026.pack"
    good = p.read_bytes()
    tr = PK.read_trailer(p)
    sym, e = next(iter(tr["pieces"].items()))
    doc = {k: v for k, v in tr.items() if k != "body_bytes"}
    doc["pieces"][sym] = [e[0], e[1], e[2] + 1, e[3], e[4], e[5]]
    t = json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
    p.write_bytes(good[:tr["body_bytes"]] + t + len(t).to_bytes(8, "little") + b"UBHPACK1")
    with pytest.raises(BLD.BuildError, match="disagree"):
        PUB.build_indexes(PUB.collect_packs([a]), log=lambda *_: None)
    PUB.build_indexes(PUB.collect_packs([a]), check=False, log=lambda *_: None)    # unchecked: not read
    # check_since: only packs written at or after it are read (an immutable pack was checked when written)
    import os as _os
    import time as _time
    PUB.build_indexes(PUB.collect_packs([a]), check_since=_time.time() + 3600, log=lambda *_: None)
    # a daily run's few rebuilt packs are checked without a process pool (never pool + uploader in one process)
    real_pool = PUB.ProcessPoolExecutor
    PUB.ProcessPoolExecutor = lambda *a, **k: (_ for _ in ()).throw(AssertionError("no pool for a few packs"))
    try:
        with pytest.raises(BLD.BuildError, match="disagree"):
            PUB.build_indexes(PUB.collect_packs([a]), jobs=8, check_since=_os.path.getmtime(p) - 1, log=lambda *_: None)
    finally:
        PUB.ProcessPoolExecutor = real_pool
    with pytest.raises(BLD.BuildError, match="disagree"):
        PUB.build_indexes(PUB.collect_packs([a]), check_since=_os.path.getmtime(p) - 1, log=lambda *_: None)
    p.write_bytes(good)
    (a / "build.lock").write_text("1")
    with pytest.raises(BLD.BuildError, match="held by a build"):
        PUB.collect_packs([a])
    (a / "build.lock").unlink()

    rows = [{"ticker": "AAA", "execution_date": "2026-12-01", "split_from": 1, "split_to": 4}]
    assert PUB.stamp_indexes(idx, rows, "2027-02-01") == 1
    assert idx["AAA"]["splits"] == [["2026-12-01", 4.0]] and idx["CON"]["splits"] == []
    assert all(d["splits_as_of"] == "2027-02-01" for d in idx.values())

    order = []
    PUB.upload(packs, idx, lambda k, path, ct: order.append(("pack", k, ct)), lambda k, data, ct: order.append(("index", k, ct)),
               prefix="hist/", jobs=4, log=lambda *_: None)
    kinds = [o[0] for o in order]
    assert kinds == ["pack"] * len(packs) + ["index"] * len(idx)          # an index never names a missing pack
    assert ("pack", "hist/packs/1/2026-11.pack", "application/octet-stream") in order
    assert ("index", "hist/v1/index/s-BB_70C.json", "application/json") in order

    # the CLI end to end, with no network
    splits = tmp_path / "splits.json"
    splits.write_text(json.dumps({"rows": rows}))
    assert PUB.main(["--from", str(a), "--from", str(b), "--out", str(tmp_path / "pub"), "--splits", str(splits),
                     "--as-of", "2027-02-01"]) == 0
    doc = json.loads((tmp_path / "pub" / "v1" / "index" / "s-AAA.json").read_text())
    assert doc["splits"] == [["2026-12-01", 4.0]] and "off" in doc["series"]["1"]["2026-11"]
    assert PUB.main(["--from", str(tmp_path / "raw")]) == 2                 # no packs there


def test_upload_is_resumable_and_reports_progress(raw, tmp_path):
    """A re-run after an interrupted upload (the real lake is ~65 GB) sends only the packs the
    bucket does not hold at the same size; indexes still go last; progress is logged."""
    a = tmp_path / "a"
    BLD.Builder(raw, a, quality=5, packs=True, **QUIET).run(ALL)
    packs = PUB.collect_packs([a])
    idx = PUB.build_indexes(packs, log=lambda *_: None)
    keys = sorted(f"hist/{PUB.pack.pack_relpath(s, p)}" for (s, p) in packs)
    assert len(keys) >= 3
    sizes = {f"hist/{PUB.pack.pack_relpath(s, p)}": path.stat().st_size for (s, p), path in packs.items()}
    in_bucket = {keys[0]: sizes[keys[0]], keys[1]: sizes[keys[1]] - 1}   # one whole, one PARTIAL (wrong size)
    sent, order, logs = [], [], []
    stats = PUB.upload(packs, idx,
                       lambda k, path, ct: (sent.append(k), order.append("pack")),
                       lambda k, data, ct: order.append("index"),
                       prefix="hist/", jobs=2, log=logs.append, every=1,
                       exists=lambda k, size: in_bucket.get(k) == size)
    assert keys[0] not in sent                        # already there at its size: not sent again
    assert keys[1] in sent                            # a partial object is re-sent
    assert sorted(sent) == sorted(set(keys) - {keys[0]})
    assert stats["skipped"] == 1 and stats["packs"] == len(keys) - 1
    assert order == ["pack"] * (len(keys) - 1) + ["index"] * len(idx)      # indexes still last
    assert any(m.startswith(f"packs {len(keys)}/{len(keys)}") for m in logs)
    assert any("1 already there" in m for m in logs)


def test_a_pack_rebuilt_by_the_daily_refresh_is_sent_even_at_the_same_size(raw, tmp_path):
    """A current period's pack is rebuilt in place each day: the bucket's same-size copy is NOT proof it
    is the same pack. Packs written since the run started (`forced_keys`) are always sent; the rest
    keep the resumable size check."""
    import os
    a = tmp_path / "a"
    BLD.Builder(raw, a, quality=5, packs=True, **QUIET).run(ALL)
    packs = PUB.collect_packs([a])
    idx = PUB.build_indexes(packs, log=lambda *_: None)
    items = sorted(packs.items())
    assert len(items) >= 2
    (old_k, old_path), (new_k, new_path) = items[0], items[1]
    os.utime(old_path, (1_000_000, 1_000_000))                 # written long ago
    since = new_path.stat().st_mtime
    force = PUB.forced_keys(packs, since, prefix="hist/")
    key = lambda k: f"hist/{PUB.pack.pack_relpath(*k)}"
    assert key(new_k) in force and key(old_k) not in force
    everything_there = lambda k, size: True                   # the bucket holds every key at its size
    sent = []
    PUB.upload(packs, idx, lambda k, path, ct: sent.append(k), lambda k, data, ct: None,
               prefix="hist/", jobs=1, log=lambda *_: None, exists=everything_there, force=force)
    assert key(new_k) in sent and key(old_k) not in sent
    sent.clear()                                              # without `force`: the old behaviour
    PUB.upload(packs, idx, lambda k, path, ct: sent.append(k), lambda k, data, ct: None,
               prefix="hist/", jobs=1, log=lambda *_: None, exists=everything_there)
    assert sent == []


def test_an_index_put_that_fails_is_retried_on_its_own_and_the_rest_carry_on(raw, tmp_path):
    """2026-11-17: one of 36,676 index puts got R2's 'reduce your concurrent request rate for the same
    object' and the whole run died. A failing put is retried with a backoff; the others are not held up."""
    a = tmp_path / "a"
    BLD.Builder(raw, a, quality=5, packs=True, **QUIET).run(ALL)
    packs = PUB.collect_packs([a])
    idx = PUB.build_indexes(packs, log=lambda *_: None)
    flaky = f"hist/{PUB.piece.index_relpath(sorted(idx)[0])}"
    tries, sent, waits = {}, [], []

    def put_bytes(k, data, ct):
        tries[k] = tries.get(k, 0) + 1
        if k == flaky and tries[k] <= 2:
            raise RuntimeError("ServiceUnavailable: Reduce your concurrent request rate for the same object")
        sent.append(k)

    stats = PUB.upload(packs, idx, lambda *a: None, put_bytes, prefix="hist/", jobs=2,
                       log=lambda *_: None, sleep=waits.append)
    assert stats["indexes"] == len(idx) and flaky in sent
    assert tries[flaky] == 3 and waits == [PUB.INDEX_RETRY_BASE_S, PUB.INDEX_RETRY_BASE_S * 2]
    assert all(n == 1 for k, n in tries.items() if k != flaky)


def test_an_index_that_never_lands_is_NAMED_and_the_others_still_land(raw, tmp_path):
    a = tmp_path / "a"
    BLD.Builder(raw, a, quality=5, packs=True, **QUIET).run(ALL)
    packs = PUB.collect_packs([a])
    idx = PUB.build_indexes(packs, log=lambda *_: None)
    dead = f"hist/{PUB.piece.index_relpath(sorted(idx)[0])}"
    sent = []

    def put_bytes(k, data, ct):
        if k == dead:
            raise RuntimeError("ServiceUnavailable")
        sent.append(k)

    with pytest.raises(PUB.BuildError) as e:
        PUB.upload(packs, idx, lambda *a: None, put_bytes, prefix="hist/", jobs=2, log=lambda *_: None,
                   sleep=lambda _s: None)
    assert dead in str(e.value) and "re-run" in str(e.value)
    assert len(sent) == len(idx) - 1


def test_scratch_rows_on_another_disk_change_nothing_and_stop_before_it_fills(raw, tmp_path, monkeypatch):
    here = tmp_path / "here"
    BLD.Builder(raw, here, quality=5, packs=True, **QUIET).run(ALL)
    scratch = tmp_path / "ssd"
    scratch.mkdir()
    (scratch / "someone_elses_file").write_text("keep me")
    there = tmp_path / "there"
    seen = []                                       # where the scratch rows were while days were folded in
    real_flush = BLD.Builder._flush

    def spy(self, keys):
        seen.append(((scratch / "_spill_there").is_dir(), any((scratch / "_spill_there").glob("*.bin")),
                     (there / "_spill").exists()))
        return real_flush(self, keys)

    monkeypatch.setattr(BLD.Builder, "_flush", spy)
    BLD.Builder(raw, there, quality=5, packs=True, spill_dir=scratch, min_spill_free_gb=0.001, **QUIET).run(ALL)
    monkeypatch.setattr(BLD.Builder, "_flush", real_flush)
    assert seen and all(s == (True, True, False) for s in seen)           # on the other disk, never beside the output
    assert _tree(there) == _tree(here)                                     # same packs, same ledger
    assert sorted(p.name for p in scratch.iterdir()) == ["someone_elses_file"]   # its own folder only, and gone
    assert not (there / "_spill").exists()

    # the disk running low stops the build before a day is read, and a rerun resumes
    import shutil as _sh
    real = _sh.disk_usage
    monkeypatch.setattr(BLD.shutil, "disk_usage", lambda p: real(p)._replace(free=2 ** 20))
    low = tmp_path / "low"
    with pytest.raises(BLD.BuildError, match="free where the scratch rows go"):
        BLD.Builder(raw, low, quality=5, packs=True, spill_dir=scratch, min_spill_free_gb=1, **QUIET).run(ALL)
    assert not (low / "build.lock").exists()
    assert not (low / "ledger.json").exists() or json.loads((low / "ledger.json").read_text())["days"] == {}
    monkeypatch.setattr(BLD.shutil, "disk_usage", real)
    BLD.Builder(raw, low, quality=5, packs=True, spill_dir=scratch, min_spill_free_gb=0.001, **QUIET).run(ALL)
    assert _tree(low) == _tree(here)
    # without --spill-dir there is no check at all (the default scratch lives with the output)
    monkeypatch.setattr(BLD.shutil, "disk_usage", lambda p: real(p)._replace(free=0))
    BLD.Builder(raw, tmp_path / "plain", quality=5, packs=True, **QUIET).run("2026-11-27")


def test_publish_check_in_a_process_pool_is_identical_and_still_refuses(raw, tmp_path):
    out = tmp_path / "lake"
    BLD.Builder(raw, out, quality=5, packs=True, **QUIET).run(ALL)
    packs = PUB.collect_packs([out])
    one = PUB.build_indexes(packs, check=True, log=lambda *_: None, jobs=1)
    many = PUB.build_indexes(packs, check=True, log=lambda *_: None, jobs=3)
    assert one and json.dumps(many) == json.dumps(one)          # same documents, same key order
    # a pack whose piece disagrees with its trailer is refused by the pool too
    (key, path), = [(k, p) for k, p in packs.items() if k[0] == "1"][:1]
    data = bytearray(path.read_bytes())
    tr = PK.read_trailer(path)
    sym, (off, length, *_rest) = next(iter(tr["pieces"].items()))
    data[off + 12] ^= 0xFF                                      # a byte in that piece's header
    path.write_bytes(bytes(data))
    with pytest.raises(BLD.BuildError):
        PUB.build_indexes(packs, check=True, log=lambda *_: None, jobs=3)


def test_both_stamping_paths_give_a_class_share_its_undotted_splits(tmp_path):
    """publish.stamp_indexes and stamp_splits.stamp both run factors.with_class_share_spellings (2026-11-18)."""
    rows = [{"ticker": "BF.B", "execution_date": "2004-01-21", "split_from": 1, "split_to": 2},
            {"ticker": "BFB", "execution_date": "2016-08-19", "split_from": 1, "split_to": 2}]
    want = [["2004-01-21", 2.0], ["2016-08-19", 2.0]]
    idx = {"BF.B": {"symbol": "BF.B", "series": {}}, "AAA": {"symbol": "AAA", "series": {}}}
    assert PUB.stamp_indexes(idx, rows, "2026-11-17") == 1
    assert idx["BF.B"]["splits"] == want

    from tools.history_lake import stamp_splits as SS
    lake = tmp_path / "lake"
    for sym in ("BF.B", "AAA"):
        p = lake / piece.index_relpath(sym)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"v": 1, "symbol": sym, "series": {}}), encoding="utf-8")
    SS.stamp(lake, rows, "2026-11-17", log=lambda *_: None)
    got = json.loads((lake / piece.index_relpath("BF.B")).read_text(encoding="utf-8"))
    assert got["splits"] == want
