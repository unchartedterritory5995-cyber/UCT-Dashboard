"""tools/history_lake/merge_lakes.py: two trees built over disjoint years, folded into one, must
equal the tree a single build over both ranges writes -- file for file, byte for byte.

Run: python -m pytest tests/test_history_lake_merge.py -q -p no:cacheprovider
"""
from datetime import datetime
import gzip
import json
import random
import shutil

import pytest

from tools.history_lake import bucketing as B
from tools.history_lake import build as BLD
from tools.history_lake import merge_lakes as M

HEADER = "ticker,volume,open,close,high,low,window_start,transactions\n"
DAYS_A = ["2026-11-27", "2026-12-31"]
DAYS_B = ["2027-01-04", "2027-02-01"]
QUIET = dict(log=lambda *_: None)


def _ts(day, hh, mm):
    y, m, d = (int(x) for x in day.split("-"))
    return int(datetime(y, m, d, hh, mm, tzinfo=B.ET).timestamp())


def _write_day(raw, day, rng):
    rows = []
    for ticker, base, count in (("AAA", 412.5, 200), ("BB.C", 37.25, 80), ("BBpC", 25.11, 40), ("CON", 18.4, 25)):
        for m in sorted(rng.sample(range(4 * 60, 20 * 60), count)):
            o = round(base + rng.uniform(-1, 1), 2)
            c = round(base + rng.uniform(-1, 1), 2)
            rows.append((ticker, f"{rng.randint(1, 90000)}.000000", f"{o:.6f}", f"{c:.6f}",
                         f"{max(o, c) + 0.05:.6f}", f"{min(o, c) - 0.05:.6f}",
                         _ts(day, m // 60, m % 60) * 1_000_000_000, rng.randint(1, 900)))
    rows.sort(key=lambda r: (r[0], r[6]))
    ydir = raw / day[:4]
    ydir.mkdir(parents=True, exist_ok=True)
    with gzip.open(ydir / f"{day}.csv.gz", "wt", encoding="ascii", newline="") as f:
        f.write(HEADER)
        for r in rows:
            f.write(",".join(str(x) for x in r) + "\n")


def _build(raw, out, days):
    BLD.Builder(raw, out, quality=5, **QUIET).run(days)
    return out


def _tree(root):
    """{relative path: bytes} of everything a reader uses (pieces, indexes, ledger)."""
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file() and "_spill" not in p.parts:
            out[p.relative_to(root).as_posix()] = p.read_bytes()
    return out


@pytest.fixture()
def lakes(tmp_path):
    raw = tmp_path / "raw"
    rng = random.Random(77)
    for day in DAYS_A + DAYS_B:
        _write_day(raw, day, rng)
    a = _build(raw, tmp_path / "a", "2026-01-01..2026-12-31")
    b = _build(raw, tmp_path / "b", "2027-01-01..2027-12-31")
    whole = _build(raw, tmp_path / "whole", "2026-01-01..2027-12-31")
    return {"raw": raw, "a": a, "b": b, "whole": whole, "tmp": tmp_path}


def test_merge_equals_one_build_over_both_ranges(lakes):
    want = _tree(lakes["whole"])
    assert len([k for k in want if k.endswith(".ubh")]) > 40      # the comparison has something to compare
    a_before, b_before = _tree(lakes["a"]), _tree(lakes["b"])

    into = lakes["tmp"] / "merged_copy"
    out = M.merge(into, [lakes["a"], lakes["b"]], copy=True, **QUIET)
    assert _tree(into) == want
    assert out["problems"] == [] and out["days"] == 4
    assert out["pieces"] == out["pieces_moved"] == len([k for k in want if k.endswith(".ubh")])
    assert _tree(lakes["a"]) == a_before and _tree(lakes["b"]) == b_before          # --copy leaves the sources alone

    # again: nothing to do, nothing changes
    again = M.merge(into, [lakes["a"], lakes["b"]], copy=True, **QUIET)
    assert again["pieces_moved"] == 0 and again["already_there"] == out["pieces"]
    assert _tree(into) == want

    # order does not matter, and moving empties the sources of pieces
    into2 = lakes["tmp"] / "merged_move"
    M.merge(into2, [lakes["b"], lakes["a"]], **QUIET)
    assert _tree(into2) == want
    assert not list(lakes["a"].rglob("*.ubh")) and not list(lakes["b"].rglob("*.ubh"))
    # an interrupted move is finished by running it again (the sources still hold their indexes)
    M.merge(into2, [lakes["b"], lakes["a"]], **QUIET)
    assert _tree(into2) == want


def test_merge_refuses_instead_of_guessing(lakes):
    tmp, a, b = lakes["tmp"], lakes["a"], lakes["b"]

    with pytest.raises(BLD.BuildError, match="at least one"):
        M.merge(tmp / "x0", [], **QUIET)
    with pytest.raises(BLD.BuildError, match="named twice"):
        M.merge(tmp / "x1", [a, a], **QUIET)
    with pytest.raises(BLD.BuildError, match="named twice, or is the destination"):
        M.merge(a, [a], **QUIET)
    with pytest.raises(BLD.BuildError, match="not a history-lake tree"):
        M.merge(tmp / "x2", [tmp / "raw"], **QUIET)

    (b / "build.lock").write_text("1")
    with pytest.raises(BLD.BuildError, match="held by a build"):
        M.merge(tmp / "x3", [a, b], **QUIET)
    assert not (tmp / "x3" / "v1").exists()                       # refused before anything moved
    (b / "build.lock").unlink()

    (b / "_spill").mkdir(exist_ok=True)
    (b / "_spill" / "left.bin").write_bytes(b"x")
    with pytest.raises(BLD.BuildError, match="unfinished build"):
        M.merge(tmp / "x4", [a, b], **QUIET)
    shutil.rmtree(b / "_spill")

    # the same day folded from two different day files
    led = json.loads((b / "ledger.json").read_text())
    saved = (b / "ledger.json").read_bytes()
    led["days"]["2026-12-31"] = {"size": 1, "rows": 1}
    (b / "ledger.json").write_text(json.dumps(led))
    with pytest.raises(BLD.BuildError, match="day 2026-12-31 is in two trees"):
        M.merge(tmp / "x5", [a, b], **QUIET)
    assert not (tmp / "x5" / "v1").exists()
    (b / "ledger.json").write_bytes(saved)

    led["symbols"] = ["AAA"]
    del led["days"]["2026-12-31"]
    (b / "ledger.json").write_text(json.dumps(led))
    with pytest.raises(BLD.BuildError, match="different --symbols scope"):
        M.merge(tmp / "x6", [a, b], **QUIET)
    (b / "ledger.json").write_bytes(saved)

    # two trees that hold the SAME period with different bars (ranges not split on a year)
    c = _build(lakes["raw"], tmp / "c", "2026-12-31")
    with pytest.raises(BLD.BuildError, match="different bytes|different day files|different pieces"):
        M.merge(tmp / "x7", [a, c], copy=True, **QUIET)
    led_c = json.loads((c / "ledger.json").read_text())
    assert set(led_c["days"]) == {"2026-12-31"}                   # same day, same file: the ledger agrees ...
    with pytest.raises(BLD.BuildError, match="different bytes"):  # ... and the pieces are what stops it
        M.merge(tmp / "x8", [a, c], copy=True, **QUIET)


def test_verify_sees_a_missing_a_stray_and_a_resized_piece(lakes):
    into = lakes["tmp"] / "v"
    M.merge(into, [lakes["a"], lakes["b"]], copy=True, **QUIET)
    assert M.verify(into)["problems"] == []
    pieces = sorted(into.rglob("*.ubh"))

    gone = pieces[0].read_bytes()
    pieces[0].unlink()
    assert any("missing piece" in p for p in M.verify(into)["problems"])
    pieces[0].write_bytes(gone)

    pieces[1].write_bytes(pieces[1].read_bytes() + b"\0")
    assert any("index says" in p for p in M.verify(into)["problems"])
    pieces[1].write_bytes(pieces[1].read_bytes()[:-1])

    stray = pieces[2].with_name("1999.ubh")
    stray.write_bytes(b"x")
    assert any("not in any index" in p for p in M.verify(into)["problems"])
    stray.unlink()
    assert M.verify(into)["problems"] == []
    assert M.main(["--into", str(into), "--verify-only"]) == 0
