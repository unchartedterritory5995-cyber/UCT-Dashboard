import pytest

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


# ── Phase C Task 13: the genericization may not touch what the ledger STORES ──

def test_the_ledger_key_vocabulary_is_UNCHANGED_by_genericization():
    """🔴 THE ONE THING THIS TASK MAY NOT DO.

    Ten rows of real history are keyed `(indicator='fcb', version='fcb-v2',
    tf='1D', …)`. `ledger.py` is INSERT-only — there is no rewrite path, so a
    re-key orphans history that cannot be reconstructed. The definition may be
    called `uct-flow-breakout` on the chart; what it WRITES stays 'fcb'/'1D'.
    """
    from api.services.signature.registry_defs import (
        LEDGER_INDICATOR_FOR, LEDGER_TF_FOR)
    assert LEDGER_INDICATOR_FOR["uct-flow-breakout"] == "fcb"
    assert LEDGER_TF_FOR["1D"] == "1D"


def test_every_signature_definition_maps_to_the_ledger_key_it_ALREADY_WROTE():
    """The whole vocabulary, not just the one the brief names.

    `VERSIONS` is keyed by the LEDGER indicator ('dpl'/'fcb'/'gxw'/'dpc'), and
    the ledger's uniqueness key includes it. A definition whose `rules_key` did
    not resolve there would look up `None` and write a NULL version — a row that
    joins to nothing and can never be attributed to a rule.
    """
    from api.services.signature import registry_defs as rd
    from api.services.signature.rules import VERSIONS
    assert set(rd.LEDGER_INDICATOR_FOR) == set(rd.SIGNATURE_DEF_IDS)
    for def_id in rd.SIGNATURE_DEF_IDS:
        key = rd.ledger_indicator(def_id)
        assert key in VERSIONS, f"{def_id} -> {key!r} is not a versioned rule"
        assert rd.definition(def_id)["rules_key"] == key


def test_rs_line_writes_NOTHING_to_the_ledger_and_that_is_a_different_answer():
    """None is "writes nothing"; an unknown id RAISES. Two different questions.

    `rsLine` shares the server lane with the three Signature rules and shares
    nothing else: it is a chart indicator, not a recorded signal. Collapsing the
    two answers would make "I forgot to add a row" indistinguishable from "this
    one deliberately has none".
    """
    from api.services.signature import registry_defs as rd
    assert rd.ledger_indicator("rsLine") is None
    with pytest.raises(rd.DefinitionNotOffered):
        rd.ledger_indicator("no-such-definition")


def test_the_bars_store_key_and_the_ledger_label_are_DIFFERENT_maps():
    """"D" is what `bars_sqlite` stores daily rows under; "1D" is the PRODUCT
    label the ledger row carries. `_fetch_bars`' docstring is the cautionary
    tale — passing the product label to the store matches no rows at all and the
    indicator ships permanently, silently dead. Two maps, and neither is the
    other's inverse."""
    from api.services.signature import registry_defs as rd
    assert rd.store_tf("1D") == "D" and rd.store_tf("D") == "D"
    assert rd.ledger_tf("D") == "1D" and rd.ledger_tf("1D") == "1D"
    assert rd.store_tf("5") == "5"
    # An unknown timeframe falls back to daily for the STORE (a real key), and
    # is returned VERBATIM for the ledger — guessing a ledger tf would put a
    # second, weaker opinion in front of `record_signal`'s own refusal.
    assert rd.store_tf("nonsense") == "D"
    assert rd.ledger_tf("nonsense") == "nonsense"


# ─────────────────────────────────────────────────────────────────────────────
# PHASE D TASK 8 — ONE WIRE CONTRACT, TWO CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────


def _js_schema_version() -> int:
    """`defSchema.SCHEMA_VERSION`, READ OUT OF THE JS SOURCE.

    ⛔ READ, NEVER RE-TYPED. A Python copy of the number is a second authority
    over the same wire contract wearing a test's name: it would agree with
    itself forever and stop agreeing with the client the moment somebody bumped
    the JS constant, which is exactly the failure this test exists to catch.

    ⚠️ CRLF-TOLERANT AND ANCHORED TO A DECLARATION, not to a line number.
    `core.autocrlf` is on in this checkout.
    """
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    src = (root / "app/src/components/chart/engine/defSchema.js").read_text(
        encoding="utf-8").replace("\r\n", "\n")
    # Strip line comments so a number quoted in prose can never be read as the
    # declaration. (The grep-counts-prose trap has fired on this branch twice.)
    code = re.sub(r"(?m)^\s*//.*$", "", src)
    code = re.sub(r"/\*.*?\*/", "", code, flags=re.S)
    hits = re.findall(r"export\s+const\s+SCHEMA_VERSION\s*=\s*(\d+)", code)
    assert len(hits) == 1, (
        "defSchema.js declares SCHEMA_VERSION %d times, expected exactly 1 — the "
        "reader below cannot say which one the client validates against." % len(hits))
    return int(hits[0])


def test_the_server_lane_publishes_the_SAME_schema_version_the_client_validates():
    """⚠️ TWO SCHEMA-VERSION CONSTANTS EXIST and they can disagree.

    `defSchema.SCHEMA_VERSION` is what the client validates against;
    `api/services/signature/registry_defs.SCHEMA_VERSION` is what
    `/api/signature/definitions` PUBLISHES. Two authorities over one wire
    contract is how a client silently refuses every definition after a bump
    nobody propagated — and the failure mode is the worst shape there is: the
    server keeps serving, the client keeps starting, and every server-lane
    indicator simply stops existing with no error anywhere.

    Read the JS constant from source rather than re-typing it.
    """
    from api.services.signature import registry_defs

    js = _js_schema_version()
    assert registry_defs.SCHEMA_VERSION == js, (
        "the server lane publishes schemaVersion %r and the client validates against %r. "
        "A definition whose schemaVersion is not EXACTLY the client's is refused by "
        "`validateDefinition` with 'this client cannot safely interpret another schema "
        "major' — so a one-sided bump takes the whole server lane off every chart, "
        "silently. Move both, in one commit."
        % (registry_defs.SCHEMA_VERSION, js))

    # ⛔ AND THE READER IS NOT VACUOUS. A regex that matched nothing would make
    # `js` meaningless; a regex that matched a comment would make it wrong. This
    # is the positive control: the number really came out of the file.
    assert js >= 1
    assert all(
        d["schemaVersion"] == js for d in registry_defs.SERVER_DEFS), (
        "a published definition carries a schemaVersion other than the module's own "
        "constant — the two-authority problem, one level further in.")
