"""Market Cap V1 production lifecycle: release contract, private immutable publication, verification, pointer
compare-and-set, rollback, and failure atomicity (cases A-G)."""
from __future__ import annotations

import json
import os

import pytest

from api.services.marketcap import artifacts as A, publication as P, release_contract as C

from .lifecycle_fixtures import make_build, make_prices, manifest_fields, passing_validation

BA, BB = "MCAP_V1-20261002T050000Z", "MCAP_V1-20261003T050000Z"


@pytest.fixture
def env(tmp_path):
    prices = make_prices(str(tmp_path / "prices.db"))
    a = make_build(str(tmp_path / "a.db"), BA, last_day=20260930)
    b = make_build(str(tmp_path / "b.db"), BB, last_day=20261001, bump=1.5)
    return {"t": P.LocalTarget(str(tmp_path / "bucket")), "prices": prices, "a": a, "b": b, "root": str(tmp_path / "bucket")}


def publish(env, which, bid, **kw):
    db = env[which]
    return P.publish_build(env["t"], build_db=db, prices_db=env["prices"],
                           manifest_fields=manifest_fields(bid, P.file_sha(db)[0], **kw), validation=passing_validation())


def test_publish_is_verified_and_never_moves_the_pointer(env):
    r = publish(env, "a", BA, latest="2026-09-30")
    assert r["census"]["tickers"] == 4 and r["verified"]["documents"] == 4
    assert P.read_pointer(env["t"]) is None                              # publication is not authority
    m = P.read_manifest(env["t"], BA, r["manifest_sha256"])
    assert set(m["artifacts"]["documents"]) == {"AAA", "GOOG", "GOOGL", "ARM"}
    assert m["artifacts"]["db"]["key"] == C.db_key(BA)
    P.verify_build(env["t"], BA, r["manifest_sha256"], deep_db=True)


def test_documents_preserve_gaps_and_never_encode_missing_as_zero(env):
    r = publish(env, "a", BA, latest="2026-09-30")
    m = P.read_manifest(env["t"], BA, r["manifest_sha256"])
    doc = A.decode_doc(env["t"].get(C.obj_key(m["artifacts"]["documents"]["ARM"])))
    assert doc["gaps"][0]["reason"] == "TICKER_REUSE_DIFFERENT_ISSUER"
    assert all(v > 0 for _d, v in doc["points"])
    goog = A.decode_doc(env["t"].get(C.obj_key(m["artifacts"]["documents"]["GOOG"])))
    googl = A.decode_doc(env["t"].get(C.obj_key(m["artifacts"]["documents"]["GOOGL"])))
    assert goog["points"] == googl["points"]                              # company-level series (ruling 6)
    assert goog["latest"]["security_market_cap"] != googl["latest"]["security_market_cap"]


def test_check_doc_refuses_zero_and_unreasoned_gaps():
    assert A.check_doc({"points": [["2026-01-02", 0]], "gaps": []})
    assert A.check_doc({"points": [["2026-01-02", 5.0]], "gaps": [{"start": "2026-01-03", "end": "2026-01-03", "reason": None}]})
    assert A.check_doc({"points": [["2026-01-02", 5.0]], "gaps": [{"start": "2026-01-01", "end": "2026-01-05", "reason": "X"}]})
    assert not A.check_doc({"points": [["2026-01-02", 5.0]], "gaps": [{"start": "2026-01-03", "end": "2026-01-05", "reason": "X"}]})


def test_same_build_id_can_never_be_republished(env):
    publish(env, "a", BA, latest="2026-09-30")
    with pytest.raises(P.PublishError, match="already published"):
        publish(env, "a", BA, latest="2026-09-30")


def test_write_once_refuses_different_bytes(env):
    env["t"].put_new("marketcap_pit/v1/x.json", b"one")
    assert P.put_once(env["t"], "marketcap_pit/v1/x.json", b"one") == "existing"
    with pytest.raises(P.PublishError, match="different bytes"):
        P.put_once(env["t"], "marketcap_pit/v1/x.json", b"two")
    with pytest.raises(P.PublishError):
        env["t"].put_new("marketcap_pit/v1/x.json", b"two")
    assert env["t"].get("marketcap_pit/v1/x.json") == b"one"


def test_manifest_contract_rejections(env):
    r = publish(env, "a", BA, latest="2026-09-30")
    m = P.read_manifest(env["t"], BA, r["manifest_sha256"])
    for mut, msg in ((lambda x: x["validation"].update(status="FAIL"), "only PASS"),
                     (lambda x: x.pop("knowledge"), "lacks knowledge"),
                     (lambda x: x["schema"].update(document_format=99), "format"),
                     (lambda x: x["code"].update(dirty=True), "dirty"),
                     (lambda x: x["artifacts"]["documents"].update(AAA="nothex"), "malformed"),
                     (lambda x: x.update(build_id="latest"), "build id")):
        bad = json.loads(json.dumps(m))
        mut(bad)
        with pytest.raises(C.ContractError, match=msg):
            C.validate_manifest(bad)
    with pytest.raises(C.ContractError):
        C.validate_manifest(m, build_id=BB)


def test_unvalidated_build_is_never_published(env):
    with pytest.raises(P.PublishError, match="never published"):
        P.publish_build(env["t"], build_db=env["a"], prices_db=env["prices"],
                        manifest_fields=manifest_fields(BA, P.file_sha(env["a"])[0]), validation={"status": "FAIL"})
    assert not env["t"].exists(C.manifest_key(BA))


def test_manifest_must_describe_the_db_being_published(env):
    with pytest.raises(P.PublishError, match="not the DB"):
        P.publish_build(env["t"], build_db=env["a"], prices_db=env["prices"],
                        manifest_fields=manifest_fields(BA, "0" * 64), validation=passing_validation())
    assert not env["t"].exists(C.manifest_key(BA))                      # no manifest => never servable


# ── pointer: advance, compare-and-set, rollback ─────────────────────────────────────────────────────────────────────
def test_advance_cas_and_rollback(env):
    ra = publish(env, "a", BA, latest="2026-09-30")
    rb = publish(env, "b", BB)
    p1 = P.advance(env["t"], BA, ra["manifest_sha256"], expect_current=None, by="owner", reason="cutover",
                   acceptance="HUMAN_CUTOVER")
    assert p1["previous"] is None and P.read_pointer(env["t"]) == p1
    with pytest.raises(P.PublishError, match="pointer moved"):
        P.advance(env["t"], BB, rb["manifest_sha256"], expect_current=None, by="x", reason="y", acceptance="AUTOMATED_REFRESH")
    p2 = P.advance(env["t"], BB, rb["manifest_sha256"], expect_current=BA, by="refresh", reason="daily",
                   acceptance="AUTOMATED_REFRESH")
    assert p2["previous"] == {"build_id": BA, "manifest_sha256": ra["manifest_sha256"]}
    p3 = P.rollback(env["t"], BA, ra["manifest_sha256"], expect_current=BB, by="owner", reason="drill")
    assert p3["build_id"] == BA and p3["acceptance"] == "ROLLBACK"
    assert env["t"].exists(C.manifest_key(BB))                           # rollback deletes nothing


def test_pointer_names_an_exact_manifest(env):
    ra = publish(env, "a", BA, latest="2026-09-30")
    with pytest.raises(P.PublishError, match="sha mismatch"):
        P.advance(env["t"], BA, "f" * 64, expect_current=None, by="x", reason="y", acceptance="HUMAN_CUTOVER")
    assert P.read_pointer(env["t"]) is None
    assert ra


# ── failure atomicity: the authority never changes unless every step succeeded ───────────────────────────────────────
def test_F_pointer_write_failure_leaves_authority(env, monkeypatch):
    ra = publish(env, "a", BA, latest="2026-09-30")
    rb = publish(env, "b", BB)
    P.advance(env["t"], BA, ra["manifest_sha256"], expect_current=None, by="o", reason="r", acceptance="HUMAN_CUTOVER")
    monkeypatch.setattr(env["t"], "put_mutable", lambda k, b: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError):
        P.advance(env["t"], BB, rb["manifest_sha256"], expect_current=BA, by="r", reason="d", acceptance="AUTOMATED_REFRESH")
    assert P.read_pointer(env["t"])["build_id"] == BA


def test_D_upload_failure_leaves_no_manifest(env, monkeypatch):
    calls = {"n": 0}
    real = env["t"].put_new

    def flaky(key, body):
        calls["n"] += 1
        if calls["n"] == 3:
            raise OSError("network")
        return real(key, body)
    monkeypatch.setattr(env["t"], "put_new", flaky)
    with pytest.raises(OSError):
        publish(env, "a", BA, latest="2026-09-30")
    assert not env["t"].exists(C.manifest_key(BA)) and P.read_pointer(env["t"]) is None


def test_E_altered_object_fails_verification_and_blocks_advance(env):
    ra = publish(env, "a", BA, latest="2026-09-30")
    m = P.read_manifest(env["t"], BA, ra["manifest_sha256"])
    p = os.path.join(env["root"], *C.obj_key(m["artifacts"]["documents"]["AAA"]).split("/"))
    os.chmod(p, 0o644)
    with open(p, "wb") as f:
        f.write(b"tampered")
    with pytest.raises(P.PublishError, match="failed verification"):
        P.verify_build(env["t"], BA, ra["manifest_sha256"])
    with pytest.raises(P.PublishError):
        P.advance(env["t"], BA, ra["manifest_sha256"], expect_current=None, by="o", reason="r", acceptance="HUMAN_CUTOVER")
    assert P.read_pointer(env["t"]) is None


def test_E_altered_db_artifact_fails_deep_verification(env):
    ra = publish(env, "a", BA, latest="2026-09-30")
    p = os.path.join(env["root"], *C.db_key(BA).split("/"))
    with open(p, "r+b") as f:
        f.seek(30)
        f.write(b"\x00\x01\x02")
    with pytest.raises(Exception):
        P.verify_build(env["t"], BA, ra["manifest_sha256"], deep_db=True)
