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
                "GXW_TTL_S": 600, "GXW_MAX_AGE_S": 1800,
                # dpc-v1's four, added 2026-08-06. They shipped with
                # `0f63afb7` and rode UNPINNED for the rule's whole life: the
                # VERSIONS re-arm below acknowledged the SET but never the
                # NUMBERS, so all four could be retuned silently. Measured, not
                # assumed — mutating DPC_LOOKBACK 10 -> 999 left this file
                # `5 passed, rc=0` while the same mutation of FCB_VOL_MULT
                # exits 1.
                "DPC_LOOKBACK": 10, "DPC_PROX_PCT": 0.03,
                "DPC_HOLD_MIN": 1, "DPC_FLOW_WINDOW": 5}
    for k, v in expected.items():
        got = getattr(r, k)
        assert got == v and type(got) is type(v), f"{k}: {got!r} != {v!r}"

    # TOTALITY — the half that makes this a rail rather than a list.
    #
    # Pinning by hand is why dpc drifted out of cover: the constants moved and
    # the dict did not, and nothing said so. So the gate now derives the set it
    # OUGHT to cover from the module itself. A future `DPX_*` tuning knob lands
    # unpinned exactly once, and this fails naming it.
    #
    # `VERSIONS` is asserted separately below (it is a dict, not a scalar);
    # `_SUFFIX` is private by the leading underscore. Everything else public and
    # SCREAMING_CASE is a tunable that changes output, and must be pinned.
    public = {n for n in dir(r)
              if n.isupper() and not n.startswith("_")
              and not isinstance(getattr(r, n), dict)}
    unpinned = public - set(expected)
    assert unpinned == set(), (
        f"unpinned owner-spec constant(s): {sorted(unpinned)} — add them to "
        "`expected` with the owner's value, or this gate silently stops "
        "covering them the way it stopped covering dpc")
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
