"""PUBR's matching rule and its readers of the four agencies' answers (`api/services/public_records_match.py`,
`api/services/public_records_parse.py`). Pure functions: no network, no clock.

What is held here:
  * a name normalises the same way on both sides (legal forms, SEC state markers, "&", initials, the
    FDA's abbreviations, a leading THE), and a record's name counts only as the same name, the same words
    in another order, or the same name but for one business word on a distinctive name;
  * a common one-word name never matches through the business-word rule; a former SEC name counts only
    when it was given up within five years; the site's name and the SEC's are both listed;
  * each agency's answer is read into rows, unknown fields dropped, a row that cannot be read counted;
    totals and lists cover only the names that matched, and everything else the agency returned is
    listed as not counted.

Every company, person, place and figure below is invented.
"""
from __future__ import annotations

from datetime import date

import pytest

from api.services import public_records_match as M
from api.services import public_records_parse as P

TODAY = date(2030, 5, 14)


def _names(site="Kestrel Dynamics Corporation", sec="KESTREL DYNAMICS CORP", former=None):
    return M.company_names(site, sec, former or [], today=TODAY)


# ── normalising ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, words", [
    ("Kestrel Dynamics Corporation", ("KESTREL", "DYNAMICS")),
    ("KESTREL DYNAMICS CORP /DE/", ("KESTREL", "DYNAMICS")),
    ("The Kestrel Co.", ("KESTREL",)),
    ("Harrow & Vane, Inc.", ("HARROW", "AND", "VANE")),
    ("Merrow & Co., Inc.", ("MERROW",)),
    ("U.S. Kestrel Steel Corp", ("US", "KESTREL", "STEEL")),
    ("Quillon.com, Inc.", ("QUILLON", "COM")),
    ("QUILLON PHARMS INC", ("QUILLON", "PHARMACEUTICALS")),
    ("Quillon Labs, L.L.C.", ("QUILLON", "LABORATORIES")),
    ("Brennick-Saal Holdings PLC", ("BRENNICK", "SAAL", "HOLDINGS")),
    ("Ålder Kestrel AG", ("ALDER", "KESTREL")),
    ("", ()),
    (None, ()),
])
def test_a_name_normalises_the_same_way_on_both_sides(raw, words):
    assert M.tokens(raw) == words


def test_a_record_name_counts_only_by_the_three_ways():
    names = _names()
    assert M.match_name("KESTREL DYNAMICS CORPORATION", names)["how"] == "same_name"
    assert M.match_name("Dynamics Kestrel Inc", names)["how"] == "same_words"
    assert M.match_name("KESTREL DYNAMICS LABORATORIES", names)["how"] == "descriptor"
    for other in ("KESTREL DYNAMICS SPACE SYSTEMS", "KESTREL", "KESTREL DYNAMIC", "NORTH KESTREL DYNAMICS", ""):
        assert M.match_name(other, names) is None, other


def test_the_business_word_rule_needs_a_distinctive_name():
    # "United" alone is a common word: "UNITED THERAPEUTICS"-style names must not match a bare "UNITED"
    common = M.company_names("Granite Therapeutics Inc", None, today=TODAY)
    assert M.match_name("GRANITE THERAPEUTICS", common)["how"] == "same_name"
    assert M.match_name("GRANITE", common)["how"] == "descriptor"          # five letters, not a common word
    generic = M.company_names("United Therapeutics Corp", None, today=TODAY)
    assert M.match_name("UNITED", generic) is None
    short = M.company_names("Oxa Pharma Inc", None, today=TODAY)
    assert M.match_name("OXA", short) is None                             # under five letters


def test_the_company_names_keep_both_current_names_and_only_recent_former_ones():
    names = _names(former=[{"name": "OLD KESTREL INC", "from": "2001-01-01", "to": "2027-03-01"},
                           {"name": "ANCIENT KESTREL INC", "from": "1990-01-01", "to": "2019-01-01"},
                           {"name": "KESTREL DYNAMICS CORP", "to": "2028-01-01"}, "not a row"])
    assert [(n["name"], n["source"]) for n in names] == [
        ("Kestrel Dynamics Corporation", "site"), ("KESTREL DYNAMICS CORP", "sec"), ("OLD KESTREL INC", "sec_former")]
    assert names[2]["until"] == "2027-03-01"
    assert M.match_name("Old Kestrel", names) == {"how": "same_name", "against": "OLD KESTREL INC", "source": "sec_former"}
    assert M.match_name("ANCIENT KESTREL", names) is None
    shown = M.public_names(names)
    assert shown[1] == {"name": "KESTREL DYNAMICS CORP", "source": "sec", "source_words": "the SEC's name for the company",
                        "until": None}
    assert "words" not in shown[0]


def test_the_search_words_are_the_first_name_and_the_core_drops_one_business_word():
    assert M.search_text(_names()) == "KESTREL DYNAMICS"
    assert M.search_text(M.company_names(None, "QUILLON THERAPEUTICS INC", today=TODAY)) == "QUILLON THERAPEUTICS"
    assert M.search_core(M.company_names("Quillon Pharmaceuticals Inc", None, today=TODAY)) == "QUILLON"
    assert M.search_core(M.company_names("United Therapeutics Corp", None, today=TODAY)) == "UNITED THERAPEUTICS"
    assert M.search_text([]) is None and M.search_core([]) is None


def test_the_tally_sorts_names_into_counted_and_not_counted():
    t = M.Tally(_names())
    t.add("KESTREL DYNAMICS CORP", 300.0)
    t.add("Kestrel Dynamics Corporation", 200.0)        # the same name, written another way, is its own row
    t.add("KESTREL DYNAMICS CORP", 50.0)
    t.add("SKYHOOK KESTREL LLC", 900.0)
    t.add("BRAMBLE WORKS", None)
    t.add("   ", 1.0)
    counted = t.counted()
    assert [(c["name"], c["amount"], c["records"], c["how"]) for c in counted] == [
        ("KESTREL DYNAMICS CORP", 350.0, 2, "same_name"), ("Kestrel Dynamics Corporation", 200.0, 1, "same_name")]
    rows, total = t.not_counted(cap=1)
    assert total == 2 and [r["name"] for r in rows] == ["SKYHOOK KESTREL LLC"]
    assert t.is_counted("kestrel dynamics corp") and not t.is_counted("BRAMBLE WORKS")


# ── USAspending.gov ──────────────────────────────────────────────────────────────────────────

def _recipients(rows, more=False):
    return {"category": "recipient", "results": [dict(r) for r in rows], "page_metadata": {"hasNext": more}}


AWARDS = {"results": [
    {"Award ID": "QZ0001", "Recipient Name": "KESTREL DYNAMICS CORP", "Base Obligation Date": "2030-03-02",
     "Award Amount": 1250000.0, "Awarding Agency": "Department of Imaginary Affairs", "Awarding Sub Agency": "Office of Lanterns",
     "Description": "LANTERN MAINTENANCE " * 30, "Primary Place of Performance": {"city_name": "MAPLE FORD", "state_code": "OR",
     "country_name": "UNITED STATES"}, "Contract Award Type": "DEFINITIVE CONTRACT", "generated_internal_id": "CONT_AWD_QZ0001",
     "code": "123456789", "uei": "QQQQQQQQQQQQ"},
    {"Award ID": "QZ0002", "Recipient Name": "SKYHOOK KESTREL LLC", "Base Obligation Date": "2030-04-01", "Award Amount": 9.0},
    {"Award ID": "QZ0003", "Recipient Name": "KESTREL DYNAMICS CORPORATION", "Base Obligation Date": "2030-04-20",
     "Award Amount": 400.0, "Place of Performance State Code": "WA", "Place of Performance Country Code": "USA",
     "generated_internal_id": "bad id with spaces"},
    {"Award ID": None, "Recipient Name": "KESTREL DYNAMICS CORP", "Base Obligation Date": "2030-04-21"},
    "not a row",
], "page_metadata": {"hasNext": True}}


def test_contracts_total_only_the_matched_recipients_in_each_window():
    recent = _recipients([{"name": "KESTREL DYNAMICS CORP", "amount": 1000.0, "code": "987654321"},
                          {"name": "KESTREL DYNAMICS CORPORATION", "amount": 500.0},
                          {"name": "SKYHOOK KESTREL LLC", "amount": 7000.0}, {"name": None, "amount": 1.0}], more=True)
    prior = _recipients([{"name": "KESTREL DYNAMICS CORP", "amount": 800.0}, {"name": "SKYHOOK KESTREL LLC", "amount": 5.0}])
    body = P.shape_contracts(recent, prior, AWARDS, _names())
    assert body["recent_total"] == 1500.0 and body["prior_total"] == 800.0
    assert [c["name"] for c in body["counted"]] == ["KESTREL DYNAMICS CORP", "KESTREL DYNAMICS CORPORATION"]
    assert body["counted"][0]["prior_amount"] == 800.0 and body["counted"][1]["prior_amount"] is None
    assert [n["name"] for n in body["not_counted"]] == ["SKYHOOK KESTREL LLC"] and body["not_counted_total"] == 1
    assert body["recipients_more"] is True and body["awards_more"] is True and body["dropped"] == 3
    # only matched awards, newest first; DUNS and UEI never kept
    assert [a["award_id"] for a in body["awards"]] == ["QZ0003", "QZ0001"]
    first = body["awards"][1]
    assert first["place"] == "Maple Ford, OR" and first["url"] == "https://www.usaspending.gov/award/CONT_AWD_QZ0001"
    assert first["description_cut"] is True and len(first["description"]) <= P.DESCRIPTION_CHARS
    assert body["awards"][0]["place"] == "WA" and body["awards"][0]["url"] is None
    assert "code" not in first and "uei" not in first and "987654321" not in repr(body)


def test_contracts_with_no_match_have_no_total_and_a_wrong_shape_raises():
    body = P.shape_contracts(_recipients([{"name": "BRAMBLE WORKS", "amount": 10.0}]), _recipients([]),
                             {"results": []}, _names())
    assert body["counted"] == [] and body["recent_total"] is None and body["prior_total"] is None
    with pytest.raises(ValueError):
        P.shape_contracts({"detail": "no"}, _recipients([]), {"results": []}, _names())
    with pytest.raises(ValueError):
        P.shape_contracts(_recipients([]), _recipients([]), [], _names())


def test_the_two_contract_windows_are_twelve_months_each_back_to_back():
    assert P.contract_windows(date(2030, 5, 14)) == {"recent": ("2029-05-15", "2030-05-14"),
                                                     "prior": ("2028-05-15", "2029-05-14")}
    assert P.contract_windows(date(2032, 2, 29))["recent"] == ("2031-03-01", "2032-02-29")


# ── ClinicalTrials.gov ───────────────────────────────────────────────────────────────────────

def _study(nct, sponsor, status="RECRUITING", phases=("PHASE2",), pcd="2031-01-15", pcd_type="ESTIMATED", updated="2030-05-01"):
    return {"protocolSection": {
        "identificationModule": {"nctId": nct, "briefTitle": f"A study of lantern oil {nct[-2:]}"},
        "statusModule": {"overallStatus": status, "startDateStruct": {"date": "2029-02"},
                         "primaryCompletionDateStruct": {"date": pcd, "type": pcd_type},
                         "lastUpdatePostDateStruct": {"date": updated}},
        "sponsorCollaboratorsModule": {"leadSponsor": {"name": sponsor, "class": "INDUSTRY"}},
        "conditionsModule": {"conditions": ["Glow fatigue", "Wick syndrome", "Ember cough", "Ash rash", "Smoke ear"]},
        "designModule": {"phases": list(phases), "enrollmentInfo": {"count": 120, "type": "ESTIMATED"}}}}


def test_trials_keep_the_lead_sponsored_ones_and_count_them_by_phase_and_status():
    active = {"totalCount": 4, "studies": [
        _study("NCT90000001", "Kestrel Dynamics", pcd="2031-06-01"),
        _study("NCT90000002", "Kestrel Dynamics Corporation", phases=("PHASE1", "PHASE2"), pcd="2030-09-01"),
        _study("NCT90000003", "Bramble University", phases=("PHASE3",)),
        _study("NCT90000004", "Kestrel Dynamics", status="ACTIVE_NOT_RECRUITING", phases=(), pcd=None),
        {"protocolSection": {"identificationModule": {"nctId": "BAD"}}}]}
    closed = {"totalCount": 1, "studies": [_study("NCT90000005", "KESTREL DYNAMICS", status="TERMINATED", updated="2030-04-02")]}
    body = P.shape_trials(active, closed, _names())
    assert [s["nct_id"] for s in body["active"]] == ["NCT90000002", "NCT90000001", "NCT90000004"]   # next readout first
    assert body["active_matched"] == 3 and body["active_read"] == 4 and body["active_total"] == 4 and body["dropped"] == 1
    assert [s["nct_id"] for s in body["closed"]] == ["NCT90000005"]
    assert body["by_phase"] == {"PHASE2": 1, "PHASE1+PHASE2": 1, "NONE": 1}
    assert body["by_status"] == {"RECRUITING": 2, "ACTIVE_NOT_RECRUITING": 1, "TERMINATED": 1}
    assert body["phase_status"]["PHASE2"] == {"RECRUITING": 1}
    first = body["active"][0]
    assert first["primary_completion"] == {"date": "2030-09-01", "estimated": True}
    assert first["start"] == {"date": "2029-02", "estimated": None}
    assert first["conditions"] == ["Glow fatigue", "Wick syndrome", "Ember cough", "Ash rash"] and first["conditions_more"] == 1
    assert first["enrollment"] == 120 and first["enrollment_estimated"] is True
    assert first["url"] == "https://clinicaltrials.gov/study/NCT90000002"
    assert [n["name"] for n in body["not_counted"]] == ["Bramble University"]
    with pytest.raises(ValueError):
        P.shape_trials({"error": "x"}, closed, _names())


def test_the_data_timestamp_is_read_as_given():
    assert P.data_timestamp({"apiVersion": "9.9", "dataTimestamp": "2030-05-13T10:00:05"}) == "2030-05-13T10:00:05"
    assert P.data_timestamp({"dataTimestamp": "yesterday"}) is None and P.data_timestamp(None) is None


# ── openFDA ──────────────────────────────────────────────────────────────────────────────────

def _app(number, sponsor, subs, brands=("GLOWEX",)):
    return {"application_number": number, "sponsor_name": sponsor,
            "products": [{"brand_name": b, "active_ingredients": [{"name": "EMBERINE", "strength": "1MG"}]} for b in brands],
            "submissions": subs}


def _sub(kind, num, status, day, cls="TYPE 1", priority="PRIORITY"):
    return {"submission_type": kind, "submission_number": num, "submission_status": status,
            "submission_status_date": day, "submission_class_code": cls,
            "submission_class_code_description": "Efficacy" if cls == "EFFICACY" else "Type 1 - New Molecular Entity",
            "review_priority": priority}


def test_fda_lists_approvals_new_uses_and_tentative_approvals_and_counts_the_rest():
    body = P.shape_fda({"meta": {"last_updated": "2030-05-12", "disclaimer": "Invented notice text.",
                                 "results": {"total": 3}}, "results": [
        _app("NDA990001", "KESTREL DYNAMICS", [_sub("ORIG", "1", "AP", "20290601"), _sub("SUPPL", "4", "AP", "20300101", cls="EFFICACY"),
                                               _sub("SUPPL", "5", "AP", "20300201", cls="LABELING"),
                                               _sub("SUPPL", "6", "AP", "20270101", cls="EFFICACY")]),
        _app("ANDA990002", "KESTREL DYNAMICS LABS", [_sub("ORIG", "1", "TA", "20300310", cls="", priority="N/A")],
             brands=("EMBERINE",)),
        _app("BLA990003", "SKYHOOK BIO", [_sub("ORIG", "1", "AP", "20300401")]),
        _app("XYZ1", "KESTREL DYNAMICS", [])]}, _names(), "2028-05-14")
    assert [(a["application"], a["action"], a["date"]) for a in body["actions"]] == [
        ("ANDA990002", "tentative", "2030-03-10"), ("NDA990001", "new_use", "2030-01-01"), ("NDA990001", "approval", "2029-06-01")]
    assert body["other_changes"] == 1 and body["applications_counted"] == 2 and body["dropped"] == 1
    first = body["actions"][2]
    assert first["drug"] == "GLOWEX" and first["ingredients"] == "EMBERINE" and first["priority"] == "PRIORITY"
    assert first["url"].endswith("ApplNo=990001") and first["application_words"] == "New drug application"
    assert body["actions"][0]["priority"] is None
    assert body["data_as_of"] == "2030-05-12" and body["notice"] == "Invented notice text." and body["applications_total"] == 3
    assert [n["name"] for n in body["not_counted"]] == ["SKYHOOK BIO"]
    assert {c["how"] for c in body["counted"]} == {"same_name", "descriptor"}


def test_fda_action_kinds():
    assert P.fda_action({"submission_status": "AP", "submission_type": "ORIG"}) == "approval"
    assert P.fda_action({"submission_status": "TA", "submission_type": "ORIG"}) == "tentative"
    assert P.fda_action({"submission_status": "AP", "submission_type": "SUPPL", "submission_class_code": "EFFICACY"}) == "new_use"
    assert P.fda_action({"submission_status": "AP", "submission_type": "SUPPL", "submission_class_code": "MANUF (CMC)"}) == "other_change"
    assert P.fda_action({"submission_status": "RL", "submission_type": "ORIG"}) is None


# ── LDA.gov ──────────────────────────────────────────────────────────────────────────────────

def _filing(uuid, client, registrant, year, period, *, income=None, expenses=None, posted="2030-04-10T10:00:00-04:00",
            issues=("Defense",), reg_id=1, cli_id=10):
    return {"filing_uuid": uuid, "filing_type": "Q1", "filing_year": year, "filing_period": period, "income": income,
            "expenses": expenses, "dt_posted": posted, "filing_document_url": f"https://lda.gov/filings/public/filing/{uuid}/print/",
            "registrant": {"id": reg_id, "name": registrant}, "client": {"id": cli_id, "name": client},
            "lobbying_activities": [{"general_issue_code_display": i} for i in issues]}


def test_the_last_quarters_are_the_ended_ones_newest_first():
    qs = P.last_quarters(date(2030, 4, 10), 3)
    assert [q["label"] for q in qs] == ["Q1 2030", "Q4 2029", "Q3 2029"]
    assert qs[0]["ends"] == "2030-03-31" and qs[0]["due"] == "2030-04-20" and qs[0]["reports_due"] is True
    assert qs[1]["reports_due"] is False


def test_lobbying_keeps_own_spend_and_outside_firms_apart_and_an_amendment_replaces_its_report():
    rows, count, more, bad = P.filing_rows({"count": 5, "next": "https://lda.gov/next", "results": [
        _filing("u1", "KESTREL DYNAMICS CORPORATION", "KESTREL DYNAMICS CORPORATION", 2030, "first_quarter", expenses="410000.00",
                reg_id=7, cli_id=70, issues=("Defense", "Taxation/Internal Revenue Code")),
        _filing("u2", "KESTREL DYNAMICS CORP", "BRAMBLE & PARTNERS", 2030, "first_quarter", income="20000.00", reg_id=8, cli_id=80),
        _filing("u3", "KESTREL DYNAMICS CORP", "BRAMBLE & PARTNERS", 2030, "first_quarter", income="30000.00", reg_id=8, cli_id=80,
                posted="2030-05-01T10:00:00-04:00"),
        _filing("u4", "KESTREL DYNAMICS AERO SECTOR", "HOLLOW OAK LLC", 2030, "first_quarter", income="90000.00", reg_id=9),
        _filing("u5", "KESTREL DYNAMICS CORP", "CEDAR LANE GROUP", 2029, "fourth_quarter", income=None, reg_id=11),
        {"filing_year": 2030, "filing_period": "mid_year"}]})
    assert count == 5 and more is True and bad == 1 and len(rows) == 5
    quarters = P.last_quarters(date(2030, 5, 14), 2)
    body = P.shape_lobbying(rows, _names(), quarters)
    q1, q4 = body["quarters"]
    assert q1["label"] == "Q1 2030" and q1["own"] == 410000.0 and q1["own_reports"] == 1
    assert q1["firms"] == 30000.0 and q1["firm_reports"] == 1 and q1["firm_names"] == ["BRAMBLE & PARTNERS"]
    assert q1["filings"] == 2 and q1["issues"][0] == {"issue": "Defense", "filings": 2}
    assert q1["links"][0] == "https://lda.gov/filings/public/filing/u3/print/"
    assert q4["firms"] is None and q4["firms_no_figure"] == 1 and q4["own"] is None
    assert [n["name"] for n in body["not_counted"]] == ["KESTREL DYNAMICS AERO SECTOR"]
    # a lobbying firm's name is never listed as a name the agency returned for the company
    assert "BRAMBLE & PARTNERS" not in [n["name"] for n in body["counted"] + body["not_counted"]]
    with pytest.raises(ValueError):
        P.filing_rows({"detail": "Invalid page."})
