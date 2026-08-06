from api.services.signature.rules import parse_money, VERSIONS


def test_parse_money_plain_and_suffixed():
    assert parse_money("1500000") == 1_500_000.0
    assert parse_money("$1.5M") == 1_500_000.0
    assert parse_money("250K") == 250_000.0
    assert parse_money("1,500,000") == 1_500_000.0


def test_parse_money_garbage_is_zero():
    assert parse_money(None) == 0.0
    assert parse_money("") == 0.0
    assert parse_money("N/A") == 0.0


def test_versions_are_pinned_strings():
    assert VERSIONS["fcb"] == "fcb-v2"


def test_parse_money_non_finite_is_zero():
    assert parse_money("nan") == 0.0
    assert parse_money("inf") == 0.0
    assert parse_money(float("nan")) == 0.0
    assert parse_money(10**400) == 0.0


def test_all_constants_match_owner_spec():
    """The constants rail. FCB_VOL_MULT is 1.5 and the fcb version is v2 as of
    the owner's 2026-08-01 pre-launch tightening (was 1.25 / fcb-v1); the two
    move TOGETHER because the multiple changes output and the ledger's
    uniqueness key includes the version."""
    import api.services.signature.rules as r
    expected = {"DPL_WINDOW_DAYS": 20, "DPL_BIN_PCT": 0.0025,
                "DPL_MIN_CLUSTER_NOTIONAL": 10_000_000.0, "DPL_TOP_K": 5,
                "FCB_LOOKBACK": 20, "FCB_VOL_MULT": 1.5,
                "FCB_MIN_CALL_PREM": 500_000.0, "FCB_DOMINANCE": 1.75,
                "GXW_DTE": "week", "GXW_MAX_DIST_PCT": 0.15,
                "GXW_TTL_S": 600, "GXW_MAX_AGE_S": 1800}
    for k, v in expected.items():
        got = getattr(r, k)
        assert got == v and type(got) is type(v), f"{k}: {got!r} != {v!r}"
    # `dpc-v1` added by 0f63afb7 ("dark-pool reclaim confluence — prototype
    # endpoints") and NOT reflected here, so this owner-spec gate has been RED
    # on master ever since — meaning it could no longer flag the NEXT drift.
    # Acknowledged rather than deleted: `dpc` is not leftover prototype code.
    # Unlike dpl/fcb/gxw it owns no route of its own; it is the engine behind
    # the live `/confluence` and `/confluence-scan` endpoints
    # (api/routers/signature.py:503-535), so it is a shipped rule and belongs
    # in the sanctioned set. Adding it re-arms the tripwire.
    assert r.VERSIONS == {"dpl": "dpl-v1", "fcb": "fcb-v2", "gxw": "gxw-v1",
                          "dpc": "dpc-v1"}
