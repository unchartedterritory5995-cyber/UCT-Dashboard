"""Rails for tools/pine_coverage/coverage_ratchet.py (the coverage ratchet over corpus/committed, 2026-11-16).

No census runs here: rows are fabricated in the shape coverageMapDoorCensus.measure.test.js writes, and the
census loop (`run_census.drive`) is driven with a fake vitest. What must stay true, each a test below:

  * a snapshot script that stops transferring FAILS (exit 1), named with its wall; a newly transferring one
    PASSES and is reported with the command that adds it;
  * the predicate is the coverage map's: an order-placing strategy never transfers; a runtime-lane attach
    transfers on the runtime-on lane only;
  * REFUSED (exit 2): a vacuous snapshot (under the lane's floor), a count that disagrees with its list, a
    snapshot naming a script not in the corpus or whose text changed, a run that measured fewer scripts than
    the corpus holds, rows of another lane or without a lane proof, rows measured on other texts, a corpus
    smaller than its index says, a census loop that did not finish;
  * `--write` refuses a vacuous snapshot and writes a deterministic, LF, sorted file a check then passes;
  * the census loop raises (never returns) when the census answers fewer scripts than it was given;
  * the COMMITTED snapshot is sound against the committed corpus.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))

import coverage_map as CM  # noqa: E402
import coverage_ratchet as R  # noqa: E402
import run_census as RC  # noqa: E402

PROD, RT = RC.LANE_PRODUCTION, RC.LANE_RUNTIME_ON
INDICATOR = "//@version=5\nindicator('{n}')\nplot(close)\n"
STRATEGY = "//@version=5\nstrategy('{n}')\nif close > open\n    strategy.entry('L', strategy.long)\nplot(close)\n"


def _row(key, lane, *, clean=True, attached=True, rt_lane=None, guard=None, killed=False):
    st = {"attached": attached, "installed": True if attached else None, "lane": rt_lane or ("host" if attached else None),
          "refusals": [] if guard is None else [{"guard": guard, "line": 3}], "lossVerdict": "clean" if attached else None,
          "withheldObjects": False, "withheldPaints": 0}
    if killed:
        return {"key": key, "lane": lane, "attached": False, "clean": False, "stuck": "killed",
                "steps": [{"threw": "process died (rc=1)"}]}
    return {"key": key, "lane": lane, "attached": attached, "clean": clean, "steps": [st]}


class World:
    """A small committed corpus, its index, a snapshot path and a rows directory."""

    def __init__(self, tmp, scripts, *, index_count=None):
        self.tmp = tmp
        self.corpus = tmp / "corpus" / "committed"
        self.corpus.mkdir(parents=True)
        for name, text in scripts.items():
            (self.corpus / f"{name}.pine").write_text(text, encoding="utf-8", newline="\n")
        self.index = tmp / "corpus" / "index.json"
        self.index.write_text(json.dumps({"counts": {"committed": len(scripts) if index_count is None else index_count}}),
                              encoding="utf-8")
        self.snapshot = tmp / "coverage-ratchet.json"
        self.rows_dir = tmp / "rows"
        self.rows_dir.mkdir()

    def scripts(self):
        return R.corpus_scripts(str(self.corpus))

    def rows(self, lane, rows, *, lane_ok=True, inputs=None):
        with open(self.rows_dir / "census.jsonl", "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        (self.rows_dir / "lane.jsonl").write_text(
            json.dumps({"requested": lane, "ok": lane_ok, "line": "LANE MEASURED: %s" % lane if lane_ok else "LANE NOT OK"})
            + "\n", encoding="utf-8")
        shas = {k: v["sha"] for k, v in self.scripts().items()} if inputs is None else inputs
        (self.rows_dir / "inputs.json").write_text(json.dumps(shas), encoding="utf-8")

    def snap(self, lanes):
        sc = self.scripts()
        doc = {"schema": R.SCHEMA, "lanes": {lane: {"count": len(keys), "scripts": {k: sc[k]["sha"] if k in sc else "0" * 16
                                                                                    for k in keys}}
                                            for lane, keys in lanes.items()}}
        self.snapshot.write_text(json.dumps(doc), encoding="utf-8")

    def run(self, lane, *extra):
        return R.main(["--lane", lane, "--rows", str(self.rows_dir / "census.jsonl"), "--snapshot", str(self.snapshot),
                       "--corpus", str(self.corpus), "--corpus-index", str(self.index), *extra])

    def result(self):
        return json.loads((self.rows_dir / "ratchet-result.json").read_text(encoding="utf-8"))


@pytest.fixture
def small(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "MIN_CORPUS", 1)
    monkeypatch.setattr(R, "FLOORS", {PROD: 1, RT: 1})
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.delenv("GITHUB_RUN_ID", raising=False)
    w = World(tmp_path, {"a": INDICATOR.format(n="a"), "b": INDICATOR.format(n="b"), "c": INDICATOR.format(n="c"),
                         "s": STRATEGY.format(n="s")})
    return w


def K(n):
    return R.KEY_PREFIX + n


def _all(lane, **over):
    """A row per corpus script: clean unless overridden by name."""
    return [over.get(n, _row(K(n), lane)) for n in ("a", "b", "c", "s")]


# ── pass, lost, gained ────────────────────────────────────────────────────────

def test_a_snapshot_that_still_transfers_passes_and_a_new_transfer_is_reported(small, capsys):
    small.snap({PROD: [K("a"), K("b")]})
    small.rows(PROD, _all(PROD))
    assert small.run(PROD) == R.EXIT_PASS
    res = small.result()
    assert res["verdict"] == "PASS" and res["measured"] == res["expected"] == 4
    assert res["gained"] == [K("c")]                         # s places orders: never counted
    out = capsys.readouterr().out
    assert "GAINED: " + K("c") in out and "coverage_ratchet.py --lane production --write" in out


def test_a_snapshot_script_that_stops_transferring_fails_named_with_its_wall(small, capsys):
    small.snap({PROD: [K("a"), K("b")]})
    small.rows(PROD, _all(PROD, b=_row(K("b"), PROD, clean=False, attached=False, guard="pine:collection")))
    assert small.run(PROD) == R.EXIT_LOST
    res = small.result()
    assert res["verdict"] == "LOST"
    assert res["lost"] == [{"key": K("b"), "wall": "refused pine:collection"}]
    assert "LOST: %s - refused pine:collection" % K("b") in capsys.readouterr().out


def test_a_killed_script_is_lost_not_skipped(small):
    small.snap({PROD: [K("a"), K("b")]})
    small.rows(PROD, _all(PROD, a=_row(K("a"), PROD, killed=True)))
    assert small.run(PROD) == R.EXIT_LOST
    assert small.result()["lost"][0]["wall"].startswith("killed")


# ── the predicate is the coverage map's ───────────────────────────────────────

def test_an_order_placing_strategy_never_transfers_on_either_lane(small):
    sc = small.scripts()
    clean = _row(K("s"), PROD)
    assert CM.places_orders(CM.order_usage_of(sc[K("s")]["src"]))
    assert not R.transfers(PROD, clean, sc[K("s")]["src"])
    rt_attach = _row(K("s"), RT, clean=False, rt_lane="runtime")
    assert not R.transfers(RT, rt_attach, sc[K("s")]["src"])
    assert R.wall_of(PROD, clean, sc[K("s")]["src"]).startswith("a strategy that places orders (strategy.entry")


def test_a_runtime_lane_attach_transfers_on_the_runtime_on_lane_only(small):
    src = small.scripts()[K("a")]["src"]
    row = _row(K("a"), RT, clean=False, rt_lane="runtime")
    assert R.transfers(RT, row, src) is True
    assert R.transfers(PROD, row, src) is False
    # one authority: the ratchet's answer IS the map's
    assert R.transfers(RT, row, src) == CM.runtime_on_transfers(row, False)


# ── refusals: a comparison that would prove nothing ──────────────────────────

def test_a_vacuous_snapshot_is_refused(small, monkeypatch):
    monkeypatch.setattr(R, "FLOORS", {PROD: 3, RT: 3})
    small.snap({PROD: [K("a"), K("b")]})
    small.rows(PROD, _all(PROD))
    assert small.run(PROD) == R.EXIT_REFUSED
    assert any(p.startswith("VACUOUS") for p in small.result()["problems"])


def test_an_empty_snapshot_is_refused_even_with_the_floor_at_one(small):
    small.snap({PROD: []})
    small.rows(PROD, _all(PROD))
    assert small.run(PROD) == R.EXIT_REFUSED


def test_a_snapshot_count_that_disagrees_with_its_list_is_refused(small):
    small.snap({PROD: [K("a"), K("b")]})
    doc = json.loads(small.snapshot.read_text(encoding="utf-8"))
    doc["lanes"][PROD]["count"] = 3
    small.snapshot.write_text(json.dumps(doc), encoding="utf-8")
    small.rows(PROD, _all(PROD))
    assert small.run(PROD) == R.EXIT_REFUSED
    assert any("says count 3 but lists 2" in p for p in small.result()["problems"])


def test_a_snapshot_naming_a_script_not_in_the_corpus_is_refused(small):
    small.snap({PROD: [K("a"), K("gone")]})
    small.rows(PROD, _all(PROD))
    assert small.run(PROD) == R.EXIT_REFUSED
    assert any("not in corpus/committed" in p and K("gone") in p for p in small.result()["problems"])


def test_a_snapshot_whose_script_text_changed_is_refused(small):
    small.snap({PROD: [K("a"), K("b")]})
    doc = json.loads(small.snapshot.read_text(encoding="utf-8"))
    doc["lanes"][PROD]["scripts"][K("a")] = "f" * 16
    small.snapshot.write_text(json.dumps(doc), encoding="utf-8")
    small.rows(PROD, _all(PROD))
    assert small.run(PROD) == R.EXIT_REFUSED
    assert any("changed since the snapshot" in p for p in small.result()["problems"])


def test_a_snapshot_without_the_lane_is_refused(small):
    small.snap({RT: [K("a")]})
    small.rows(PROD, _all(PROD))
    assert small.run(PROD) == R.EXIT_REFUSED


def test_a_run_that_measured_fewer_scripts_than_the_corpus_holds_is_refused(small):
    small.snap({PROD: [K("a")]})
    small.rows(PROD, [_row(K("a"), PROD), _row(K("b"), PROD), _row(K("s"), PROD)])   # no row for c
    assert small.run(PROD) == R.EXIT_REFUSED
    res = small.result()
    assert res["measured"] == 3 and res["expected"] == 4
    assert any(p.startswith("measured 3 of 4") and K("c") in p for p in res["problems"])


def test_rows_of_another_lane_are_refused(small):
    small.snap({PROD: [K("a")]})
    small.rows(PROD, _all(PROD, b=_row(K("b"), RT)))
    assert small.run(PROD) == R.EXIT_REFUSED


def test_rows_without_a_lane_proof_are_refused(small):
    small.snap({PROD: [K("a")]})
    small.rows(PROD, _all(PROD), lane_ok=False)
    assert small.run(PROD) == R.EXIT_REFUSED
    assert any("LANE NOT MEASURED" in p for p in small.result()["problems"])


def test_rows_measured_on_other_texts_are_refused(small):
    small.snap({PROD: [K("a")]})
    shas = {k: v["sha"] for k, v in small.scripts().items()}
    shas[K("b")] = "0" * 16
    small.rows(PROD, _all(PROD), inputs=shas)
    assert small.run(PROD) == R.EXIT_REFUSED
    assert any("differ from the texts the rows were measured on" in p for p in small.result()["problems"])


def test_a_corpus_smaller_than_its_index_is_refused(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "MIN_CORPUS", 1)
    w = World(tmp_path, {"a": INDICATOR.format(n="a")}, index_count=2)
    w.snap({PROD: [K("a")]})
    w.rows(PROD, [_row(K("a"), PROD)])
    assert w.run(PROD) == R.EXIT_REFUSED
    assert any("index.json says 2" in p for p in w.result()["problems"])


def test_a_census_loop_that_did_not_finish_is_refused(small, monkeypatch, tmp_path):
    def broken(items, cache, lane, **kw):
        raise RC.CensusRunError("census rows: 3 / 4 - the census did not answer every input")
    monkeypatch.setattr(R.RC, "drive", broken)
    small.snap({PROD: [K("a")]})
    out = tmp_path / "measure"
    rc = R.main(["--lane", PROD, "--out", str(out), "--snapshot", str(small.snapshot), "--corpus", str(small.corpus),
                 "--corpus-index", str(small.index)])
    assert rc == R.EXIT_REFUSED
    res = json.loads((out / "ratchet-result.json").read_text(encoding="utf-8"))
    assert res["verdict"] == "REFUSED" and "did not answer every input" in res["problems"][0]


def test_measure_refuses_a_directory_that_already_holds_rows(small, tmp_path):
    out = tmp_path / "old"
    out.mkdir()
    (out / "census.jsonl").write_text("{}\n", encoding="utf-8")
    with pytest.raises(RC.CensusRunError, match="not empty"):
        R.measure(PROD, small.scripts(), str(out))


# ── --write ───────────────────────────────────────────────────────────────────

def test_write_refuses_a_vacuous_snapshot(small, monkeypatch):
    monkeypatch.setattr(R, "FLOORS", {PROD: 9, RT: 9})
    small.rows(PROD, _all(PROD))
    assert small.run(PROD, "--write") == R.EXIT_REFUSED
    assert not small.snapshot.exists()


def test_write_then_check_passes_and_the_file_is_deterministic(small):
    small.rows(PROD, _all(PROD))
    assert small.run(PROD, "--write") == R.EXIT_PASS
    first = small.snapshot.read_bytes()
    assert b"\r" not in first and first.endswith(b"\n")
    doc = json.loads(first)
    assert doc["schema"] == R.SCHEMA
    assert list(doc["lanes"][PROD]["scripts"]) == sorted([K("a"), K("b"), K("c")])
    assert doc["lanes"][PROD]["count"] == 3
    assert small.run(PROD, "--write") == R.EXIT_PASS
    assert small.snapshot.read_bytes() == first                     # same measurement, same bytes
    assert small.run(PROD) == R.EXIT_PASS                           # and a check against it passes
    # writing one lane keeps the other
    small.rows(RT, _all(RT, a=_row(K("a"), RT, clean=False, rt_lane="runtime")))
    assert small.run(RT, "--write") == R.EXIT_PASS
    both = json.loads(small.snapshot.read_bytes())
    assert set(both["lanes"]) == {PROD, RT} and both["lanes"][PROD] == doc["lanes"][PROD]


# ── the census loop: fewer rows than items never returns ─────────────────────

def _fake_vitest(monkeypatch, answer, lane_ok=True):
    """Stand in for `node vitest run <census>`: append rows for `answer(items)` and a lane.jsonl pass."""
    def call(cmd, cwd=None, env=None):
        items = json.loads(open(env["COVERAGE_INPUT"], encoding="utf-8").read())
        out = env["COVERAGE_OUT"]
        lane = PROD if env["COVERAGE_RUNTIME_ON"] == "0" else RT
        done = RC.done_keys(out)
        new = [it for it in answer(items) if it["key"] not in done]
        with open(out, "a", encoding="utf-8") as f:
            for it in new:
                f.write(json.dumps({"key": it["key"], "lane": lane, "clean": True, "attached": True, "steps": [{}]}) + "\n")
        if new:
            with open(pathlib.Path(out).parent / "lane.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"requested": lane, "ok": lane_ok, "line": "x"}) + "\n")
        return 0                        # ⛔ vitest's exit says nothing: it is 0 here every time
    monkeypatch.setattr(RC.subprocess, "call", call)


def test_drive_returns_only_when_every_item_has_a_row(monkeypatch, tmp_path):
    items = [{"key": f"committed:x{i}", "path": "unused", "cap": 1} for i in range(5)]
    _fake_vitest(monkeypatch, lambda its: its)
    assert RC.drive(items, str(tmp_path / "ok"), PROD) == 5


def test_drive_raises_when_the_census_answers_fewer_scripts_than_it_was_given(monkeypatch, tmp_path):
    items = [{"key": f"committed:x{i}", "path": "unused", "cap": 1} for i in range(5)]
    _fake_vitest(monkeypatch, lambda its: its[:3])            # exits 0, writes 3 of 5
    with pytest.raises(RC.CensusRunError, match="no progress"):
        RC.drive(items, str(tmp_path / "short"), PROD)


def test_drive_raises_when_the_lane_was_not_measured(monkeypatch, tmp_path):
    items = [{"key": f"committed:x{i}", "path": "unused", "cap": 1} for i in range(2)]
    _fake_vitest(monkeypatch, lambda its: its, lane_ok=False)
    with pytest.raises(RC.CensusRunError, match="LANE NOT MEASURED"):
        RC.drive(items, str(tmp_path / "lane"), PROD)


# ── the committed snapshot ────────────────────────────────────────────────────

def test_the_committed_snapshot_is_sound_against_the_committed_corpus():
    scripts = R.corpus_scripts()
    assert R.corpus_problems(scripts) == []
    doc = R.load_snapshot()
    assert doc is not None, "docs/pine/coverage-ratchet.json is missing"
    for lane in R.LANES:
        assert R.snapshot_problems(doc, lane, scripts) == [], lane
    assert R.snapshot_text(doc).encode("utf-8") == pathlib.Path(R.SNAPSHOT).read_bytes().replace(b"\r\n", b"\n"), \
        "the snapshot is not in the form --write produces (hand-edited?)"
