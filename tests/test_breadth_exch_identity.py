"""Exchange Breadth V1 — live identity continuity: the synthetic regression matrix (CASES 1-10).

Each case is a tiny session sequence fed to `IdentityState.observe` exactly as the builder and the
live leg feed it: (ticker, reference key, CIK, composite FIGI) per member per session.
"""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "breadth_exch", "identity"))
import identity_model as im  # noqa: E402

S = [f"2026-01-{d:02d}" for d in range(1, 31)] + [f"2026-02-{d:02d}" for d in range(1, 29)]


def run(days, snap="A"):
    """days: {session_index: [(ticker, key, cik, figi), ...]} -> (state, {(ticker, i): sid})"""
    st = im.IdentityState(S)
    got = {}
    for i in sorted(days):
        for t, sid in st.observe(i, days[i], snap).items():
            got[(t, i)] = sid
    return st, got


def test_case1_learning_a_delisting_date_keeps_the_identity():
    days = {i: [("DBRG", "DBRG|active", "C1", "F1")] for i in range(0, 10)}
    st, got = run(days, "A")
    # snapshot B learns the delisting date: history re-observed (enrichment) + new sessions
    for i in range(0, 10):
        st.observe(i, [("DBRG", "DBRG|2026-01-14", "C1", "F1")], "B")
    for i in range(10, 13):
        got[("DBRG", i)] = st.observe(i, [("DBRG", "DBRG|2026-01-14", "C1", "F1")], "B")["DBRG"]
    assert len(st.sids) == 1 and {got[("DBRG", i)] for i in range(13)} == {"DBRG@2026-01-01"}
    assert st.sids["DBRG@2026-01-01"]["delisted_learned"] == {"2026-01-14": "B"}


def test_case2_exchange_transfer_keeps_the_identity():
    # venue is not an identity attribute at all: the key and ids are unchanged across the move
    days = {i: [("WMT", "WMT|active", "C", "F")] for i in range(0, 20)}
    st, got = run(days)
    assert set(got.values()) == {"WMT@2026-01-01"}


def test_case3_ticker_rename_same_security_keeps_the_identity():
    days = {i: [("FB", "FB|active", "C", "F")] for i in range(0, 5)}
    days.update({i: [("META", "META|active", "C", "F")] for i in range(5, 9)})
    st, got = run(days)
    assert got[("FB", 4)] == got[("META", 5)] == "FB@2026-01-01"
    assert st.sids["FB@2026-01-01"]["tickers"] == [["FB", 0, 4], ["META", 5, 8]]
    assert "FB" not in st.holder


def test_case4_ticker_reused_by_a_different_security_is_a_new_identity():
    # ACI: Arch Coal (no FIGI in that era) ... long gap ... Albertsons
    days = {i: [("ACI", "ACI|active", "C_ARCH", None)] for i in range(0, 5)}
    days.update({i: [("ACI", "ACI|active", "C_ALB", "F_ALB")] for i in range(20, 25)})
    st, got = run(days)
    assert got[("ACI", 4)] == "ACI@2026-01-01" and got[("ACI", 20)] == "ACI@2026-01-21"
    # and without a gap (ETF -> operating company on the same symbol, META 2022-06-09)
    days = {i: [("META", "META|active", None, "F_ETF")] for i in range(0, 5)}
    days.update({i: [("META", "META|active", "C_META", "F_META")] for i in range(5, 8)})
    st, got = run(days)
    assert got[("META", 4)] != got[("META", 5)]


def test_case5_simultaneous_share_classes_are_separate_identities():
    days = {i: [("BRK.A", "BRK.A|active", "C", "FA"), ("BRK.B", "BRK.B|active", "C", "FB")] for i in range(0, 6)}
    st, got = run(days)
    assert got[("BRK.A", 0)] != got[("BRK.B", 0)] and len(st.sids) == 2
    # a shared (wrong) FIGI on concurrently traded tickers still cannot merge them
    days = {i: [("BSAC", "BSAC|active", "C1", "FX"), ("SAN", "SAN|active", "C2", "FX")] for i in range(0, 4)}
    st, got = run(days)
    assert got[("BSAC", 3)] != got[("SAN", 3)]


def test_case6_adr_and_ordinary_listing_are_separate_identities():
    days = {i: [("TSM", "TSM|active", "C", "F_ADR"), ("TSMWF", "TSMWF|active", "C", "F_ORD")] for i in range(0, 5)}
    st, got = run(days)
    assert got[("TSM", 2)] != got[("TSMWF", 2)]


def test_case7_missing_delisting_metadata_later_enriched_keeps_identity_and_old_rows():
    days = {i: [("TBPH", "TBPH|active", "C", None)] for i in range(0, 8)}
    st, got = run(days, "A")
    for i in range(0, 8):
        st.observe(i, [("TBPH", "TBPH|2026-01-08", "C", None)], "B")
    r = st.sids["TBPH@2026-01-01"]
    assert len(st.sids) == 1 and {k[0] for k in r["keys"]} == {"TBPH|active", "TBPH|2026-01-08"}
    assert im.ledger_key(st, "TBPH@2026-01-01", 3, "A") == "TBPH|active"


def test_case8_snapshot_dropping_a_security_keeps_its_continuity_record():
    days = {i: [("DOMO", "DOMO|active", "C", "F"), ("X", "X|active", "CX", "FX")] for i in range(0, 5)}
    days.update({i: [("X", "X|active", "CX", "FX")] for i in range(5, 9)})   # DOMO no longer a member
    st, got = run(days)
    assert "DOMO@2026-01-01" in st.sids and st.sid_at("DOMO", 4) == "DOMO@2026-01-01"
    assert st.sid_at("DOMO", 6) is None


@pytest.mark.parametrize("same_figi", [True, False])
def test_case9_disappear_then_relist_is_defined(same_figi):
    # the old record ENDED (a learned delisting date) and the symbol comes back on a new record
    days = {i: [("IPW", "IPW|2026-01-05", "C1", "F1")] for i in range(0, 5)}
    days[6] = [("IPW", "IPW|active", "C1" if same_figi else "C2", "F1" if same_figi else "F2")]
    st, got = run(days)
    if same_figi:
        assert got[("IPW", 6)] == got[("IPW", 4)]          # true relisting of the same security
    else:
        assert got[("IPW", 6)] != got[("IPW", 4)]          # a different security on the old symbol
        assert st.sids[got[("IPW", 6)]]["evidence"][0][1] in ("S2_ENDED", "S3_SWAP")
    # a long absence with NO durable evidence is never silently continued
    days = {i: [("ZZZ", "ZZZ|active", None, None)] for i in range(0, 3)}
    days[20] = [("ZZZ", "ZZZ|active", None, None)]
    st, got = run(days)
    assert got[("ZZZ", 20)] != got[("ZZZ", 2)]


def test_case10_a_later_snapshot_cannot_alter_accepted_earlier_assignment():
    days = {i: [("AIXC", "AIXC|active", "C", "F"), ("KW", "KW|2026-01-10", "CK", "FK")] for i in range(0, 10)}
    days.update({i: [("AIXC", "AIXC|active", "C", "F"), ("KW", "KW|2026-01-20", "CK", "FK")] for i in range(10, 15)})
    st, got = run(days, "A")
    before = {k: st.sid_at(k[0], k[1]) for k in got}
    h0 = im.doc_hash({k: v for k, v in st.to_doc()["ticker_index"].items()})
    for i in range(0, 15):   # snapshot B re-keys everything
        st.observe(i, [("AIXC", "AIXC|2026-01-29", "C", "F"), ("KW", "KW|2026-01-29", "CK", "FK")], "B")
    assert {k: st.sid_at(k[0], k[1]) for k in got} == before
    assert im.doc_hash({k: v for k, v in st.to_doc()["ticker_index"].items()}) == h0
    assert got[("KW", 9)] == got[("KW", 10)]                  # two reference records, one security
    with pytest.raises(ValueError):                           # enrichment cannot invent a member
        st.observe(3, [("NEWCO", "NEWCO|active", "C9", "F9")], "B")


def test_reobserving_with_the_same_snapshot_is_idempotent():
    days = {i: [("A", "A|active", "C", "F"), ("B", "B|active", "C2", "F2")] for i in range(0, 6)}
    st, _ = run(days, "A")
    h = im.doc_hash(st.to_doc())
    for i in range(0, 6):
        st.observe(i, days[i], "A")
    assert im.doc_hash(st.to_doc()) == h


def test_one_day_provider_glitch_returns_to_the_original_identity():
    # 2019-09-24-style day: composite FIGI and CIK both flip for one session, then return
    days = {i: [("AAWW", "AAWW|active", "C1", "F1")] for i in range(0, 6)}
    days[6] = [("AAWW", "AAWW|active", "C2", "F2")]
    days.update({i: [("AAWW", "AAWW|active", "C1", "F1")] for i in range(7, 10)})
    st, got = run(days)
    assert got[("AAWW", 9)] == got[("AAWW", 5)] == "AAWW@2026-01-01"


def test_bridge_uses_accepted_rows_never_the_snapshot_key():
    # history: DBRG on NYSE under its ledger key; a later snapshot calls it DBRG|2026-01-14
    days = {i: [("DBRG", "DBRG|active", "C", "F")] for i in (0, 1, 2, 5, 6)}      # 3,4 = no print
    st, _ = run(days, "LEDGER")
    for i in days:
        st.observe(i, [("DBRG", "DBRG|2026-01-14", "C", "F")], "B")
    doc = st.to_doc()
    rows = [["DBRG|active", "DBRG", S[0], S[6], "NYSE", "XNYS", "dated+tape", []]]
    br = im.Bridge(doc, rows)
    assert br.status("DBRG", S[1]) == ("DBRG@2026-01-01", "DBRG|active", "NYSE")
    assert br.status("DBRG", S[3])[2] == "NYSE"          # a gap day inside the accepted row span
    assert br.status("DBRG", S[9])[2] == "UNRESOLVED"    # known security, no evidence covers it
    assert br.status("NOPE", S[1])[2] == "absent"
    # two of the SID's keys covering the same session is a conflict, never a guess
    rows2 = rows + [["DBRG|2026-01-14", "DBRG", S[6], S[6], "NASDAQ", "XNAS", "tape", []]]
    doc["sids"]["DBRG@2026-01-01"]["keys"].append(["DBRG|2026-01-14", S[6], S[6], "LEDGER"])
    assert im.Bridge(doc, rows2).status("DBRG", S[6])[2] == "CONFLICT"


def test_bridge_reads_only_this_tickers_rows_after_a_rename_whose_symbol_was_reused():
    # Ingersoll-Rand IR -> Trane TT on day 3; a NEW company takes IR on day 4 (the reference merges both
    # IRs into one IR|active key, whose rows keep covering the new IR)
    days = {i: [("IR", "IR|active", "C1", "F1")] for i in range(0, 3)}
    days.update({i: [("TT", "TT|active", "C1", "F1")] + ([("IR", "IR|active", "C2", "F2")] if i >= 4 else [])
                 for i in range(3, 8)})
    st, got = run(days, "LEDGER")
    assert got[("TT", 3)] == got[("IR", 2)] != got[("IR", 4)]
    rows = [["IR|active", "IR", S[0], S[7], "NYSE", "XNYS", "dated+tape", []],
            ["TT|active", "TT", S[3], S[7], "NYSE", "XNYS", "dated+tape", []]]
    br = im.Bridge(st.to_doc(), rows)
    assert br.status("TT", S[5]) == (got[("TT", 3)], "TT|active", "NYSE")      # not CONFLICT
    assert br.status("IR", S[5])[1:] == ("IR|active", "NYSE")


def test_from_doc_round_trips_and_resumes_exactly_like_an_uninterrupted_replay():
    # a mixed history: enrichment, rename, reuse after a gap, a glitch day, share classes
    days = {}
    for i in range(0, 40):
        m = [("BRK.A", "BRK.A|active", "C", "FA"), ("BRK.B", "BRK.B|active", "C", "FB")]
        m.append(("FB", "FB|active", "CM", "FM") if i < 15 else ("META", "META|active", "CM", "FM"))
        if i < 8:
            m.append(("ACI", "ACI|active", "C_ARCH", None))
        if i >= 25:
            m.append(("ACI", "ACI|active", "C_ALB", "F_ALB"))
        m.append(("AAWW", "AAWW|active", "C2" if i == 20 else "C1", "F2" if i == 20 else "F1"))
        days[i] = m
    full = im.IdentityState(S)
    for i in range(40):
        full.observe(i, days[i], "LEDGER")
    part = im.IdentityState(S)
    for i in range(30):
        part.observe(i, days[i], "LEDGER")
    doc30 = part.to_doc()
    resumed = im.IdentityState.from_doc(doc30, S)
    assert im.doc_hash(resumed.to_doc()) == im.doc_hash(doc30)               # exact round trip
    for i in range(30, 40):
        resumed.observe(i, days[i], "LEDGER")
    assert im.doc_hash(resumed.to_doc()) == im.doc_hash(full.to_doc())       # resume == uninterrupted
