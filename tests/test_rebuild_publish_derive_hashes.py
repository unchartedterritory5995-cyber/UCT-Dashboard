"""U5c: the first per-ticker-rev rebuild publish must move ONLY the symbols whose series changed. The live manifest v1
predates `hashes`, so the publisher derives each missing hash from the PUBLISHED payload; a symbol it cannot read is
refused (never silently re-epoched); `--dry` names exactly which symbols get a new rev and writes nothing; and only a
missing manifest means "first publish". Synthetic data only."""
import gzip
import io
import json

import pytest

from tools.history_lake import daily_publish as DP


class NoSuchKey(Exception):
    pass


class _S3:
    def __init__(self, objs=None, manifest_error=None):
        self.objs, self.gets, self.puts, self.manifest_error = dict(objs or {}), [], [], manifest_error

    def get_object(self, Bucket, Key):
        self.gets.append(Key)
        if Key == f"{DP.PREFIX}manifest.json" and self.manifest_error:
            raise self.manifest_error
        if Key not in self.objs:
            raise NoSuchKey(Key)
        return {"Body": io.BytesIO(self.objs[Key])}

    def put_object(self, Bucket, Key, Body, **kw):
        self.puts.append(Key)
        self.objs[Key] = Body


def _rec(sym, px):
    return {"sym": sym, "bars": [["2005-01-03", px, px + 1, px - 1, px, 100], ["2026-11-17", px, px, px, px, 5]]}


def _root(tmp_path, recs):
    d = tmp_path / "daily-v1" / "joined"
    d.mkdir(parents=True)
    for s, r in recs.items():
        (d / f"{s}.json").write_text(json.dumps(r))
    (tmp_path / "daily-v1" / "serve_list.json").write_text(json.dumps(sorted(recs)))
    return str(tmp_path)


def _live_v1(recs, decoded=()):
    """The live shape: v1, no revs, no hashes, no retired; payloads gzip(payload_body) (or already decoded)."""
    objs = {f"{DP.PREFIX}manifest.json": json.dumps({"version": 1, "end": "2026-11-17", "stage": "all",
                                                       "symbols": sorted(recs)}).encode()}
    for s, r in recs.items():
        body = DP.payload_body(r)
        objs[f"{DP.PREFIX}v1/{s}.json.gz"] = body if s in decoded else gzip.compress(body, 6)
    return objs


V1 = {"ASB": _rec("ASB", 10.0), "MNST": _rec("MNST", 20.0), "FDX": _rec("FDX", 300.0)}


def _manifest(s3):
    return json.loads(s3.objs[f"{DP.PREFIX}manifest.json"])


def test_a_hashless_v1_moves_only_the_changed_symbol(tmp_path):
    s3 = _S3(_live_v1(V1))
    root = _root(tmp_path, {**V1, "FDX": _rec("FDX", 299.8)})           # only FDX's series changed
    rep = DP.main(["--root", root, "--version", "2", "--stage", "all"], client=s3, bucket="b")
    m = _manifest(s3)
    assert m["revs"] == {"ASB": 1, "MNST": 1, "FDX": 2} and rep["changed"] == ["FDX"] and rep["hash_derived"] == 3
    assert [k for k in s3.puts if k.endswith(".json.gz")] == [f"{DP.PREFIX}v2/FDX.json.gz"]
    assert set(m["hashes"]) == {"ASB", "MNST", "FDX"}                    # the next publish needs no derivation


def test_dry_names_the_movers_and_writes_nothing(tmp_path):
    s3 = _S3(_live_v1(V1))
    root = _root(tmp_path, {**V1, "FDX": _rec("FDX", 299.8), "NEW": _rec("NEW", 5.0)})
    rep = DP.main(["--root", root, "--version", "2", "--stage", "all", "--dry"], client=s3, bucket="b")
    assert s3.puts == [] and rep["changed"] == ["FDX"] and rep["added"] == ["NEW"] and rep["kept"] == 2


def test_an_unreadable_published_payload_is_refused_not_re_epoched(tmp_path):
    objs = _live_v1(V1)
    del objs[f"{DP.PREFIX}v1/MNST.json.gz"]
    s3 = _S3(objs)
    root = _root(tmp_path, V1)
    with pytest.raises(SystemExit):
        DP.main(["--root", root, "--version", "2", "--stage", "all"], client=s3, bucket="b")
    assert s3.puts == []
    rep = DP.main(["--root", root, "--version", "2", "--stage", "all", "--dry"], client=s3, bucket="b")
    assert rep["hash_unreadable"] == ["MNST"]


def test_a_manifest_read_error_is_not_a_first_publish(tmp_path):
    root = _root(tmp_path, V1)
    s3 = _S3(_live_v1(V1), manifest_error=TimeoutError("read timed out"))
    with pytest.raises(TimeoutError):
        DP.main(["--root", root, "--version", "2", "--stage", "all"], client=s3, bucket="b")
    assert s3.puts == []
    first = _S3({})                                                       # no manifest at all: a first publish
    DP.main(["--root", root, "--version", "1", "--stage", "all"], client=first, bucket="b")
    assert _manifest(first)["revs"] == {"ASB": 1, "MNST": 1, "FDX": 1}


def test_an_already_decoded_payload_hashes_the_same(tmp_path):
    s3 = _S3(_live_v1(V1, decoded=("ASB",)))
    DP.main(["--root", _root(tmp_path, V1), "--version", "2", "--stage", "all"], client=s3, bucket="b")
    assert _manifest(s3)["revs"] == {"ASB": 1, "MNST": 1, "FDX": 1}
    assert not [k for k in s3.puts if k.endswith(".json.gz")]


def test_only_missing_hashes_are_derived(tmp_path):
    objs = _live_v1(V1)
    import hashlib
    m = json.loads(objs[f"{DP.PREFIX}manifest.json"])
    m["hashes"] = {"ASB": hashlib.sha256(DP.payload_body(V1["ASB"])).hexdigest()}
    objs[f"{DP.PREFIX}manifest.json"] = json.dumps(m).encode()
    s3 = _S3(objs)
    rep = DP.main(["--root", _root(tmp_path, V1), "--version", "2", "--stage", "all", "--dry"], client=s3, bucket="b")
    assert rep["hash_derived"] == 2 and f"{DP.PREFIX}v1/ASB.json.gz" not in s3.gets and rep["new_rev"] == 0


# ── fail closed on retirement (2026-11-21) ──────────────────────────────────────────────────────────────────
def test_a_plan_that_retires_an_unnamed_symbol_is_refused(tmp_path):
    """The live dry run found a serve list 15 symbols behind the live manifest: those would retire silently."""
    s3 = _S3(_live_v1(V1))
    root = _root(tmp_path, {s: r for s, r in V1.items() if s != "MNST"})      # MNST missing from the serve list
    with pytest.raises(SystemExit):
        DP.main(["--root", root, "--version", "2", "--stage", "all"], client=s3, bucket="b")
    assert s3.puts == []
    with pytest.raises(SystemExit):                                           # naming the wrong one is no better
        DP.main(["--root", root, "--version", "2", "--stage", "all", "--allow-retire", "FDX"], client=s3, bucket="b")
    rep = DP.main(["--root", root, "--version", "2", "--stage", "all", "--dry"], client=s3, bucket="b")
    assert rep["retired_now"] == ["MNST"] and rep["retire_refused"] and s3.puts == []


def test_a_plan_whose_retirements_are_named_exactly_publishes(tmp_path):
    s3 = _S3(_live_v1(V1))
    root = _root(tmp_path, {s: r for s, r in V1.items() if s != "MNST"})
    DP.main(["--root", root, "--version", "2", "--stage", "all", "--allow-retire", "mnst"], client=s3, bucket="b")
    m = _manifest(s3)
    assert m["retired"] == ["MNST"] and m["revs"]["MNST"] == 2 and m["revs"]["ASB"] == 1
    with pytest.raises(SystemExit):                                           # naming a symbol it does NOT retire
        DP.main(["--root", _root(tmp_path / "b", V1), "--version", "3", "--stage", "all", "--allow-retire", "ASB"],
                client=_S3(_live_v1(V1)), bucket="b")


# ── republish ONE listed symbol: --expect-moved (2026-11-21) ────────────────────────────────────────────────
# A corrected series for a symbol the manifest already serves reaches cached browsers only if its served history_rev
# RISES: a new version whose per-ticker rev moves that symbol alone (U5). A same-version re-upload cannot do it (same
# epoch, and the pods never re-fetch a v<rev> file they already hold). `--expect-moved` makes "exactly these move" a
# fail-closed condition of the run itself, not a reading of the dry run: any other joined/ file that drifted from its
# published bytes would otherwise be re-epoched and published with it.
def test_expect_moved_republishes_exactly_the_named_listed_symbol(tmp_path):
    from api.services import bars_rebuild as R
    s3 = _S3(_live_v1(V1))
    root = _root(tmp_path, {**V1, "FDX": _rec("FDX", 299.8)})
    rep = DP.main(["--root", root, "--version", "2", "--stage", "all", "--expect-moved", "fdx"], client=s3, bucket="b")
    m = _manifest(s3)
    assert rep["changed"] == ["FDX"] and rep["moved_refused"] is None
    assert [k for k in s3.puts if k.endswith(".json.gz")] == [f"{DP.PREFIX}v2/FDX.json.gz"]
    revs = {k: int(v) for k, v in m["revs"].items()}
    # the served epoch (rev x EPOCH_STEP) rises for FDX alone
    assert [R._rev(s, revs, m["version"]) for s in ("ASB", "MNST", "FDX")] == [1, 1, 2]


def test_expect_moved_refuses_a_plan_that_moves_another_symbol(tmp_path):
    s3 = _S3(_live_v1(V1))
    root = _root(tmp_path, {**V1, "FDX": _rec("FDX", 299.8), "ASB": _rec("ASB", 10.5)})   # ASB drifted too
    with pytest.raises(SystemExit, match="--expect-moved"):
        DP.main(["--root", root, "--version", "2", "--stage", "all", "--expect-moved", "FDX"], client=s3, bucket="b")
    assert s3.puts == []
    rep = DP.main(["--root", root, "--version", "2", "--stage", "all", "--expect-moved", "FDX", "--dry"],
                  client=s3, bucket="b")
    assert rep["moved_refused"] and rep["changed"] == ["ASB", "FDX"] and s3.puts == []


def test_expect_moved_refuses_when_the_named_symbol_would_not_move(tmp_path):
    s3 = _S3(_live_v1(V1))
    root = _root(tmp_path, {**V1, "FDX": _rec("FDX", 299.8)})
    with pytest.raises(SystemExit, match="--expect-moved"):                                           # MNST is unchanged: nothing to republish
        DP.main(["--root", root, "--version", "2", "--stage", "all", "--expect-moved", "MNST,FDX"], client=s3, bucket="b")
    with pytest.raises(SystemExit, match="--expect-moved"):                                           # FDX's file was never replaced
        DP.main(["--root", _root(tmp_path / "b", V1), "--version", "2", "--stage", "all", "--expect-moved", "FDX"],
                client=s3, bucket="b")
    assert s3.puts == []
    rep = DP.main(["--root", root, "--version", "2", "--stage", "all", "--expect-moved", "MNST,FDX", "--dry"],
                  client=s3, bucket="b")
    assert rep["moved_refused"] and rep["changed"] == ["FDX"] and s3.puts == []


def test_expect_moved_counts_an_added_symbol_as_moving(tmp_path):
    s3 = _S3(_live_v1(V1))
    root = _root(tmp_path, {**V1, "NEW": _rec("NEW", 5.0)})
    with pytest.raises(SystemExit, match="--expect-moved"):
        DP.main(["--root", root, "--version", "2", "--stage", "all", "--expect-moved", ""], client=s3, bucket="b")
    assert s3.puts == []
    rep = DP.main(["--root", root, "--version", "2", "--stage", "all", "--expect-moved", "NEW"], client=s3, bucket="b")
    assert rep["added"] == ["NEW"] and _manifest(s3)["revs"]["NEW"] == 2


def test_the_served_history_rev_rises_for_exactly_the_named_symbols(tmp_path, monkeypatch):
    """End to end through the SERVING code: a pod syncs v1, the publisher republishes FDX alone as v2, the pod syncs
    again. bars_rebuild.history_epoch (the term bar_contract adds to history_rev) must RISE for FDX on D/W/M and stay
    put for every other symbol, and the pod must serve FDX's new bytes."""
    from api.services import bars_rebuild as R
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv(R.ENV_SERVE, "1")
    monkeypatch.setattr(R, "_state", {"version": 0, "end": None, "symbols": frozenset(), "retired": frozenset(),
                                      "revs": {}, "loaded": False})
    monkeypatch.setattr(R, "_cache", {})
    s3 = _S3(_live_v1(V1))
    assert R.sync(s3, "b")["ok"]
    keys = [(s, tf) for s in V1 for tf in ("D", "W", "M")]
    before = {k: R.history_epoch(*k) for k in keys}
    assert all(v == R.EPOCH_STEP for v in before.values())
    root = _root(tmp_path, {**V1, "FDX": _rec("FDX", 299.8)})
    DP.main(["--root", root, "--version", "2", "--stage", "all", "--expect-moved", "FDX"], client=s3, bucket="b")
    got = R.sync(s3, "b")
    assert got["ok"] and got["fetched"] == 1                              # only FDX's new file is downloaded
    after = {k: R.history_epoch(*k) for k in keys}
    assert {s for s, tf in keys if after[(s, tf)] > before[(s, tf)]} == {"FDX"}
    assert all(after[k] == before[k] for k in keys if k[0] != "FDX")
    assert R.series("FDX")[0]["c"] == 299.8 and R.series("ASB")[0]["c"] == 10.0


def test_the_dry_run_names_each_mover_with_its_revs_and_bar_diff(tmp_path, capsys):
    s3 = _S3(_live_v1(V1))
    fdx = _rec("FDX", 300.0)
    fdx["bars"][0] = ["2005-01-03", 150.0, 150.5, 149.5, 150.0, 200]       # one bar corrected (halved, volume x2)
    root = _root(tmp_path, {**V1, "FDX": fdx, "NEW": _rec("NEW", 5.0)})
    rep = DP.main(["--root", root, "--version", "2", "--stage", "all", "--expect-moved", "FDX,NEW", "--dry"],
                  client=s3, bucket="b")
    assert s3.puts == [] and rep["moved_refused"] is None
    d = rep["detail"]["FDX"]
    assert (d["old_rev"], d["new_rev"]) == (1, 2)
    assert d["bars"] == {"published": 2, "local": 2, "changed": 1, "added": 0, "removed": 0, "first": "2005-01-03",
                         "last": "2005-01-03", "max_close_change": 0.5}
    assert rep["detail"]["NEW"]["old_rev"] is None and rep["detail"]["NEW"]["bars"]["added"] == 2
    assert set(rep["detail"]) == {"FDX", "NEW"}                           # unchanged symbols are not listed
    out = capsys.readouterr().out
    assert "FDX rev 1 -> 2" in out and "NEW rev - -> 2" in out
