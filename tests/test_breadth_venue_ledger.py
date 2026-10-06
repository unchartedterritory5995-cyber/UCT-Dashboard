"""Exchange Breadth V1 — the PIT venue ledger's rules (pure; no network, no store)."""
from api.services import breadth_venue_ledger as vl


def D(*mics):
    return vl.dated_class(mics)


def test_rule_table_is_fail_closed():
    assert vl.classify(D("XNYS"), 1)[0] == vl.NYSE
    assert vl.classify(D("XNYS"), None)[0] == vl.NYSE
    assert vl.classify(D("XNAS"), 3)[0] == vl.NASDAQ
    assert vl.classify(D(), 3) == (vl.NASDAQ, "XNAS", "tape")
    # non-Nasdaq is NOT NYSE: CTA tape without a dated venue stays unresolved
    assert vl.classify(D(), 1)[0] == vl.UNRESOLVED
    assert vl.classify(D(), 2)[0] == vl.UNRESOLVED
    assert vl.classify(D(), None)[0] == vl.UNRESOLVED
    assert vl.classify(D("XASE"), 1) == (vl.OTHER, "XASE", "dated+tape")
    assert vl.classify(D("ARCX"), 2)[0] == vl.OTHER
    # the tape is primary for Nasdaq-vs-not: a lagging dated venue cannot hold a Nasdaq name
    assert vl.classify(D("XNYS"), 3)[:2] == (vl.NASDAQ, "XNAS")
    assert vl.classify(D("XASE"), 3)[:2] == (vl.NASDAQ, "XNAS")
    # ...and can veto Nasdaq, but never CREATE NYSE
    assert vl.classify(D("XNAS"), 1)[0] == vl.UNRESOLVED
    # genuine contradictions inside one source stay excluded
    assert vl.classify(D("XNYS", "XNAS"), None)[0] == vl.CONFLICT
    assert vl.classify(D("XNYS"), 9)[0] == vl.CONFLICT
    assert vl.classify(D("XWHAT"), None)[0] == vl.CONFLICT


def test_nasdaq_tiers_are_one_venue():
    for m in ("XNAS", "XNGS", "XNMS", "XNCM"):
        assert vl.classify(D(m), 3)[:2] == (vl.NASDAQ, "XNAS")


def _seg(dated, tape, sessions=None):
    sessions = sessions or ["2025-12-%02d" % d for d in (3, 4, 5, 8, 9, 10, 11)]
    return vl.segment("WMT|active", "WMT", sessions, [D(*m) for m in dated], tape)


def test_transfer_on_dated_boundary_is_exact():
    cps = _seg([("XNYS",)] * 4 + [("XNAS",)] * 3, {0: 1, 3: 1, 4: 3, 6: 3})
    assert [(c.effective_from, c.effective_to, c.status) for c in cps] == [
        ("2025-12-03", "2025-12-08", vl.NYSE), ("2025-12-09", "2025-12-11", vl.NASDAQ)]


def test_tape_flip_inside_a_lagging_dated_stretch_moves_on_the_tape_day():
    # dated list lags (still XNYS); the tape flips on 12-09 — the transfer takes effect that day
    cps = _seg([("XNYS",)] * 7, {0: 1, 3: 1, 4: 3, 6: 3})
    assert [(c.effective_from, c.status, c.source) for c in cps] == [
        ("2025-12-03", vl.NYSE, "dated+tape"), ("2025-12-09", vl.NASDAQ, "tape (dated lagging: XNYS)")]


def test_early_nasdaq_without_dated_venue_resolves_by_tape():
    cps = _seg([()] * 7, {0: 3, 6: 3})
    assert len(cps) == 1 and cps[0].status == vl.NASDAQ and cps[0].source == "tape"


def test_lookup_is_exact_by_session_and_never_defaults():
    cps = _seg([("XNYS",)] * 4 + [("XNAS",)] * 3, {0: 1, 3: 1, 4: 3, 6: 3})
    L = vl.Ledger([c.row() for c in cps])
    assert L.status_on("WMT|active", "2025-12-08")[0] == vl.NYSE
    assert L.status_on("WMT|active", "2025-12-09")[0] == vl.NASDAQ
    assert L.status_on("WMT|active", "2025-12-12")[0] == vl.UNRESOLVED     # outside evidence
    assert L.status_on("NOPE|active", "2025-12-09")[0] == vl.UNRESOLVED


def test_identity_separates_ticker_reuse():
    assert vl.identity_of("ABC", {"delisted_utc": "2009-03-02"}) != vl.identity_of("ABC", {"delisted_utc": None})


def test_hash_is_order_independent_and_content_sensitive():
    cps = _seg([("XNYS",)] * 4 + [("XNAS",)] * 3, {0: 1, 3: 1, 4: 3, 6: 3})
    rows = [c.row() for c in cps]
    assert vl.ledger_hash(rows) == vl.ledger_hash(list(reversed(rows)))
    rows[0][3] = "2025-12-05"
    assert vl.ledger_hash(rows) != vl.ledger_hash([c.row() for c in cps])


def test_the_runner_copy_is_byte_identical():
    import os
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    a = open(os.path.join(root, "api", "services", "breadth_venue_ledger.py"), "rb").read().replace(b"\r\n", b"\n")
    b = open(os.path.join(root, "tools", "breadth_exch", "breadth_venue_ledger.py"), "rb").read().replace(b"\r\n", b"\n")
    assert a == b
