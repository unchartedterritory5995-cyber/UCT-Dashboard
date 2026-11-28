"""The cloud runner (tools/history_lake/cloud_daily.py) produces the SAME bucket as the PC's daily.py.

A whole run is driven against stand-ins for R2 and the vendor's flat files (an in-memory S3 that answers
ranged reads), with the real builder and the real publish functions:

  * folding new days on top of the bucket's packs gives the same packs AND the same indexes as building
    every day from scratch on one tree and publishing it (the PC's path);
  * a pack the run did not rebuild is never uploaded (only its trailer is on the runner);
  * a failed build, or a publish that does not verify, never advances the state in the bucket;
  * the lag check is loud when the lake is more than one session behind, and quiet across a holiday.

Run: python -m pytest tests/test_history_lake_cloud_daily.py -q -p no:cacheprovider
"""
import datetime as dt
import gzip
import io
import json
import random
import sys
from pathlib import Path

import pytest

from tools.history_lake import cloud_daily as CD
from tests.test_history_lake_merge import QUIET, _write_day

BLD = sys.modules["build"]        # cloud_daily's own (script-mode) modules: one BuildError, one pack format
PUB = CD.publish
PREFIX = "hist/"
#: The PC published A; the cloud folds B. 2026-12-31 lands in periods A already has (5m 2026Q4, the 2026
#: years) so a downloaded pack is really merged into; 2027-01-04 opens new ones; 1m 2026-11 is never touched.
DAYS_A = ["2026-11-27"]
DAYS_B = ["2026-12-31", "2027-01-04"]
TODAY = dt.date(2027, 1, 5)
SPLITS = [{"ticker": "AAA", "execution_date": "2026-12-15", "split_from": 1, "split_to": 2}]


class NoSuchKey(Exception):
    response = {"Error": {"Code": "NoSuchKey"}}


class PreconditionFailed(Exception):
    response = {"Error": {"Code": "PreconditionFailed"}}


class FakeS3:
    """The S3 calls cloud_daily makes, over a dict. Ranged GETs are answered like R2's."""

    class exceptions:                       # noqa: N801 - boto3's shape
        NoSuchKey = NoSuchKey

    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.puts = []
        self.etags = {}
        self.n = 0

    def _etag(self, key):
        self.n += 1
        self.etags[key] = f'"e{self.n}"'
        return self.etags[key]

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        return {"Contents": [{"Key": k, "Size": len(self.objects[k])} for k in keys]}

    def get_object(self, Bucket, Key, Range=None):
        if Key not in self.objects:
            raise NoSuchKey(Key)
        data = self.objects[Key]
        if Range:
            a, b = Range[len("bytes="):].split("-")
            data = data[int(a):int(b) + 1]
        return {"Body": io.BytesIO(data), "ETag": self.etags.get(Key, '"e0"')}

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise NoSuchKey(Key)
        return {"ContentLength": len(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, ContentType=None, IfNoneMatch=None, IfMatch=None):
        # R2's conditional writes, as the lease uses them
        if IfNoneMatch == "*" and Key in self.objects:
            raise PreconditionFailed(Key)
        if IfMatch is not None and self.etags.get(Key, '"e0"') != IfMatch:
            raise PreconditionFailed(Key)
        self.puts.append(Key)
        self.objects[Key] = bytes(Body)
        return {"ETag": self._etag(Key)}

    def download_file(self, bucket, key, path):
        if key not in self.objects:
            raise NoSuchKey(key)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(self.objects[key])

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.puts.append(key)
        self.objects[key] = Path(path).read_bytes()


def _raw(tmp_path):
    raw = tmp_path / "raw"
    rng = random.Random(123)
    for day in DAYS_A + DAYS_B:
        _write_day(raw, day, rng)
    return raw


def _vendor(raw, days):
    objs = {}
    for d in days:
        objs[f"{CD.VENDOR_PREFIX}{d[:4]}/{d}.csv.gz"] = (raw / d[:4] / f"{d}.csv.gz").read_bytes()
    return FakeS3(objs)


def _published_bucket(tmp_path, raw, days, events=b""):
    """What the PC leaves in R2 after building `days` on one tree and publishing it."""
    tree = tmp_path / "pc"
    BLD.Builder(raw, tree, quality=5, packs=True, **QUIET).run(",".join(days))
    packs = PUB.collect_packs([tree])
    idx = PUB.build_indexes(packs, log=lambda *_: None)
    PUB.stamp_indexes(idx, SPLITS, max(days))
    ev = tmp_path / "events.jsonl"
    ev.write_bytes(events)
    CD.identity.apply(idx, CD.identity.plan(CD.identity.load_records(ev), have=idx.keys()))
    objs = {}
    for (s, p), path in packs.items():
        objs[f"{PREFIX}{CD.pack.pack_relpath(s, p)}"] = path.read_bytes()
    for sym, doc in idx.items():
        objs[f"{PREFIX}{CD.piece.index_relpath(sym)}"] = PUB._json_bytes(doc)
    objs[f"{PREFIX}state/ledger.json"] = (tree / "ledger.json").read_bytes()
    seed = FakeS3()
    st = CD.lake_state.LakeState(seed, "bkt", PREFIX)
    st.put_ref("ticker_events.jsonl", events, "pc")
    st.put_ref("splits.json", json.dumps({"rows": SPLITS}).encode(), "pc")
    objs.update(seed.objects)
    return objs


def _build(raw, tree, days, jobs):
    BLD.Builder(raw, tree, quality=5, packs=True, **QUIET).run(",".join(days))
    return 0


@pytest.fixture()
def world(tmp_path, monkeypatch):
    monkeypatch.setattr(CD.daily, "REFERENCE_SYMBOL", "AAA")
    raw = _raw(tmp_path)
    r2 = FakeS3(_published_bucket(tmp_path, raw, DAYS_A))
    vend = _vendor(raw, DAYS_A + DAYS_B)
    return tmp_path, raw, r2, vend


def _run(tmp_path, r2, vend, **kw):
    kw.setdefault("builder", _build)
    kw.setdefault("holder", "cloud:test:0")
    kw.setdefault("splits_fn", lambda: SPLITS)
    return CD.run(tmp_path / "work", "bkt", PREFIX, r2=r2, vend=vend, today=TODAY, jobs=1, **kw)


def test_folding_new_days_on_the_bucket_equals_building_everything_on_the_pc(world):
    tmp_path, raw, r2, vend = world
    before = dict(r2.objects)
    assert _run(tmp_path, r2, vend) == CD.EXIT_OK
    want = _published_bucket(tmp_path / "all", raw, DAYS_A + DAYS_B)
    for key, data in want.items():
        if key.endswith(".pack") or "/v1/index/" in key:
            assert r2.objects.get(key) == data, key
    got_keys = {k for k in r2.objects if k.endswith(".pack") or "/v1/index/" in k}
    want_keys = {k for k in want if k.endswith(".pack") or "/v1/index/" in k}
    assert got_keys == want_keys
    # state advanced only after the verify: the ledger now holds every day, runner.json names them
    led = json.loads(r2.objects[f"{PREFIX}state/ledger.json"])
    assert sorted(led["days"]) == sorted(DAYS_A + DAYS_B)
    runner = json.loads(r2.objects[f"{PREFIX}state/runner.json"])
    assert runner["published_through"] == max(DAYS_B) and runner["days"] == DAYS_B
    assert before != r2.objects


def test_a_pack_the_run_did_not_rebuild_is_never_uploaded(world):
    tmp_path, raw, r2, vend = world
    assert _run(tmp_path, r2, vend) == CD.EXIT_OK
    sent = {k for k in r2.puts if k.endswith(".pack")}
    rebuilt = {f"{PREFIX}packs/{rel}" for rel in CD.daily.touched_packs(DAYS_B)}
    assert sent and sent <= rebuilt, sent - rebuilt
    untouched = {k for k in r2.objects if k.endswith(".pack")} - rebuilt
    assert untouched, "the fixture must hold packs this run does not rebuild"
    assert not (untouched & set(r2.puts))


def test_a_failed_build_publishes_nothing_and_keeps_the_state(world):
    tmp_path, raw, r2, vend = world
    before = dict(r2.objects)
    assert _run(tmp_path, r2, vend, builder=lambda *a: 1) == CD.EXIT_FAILED
    assert [k for k in r2.puts if not k.endswith("lease.json")] == [] and r2.objects == before


def test_a_publish_that_does_not_verify_never_advances_the_state(world, monkeypatch):
    tmp_path, raw, r2, vend = world
    ledger_before = r2.objects[f"{PREFIX}state/ledger.json"]
    monkeypatch.setattr(CD.daily, "reaches_day", lambda last, day: False)
    assert _run(tmp_path, r2, vend) == CD.EXIT_FAILED
    assert r2.objects[f"{PREFIX}state/ledger.json"] == ledger_before
    assert f"{PREFIX}state/runner.json" not in r2.objects


def test_nothing_new_is_only_the_lag_check(world):
    tmp_path, raw, r2, vend = world
    vend2 = _vendor(raw, DAYS_A)
    code = CD.run(tmp_path / "w", "bkt", PREFIX, r2=r2, vend=vend2, today=dt.date(2026, 11, 30),
                  builder=lambda *a: pytest.fail("built with nothing to fold"), splits_fn=lambda: SPLITS)
    assert code == CD.EXIT_OK and r2.puts == []


def test_without_a_seeded_ledger_the_run_refuses(world):
    tmp_path, raw, r2, vend = world
    del r2.objects[f"{PREFIX}state/ledger.json"]
    assert _run(tmp_path, r2, vend) == CD.EXIT_FAILED and r2.puts == []


def test_trailers_read_by_range_give_the_publish_index_entries(tmp_path):
    raw = _raw(tmp_path)
    tree = tmp_path / "t"
    BLD.Builder(raw, tree, quality=5, packs=True, **QUIET).run(",".join(DAYS_A))
    packs = PUB.collect_packs([tree])
    s3 = FakeS3({f"{PREFIX}{CD.pack.pack_relpath(s, p)}": path.read_bytes() for (s, p), path in packs.items()})
    per = [(s, p, CD.remote_trailer(s3, "b", f"{PREFIX}{CD.pack.pack_relpath(s, p)}", path.stat().st_size, s, p))
           for (s, p), path in packs.items()]
    assert CD.merge_indexes(per) == PUB.build_indexes(packs, log=lambda *_: None)
    with pytest.raises(PUB.BuildError):
        CD.parse_trailer(b"\x00" * 16, 100)
    with pytest.raises(PUB.BuildError):
        CD.trailer_entries({"v": 1, "series": "1", "period": "2026-12", "pieces": {}}, "1", "2026-11")


def test_the_lag_check_is_loud_past_one_session_and_quiet_across_a_holiday():
    v = CD.lag_verdict
    nov = ["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25"]     # Thu 11-26 is Thanksgiving: no file
    # Thanksgiving week: the lake ends Wed 11-25; Fri's file posts on Sat
    assert v("2026-11-25", nov, dt.date(2026, 11, 28))[0] == CD.EXIT_OK
    assert v("2026-11-25", nov + ["2026-11-27"], dt.date(2026, 11, 28))[0] == CD.EXIT_OK      # one behind
    assert v("2026-11-25", nov + ["2026-11-27", "2026-11-30"], dt.date(2026, 12, 1))[0] == CD.EXIT_BEHIND
    # the vendor stopped: nothing new to fold, but the calendar alone says behind
    assert v("2026-11-20", ["2026-11-20"], dt.date(2026, 11, 26))[0] == CD.EXIT_BEHIND
    assert v("2026-11-20", ["2026-11-20"], dt.date(2026, 11, 24))[0] == CD.EXIT_OK           # Mon only
    assert v(None, ["2026-11-20"], dt.date(2026, 11, 24))[0] == CD.EXIT_BEHIND
    assert CD.lag_sessions("2026-11-25", nov) == 0
    assert CD.lag_sessions("2026-11-20", nov) == 3
    assert CD.lag_sessions("2026-11-25", nov + ["2026-11-27"]) == 1, "the holiday is not a session"
    assert CD.lag_sessions("2026-11-25", []) == 0


def test_vendor_listing_and_pack_keys():
    assert CD.vendor_sizes([("us_stocks_sip/minute_aggs_v1/2026/2026-11-25.csv.gz", 5),
                            ("us_stocks_sip/minute_aggs_v1/2026/notes.txt", 1)]) == {"2026-11-25": 5}
    assert CD.pack_key_of("hist/packs/1/2026-11.pack", "hist/") == ("1", "2026-11")
    assert CD.pack_key_of("hist/packs/9/2026.pack", "hist/") is None
    assert CD.pack_key_of("hist/v1/index/s-A.json", "hist/") is None
    assert CD.years_for(dt.date(2027, 1, 5)) == [2026, 2027] and CD.years_for(dt.date(2026, 5, 1)) == [2026]


# ── the lease, the ledger-vs-live check, one source for the references (review G1, G2, G5) ──────────

def _lease_doc(r2):
    return json.loads(r2.objects[f"{PREFIX}state/lease.json"])


def test_another_writer_holding_the_lease_means_no_fold_and_no_publish(world):
    tmp_path, raw, r2, vend = world
    CD.lake_state.LakeState(r2, "bkt", PREFIX).take("pc:box:1", 3600)
    before = {k: v for k, v in r2.objects.items() if not k.endswith("lease.json")}
    built = []
    code = _run(tmp_path, r2, vend, builder=lambda *a: built.append(a) or 0)
    assert code in (CD.EXIT_OK, CD.EXIT_BEHIND)
    assert built == [], "built while another writer held the lake"
    assert {k: v for k, v in r2.objects.items() if not k.endswith("lease.json")} == before
    assert _lease_doc(r2)["holder"] == "pc:box:1", "the other writer's lease is untouched"


def test_the_run_takes_the_lease_and_releases_only_its_own(world):
    tmp_path, raw, r2, vend = world
    seen = []

    def build(raw_, tree, days, jobs):
        seen.append(_lease_doc(r2)["holder"])
        return _build(raw_, tree, days, jobs)

    assert _run(tmp_path, r2, vend, builder=build, holder="cloud:test:1") == CD.EXIT_OK
    assert seen == ["cloud:test:1"], "the build ran under this run's lease"
    assert f"{PREFIX}state/lease.json" not in r2.objects, "released at the end"


def test_an_expired_lease_is_taken_over_and_a_live_one_is_not():
    r2 = FakeS3()
    clock = {"t": 1000.0}
    a = CD.lake_state.LakeState(r2, "bkt", PREFIX, now=lambda: clock["t"])
    b = CD.lake_state.LakeState(r2, "bkt", PREFIX, now=lambda: clock["t"])
    a.take("pc", 60)
    with pytest.raises(CD.lake_state.LeaseBusy):
        b.take("cloud", 60)
    clock["t"] += 61
    b.take("cloud", 60)                                   # expired: replaced with If-Match
    assert a.release() is False, "a writer never deletes another writer's lease"
    assert _lease_doc(r2)["holder"] == "cloud"
    with pytest.raises(CD.lake_state.LeaseBusy):
        a.assert_held()


def test_a_publish_is_refused_when_the_lease_changed_hands_mid_run(world, monkeypatch):
    tmp_path, raw, r2, vend = world

    def build(raw_, tree, days, jobs):
        r2.objects[f"{PREFIX}state/lease.json"] = json.dumps({"holder": "pc:x", "expires_at": 9e12}).encode()
        return _build(raw_, tree, days, jobs)

    assert _run(tmp_path, r2, vend, builder=build) == CD.EXIT_FAILED
    assert not any(k.endswith(".pack") for k in r2.puts), "published on a lease it no longer held"


def test_a_ledger_day_the_live_index_does_not_hold_is_folded_again(world):
    tmp_path, raw, r2, vend = world
    led = json.loads(r2.objects[f"{PREFIX}state/ledger.json"])
    for d in DAYS_B:                                              # claimed (true sizes), never published
        led["days"][d] = {"size": len(vend.objects[f"{CD.VENDOR_PREFIX}{d[:4]}/{d}.csv.gz"]), "rows": 1}
    r2.objects[f"{PREFIX}state/ledger.json"] = json.dumps(led).encode()
    folded = []

    def build(raw_, tree, days, jobs):
        folded.extend(days)
        return _build(raw_, tree, days, jobs)

    assert _run(tmp_path, r2, vend, builder=build) == CD.EXIT_OK
    assert folded == DAYS_B, "without the live check the ledger's claim would fold nothing"


def test_a_reference_whose_bytes_are_not_the_manifests_is_refused(world):
    tmp_path, raw, r2, vend = world
    r2.objects[f"{PREFIX}state/ticker_events.jsonl"] = b'{"ticker": "AAA"}\n'      # not what the manifest names
    assert _run(tmp_path, r2, vend) == CD.EXIT_FAILED
    assert not any(k.endswith(".pack") or "/v1/index/" in k for k in r2.puts)


def test_the_split_table_published_is_the_one_in_r2_with_its_hash(world):
    tmp_path, raw, r2, vend = world
    fresh = SPLITS + [{"ticker": "CON", "execution_date": "2027-01-04", "split_from": 1, "split_to": 3}]
    assert _run(tmp_path, r2, vend, splits_fn=lambda: fresh) == CD.EXIT_OK
    st = CD.lake_state.LakeState(r2, "bkt", PREFIX)
    assert json.loads(st.get_ref("splits.json"))["rows"] == fresh


def test_a_failure_prints_only_the_type_and_where_never_the_message(capsys, monkeypatch):
    secret_row = "AAA,123456.000000,412.51,412.77"

    def boom(*a, **k):
        raise ValueError(secret_row)

    monkeypatch.setattr(CD, "run", boom)
    assert CD.main(["--work", "w"]) == CD.EXIT_FAILED
    out = capsys.readouterr().out
    assert "ValueError at test_history_lake_cloud_daily.py:" in out
    assert secret_row not in out and "412" not in out
