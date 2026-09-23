"""Filing-level restatement signals + the knowledge rules they feed.

Golden: CELH's FY2021 10-K restated its quarters ONLY through XBRL dimensions,
which companyfacts does not carry. The SEC Financial Statement Data Set rows of
that 10-K (fixture `fs_num_txt`) are the signal."""
import io
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from api.services.fundamentals_pit import facts as F, filings as FL, knowledge as K, metrics as M
from api.services.fundamentals_pit import restatement_signals as R

from ._build import D, fact, filing, utc

FIX = Path(__file__).parent / "fixtures"
TEN_K = "0000950170-22-003965"


def _celh():
    d = json.loads((FIX / "celh_2021_dimensional_restatement.json").read_text())
    fl = FL.parse_submission_pages([d["submissions_page"]])
    return F.parse_companyfacts(d["companyfacts"]), fl, d["fs_num_txt"]


def _book(kb, when):
    return M.build_book(kb.state_at(when), None, kb, when)


def _nums(kb, when):
    b = _book(kb, when)
    f = lambda v: None if v is None else round(v.v)
    return (f(M.quarter_value(b, "net_income", date(2021, 9, 30))),
            f(M.quarter_value(b, "net_income", date(2021, 12, 31))),
            f(M.ttm(b, "net_income", date(2021, 12, 31))),
            f(M.quarter_value(b, "revenue", date(2021, 12, 31))))


def test_fs_signal_names_the_restated_concepts_only():
    facts, fl, num = _celh()
    sig = R.fs_dataset_signals(io.StringIO(num))
    tags = {s[1] for s in sig}
    assert "us-gaap:NetIncomeLoss" in tags
    assert "us-gaap:Revenues" not in tags            # on the axis, but unchanged -> not restated
    assert all(s[0] == TEN_K and s[4] == R.KIND for s in sig)


def test_celh_without_the_signal_manufactures_a_false_q4():
    facts, fl, _ = _celh()
    kb = K.build(facts, fl)
    after = fl[TEN_K].public_at + timedelta(minutes=1)
    q3, q4, fy, _rev = _nums(kb, after)
    assert (q3, fy) == (2_745_791, 3_937_273)
    assert q4 == 3_937_273 - 7_291_559           # FY(restated) - 9M(original) = -3.35M: a lie


def test_celh_with_the_signal_withholds_then_restores_at_its_own_time():
    facts, fl, num = _celh()
    kb = K.build(facts, fl)
    pub = fl[TEN_K].public_at
    kb.filing_epochs = [(pub, D(s), D(e), t) for _, t, s, e, _k in R.fs_dataset_signals(io.StringIO(num))]
    # before the 10-K: the original Q3 stands
    assert _nums(kb, pub - timedelta(seconds=1))[0] == 2_745_791
    # from the 10-K: Q3 and Q4 are withheld, FY (restated) and Q4 revenue stand
    q3, q4, fy, rev = _nums(kb, pub + timedelta(seconds=1))
    assert (q3, q4, fy) == (None, None, 3_937_273) and rev is not None
    # from the 2022-11-09 10-Q: non-dimensional restated values -> Q3 and Q4 return
    q3, q4, fy, _ = _nums(kb, datetime(2022, 11, 10, tzinfo=timezone.utc))
    assert (q3, q4, fy) == (-9_371_000, 3_937_273 + 8_005_000, 3_937_273)


def test_instance_extractor_matches_the_fs_extractor_semantics():
    xml = """<xbrl>
<context id="p"><entity/><period><startDate>2021-07-01</startDate><endDate>2021-09-30</endDate></period></context>
<context id="adj"><entity><segment><xbrldi:explicitMember dimension="srt:RestatementAxis">srt:RestatementAdjustmentMember</xbrldi:explicitMember></segment></entity><period><startDate>2021-07-01</startDate><endDate>2021-09-30</endDate></period></context>
<context id="prev"><entity><segment><xbrldi:explicitMember dimension="srt:RestatementAxis">srt:ScenarioPreviouslyReportedMember</xbrldi:explicitMember></segment></entity><period><startDate>2021-07-01</startDate><endDate>2021-09-30</endDate></period></context>
<us-gaap:NetIncomeLoss contextRef="p" unitRef="usd" decimals="-3">-9371000</us-gaap:NetIncomeLoss>
<us-gaap:NetIncomeLoss contextRef="adj" unitRef="usd" decimals="-3">-12117000</us-gaap:NetIncomeLoss>
<us-gaap:Revenues contextRef="p" unitRef="usd">94909000</us-gaap:Revenues>
<us-gaap:Revenues contextRef="prev" unitRef="usd">94909000</us-gaap:Revenues>
<us-gaap:Revenues contextRef="adj" unitRef="usd">0</us-gaap:Revenues>
</xbrl>"""
    sig = R.instance_signals("A", xml)
    assert sig == [("A", "us-gaap:NetIncomeLoss", "2021-07-01", "2021-09-30", R.KIND)]


def test_signal_epochs_are_tag_scoped():
    fl = [filing("Q0", "2021-11-12T19:00:00"), filing("K", "2022-03-16T21:00:00", form="10-K")]
    kb = K.build([fact("NetIncomeLoss", "2021-01-01", "2021-09-30", 7, "Q0"),
                  fact("Revenues", "2021-01-01", "2021-09-30", 70, "Q0")], {f.accn: f for f in fl})
    kb.filing_epochs = [(fl[1].public_at, D("2021-07-01"), D("2021-09-30"), "us-gaap:NetIncomeLoss")]
    t = utc("2023-01-01T00:00:00")
    assert kb.restatements("us-gaap:NetIncomeLoss", t) and not kb.restatements("us-gaap:Revenues", t)


def test_pooled_tags_share_signal_epochs():
    # CELH's signal names NetIncomeLoss; the pooled twin must not treat the same
    # catch-up (Nov 2022) as a NEW restatement.
    q0 = filing("Q0", "2021-11-12T19:00:00")
    k = filing("K", "2022-03-16T21:00:00", form="10-K")
    q1 = filing("Q1", "2022-11-09T21:00:00")
    TW = "NetIncomeLossAvailableToCommonStockholdersBasic"
    kb = K.build([fact(TW, "2021-01-01", "2021-09-30", 7_291_559, "Q0"),
                  fact(TW, "2021-01-01", "2021-09-30", -8_005_000, "Q1")], {f.accn: f for f in (q0, k, q1)})
    kb.filing_epochs = [(k.public_at, D("2021-07-01"), D("2021-09-30"), "us-gaap:NetIncomeLoss")]
    t = utc("2023-01-01T00:00:00")
    alone = kb.restatements(f"us-gaap:{TW}", t)
    pooled = kb.restatements(f"us-gaap:{TW}", t, None, frozenset({"us-gaap:NetIncomeLoss", f"us-gaap:{TW}"}))
    assert [e[0] for e in alone] == [q1.public_at]            # alone: looks genuine
    assert [e[0] for e in pooled] == [k.public_at]            # pooled: a catch-up


def test_scale_tagging_error_is_quarantined_not_a_restatement():
    # CELH's May 2022 10-Q re-tagged Q1 2021 NI-to-common 585,424 as 585.0
    fl = [filing("A", "2021-05-13T12:15:00"), filing("B", "2022-05-10T20:03:00")]
    kb = K.build([fact("Revenues", "2021-01-01", "2021-03-31", 585_424, "A"),
                  fact("Revenues", "2021-01-01", "2021-03-31", 585.0, "B")], {f.accn: f for f in fl})
    key = ("us-gaap:Revenues", "USD", D("2021-01-01"), D("2021-03-31"))
    assert [r.fact.val for r in kb.history[key]] == [585_424]
    assert K.is_scale_error(48_289, 48.289) and not K.is_scale_error(0.001, 0.001)
    assert not K.is_scale_error(100, 120)
