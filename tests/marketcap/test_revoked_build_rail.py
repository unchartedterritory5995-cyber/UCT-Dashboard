"""The REVOKED-build rail: the rejected first M3 build (and any build listed in release_contract.REVOKED_BUILDS) can never
be published, advanced to, rolled back to, pinned, or served -- by build id or by DB bytes under another id."""
from __future__ import annotations

import os

import pytest

from api.services.marketcap import pit_serving as S, publication as P, release_contract as C

from .lifecycle_fixtures import make_build, make_prices, manifest_fields, passing_validation

GOOD, BAD, REWRAP = "MCAP_V1-20261002T050000Z", "MCAP_V1-20261003T050000Z", "MCAP_V1-20261004T050000Z"
REJECTED_M3 = "C:/mcapid/runs/run-20261005-m3/data/builds/MCAP_V1-20261005T205248Z.db"


@pytest.fixture
def env(tmp_path, monkeypatch):
    t = P.LocalTarget(str(tmp_path / "bucket"))
    prices = make_prices(str(tmp_path / "prices.db"))
    good = make_build(str(tmp_path / "good.db"), GOOD, last_day=20260930)
    bad = make_build(str(tmp_path / "bad.db"), BAD, last_day=20261001, bump=1.5)
    return {"t": t, "prices": prices, "good": good, "bad": bad, "root": str(tmp_path / "bucket"), "mp": monkeypatch}


def pub(env, db, bid):
    return P.publish_build(env["t"], build_db=db, prices_db=env["prices"],
                           manifest_fields=manifest_fields(bid, P.file_sha(db)[0]), validation=passing_validation())


def revoke(env, bid, db):
    env["mp"].setitem(C.REVOKED_BUILDS, bid, {"db_sha256": P.file_sha(db)[0], "reason": "test"})
    env["mp"].setitem(C.REVOKED_DB_SHA, P.file_sha(db)[0], bid)


def test_the_rejected_first_m3_build_is_revoked_in_code():
    e = C.REVOKED_BUILDS["MCAP_V1-20261005T205248Z"]
    assert e["db_sha256"].startswith("fae1dbb5701d28cd")
    assert "MCAP_V1-20261005T234206Z" not in C.REVOKED_BUILDS          # the accepted M3 is not
    with pytest.raises(C.ContractError, match="REVOKED"):
        C.assert_not_revoked("MCAP_V1-20261005T205248Z")
    with pytest.raises(C.ContractError, match="REVOKED"):
        C.assert_not_revoked(None, e["db_sha256"])
    if os.path.exists(REJECTED_M3):                                     # the entry names the real file's bytes
        assert P.file_sha(REJECTED_M3)[0] == e["db_sha256"]


def test_revoked_build_is_never_published_by_id_or_by_bytes(env):
    revoke(env, BAD, env["bad"])
    with pytest.raises(C.ContractError, match="REVOKED"):
        pub(env, env["bad"], BAD)
    with pytest.raises(C.ContractError, match="REVOKED"):           # the same DB re-wrapped under a fresh build id
        pub(env, env["bad"], REWRAP)
    assert not env["t"].exists(C.manifest_key(BAD)) and not env["t"].exists(C.manifest_key(REWRAP))


def test_a_build_revoked_after_publication_can_never_be_pointed_at(env):
    g = pub(env, env["good"], GOOD)["manifest_sha256"]
    b = pub(env, env["bad"], BAD)["manifest_sha256"]
    revoke(env, BAD, env["bad"])
    with pytest.raises(C.ContractError, match="REVOKED"):
        P.advance(env["t"], BAD, b, expect_current=None, by="owner", reason="x", acceptance="HUMAN_CUTOVER")
    P.advance(env["t"], GOOD, g, expect_current=None, by="owner", reason="cutover", acceptance="HUMAN_CUTOVER")
    with pytest.raises(C.ContractError, match="REVOKED"):
        P.rollback(env["t"], BAD, b, expect_current=GOOD, by="owner", reason="x")
    assert P.read_pointer(env["t"])["build_id"] == GOOD


def test_reader_refuses_a_revoked_pointer_pin_and_drops_it_from_its_cache(env):
    mp = env["mp"]
    b = pub(env, env["bad"], BAD)["manifest_sha256"]
    P.advance(env["t"], BAD, b, expect_current=None, by="owner", reason="before revocation", acceptance="HUMAN_CUTOVER")
    mp.setenv("MCAP_PIT_SOURCE", "local")
    mp.setenv("MCAP_PIT_LOCAL_ROOT", env["root"])
    mp.delenv("MCAP_PIT_PIN", raising=False)
    mp.setattr(S, "CONTROL_TTL", 0.0)
    S.clear_cache()
    try:
        assert S.bound()["build_id"] == BAD                          # served before the rail names it
        revoke(env, BAD, env["bad"])
        with pytest.raises(S.Unavailable):                           # ... and never again, not even as "last verified"
            S.bound(force=True)
        mp.setenv("MCAP_PIT_PIN", f"{BAD}:{b}")
        S.clear_cache()
        with pytest.raises(S.Unavailable):
            S.bound(force=True)
    finally:
        S.clear_cache()
