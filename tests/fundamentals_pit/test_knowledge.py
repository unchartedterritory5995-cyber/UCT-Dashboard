"""The point-in-time selection rule: what was KNOWN at an instant."""
from datetime import timedelta

from api.services.fundamentals_pit import knowledge as K

from ._build import D, fact, filing, utc

def key(start, end, tag="us-gaap:Revenues", unit="USD"):
    return (tag, unit, D(start), D(end))


KEY = key("2020-01-01", "2020-12-31")


def _kb(facts, filings):
    return K.build(facts, {f.accn: f for f in filings})


def test_no_value_before_effective_time_and_value_at_it():
    f1 = filing("A1", "2021-02-10T21:00:00", form="10-K")
    kb = _kb([fact("Revenues", "2020-01-01", "2020-12-31", 100, "A1")], [f1])
    assert kb.known(KEY, f1.public_at - timedelta(seconds=1)) is None
    assert kb.known(KEY, f1.public_at).fact.val == 100


def test_amendment_activates_only_at_its_own_time_and_original_stays_reconstructable():
    f1 = filing("A1", "2021-02-10T21:00:00", form="10-K")
    f2 = filing("A2", "2021-06-01T14:00:00", form="10-K/A")
    kb = _kb([fact("Revenues", "2020-01-01", "2020-12-31", 100, "A1"),
              fact("Revenues", "2020-01-01", "2020-12-31", 90, "A2")], [f1, f2])
    assert kb.known(KEY, f2.public_at - timedelta(seconds=1)).fact.val == 100   # never B early
    assert kb.known(KEY, f2.public_at).fact.val == 90
    assert [r.fact.val for r in kb.history[KEY]] == [100, 90]                 # A kept forever


def test_silence_is_not_a_retraction():
    f1 = filing("A1", "2021-02-10T21:00:00", form="10-K")
    f2 = filing("A2", "2021-05-01T21:00:00")
    kb = _kb([fact("Revenues", "2020-01-01", "2020-12-31", 100, "A1"),
              fact("Revenues", "2021-01-01", "2021-03-31", 30, "A2")], [f1, f2])
    assert kb.known(KEY, utc("2030-01-01T00:00:00")).fact.val == 100


def test_unjoined_fact_is_excluded_not_guessed():
    kb = _kb([fact("Revenues", "2020-01-01", "2020-12-31", 100, "NOPE")], [])
    assert kb.history == {} and len(kb.unjoined) == 1


def test_one_filing_two_values_for_one_key_is_withheld():
    f1 = filing("A1", "2021-02-10T21:00:00", form="10-K")
    kb = _kb([fact("Revenues", "2020-01-01", "2020-12-31", 100, "A1"),
              fact("Revenues", "2020-01-01", "2020-12-31", 101, "A1")], [f1])
    assert KEY not in kb.history and len(kb.conflicts) == 1


def test_duplicate_identical_facts_are_one_fact():
    f1 = filing("A1", "2021-02-10T21:00:00", form="10-K")
    kb = _kb([fact("Revenues", "2020-01-01", "2020-12-31", 100, "A1")] * 3, [f1])
    assert len(kb.history[KEY]) == 1


def test_sign_flip_is_quarantined_as_tagging_error():
    # PLUG FY2010 net loss read -47.0M, +47.0M, -47.0M across three 10-Qs
    fs = [filing(a, t) for a, t in (("A1", "2013-05-15T20:00:00"), ("A2", "2013-08-14T19:00:00"),
                                      ("A3", "2013-11-14T19:00:00"))]
    kb = _kb([fact("Revenues", "2020-01-01", "2020-12-31", v, a)
              for v, a in ((-47e6, "A1"), (47e6, "A2"), (-47e6, "A3"))], fs)
    assert [r.fact.val for r in kb.history[KEY]] == [-47e6, -47e6]
    assert len(kb.quarantined) == 1


def test_coarser_rounding_never_replaces_a_precise_value():
    # JPM's 2026 proxy re-tagged FY2025 net income 57,048M as 57,000M
    f1 = filing("K", "2026-02-13T21:00:00", form="10-K")
    f2 = filing("Q", "2026-05-01T21:00:00")
    kb = _kb([fact("Revenues", "2020-01-01", "2020-12-31", 57_048e6, "K"),
              fact("Revenues", "2020-01-01", "2020-12-31", 57_000e6, "Q")], [f1, f2])
    assert kb.known(KEY, utc("2030-01-01T00:00:00")).fact.val == 57_048e6


def test_proxy_statement_facts_are_not_knowledge():
    f1 = filing("P", "2026-04-06T10:17:00", form="DEF 14A")
    kb = _kb([fact("Revenues", "2020-01-01", "2020-12-31", 1, "P")], [f1])
    assert kb.history == {}


def test_values_equivalent_respects_reporting_unit():
    assert K.values_equivalent(-46_958_921, -47_000_000)
    assert not K.values_equivalent(46_958_921, 46_000_000)
    assert not K.values_equivalent(100, 101)


def test_genuine_restatement_opens_epoch_catch_up_does_not():
    # AAPL shape: original FY (T0) restated by a 10-K/A (T1); a later 10-Q (T2)
    # re-reports the ORIGINAL 9M on the new basis -> catch-up, not an epoch.
    t0 = filing("K0", "2009-10-27T20:18:29", form="10-K")
    q0 = filing("Q0", "2009-07-22T20:41:00")
    t1 = filing("KA", "2010-01-25T21:25:58", form="10-K/A")
    t2 = filing("Q2", "2010-07-21T20:37:00")
    kb = _kb([fact("Revenues", "2008-09-28", "2009-06-27", 26_667, "Q0"),
              fact("Revenues", "2008-09-28", "2009-09-26", 36_537, "K0"),
              fact("Revenues", "2008-09-28", "2009-09-26", 42_905, "KA"),
              fact("Revenues", "2008-09-28", "2009-06-27", 30_698, "Q2")], [q0, t0, t1, t2])
    ep = kb.restatements("us-gaap:Revenues", utc("2011-01-01T00:00:00"))
    assert [e[0] for e in ep] == [t1.public_at]


def test_immaterial_revision_is_applied_but_opens_no_epoch():
    # SMCI 9M FY24 operating cash flow revised by 0.24%
    q0 = filing("Q0", "2024-05-06T20:00:00")
    q1 = filing("Q1", "2025-05-12T20:00:00")
    kb = _kb([fact("Revenues", "2023-07-01", "2024-03-31", -1_844_158_000, "Q0"),
              fact("Revenues", "2023-07-01", "2024-03-31", -1_838_158_000, "Q1")], [q0, q1])
    assert kb.restatements("us-gaap:Revenues", utc("2026-01-01T00:00:00")) == []
    k9 = key("2023-07-01", "2024-03-31")
    assert kb.known(k9, utc("2026-01-01T00:00:00")).fact.val == -1_838_158_000


def test_filing_signal_epoch_makes_later_catch_up_non_epoch():
    k = filing("K", "2022-03-16T21:00:00", form="10-K")
    q0 = filing("Q0", "2021-11-12T19:57:00")
    q1 = filing("Q1", "2022-11-09T21:01:00")
    kb = _kb([fact("Revenues", "2021-01-01", "2021-09-30", 7_291_559, "Q0"),
              fact("Revenues", "2021-01-01", "2021-09-30", -8_005_000, "Q1")], [q0, k, q1])
    without = kb.restatements("us-gaap:Revenues", utc("2023-01-01T00:00:00"))
    assert [e[0] for e in without] == [q1.public_at]
    kb2 = _kb([fact("Revenues", "2021-01-01", "2021-09-30", 7_291_559, "Q0"),
               fact("Revenues", "2021-01-01", "2021-09-30", -8_005_000, "Q1")], [q0, k, q1])
    kb2.filing_epochs = [(k.public_at, D("2021-04-01"), D("2021-09-30"))]
    ep = kb2.restatements("us-gaap:Revenues", utc("2023-01-01T00:00:00"))
    assert [e[0] for e in ep] == [k.public_at]
