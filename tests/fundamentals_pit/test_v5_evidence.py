"""V5: restatement evidence is the filing's OWN instance -- exact spans, consolidated
only -- and full and incremental derivation consume it through ONE seam.

MEASURED 2026-09-25 (121-filing parity corpus, 71 disagreeing filings, 546 signal
differences): 372 were FS-data-set span artifacts (start reconstructed 1-3 days early,
end rounded to month-end), component disclosures sat on standard breakdown axes, and
genuine quarterly restatements live in NOTES (so placement is not a filter).
CELH 2022-05-10 is the golden: Q1-2021 was never restated (585,424 -> 585,000 on
re-report), the 10-K restated Q2 and Q3 only, so TTM at Q1-2022 IS knowable."""
from datetime import timedelta

import pytest

from api.services.fundamentals_pit import incremental as INC, knowledge as K, restatement_signals as R
from api.services.fundamentals_pit.series import GAP, build_series, value_at
from ._build import D, fact, filing

NIL = "NetIncomeLoss"


def _ctx(cid, start, end, dims=()):
    mem = "".join(f'<xbrldi:explicitMember dimension="{d}">{m}</xbrldi:explicitMember>' for d, m in dims)
    seg = f"<xbrli:segment>{mem}</xbrli:segment>" if dims else ""
    return (f'<xbrli:context id="{cid}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>{seg}'
            f"</xbrli:entity><xbrli:period><xbrli:startDate>{start}</xbrli:startDate><xbrli:endDate>{end}</xbrli:endDate>"
            f"</xbrli:period></xbrli:context>")


def _instance(*parts):
    return "<xbrli:xbrl>" + "".join(parts) + "</xbrli:xbrl>"


RESTATE = ("srt:RestatementAxis", "srt:ScenarioPreviouslyReportedMember")


def test_spans_are_the_contexts_exact_dates_never_reconstructed():
    xml = _instance(_ctx("p", "2021-04-01", "2021-06-30"), _ctx("r", "2021-04-01", "2021-06-30", [RESTATE]),
                    '<us-gaap:NetIncomeLoss contextRef="p" unitRef="usd">780000</us-gaap:NetIncomeLoss>',
                    '<us-gaap:NetIncomeLoss contextRef="r" unitRef="usd">3960344</us-gaap:NetIncomeLoss>')
    assert R.instance_signals("A", xml) == [("A", "us-gaap:NetIncomeLoss", "2021-04-01", "2021-06-30", R.KIND)]


def test_celh_real_structure_a_second_standard_axis_is_kept_as_an_adjustment():
    """CELH's FY2021 10-K, AS FILED: srt:RestatementAxis together with the STANDARD
    srt:CumulativeEffectPeriodOfAdoptionAxis carrying CELH's own members. A 'drop every
    context with another standard axis' rule threw this genuine restatement away
    (2026-09-25) -- this fixture is the real shape, not an invented extension axis."""
    basis = ("srt:CumulativeEffectPeriodOfAdoptionAxis", "celh:EffectsOfTheAdjustmentsOnAStandaloneQuarterBasisMember")
    xml = _instance(
        _ctx("adj2", "2021-04-01", "2021-06-30", [basis, ("srt:RestatementAxis", "srt:RestatementAdjustmentMember")]),
        _ctx("prev2", "2021-04-01", "2021-06-30", [basis, ("srt:RestatementAxis", "srt:ScenarioPreviouslyReportedMember")]),
        _ctx("adj3", "2021-07-01", "2021-09-30", [basis, ("srt:RestatementAxis", "srt:RestatementAdjustmentMember")]),
        '<us-gaap:NetIncomeLoss contextRef="adj2" unitRef="usd">-3180353</us-gaap:NetIncomeLoss>',
        '<us-gaap:NetIncomeLoss contextRef="prev2" unitRef="usd">3960344</us-gaap:NetIncomeLoss>',
        '<us-gaap:NetIncomeLoss contextRef="adj3" unitRef="usd">-12116438</us-gaap:NetIncomeLoss>')
    assert R.instance_signals("K21", xml) == [
        ("K21", "us-gaap:NetIncomeLoss", "2021-04-01", "2021-06-30", R.KIND),
        ("K21", "us-gaap:NetIncomeLoss", "2021-07-01", "2021-09-30", R.KIND)]


def test_a_second_axis_with_a_zero_adjustment_is_not_a_restatement():
    """A multi-axis context counts only through a NON-ZERO adjustment (v4 meaning, kept)."""
    xml = _instance(_ctx("r", "2023-01-01", "2023-06-30", [("srt:ProductOrServiceAxis", "x:WidgetsMember"),
                                                          ("srt:RestatementAxis", "srt:RestatementAdjustmentMember")]),
                    '<us-gaap:Revenues contextRef="r" unitRef="usd">0</us-gaap:Revenues>')
    assert R.instance_signals("A", xml) == []


def test_a_company_extension_axis_is_kept_as_an_adjustment():
    xml = _instance(_ctx("r", "2021-07-01", "2021-09-30", [("celh:BasisAxis", "celh:StandaloneQuarterMember"),
                                                          ("srt:RestatementAxis", "srt:RestatementAdjustmentMember")]),
                    '<us-gaap:NetIncomeLoss contextRef="r" unitRef="usd">-12116791</us-gaap:NetIncomeLoss>')
    assert R.instance_signals("A", xml) == [("A", "us-gaap:NetIncomeLoss", "2021-07-01", "2021-09-30", R.KIND)]


def test_placement_in_a_note_is_not_a_filter():
    """A genuine restatement disclosed only in the notes (quarterly data in a 10-K)
    still counts: nothing in the extractor reads presentation roles."""
    xml = _instance(_ctx("p", "2021-01-01", "2021-03-31"), _ctx("r", "2021-01-01", "2021-03-31", [RESTATE]),
                    '<us-gaap:Revenues contextRef="p" unitRef="usd">100</us-gaap:Revenues>',
                    '<us-gaap:Revenues contextRef="r" unitRef="usd">90</us-gaap:Revenues>')
    assert [s[1] for s in R.instance_signals("A", xml)] == ["us-gaap:Revenues"]


# ── CELH, with the real numbers ─────────────────────────────────────────────
def _celh(k21_q2_span):
    fl = [filing("Q121", "2021-05-13T20:00:00"), filing("Q221", "2021-08-12T20:00:00"),
          filing("Q321", "2021-11-12T20:00:00"), filing("K21", "2022-03-16T21:00:00", form="10-K"),
          filing("Q122", "2022-05-10T20:00:00"), filing("Q222", "2022-08-09T20:00:00")]
    facts = [fact(NIL, "2021-01-01", "2021-03-31", 585424, "Q121"),
             fact(NIL, "2021-04-01", "2021-06-30", 3960344, "Q221"), fact(NIL, "2021-01-01", "2021-06-30", 4545768, "Q221"),
             fact(NIL, "2021-07-01", "2021-09-30", 2745791, "Q321"), fact(NIL, "2021-01-01", "2021-09-30", 7291559, "Q321"),
             fact(NIL, "2021-01-01", "2021-12-31", 3937273, "K21", form="10-K"),
             fact(NIL, "2022-01-01", "2022-03-31", 6679000, "Q122"), fact(NIL, "2021-01-01", "2021-03-31", 585000, "Q122"),
             fact(NIL, "2022-04-01", "2022-06-30", 9158000, "Q222"), fact(NIL, "2022-01-01", "2022-06-30", 15837000, "Q222"),
             fact(NIL, "2021-04-01", "2021-06-30", 780000, "Q222"), fact(NIL, "2021-01-01", "2021-06-30", 1366000, "Q222")]
    kb = K.build(facts, {f.accn: f for f in fl})
    pub = {f.accn: f.public_at for f in fl}
    tag = "us-gaap:" + NIL
    kb.filing_epochs = [(pub["K21"], D(k21_q2_span[0]), D(k21_q2_span[1]), tag),        # the 10-K restated Q2 ...
                        (pub["K21"], D("2021-07-01"), D("2021-09-30"), tag),              # ... and Q3 -- not Q1
                        (pub["Q222"], D("2021-01-01"), D("2021-06-30"), tag),
                        (pub["Q222"], D("2021-04-01"), D("2021-06-30"), tag)]
    return kb, pub


def test_celh_q1_2022_is_knowable_on_the_exact_span():
    kb, pub = _celh(("2021-04-01", "2021-06-30"))                 # the instance's exact span
    p = value_at(build_series(kb, ["net_income_ttm"])["net_income_ttm"], pub["Q122"])
    assert p.method != GAP
    # FY21 (restated) + Q1-22 - Q1-21 (never restated; re-reported 585,000 by this very 10-Q)
    assert abs(p.v - (3937273 + 6679000 - 585000)) < 1000


def test_mutation_the_reconstructed_fs_span_withholds_it():
    """The v4 artifact: FS rebuilds the start as 2021-03-31, which touches Q1-2021."""
    kb, pub = _celh(("2021-03-31", "2021-06-30"))
    p = value_at(build_series(kb, ["net_income_ttm"])["net_income_ttm"], pub["Q122"])
    assert p.method == GAP


def test_celh_q4_2021_is_never_restated_fy_minus_original_9m():
    """THE classic mixed basis: at the 10-K, Q4 = FY(restated) - 9M(original) = -3,354,286.
    The 10-K's Q2/Q3 restatement makes the original 9M stale; Q4 must not be built from it.
    (A too-broad 'breakdown axis' filter re-opened exactly this on the bounded corpus.)"""
    kb, pub = _celh(("2021-04-01", "2021-06-30"))
    p = value_at(build_series(kb, ["net_income_q"])["net_income_q"], pub["K21"])
    assert p is None or p.method == GAP or abs(p.v - (3937273 - 7291559)) > 1


def test_celh_q2_2022_stays_a_gap():
    kb, pub = _celh(("2021-04-01", "2021-06-30"))
    p = value_at(build_series(kb, ["net_income_ttm"])["net_income_ttm"], pub["Q222"])
    assert p.method == GAP


def test_no_revision_is_visible_before_the_filing_that_made_it_public():
    kb, pub = _celh(("2021-04-01", "2021-06-30"))
    pts = build_series(kb, ["net_income_ttm"])["net_income_ttm"]
    just_before = value_at(pts, pub["K21"] - timedelta(seconds=1))
    # before the 10-K is public, the only knowable TTM is the ORIGINAL basis (Q3-2021 filing)
    assert just_before is None or just_before.period_end.isoformat() <= "2021-09-30"
    assert all(p.t_eff >= pub["K21"] for p in pts if p.period_end and p.period_end.isoformat() == "2021-12-31")


# ── ONE seam for full and incremental ───────────────────────────────────────
XML = _instance(_ctx("p", "2021-04-01", "2021-06-30"), _ctx("r", "2021-04-01", "2021-06-30", [RESTATE]),
                '<us-gaap:NetIncomeLoss contextRef="p" unitRef="usd">780000</us-gaap:NetIncomeLoss>',
                '<us-gaap:NetIncomeLoss contextRef="r" unitRef="usd">3960344</us-gaap:NetIncomeLoss>')


def _store(tmp_path):
    from api.services.fundamentals_pit import store as S
    c = S.connect(str(tmp_path / "pit.db"))
    with S.tx(c):
        c.execute("INSERT INTO filing (filing_id, accn, cik, form, filing_date, report_date, accepted_at, public_at, "
                  "first_seen_at) VALUES (1, '0000000001-22-000001', 1, '10-K', 20220316, 20211231, 1647464400, 1647464400, 0)")
        c.execute("INSERT INTO concept (concept_id, tag) VALUES (1, 'us-gaap:NetIncomeLoss')")
        c.execute("INSERT INTO fact (cik, concept_id, unit, period_end, period_start, filing_id, val, first_seen_at) "
                  "VALUES (1, 1, 'USD', 20211231, 20210101, 1, 3937273, 0)")          # it contributes facts: in scope
    return c


def test_full_and_incremental_record_identical_evidence_through_one_function(tmp_path, monkeypatch):
    calls = []
    real = INC.instance_evidence
    monkeypatch.setattr(INC, "instance_evidence", lambda cik, accn, f=None: calls.append(accn) or real(cik, accn, lambda c, a: XML))
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    full = _store(tmp_path / "a")                         # the historical rebuild
    rep = INC.instance_signal_pass(full, workers=2)
    inc = _store(tmp_path / "b")                          # the incremental update
    INC.check_signals(inc, 1)
    q = "SELECT accn, tag, period_start, period_end, kind, source FROM filing_signal ORDER BY 1,2,3"
    assert rep["checked"] == 1 and calls == ["0000000001-22-000001"] * 2
    assert full.execute(q).fetchall() == inc.execute(q).fetchall() != []
    # resumable: a second full pass has nothing left to do
    assert INC.instance_signal_pass(full, workers=2)["todo"] == 0


def test_the_full_backfill_refuses_to_mix_fs_evidence_into_v5(tmp_path):
    from api.services.fundamentals_pit import backfill as BF
    with pytest.raises(SystemExit):
        BF.run(["--db", str(tmp_path / "x.db"), "--online", "--ciks", "1", "--fs-zip", "q.zip"])


def test_evidence_scope_is_every_filing_that_contributes_facts_whatever_its_form(tmp_path, monkeypatch):
    """20-F / 6-K / 8-K / S-1 restatements count (the v4 FS signals came from them too);
    a filing with no XBRL facts has no instance and is never fetched."""
    from api.services.fundamentals_pit import store as S
    c = S.connect(str(tmp_path / "pit.db"))
    with S.tx(c):
        c.execute("INSERT INTO concept (concept_id, tag) VALUES (1, 'us-gaap:NetIncomeLoss')")
        for fid, accn, form in ((1, "A-20F", "20-F"), (2, "A-8K", "8-K"), (3, "A-10Q", "10-Q"), (4, "A-NOXBRL", "10-K")):
            c.execute("INSERT INTO filing (filing_id, accn, cik, form, filing_date, report_date, accepted_at, public_at, "
                      "first_seen_at) VALUES (?,?,1,?,20220316,NULL,1647464400,1647464400,0)", (fid, accn, form))
            if accn != "A-NOXBRL":
                c.execute("INSERT INTO fact (cik, concept_id, unit, period_end, period_start, filing_id, val, first_seen_at) "
                          "VALUES (1, 1, 'USD', 20211231, 20210101, ?, 1.0, 0)", (fid,))
    asked = []
    monkeypatch.setattr(INC, "instance_evidence", lambda cik, accn, f=None: asked.append(accn) or [])
    INC.instance_signal_pass(c, workers=1)
    assert sorted(asked) == ["A-10Q", "A-20F", "A-8K"]


# ── REAL filing evidence: CELH FY2021 10-K (0000950170-22-003965), verbatim excerpt ──
# Every restatement-axis context the filing uses for revenue and net income, with the
# plain counterparts of the same periods, copied unmodified from the SEC instance.
# REVENUE sits on the restatement axis with NOTHING changed; net income was restated
# for Q2 and Q3 2021 only. The extractor on this excerpt yields exactly what it yields
# on the whole filing (checked 2026-09-25).
_CELH_10K = __import__("pathlib").Path(__file__).parent / "fixtures" / "celh_fy21_10k_restatement_excerpt.xml"


def test_real_celh_10k_only_genuine_restatements_count():
    """PRE-LAUNCH RAIL for 'treat every instance marker as relevant': the value-aware
    rule is what keeps CELH's unchanged revenue (and its un-restated Q1) out."""
    xml = _CELH_10K.read_text(encoding="utf-8")
    assert "Revenue" in xml and "RestatementAxis" in xml                     # the marker IS there for revenue
    got = R.instance_signals("0000950170-22-003965", xml)
    assert got == [("0000950170-22-003965", "us-gaap:NetIncomeLoss", "2021-04-01", "2021-06-30", R.KIND),
                   ("0000950170-22-003965", "us-gaap:NetIncomeLoss", "2021-07-01", "2021-09-30", R.KIND)]


# ── REAL filing evidence: CIK 1664703 10-Q/A (0001664703-20-000061), verbatim excerpt ──
# Single-axis "previously reported" contexts: CASH is marked but UNCHANGED; ASSETS and
# LIABILITIES were genuinely restated. Copied unmodified from the SEC instance.
_Q_A = __import__("pathlib").Path(__file__).parent / "fixtures" / "cik1664703_10qa_2020_restatement_excerpt.xml"


def test_real_10qa_an_unchanged_previously_reported_value_is_not_a_restatement():
    """PRE-LAUNCH RAIL (value half): a marker whose previously-reported value equals the
    current one is not evidence -- only the genuinely changed balances count."""
    xml = _Q_A.read_text(encoding="utf-8")
    assert "CashAndCashEquivalentsAtCarryingValue" in xml and "ScenarioPreviouslyReportedMember" in xml
    got = R.instance_signals("0001664703-20-000061", xml)
    assert [(t, s, e) for _, t, s, e, _ in got] == [("us-gaap:Assets", "2019-06-30", "2019-06-30"),
                                                    ("us-gaap:Liabilities", "2019-06-30", "2019-06-30")]
