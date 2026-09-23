"""A derived value may not combine facts from incompatible restatement bases.

⚰️ MEASURED (production, 2026-09-23): CELH net_income_ttm at 2022-08-09 was
15.23M -- a sum_of_4 of the ORIGINAL Q3-2021 plus a Q4 of RESTATED FY2021 minus
ORIGINAL 9M-2021. The restatement signals named `NetIncomeLoss`; the ORIGINAL
facts came from `...AvailableToCommonStockholdersBasic`, which sat in its own
pool (a x1000 tagging error split the pools) and so never saw the epoch.

These fixtures reproduce that shape with round numbers and no network. They were
written to FAIL on the per-pool rule and pass on the family rule
(metrics.build_book: epochs from ANY tag of a primitive apply to EVERY tag).
"""
from datetime import timedelta

from api.services.fundamentals_pit import knowledge as K
from api.services.fundamentals_pit.series import GAP, build_series, value_at
from ._build import D, fact, filing

NIL, AVAIL = "NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"


def _celh_shaped():
    fl = [filing("Q121", "2021-05-13T20:00:00"), filing("Q221", "2021-08-12T20:00:00"),
          filing("Q321", "2021-11-12T20:00:00"), filing("K21", "2022-03-16T21:00:00", form="10-K"),
          filing("Q122", "2022-05-10T20:00:00"), filing("Q222", "2022-08-09T20:00:00")]
    facts = []
    for tag in (NIL, AVAIL):                               # the ORIGINAL 2021 basis, both tags
        facts += [fact(tag, "2021-01-01", "2021-03-31", 100, "Q121"),
                  fact(tag, "2021-04-01", "2021-06-30", 100, "Q221"), fact(tag, "2021-01-01", "2021-06-30", 200, "Q221"),
                  fact(tag, "2021-07-01", "2021-09-30", 100, "Q321"), fact(tag, "2021-01-01", "2021-09-30", 300, "Q321"),
                  fact(tag, "2021-01-01", "2021-12-31", 500, "K21", form="10-K")]   # FY2021 as RESTATED by the 10-K
    facts += [fact(NIL, "2022-01-01", "2022-03-31", 150, "Q122"), fact(NIL, "2021-01-01", "2021-03-31", 100, "Q122"),
              fact(AVAIL, "2022-01-01", "2022-03-31", 0.15, "Q122"),      # the x1000 tagging error that splits the pools
              fact(NIL, "2022-04-01", "2022-06-30", 160, "Q222"), fact(NIL, "2022-01-01", "2022-06-30", 310, "Q222"),
              fact(NIL, "2021-04-01", "2021-06-30", 110, "Q222"), fact(NIL, "2021-01-01", "2021-06-30", 210, "Q222")]
    kb = K.build(facts, {f.accn: f for f in fl})
    pub = {f.accn: f.public_at for f in fl}
    kb.filing_epochs = [(pub["K21"], D("2021-07-01"), D("2021-09-30"), "us-gaap:" + NIL),     # the 10-K restated Q3
                        (pub["Q222"], D("2021-01-01"), D("2021-06-30"), "us-gaap:" + NIL)]   # the 10-Q flags its comparatives
    return kb, pub


def test_a_related_tag_cannot_carry_the_pre_restatement_basis_past_the_barrier():
    kb, pub = _celh_shaped()
    pts = build_series(kb, ["net_income_ttm"])["net_income_ttm"]
    at_q222 = value_at(pts, pub["Q222"])
    # The mixed construction the per-pool rule produced: 100 (original Q3) + (500 - 300) + 150 + 160 = 610.
    assert not (at_q222.method != GAP and abs(at_q222.v - 610) < 1e-9), "mixed-basis TTM resurrected"
    # Compatibility of FY2021 (10-K) with the 10-Q's freshly restated H1-2021 is not provable at T -> GAP.
    assert at_q222.method == GAP and at_q222.period_end.isoformat() == "2022-06-30"


def test_no_point_ever_cites_an_original_fact_after_its_period_was_restated():
    """Generalised: at every instant, no emitted value may use a fact known BEFORE
    a restatement epoch (of ANY tag of the primitive) that overlaps its period."""
    from api.services.fundamentals_pit import metrics as M
    kb, pub = _celh_shaped()
    for t in sorted(pub.values()):
        book = M.build_book(kb.state_at(t), None, kb, t)
        epochs = sorted({ep for tag in ("us-gaap:" + NIL, "us-gaap:" + AVAIL)
                         for ep in kb.restatements(tag, t, None, frozenset(("us-gaap:" + NIL, "us-gaap:" + AVAIL)))})
        for e, (q, label) in book.quarters.get("net_income", {}).items():
            for (s, pe) in q.parts:
                src = book.source_tag.get((label, s, pe), label)
                known = kb.known((src, "USD", s, pe), t)
                assert known is not None
                assert not any(known.public_at < r and s <= re and rs <= pe for (r, rs, re) in epochs), \
                    f"{t}: quarter {e} uses {src} {s}..{pe} known {known.public_at} across an epoch"


def test_an_ordinary_company_with_two_agreeing_tags_is_untouched():
    """The family rule must not cost coverage where there is no restatement."""
    fl = [filing("K20", "2021-02-10T21:00:00", form="10-K"), filing("Q121", "2021-05-01T20:00:00"),
          filing("K21", "2022-02-10T21:00:00", form="10-K")]
    facts = []
    for tag in (NIL, AVAIL):
        facts += [fact(tag, "2020-01-01", "2020-12-31", 400, "K20", form="10-K"),
                  fact(tag, "2021-01-01", "2021-03-31", 120, "Q121"), fact(tag, "2020-01-01", "2020-03-31", 100, "Q121"),
                  fact(tag, "2021-01-01", "2021-12-31", 480, "K21", form="10-K")]
    kb = K.build(facts, {f.accn: f for f in fl})
    pts = build_series(kb, ["net_income_ttm"])["net_income_ttm"]
    assert [(p.method, p.v) for p in pts] == [("fiscal_year", 400), ("ytd_roll", 420), ("fiscal_year", 480)]


def test_a_restated_instant_is_stale_until_re_reported():
    """Balance-sheet values answer to the same epochs (they were exempt)."""
    from api.services.fundamentals_pit import metrics as M
    fl = [filing("Q221", "2021-08-12T20:00:00"), filing("K21", "2022-03-16T21:00:00", form="10-K"),
          filing("Q222", "2022-08-09T20:00:00")]
    facts = [fact("StockholdersEquity", None, "2021-06-30", 1000, "Q221"),
             fact("StockholdersEquity", None, "2021-12-31", 1100, "K21", form="10-K"),
             fact("StockholdersEquity", None, "2022-06-30", 1200, "Q222")]
    kb = K.build(facts, {f.accn: f for f in fl})
    kb.filing_epochs = [(fl[1].public_at, D("2021-06-30"), D("2021-06-30"), "us-gaap:StockholdersEquity")]
    book = M.build_book(kb.state_at(fl[2].public_at), None, kb, fl[2].public_at)
    assert D("2021-06-30") not in book.instants["equity"]          # original, restated by the 10-K, never re-reported
    assert book.instants["equity"][D("2021-12-31")][0] == 1100
    before = M.build_book(kb.state_at(fl[1].public_at - timedelta(seconds=1)), None, kb, fl[1].public_at - timedelta(seconds=1))
    assert before.instants["equity"][D("2021-06-30")][0] == 1000   # before the restatement it was the truth
