"""U6: list-olds. One entry covers a key whose stored value differs by store (CX: the R2 snapshot's old and web's live
old): ANY listed old matches and moves the field to the ONE new. Synthetic numbers only."""
import io
import json
import types

import pytest

from api.services import bars_corrections as K
from tools.history_lake import daily_corrections as DC

D = "2010-06-01"
ENTRY = {"tf": "D", "src": "store", "d": D, "op": "set", "f": {"c": [[26.5, 25.48], 24.5]}, "chk": {}}


def _bar(c):
    return {"t": D, "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 10}


@pytest.fixture()
def vol(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(K.ENV_SERVE, raising=False)
    K._state.update(version=0, symbols=frozenset(), retired=frozenset(), revs={}, loaded=False)
    K._cache.clear()
    K._counts.clear()
    d = tmp_path / "bars_corrections" / "v2"
    d.mkdir(parents=True)
    (d / "CX.json.gz").write_bytes(K.encode_payload("CX", 2, [ENTRY]))
    (tmp_path / "bars_corrections" / "manifest.json").write_text(json.dumps({"version": 2, "symbols": ["CX"], "requires": ["list_old"]}))
    assert K.load_local()
    yield tmp_path
    K._state.update(version=0, symbols=frozenset(), retired=frozenset(), revs={}, loaded=False)
    K._cache.clear()


@pytest.mark.parametrize("old", [26.5, 25.48])
def test_either_listed_old_moves_to_the_one_new(vol, old):
    out = K.apply("CX", "D", [{**_bar(old), "o": 24.6, "h": 27.0, "l": 24.0}], "store")
    assert out[0]["c"] == 24.5


def test_a_value_matching_no_listed_old_is_refused(vol):
    bars = [{**_bar(30.0), "o": 24.6, "h": 31.0, "l": 24.0}]
    assert K.apply("CX", "D", bars, "store") is bars


def test_twice_is_once(vol):
    once = K.apply("CX", "D", [{**_bar(26.5), "o": 24.6, "h": 27.0, "l": 24.0}], "store")
    assert K.apply("CX", "D", once, "store") is once
    assert K._counts["set_applied"] == 1 and K._counts["set_already"] == 1


def test_a_malformed_list_skips_its_whole_entry_and_nothing_else(vol):
    """Half a correction is a bar no vendor printed: a malformed field skips the WHOLE entry, never just itself."""
    for bad in ([[], 24.5], [["x", 26.5], 24.5], [[26.5], None], [26.5], "26.5"):
        assert K._compact({**ENTRY, "f": {"c": bad}}) is None
        assert K._compact({**ENTRY, "f": {"c": bad, "o": [[24.6, 24.7], 24.4]}}) is None
    ok = K._compact({**ENTRY, "f": {"o": [[24.6, 24.7], 24.4], "zz": [1, 2]}})   # an unknown NAME is ignored (forward)
    assert ok == ("set", (("o", (24.6, 24.7), 24.4),), ())
    # a malformed entry on one date leaves the other date's entry applying
    good = {**ENTRY, "d": "2010-06-02"}
    bad = {**ENTRY, "f": {"c": [[], 24.5]}}
    K._cache.clear()
    K._state["revs"] = {"CX": 2}
    d = vol / "bars_corrections" / "v2"
    (d / "CX.json.gz").write_bytes(K.encode_payload("CX", 2, [bad, good]))
    rows = [{**_bar(26.5), "o": 24.6, "h": 27.0, "l": 24.0}, {**_bar(26.5), "t": "2010-06-02", "o": 24.6, "h": 27.0, "l": 24.0}]
    out = K.apply("CX", "D", rows, "store")
    assert [b["c"] for b in out] == [26.5, 24.5]


def test_a_manifest_requiring_an_unknown_feature_is_refused_whole(vol):
    class _C:
        def get_object(self, Bucket, Key):
            return {"Body": io.BytesIO(json.dumps({"version": 9, "symbols": ["CX"], "requires": ["teleport"]}).encode())}
    out = K.sync(_C(), "b")
    assert not out["ok"] and "teleport" in out["reason"] and K._state["version"] == 2


# ── the builder and the publisher ─────────────────────────────────────────────────────────────────────────
def test_same_key_rows_merge_into_one_entry_with_both_olds():
    snap = {"tf": "D", "src": "store", "d": D, "op": "set", "f": {"c": [26.5, 24.5]}, "chk": {"o": 25.0}}
    web = {"tf": "D", "src": "store", "d": D, "op": "set", "f": {"c": [25.48, 24.5]}, "chk": {"o": 24.0}}
    m = DC.merge_same_key([snap, web])
    assert m == [{"tf": "D", "src": "store", "d": D, "op": "set", "f": {"c": [[26.5, 25.48], 24.5]}, "chk": {}}]
    assert DC.merge_same_key([snap]) == [snap]                               # a single old stays a scalar


def test_rows_that_disagree_on_the_new_value_are_refused():
    a = {"tf": "D", "src": "store", "d": D, "op": "set", "f": {"c": [26.5, 24.5]}, "chk": {}}
    b = {"tf": "D", "src": "store", "d": D, "op": "set", "f": {"c": [25.48, 24.0]}, "chk": {}}
    with pytest.raises(SystemExit):
        DC.merge_same_key([a, b])


def test_a_set_and_a_drop_on_one_bar_are_refused():
    s = {"tf": "D", "src": "store", "d": D, "op": "set", "f": {"c": [26.5, 24.5]}, "chk": {}}
    dr = {"tf": "D", "src": "store", "d": D, "op": "drop", "old": [1, 2, 1, 2, 3]}
    with pytest.raises(SystemExit):
        DC.merge_same_key([s, dr])
    assert len(DC.merge_same_key([s, {**dr, "d": "2010-06-02"}])) == 2


# ── `rows`: data-identity's ledger rows into the entries dir ───────────────────────────────────────────────
def _row(sym, d, old, new, op="set"):
    if op == "drop":
        return {"sym": sym, "tf": "D", "d": d, "src": "store", "op": "drop", "f": {}, "old": old, "chk": {},
                "decisions": ["DI-rescale"], "evidence": {"x": 1}}
    return {"sym": sym, "tf": "D", "d": d, "src": "store", "op": "set", "f": {"c": [old, new]}, "chk": {},
            "decisions": ["DI-rescale"], "rules": {}, "evidence": {"x": 1}}


def _ledger(tmp_path, flagged=(), builder=None):
    (tmp_path / "entries").mkdir()
    (tmp_path / "RESCALE_FLAG.json").write_text(json.dumps({"exit": 1 if flagged else 0, "names": list(flagged)}))
    for sym, ents in (builder or {}).items():
        (tmp_path / "entries" / f"{sym}.json").write_text(json.dumps(ents))


def _jsonl(path, rows):
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return str(path)


def _rows(tmp_path, files, replace="", exclude="", symbols=""):
    return DC.cmd_rows(types.SimpleNamespace(out=str(tmp_path), files=files, replace=replace, exclude=exclude, symbols=symbols))


def test_rows_snapshot_and_web_olds_become_one_list_old_entry(tmp_path):
    _ledger(tmp_path, flagged=["CX"])
    snap = _jsonl(tmp_path / "08.jsonl", [_row("CX", D, 0.0001, 24.5)])
    web = _jsonl(tmp_path / "08b.jsonl", [_row("CX", D, 25.48, 24.5)])
    per = _rows(tmp_path, [snap, web])
    got = json.load(open(tmp_path / "entries" / "CX.json"))
    assert got == [{"tf": "D", "src": "store", "d": D, "op": "set", "f": {"c": [[0.0001, 25.48], 24.5]}, "chk": {}}]
    assert per["CX"]["list_old_entries"] == 1
    rec = json.load(open(tmp_path / "rows_loaded.json"))
    assert [f["rows"] for f in rec["files"]] == [1, 1] and all(len(f["sha256"]) == 64 for f in rec["files"])


def test_rows_merge_with_builder_entries_and_strip_evidence(tmp_path):
    b = {"tf": "D", "src": "store", "d": "2010-06-02", "op": "set", "f": {"l": [1.0, 2.0]}, "chk": {"o": 3.0}}
    _ledger(tmp_path, builder={"SUPN": [b]})
    _rows(tmp_path, [_jsonl(tmp_path / "01.jsonl", [_row("SUPN", D, 5.0, 4.0), _row("SUPN", "2010-06-03", [1, 2, 1, 2, 3], None, "drop")])])
    got = json.load(open(tmp_path / "entries" / "SUPN.json"))
    assert got[0] == b and [e["op"] for e in got] == ["set", "set", "drop"]
    assert not any("evidence" in e or "decisions" in e or "sym" in e for e in got)


def test_rows_refuse_an_f3_name_with_builder_entries_unless_replaced(tmp_path):
    b = {"tf": "D", "src": "store", "d": "2010-06-02", "op": "set", "f": {"l": [1.0, 2.0]}, "chk": {}}
    _ledger(tmp_path, flagged=["CX"], builder={"CX": [b]})
    f = _jsonl(tmp_path / "08.jsonl", [_row("CX", D, 0.0001, 24.5)])
    with pytest.raises(SystemExit):
        _rows(tmp_path, [f])
    assert json.load(open(tmp_path / "entries" / "CX.json")) == [b]            # refused = nothing written
    per = _rows(tmp_path, [f], replace="CX")
    assert per["CX"]["builder_replaced"] == 1
    assert [e["d"] for e in json.load(open(tmp_path / "entries" / "CX.json"))] == [D]


def test_rows_disagreeing_news_write_nothing_at_all(tmp_path):
    _ledger(tmp_path)
    a = _jsonl(tmp_path / "a.jsonl", [_row("AAA", D, 1.0, 2.0), _row("ZZZ", D, 1.0, 2.0)])
    b = _jsonl(tmp_path / "b.jsonl", [_row("ZZZ", D, 1.5, 2.5)])
    with pytest.raises(SystemExit):
        _rows(tmp_path, [a, b])
    assert not list((tmp_path / "entries").glob("*.json")) and not (tmp_path / "rows_loaded.json").exists()


def test_rows_exclude_leaves_a_superseded_files_rows_out(tmp_path):
    _ledger(tmp_path)
    old = _jsonl(tmp_path / "02.jsonl", [_row("CX", D, 0.0001, 99.0), _row("BBD", D, 0.0001, 3.0)])
    sup = _jsonl(tmp_path / "08.jsonl", [_row("CX", D, 0.0001, 24.5)])
    with pytest.raises(SystemExit):                                               # superseded rows disagree: refused
        _rows(tmp_path, [old, sup])
    _rows(tmp_path, [old, sup], exclude="02.jsonl:CX")
    assert json.load(open(tmp_path / "entries" / "CX.json"))[0]["f"] == {"c": [0.0001, 24.5]}
    assert (tmp_path / "entries" / "BBD.json").exists()
    with pytest.raises(SystemExit):
        _rows(tmp_path, [sup], exclude="02.jsonl:CX")                             # a file not being loaded


def test_the_cli_reaches_rows(tmp_path):
    _ledger(tmp_path)
    f = _jsonl(tmp_path / "a.jsonl", [_row("AAA", D, 1.0, 2.0)])
    DC.main(["rows", "--out", str(tmp_path), "--files", f])
    assert (tmp_path / "entries" / "AAA.json").exists()


class _S3:
    def __init__(self):
        self.objs, self.puts = {}, []

    def get_object(self, Bucket, Key):
        raise KeyError("NoSuchKey")

    def put_object(self, Bucket, Key, Body, **kw):
        self.puts.append(Key)
        self.objs[Key] = Body


def _out(tmp_path):
    (tmp_path / "entries").mkdir()
    (tmp_path / "entries" / "CX.json").write_text(json.dumps([ENTRY]))
    (tmp_path / "RESCALE_FLAG.json").write_text(json.dumps({"exit": 0, "names": []}))


def test_the_publisher_refuses_list_olds_until_every_tier_supports_them(tmp_path):
    """An applier older than U6 reads a list-old as malformed and skips the entry: publishing one before every tier
    runs U6 would half-apply across pods."""
    _out(tmp_path)
    with pytest.raises(SystemExit):
        DC.cmd_publish(types.SimpleNamespace(out=str(tmp_path), stage="CX", version=1, dry=False, cleared="", appliers_support=""),
                       client=_S3(), bucket="b")
    s3 = _S3()
    m = DC.cmd_publish(types.SimpleNamespace(out=str(tmp_path), stage="CX", version=1, dry=False, cleared="",
                                             appliers_support="list_old"), client=s3, bucket="b")
    assert m["requires"] == ["list_old"] and json.loads(s3.objs[K.MANIFEST_KEY])["requires"] == ["list_old"]
