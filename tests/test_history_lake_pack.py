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
