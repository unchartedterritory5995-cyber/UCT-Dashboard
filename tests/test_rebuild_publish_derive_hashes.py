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
