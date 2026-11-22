"""tools/history_lake/build.py --jobs: pieces encoded by a process pool are the same bytes, the same
indexes, the same ledger and the same summary as pieces encoded in one process.

Run: python -m pytest tests/test_history_lake_jobs.py -q -p no:cacheprovider
"""
import gzip
import json
import random

import pytest

from tools.history_lake import build as BLD
from tests.test_history_lake_merge import DAYS_A, DAYS_B, QUIET, _tree, _write_day, HEADER, _ts


def _summary_core(s):
    keep = ("rows", "symbols", "pieces_written", "pieces_unchanged", "bytes_written", "series", "anomalies")
    return {k: s[k] for k in keep}


@pytest.fixture()
def raw(tmp_path):
    r = tmp_path / "raw"
    rng = random.Random(91)
    for day in DAYS_A + DAYS_B:
        _write_day(r, day, rng)
    return r


def test_a_pool_writes_exactly_what_one_process_writes(raw, tmp_path, monkeypatch):
    import concurrent.futures as cf
    made, submitted = [], []

    class Spy(cf.ProcessPoolExecutor):
        def __init__(self, *a, **k):
            made.append(k.get("max_workers"))
            super().__init__(*a, **k)

        def submit(self, *a, **k):
            submitted.append(a[2])
            return super().submit(*a, **k)

    monkeypatch.setattr(cf, "ProcessPoolExecutor", Spy)
    one = BLD.Builder(raw, tmp_path / "one", quality=5, **QUIET).run("2026-01-01..2027-12-31")
    assert made == [] and submitted == []                      # one process: no pool at all
    many = BLD.Builder(raw, tmp_path / "many", quality=5, jobs=3, chunk_rows=500, **QUIET).run("2026-01-01..2027-12-31")
    assert made == [3]                                         # one pool for the run, of the size asked for
    assert len(submitted) == many["pieces_written"] and set(submitted) == {"AAA", "BB.C", "BBpC", "CON"}
    want = _tree(tmp_path / "one")
    assert len([k for k in want if k.endswith(".ubh")]) > 40
    assert _tree(tmp_path / "many") == want
    assert _summary_core(many) == _summary_core(one)
    assert not (tmp_path / "many" / "build.lock").exists() and not (tmp_path / "many" / "_spill").exists()
    # every index entry describes its file: the edge serves `?c=<crc>` from the index
    from tools.history_lake import piece
    checked = 0
    for idx in (tmp_path / "many" / "v1" / "index").iterdir():
        doc = json.loads(idx.read_text())
        enc = idx.name[:-5]
        for series, periods in doc["series"].items():
            for period, e in periods.items():
                data = (tmp_path / "many" / "v1" / series / enc / f"{period}.ubh").read_bytes()
                h = piece.read_header(data)
                assert (e["crc"], e["bars"], e["first"], e["last"], e["bytes"]) == (h["crc"], h["bars"], h["first"], h["last"], len(data))
                checked += 1
    assert checked == many["pieces_written"]


def test_a_pool_merges_into_existing_pieces_the_same_way(raw, tmp_path):
    # A then B into one tree, by one process and by a pool: B's month pieces merge into A's
    for out, jobs in ((tmp_path / "one", 1), (tmp_path / "many", 4)):
        BLD.Builder(raw, out, quality=5, jobs=jobs, **QUIET).run("2026-11-27")
        BLD.Builder(raw, out, quality=5, jobs=jobs, **QUIET).run("2026-12-31..2027-02-01")
    assert _tree(tmp_path / "many") == _tree(tmp_path / "one")
    # and folding the same days again changes nothing, and says so
    again = BLD.Builder(raw, tmp_path / "many", quality=5, jobs=4, rebuild=True, **QUIET).run("2026-11-27..2027-02-01")
    assert again["pieces_unchanged"] == again["pieces_written"] > 0
    assert _tree(tmp_path / "many") == _tree(tmp_path / "one")


def test_a_pool_stops_on_a_piece_it_cannot_write(raw, tmp_path):
    out = tmp_path / "bad"
    BLD.Builder(raw, out, quality=5, jobs=2, **QUIET).run("2026-11-27")
    # a stored piece of another symbol under AAA's November path: the merge must refuse it
    v1 = out / "v1" / "1"
    aaa, con = v1 / "s-AAA" / "2026-11.ubh", v1 / "s-CON" / "2026-11.ubh"
    aaa.write_bytes(con.read_bytes())
    led = json.loads((out / "ledger.json").read_text())
    with pytest.raises(BLD.BuildError, match=r"AAA 1/2026-11"):
        BLD.Builder(raw, out, quality=5, jobs=2, rebuild=True, **QUIET).run("2026-11-27")
    assert not (out / "build.lock").exists()
    assert json.loads((out / "ledger.json").read_text()) == led          # nothing settled by a failed run
