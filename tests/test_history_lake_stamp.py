"""tools/history_lake/stamp_splits.py: each symbol's index carries its split table, and nothing else moves.

Run: python -m pytest tests/test_history_lake_stamp.py -q -p no:cacheprovider
"""
import json

import pytest

from tools.history_lake import build as BLD
from tools.history_lake import merge_lakes as M
from tools.history_lake import stamp_splits as S
from tests.test_history_lake_merge import DAYS_A, DAYS_B, QUIET, _build, _tree, _write_day

import random

ROWS = [
    {"ticker": "AAA", "execution_date": "2026-12-01", "split_from": 1, "split_to": 4},
    {"ticker": "AAA", "execution_date": "2020-06-01", "split_from": 10, "split_to": 1},
    {"ticker": "AAA", "execution_date": "2027-06-01", "split_from": 1, "split_to": 2},     # after as_of
    {"ticker": "BB.C", "execution_date": "2026-11-30", "split_from": 0, "split_to": 2},     # unusable
    {"ticker": "BBpC", "execution_date": "2026-11-30", "split_from": 2, "split_to": 3},
    {"ticker": "NOTHERE", "execution_date": "2026-11-30", "split_from": 1, "split_to": 2},
]
AS_OF = "2027-02-01"


@pytest.fixture()
def lake(tmp_path):
    raw = tmp_path / "raw"
    rng = random.Random(77)
    for day in DAYS_A + DAYS_B:
        _write_day(raw, day, rng)
    out = _build(raw, tmp_path / "lake", "2026-01-01..2027-12-31")
    return {"raw": raw, "out": out, "tmp": tmp_path}


def _index(out, name):
    return json.loads((out / "v1" / "index" / name).read_text())


def test_stamp_writes_the_tables_and_touches_nothing_else(lake):
    out = lake["out"]
    before = _tree(out)
    stats = S.stamp(out, ROWS, AS_OF, **QUIET)
    assert stats == {"indexes": 4, "changed": 4, "with_splits": 2, "split_symbols_without_index": 1}
    assert _index(out, "s-AAA.json")["splits"] == [["2020-06-01", 0.1], ["2026-12-01", 4.0]]
    assert _index(out, "s-BB_70C.json")["splits"] == [["2026-11-30", 1.5]]
    assert _index(out, "s-BB_2EC.json")["splits"] == []
    assert _index(out, "s-CON.json")["splits"] == []
    after = _tree(out)
    assert set(after) == set(before)
    for path, data in after.items():
        if "/index/" not in path:
            assert data == before[path], path                      # pieces and ledger: byte for byte
        else:
            doc, was = json.loads(data), json.loads(before[path])
            assert doc.pop("splits_as_of") == AS_OF
            doc.pop("splits")
            assert doc == was                                      # the index's own fields are unchanged
    assert M.verify(out)["problems"] == []

    # again: nothing to do
    mtimes = {p: p.stat().st_mtime_ns for p in (out / "v1" / "index").iterdir()}
    assert S.stamp(out, ROWS, AS_OF, **QUIET)["changed"] == 0
    assert {p: p.stat().st_mtime_ns for p in (out / "v1" / "index").iterdir()} == mtimes

    # the vendor restates a ratio (same as-of): that one index is rewritten, the others are not
    restated = [dict(r, split_to=3) if r['ticker'] == 'BBpC' else r for r in ROWS]
    assert S.stamp(out, restated, AS_OF, **QUIET)['changed'] == 0              # still 3-for-2: nothing to write
    assert _index(out, 's-BB_70C.json')['splits'] == [['2026-11-30', 1.5]]
    restated = [dict(r, split_to=5) if r['ticker'] == 'BBpC' else r for r in ROWS]
    assert S.stamp(out, restated, AS_OF, **QUIET)['changed'] == 1
    assert _index(out, 's-BB_70C.json')['splits'] == [['2026-11-30', 2.5]]
    assert S.stamp(out, ROWS, AS_OF, **QUIET)['changed'] == 1

    # a later as-of brings in the split that had not happened yet, for that symbol's table only
    later = S.stamp(out, ROWS, "2027-06-01", **QUIET)
    assert later["changed"] == 4                                   # every index records the new as-of
    assert _index(out, "s-AAA.json")["splits"][-1] == ["2027-06-01", 2.0]
    assert _index(out, "s-BB_70C.json")["splits"] == [["2026-11-30", 1.5]]


def test_the_builder_and_the_merge_keep_the_stamp(lake):
    out, tmp = lake["out"], lake["tmp"]
    S.stamp(out, ROWS, AS_OF, **QUIET)
    # a later build day into the same tree rewrites the indexes it touches
    _write_day(lake["raw"], "2027-03-01", random.Random(5))
    BLD.Builder(lake["raw"], out, quality=5, **QUIET).run("2027-03-01")
    doc = _index(out, "s-AAA.json")
    assert doc["splits"] == [["2020-06-01", 0.1], ["2026-12-01", 4.0]] and doc["splits_as_of"] == AS_OF
    assert "2027-03" in doc["series"]["1"]
    # merging more pieces INTO a stamped tree keeps its stamp
    extra_raw = tmp / "raw2"
    _write_day(extra_raw, "2028-01-03", random.Random(6))
    extra = _build(extra_raw, tmp / "extra", "2028-01-01..2028-12-31")
    M.merge(out, [extra], copy=True, **QUIET)
    doc = _index(out, "s-AAA.json")
    assert doc["splits"] == [["2020-06-01", 0.1], ["2026-12-01", 4.0]] and "2028" in doc["series"]["60"]


def test_stamp_refuses_instead_of_guessing(lake, capsys):
    out, tmp = lake["out"], lake["tmp"]
    with pytest.raises(BLD.BuildError, match="not a history-lake tree"):
        S.stamp(tmp / "raw", ROWS, AS_OF, **QUIET)
    with pytest.raises(BLD.BuildError, match="as_of must be"):
        S.stamp(out, ROWS, "11/13/2026", **QUIET)
    (out / "build.lock").write_text("1")
    with pytest.raises(BLD.BuildError, match="held by a build"):
        S.stamp(out, ROWS, AS_OF, **QUIET)
    (out / "build.lock").unlink()
    bad = out / "v1" / "index" / "s-AAA.json"
    saved = bad.read_bytes()
    bad.write_text(json.dumps({"v": 1, "symbol": "ZZZ", "series": {}}))
    with pytest.raises(BLD.BuildError, match="not a symbol index"):
        S.stamp(out, ROWS, AS_OF, **QUIET)
    bad.write_text("{nope")
    with pytest.raises(BLD.BuildError, match="unreadable"):
        S.stamp(out, ROWS, AS_OF, **QUIET)
    bad.write_bytes(saved)

    splits = tmp / "splits.json"
    splits.write_text(json.dumps({"rows": ROWS}))
    assert S.main(["--lake", str(out), "--splits", str(splits), "--as-of", AS_OF]) == 0
    assert _index(out, "s-BB_70C.json")["splits"] == [["2026-11-30", 1.5]]
    splits.write_text(json.dumps({"rows": []}))
    assert S.main(["--lake", str(out), "--splits", str(splits), "--as-of", AS_OF]) == 2
    assert "has no rows" in capsys.readouterr().out
    assert S.main(["--lake", str(out), "--splits", str(tmp / "missing.json"), "--as-of", AS_OF]) == 2
