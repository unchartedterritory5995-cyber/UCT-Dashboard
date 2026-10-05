"""Exchange Breadth V1 — live identity continuity on REAL evidence (the 10-02 re-key set + reuse cases).

`tests/fixtures/exchange_identity_regression.json` holds, for 52 tickers, the exact observations the
state builder fed the model (ticker, accepted-ledger key, the 10-02 snapshot's key, CIK, composite FIGI per
population member-session) and the SID ownership the full 2008-2026 build produced. Replaying them
offline must reproduce that ownership, survive the 10-02 re-key, and keep true reuse apart.
"""
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "breadth_exch", "identity"))
import identity_model as im  # noqa: E402

FX = json.load(open(os.path.join(ROOT, "tests", "fixtures", "exchange_identity_regression.json")))
S = FX["sessions"]
IEND = max(i for i, d in enumerate(S) if d <= FX["frozen_end"])

ENRICHED = ["AIXC", "AMZE", "DBRG", "DOMO", "FGNX", "GBTG", "GETY", "HVII", "IPEX", "RILYN", "SBXD", "TBPH", "VRME"]
RENAMES = {"FFR": "AIXC", "HUCK": "DOMO", "OPNW": "VRME", "FGC": "FGNX"}          # successor: predecessor
NEW = ["ACCV", "ADRX", "CHWM", "FJDI", "GOW", "IVAI", "ONEN", "PNAQ", "RZAI", "VYLR"]


def by_session(keyfield):
    days = {}
    for t, runs in FX["observations"].items():
        for i0, i1, ident, kb, cik, figi in runs:
            k = ident if keyfield == "ledger" else kb
            for i in range(i0, i1 + 1):
                if k:
                    days.setdefault(i, []).append((t, k, cik, figi))
    return days


@pytest.fixture(scope="module")
def state():
    st = im.IdentityState(S)
    led = by_session("ledger")
    for i in sorted(d for d in led if d <= IEND):
        st.observe(i, led[i], "LEDGER")
    before = {(t, i): st.sid_at(t, i) for i in led if i <= IEND for t, *_ in led[i]}
    b3 = by_session("b3")
    for i in sorted(d for d in b3 if d <= IEND):           # the 10-02 snapshot re-keys history
        st.observe(i, b3[i], "B3_1002")
    for i in sorted(d for d in led if d > IEND):            # then the post-freeze sessions append
        st.observe(i, led[i], "LEDGER")
    st._before = before
    st._led = led
    return st


def owners(st, t):
    return {st.sid_at(t, i) for i in st._led for tt, *_ in st._led[i] if tt == t}


def test_replay_reproduces_the_full_build_ownership(state):
    for t, runs in FX["expected_owner_runs"].items():
        for a, b, sid in runs:
            for i, d in enumerate(S):
                if a <= d <= b and any(tt == t for tt, *_ in state._led.get(i, ())):
                    assert state.sid_at(t, i) == sid, (t, d)


def test_the_10_02_rekey_reassigns_no_historical_session(state):
    assert all(state.sid_at(t, i) == sid for (t, i), sid in state._before.items())


@pytest.mark.parametrize("t", ENRICHED)
def test_enriched_security_keeps_one_identity_across_both_keys(state, t):
    own = owners(state, t)
    sids = {s for s in own}
    # GBTG's first listed day carried a different FIGI (a one-day provider record) — the enrichment
    # boundary itself (active -> 2026-09-30) never splits it
    if t == "GBTG":
        sids = {s for s in sids if s != "GBTG@2022-05-31"}
    assert len(sids) == 1
    keys = {k[0] for k in state.sids[next(iter(sids))]["keys"]}
    assert f"{t}|active" in keys and any(k != f"{t}|active" and k.startswith(f"{t}|") for k in keys)


@pytest.mark.parametrize("succ,pred", sorted(RENAMES.items()))
def test_rename_successor_continues_the_predecessor(state, succ, pred):
    last_pred = max(i for i in state._led if any(tt == pred for tt, *_ in state._led[i]))
    first_succ = min(i for i in state._led if any(tt == succ for tt, *_ in state._led[i]))
    assert state.sid_at(succ, first_succ) == state.sid_at(pred, last_pred)


@pytest.mark.parametrize("t", NEW)
def test_new_listing_is_a_new_identity(state, t):
    own = owners(state, t)
    assert len(own) == 1 and next(iter(own)).startswith(f"{t}@2026-")


def test_aci_arch_coal_and_albertsons_are_different_securities(state):
    assert state.sid_at("ACI", S.index("2016-01-11")) == "ACI@2008-01-02"
    assert state.sid_at("ACI", S.index("2020-06-26")) == "ACI@2020-06-26"


def test_other_reuse_and_lineage_cases(state):
    sid = lambda t, d: state.sid_at(t, S.index(d))
    assert sid("META", "2022-01-28") != sid("META", "2022-06-09")            # ETF -> Meta Platforms
    assert sid("AA", "2016-10-31") != sid("AA", "2016-11-01")                # Alcoa spin-off on the symbol
    assert sid("BBT", "2019-12-06") != sid("BBT", "2025-09-02")              # BB&T vs Beacon (ex-BHLB)
    assert sid("BBT", "2025-09-02") == sid("BHLB", "2025-08-29")             # BHLB -> BBT rename
    assert sid("ABX", "2018-12-31") == sid("GOLD", "2019-01-02") == sid("B", "2025-05-09")   # Barrick
    assert sid("B", "2019-09-23") != sid("B", "2025-05-09")                  # Barnes Group vs Barrick
    assert sid("KW", "2023-10-02") == sid("KW", "2023-10-03")                # two records, one security
    assert sid("IPW", "2017-07-24") != sid("IPW", "2021-05-12") == sid("IPW", "2021-10-04")
    assert sid("BRK.A", "2026-10-01") != sid("BRK.B", "2026-10-01")
    assert sid("ONEN", "2026-09-25") != sid("HVII", "2026-09-23")            # de-SPAC: new FIGI -> new
