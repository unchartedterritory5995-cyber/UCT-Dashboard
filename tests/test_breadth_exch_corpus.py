"""Exchange Breadth V1 — the transfer regression corpus against the REAL ledger rows of every
corpus identity (fixture extracted from venue ledger sha 72eef1c2…)."""
import json
import os

from api.services import breadth_venue_ledger as vl

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def test_every_corpus_transfer_takes_effect_on_its_session():
    corpus = json.load(open(os.path.join(FIX, "exchange_transfer_corpus.json")))
    rows = json.load(open(os.path.join(FIX, "exchange_corpus_ledger_rows.json")))
    L = vl.Ledger(rows)
    by_tick = {}
    for r in rows:
        by_tick.setdefault(r[1], set()).add(r[0])
    assert len(corpus) >= 51
    for c in corpus:
        ids = [c["identity"]] if c.get("identity") else sorted(by_tick.get(c["ticker"], ()))
        hit = False
        for ident in ids:
            spans = sorted((r[2], r[3], r[4]) for r in rows if r[0] == ident)
            after = L.status_on(ident, c["effective"])[0]
            before_rows = [s for s in spans if s[1] < c["effective"]]
            before = before_rows[-1][2] if before_rows else None
            if (before, after) == (c["before"], c["after"]):
                # the switch is EXACTLY on the effective session: the new row starts there
                assert any(s[0] == c["effective"] and s[2] == c["after"] for s in spans), (c, spans)
                hit = True
                break
        assert hit, (c, [(i, sorted((r[2], r[3], r[4]) for r in rows if r[0] == i)) for i in ids])


def test_nyse_is_never_asserted_without_a_dated_xnys_listing():
    rows = json.load(open(os.path.join(FIX, "exchange_corpus_ledger_rows.json")))
    for r in rows:
        if r[4] == vl.NYSE:
            assert r[5] == "XNYS" and r[6].startswith("dated"), r
