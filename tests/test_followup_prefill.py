# tests/test_followup_prefill.py
"""Tier 2 part B, item 11 (R-T2B-9..11): the follow-up note opens with a link to the member's own prep
note and the quarter's numbers, each labelled with its source. Never an invented number, never a 500.

The harness is tests/test_plan_prefill.py's own (a per-file temp auth db, notes made with
notes.create_note, a sample note marked by sample_marker.SAMPLE_SOURCE)."""
from __future__ import annotations

import copy
import importlib
import json
import os
import re
import tempfile
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from api.services import earnings_intel
from api.services.cache import cache
from api.services.journal_two import followup_prefill as fp, journal_styles, plan_extract, sample_marker

_REAL_HELD = earnings_intel.get_earnings_held    # captured before any fixture replaces it (M7)
UID = "u1"
REPORT = "2026-10-14"
TODAY = date(2026, 10, 15)       # the pinned ET clock (F1): the file never expires as the real date moves
INTEL = {
    "ticker": "ORCL",
    "quarters": [
        {"label": "FY2027 Q1", "report_date": "2026-10-14", "reported": True, "eps_actual": 1.47,
         "eps_estimate": 1.42, "eps_surprise_pct": 3.5, "revenue_actual": 15.2e9, "revenue_estimate": 15.0e9,
         "rev_surprise_pct": 1.3},
        {"label": "FY2026 Q4", "report_date": "2026-07-10", "reported": True, "eps_actual": 1.3},
    ],
    "reaction": {"events": [{"report_date": "2026-07-10", "reaction_pct": 2.0},
                            {"report_date": "2026-10-14", "reaction_pct": -4.2}]},
    # 16:52 ET on Thu Oct 15: after the 16:00 close of the first session following the Wed Oct 14 report (I4)
    "meta": {"retrieved_at": datetime(2026, 10, 15, 20, 52, tzinfo=timezone.utc).timestamp()},
}


def _text(doc):
    out, stack = [], [doc]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "text":
                out.append(n.get("text", ""))
            stack.extend(reversed(n.get("content") or []))
    return "\n".join(out)


def _links(doc):
    out, stack = [], [doc]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "noteLink":
                out.append(n["attrs"]["noteId"])
            stack.extend(n.get("content") or [])
    return out


def _body(note):
    return note["bodyJson"] if isinstance(note["bodyJson"], dict) else json.loads(note["bodyJson"])


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _on(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED", "1")
    monkeypatch.setattr(fp, "_today_et", lambda: TODAY)
    monkeypatch.setattr(earnings_intel, "get_earnings",
                        lambda sym: (_ for _ in ()).throw(AssertionError("the create built earnings")))
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: copy.deepcopy(INTEL) if sym == "ORCL" else None)


@pytest.fixture
def member(db_path):
    from api.services import auth_db
    from api.services.journal_two import notes
    conn = auth_db.get_connection()

    def prep(ticker="ORCL", created=None, sample=False, tags=("earnings", "earnings-prep")):
        n = notes.create_note(UID, {"title": f"Earnings Prep — {ticker}", "ticker": ticker, "tags": list(tags),
                                    "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}, conn)
        if created:
            conn.execute("UPDATE j2_notes SET created_at = ? WHERE id = ?", (created, n["id"]))
        if sample:
            conn.execute("UPDATE j2_notes SET import_source = ? WHERE id = ?", (sample_marker.SAMPLE_SOURCE, n["id"]))
        conn.commit()
        return n

    def trash(note):
        assert notes.delete_note(UID, note["id"], conn)

    yield SimpleNamespace(conn=conn, prep=prep, trash=trash)
    conn.close()


def _followup(member, ticker="ORCL", report=REPORT, **extra):
    return journal_styles.create_styled_note(
        UID, {"kindId": "earnings_followup", "ticker": ticker, "earningsFollowup": {"reportDate": report}, **extra},
        member.conn)


def test_links_the_prep_note_and_writes_the_numbers_under_the_headings(member):
    p = member.prep(created="2026-10-13T14:00:00+00:00")
    note, _ = _followup(member)
    body = _body(note)
    assert _links(body) == [p["id"]]
    text = _text(body)
    assert "Your prep note before the report: " in text
    assert "Quarter: FY2027 Q1, reported Oct 14, 2026." in text
    assert "EPS: $1.47 actual vs $1.42 expected (+3.5% surprise)." in text
    assert "Revenue: $15.2B actual vs $15.0B expected (+1.3% surprise)." in text
    assert "Reaction: −4.2% close to close, on the session that first traded the result." in text
    assert "Source: UCT earnings data (consensus estimates and reported results), retrieved Oct 15, 2026, 4:52 PM ET." in text
    heads = [journal_styles._plain(n) for n in body["content"] if n.get("type") == "heading"]
    assert heads == list(journal_styles.FOLLOWUP_HEADINGS)
    plain = [journal_styles._plain(n) for n in body["content"]]
    i_happened = plain.index(journal_styles.FOLLOWUP_HEADINGS[1])
    assert journal_styles._plain(body["content"][i_happened + 1]).startswith("Quarter:")
    i_expected = plain.index(journal_styles.FOLLOWUP_HEADINGS[0])                       # M2
    assert plain[i_expected + 1].startswith("Your prep note before the report: ")
    assert [n["attrs"]["noteId"] for n in body["content"][i_expected + 1]["content"] if n.get("type") == "noteLink"] == [p["id"]]


def test_a_prep_note_written_on_the_report_morning_counts_and_one_written_after_does_not(member):
    same_day = member.prep(created="2026-10-14T13:00:00+00:00")             # 09:00 ET on the report day
    member.prep(created="2026-10-15T13:00:00+00:00")                        # after the report date
    note, _ = _followup(member)
    assert _links(_body(note)) == [same_day["id"]]


def test_a_trashed_or_sample_prep_note_is_never_linked(member):
    gone = member.prep(created="2026-10-12T13:00:00+00:00")
    member.trash(gone)
    member.prep(created="2026-10-12T14:00:00+00:00", sample=True)
    member.prep(ticker="AMD", created="2026-10-12T15:00:00+00:00")         # another ticker
    member.prep(created="2026-10-12T16:00:00+00:00", tags=("earnings",))  # not a prep note
    note, _ = _followup(member)
    body = _body(note)
    assert _links(body) == []
    assert "Your prep note" not in _text(body)


def test_a_missing_quarter_is_a_labelled_dash_never_invented(member, monkeypatch):
    held = copy.deepcopy(INTEL)
    held["quarters"] = held["quarters"][1:]
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _text(_body(_followup(member)[0]))
    assert "The numbers: — UCT's earnings data does not have the Oct 14, 2026 report yet." in text
    assert "EPS:" not in text and "1.3" not in text
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: None)
    text = _text(_body(_followup(member)[0]))
    assert "The numbers: — UCT holds no earnings data for ORCL right now." in text


def test_a_missing_value_or_reaction_is_a_labelled_dash(member, monkeypatch):
    held = copy.deepcopy(INTEL)
    held["quarters"][0].update(eps_actual=None, revenue_estimate=None, rev_surprise_pct=None)
    held["reaction"] = None                                              # fewer than 4 quarters computed
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _text(_body(_followup(member)[0]))
    assert "EPS: — (no reported EPS for this quarter in UCT's earnings data yet)" in text
    assert "Revenue: $15.2B actual; no consensus estimate in UCT's earnings data." in text
    assert "Reaction: — (UCT could not measure the price reaction to this report)." in text


def _happened(body):
    """The text between the "What happened" heading and the next heading: the lines this module wrote."""
    out, on = [], False
    for n in body["content"]:
        if n.get("type") == "heading":
            on = journal_styles._plain(n) == journal_styles.FOLLOWUP_HEADINGS[1]
        elif on:
            out.append(_text(n))
    return "\n".join(out)


_NO_DATA = "The numbers: — UCT holds no earnings data for ORCL right now."
_NO_QUARTER = "The numbers: — UCT's earnings data does not have the Oct 14, 2026 report yet."
_META = {"retrieved_at": INTEL["meta"]["retrieved_at"]}
_BAD = [
    ("not a dict", [_NO_DATA]),
    ({"quarters": "x"}, [_NO_QUARTER]),
    ({"quarters": [None, 5, "q"]}, [_NO_QUARTER]),
    ({"quarters": [{"report_date": "garbage", "reported": True}]}, [_NO_QUARTER]),
    ({"quarters": [{"report_date": REPORT, "reported": True, "eps_actual": "1.47", "eps_estimate": float("nan"),
                    "label": 7}], "reaction": {"events": "x"}, "meta": {"retrieved_at": "soon"}},
     ["EPS: —", "Revenue: —", "Reaction: —"]),
    ({"quarters": [{"report_date": REPORT, "reported": True, "eps_actual": True, "revenue_actual": 1e400}],
      "reaction": [], "meta": None}, ["EPS: —", "Revenue: —", "Reaction: —"]),
    ({"quarters": [{"report_date": REPORT, "reported": True, "eps_actual": float("nan"),
                    "revenue_actual": float("-inf")}], "meta": _META}, ["EPS: —", "Revenue: —"]),
    ({"quarters": [{"report_date": REPORT, "reported": True, "eps_actual": 10 ** 400, "eps_estimate": 1,
                    "revenue_actual": -(10 ** 400)}], "meta": _META}, ["EPS: —", "Revenue: —"]),   # M3: no OverflowError
]


@pytest.mark.parametrize("bad, dashes", _BAD)
def test_malformed_earnings_data_never_fails_the_create_and_invents_nothing(member, monkeypatch, bad, dashes):
    """I2: not only "did not raise". The labelled dash must stand where the number would, and none of the values a
    careless read would invent may appear: a bool read as 1.0 ("$1.00"), nan, inf, or an overflowed int."""
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: bad)
    note, _ = _followup(member)
    assert note["id"]
    text = _happened(_body(note))
    for d in dashes:
        assert d in text, (d, text)
    low = text.lower()
    for invented in ("$1.00", "nan", "inf", "true", "e+", "$0.00"):
        assert invented not in low, (invented, text)


def test_as_number_is_only_a_real_finite_number():
    assert fp.as_number(1) == 1.0 and fp.as_number(-2.5) == -2.5 and fp.as_number(0) == 0.0
    for v in (True, False, None, "1.47", [], float("nan"), float("inf"), float("-inf"), 1e400, 10 ** 400, -(10 ** 400)):
        assert fp.as_number(v) is None, v


def _h(t):
    return {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": t}]}


def _outline_style(member, content):
    """A member Earnings follow-up style whose OUTLINE is `content`, written straight to the row so no cleaning
    step tidies it (tests/test_plan_prefill.py's `_outline_style` idiom, `:303-316`)."""
    s = journal_styles.create_style(UID, {"name": "my follow-up", "kindId": "earnings_followup",
                                          "outlineBodyJson": {"type": "doc", "content": [_h("Notes")]}, "blocks": []})
    member.conn.execute("UPDATE j2_journal_styles SET outline_body_json = ? WHERE id = ?",
                        (json.dumps({"type": "doc", "content": content}), s["id"]))
    member.conn.commit()
    return s


def test_a_member_outline_without_the_headings_still_gets_the_numbers(member):
    s = _outline_style(member, [_h("My take"), {"type": "paragraph"}])
    note, _ = journal_styles.create_styled_note(
        UID, {"styleId": s["id"], "ticker": "ORCL", "earningsFollowup": {"reportDate": REPORT}}, member.conn)
    body = _body(note)
    assert journal_styles._plain(body["content"][0]) == "My take"
    assert journal_styles._plain(body["content"][1]).startswith("Quarter:")      # after the first heading


def test_apply_on_a_doc_it_cannot_copy_or_walk_returns_it_unchanged(monkeypatch):
    """The Part A I4 lesson at the unit: `apply` never raises, and leaves the doc exactly as it was."""
    monkeypatch.setattr(fp, "prep_note", lambda *a: "n9")
    uncopyable = {"type": "doc", "content": [{"type": "paragraph", "attrs": {"x": (i for i in [])}}]}
    assert fp.apply(uncopyable, {"ticker": "ORCL", "user_id": UID}, None, REPORT) is uncopyable
    assert len(uncopyable["content"]) == 1
    not_a_list = {"type": "doc", "content": "not a list"}
    assert fp.apply(not_a_list, {"ticker": "ORCL", "user_id": UID}, None, REPORT) == {"type": "doc", "content": "not a list"}


def test_the_prefill_is_the_same_insert_no_second_revision(member):
    note, _ = _followup(member)
    assert note["createdAt"] == note["updatedAt"]


def test_the_numbers_are_never_read_as_plan_levels(member):
    member.prep(created="2026-10-13T14:00:00+00:00")
    note, _ = _followup(member)
    r = member.conn.execute("SELECT body_json, properties_json FROM j2_notes WHERE id = ?", (note["id"],)).fetchone()
    plan = plan_extract.read_note_plan(r["body_json"], r["properties_json"], None, "ORCL")
    assert all(plan.value(role) is None for role in ("entry", "stop", "target"))
    # F20b CONTROL: read_note_plan never raises and answers an empty reading on a body it cannot parse, so the
    # assertion above also passes over an unreadable body. The same call over a line that DOES name a level must read it.
    control = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Entry: 100"}]}]}
    assert plan_extract.read_note_plan(json.dumps(control), None, None, "ORCL").value("entry") == 100


def test_the_style_places_the_reminder_five_trading_days_out(member, monkeypatch):
    """M8: the create's clock is pinned (compose reads `datetime.now` in journal_styles), so this never reads the wall
    clock. Fri Nov 20 2026 plus five sessions: Nov 23, 24, 25, then Thanksgiving (the 26th) is skipped, 27, 30."""
    from api.services.journal_two import note_tasks, reminder_block

    class _Fixed(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 20, 14, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(journal_styles, "datetime", _Fixed)
    note, _ = _followup(member)
    tasks = note_tasks.extract_tasks(_body(note))
    assert [t["due"] for t in tasks] == ["2026-11-30"]
    assert reminder_block.add_trading_days(date(2026, 11, 20), 5).isoformat() == "2026-11-30"


@pytest.mark.parametrize("payload, sentence", [
    ({"kindId": "trade_plan", "ticker": "ORCL"}, fp.NEEDS_TICKER_SENTENCE),
    ({"kindId": "earnings_followup"}, fp.NEEDS_TICKER_SENTENCE),
    ({"kindId": "earnings_followup", "ticker": "ORCL", "reportDate": "2099-01-01"}, fp.DATE_SENTENCE),
    ({"kindId": "earnings_followup", "ticker": "ORCL", "reportDate": "2026-02-30"}, fp.DATE_SENTENCE),
    ({"kindId": "earnings_followup", "ticker": "ORCL", "reportDate": "2020-01-02"}, fp.DATE_SENTENCE),
])
def test_refusals(member, payload, sentence):
    payload = dict(payload)                                   # F20c: a rerun of the parametrize dict keeps its key
    report = payload.pop("reportDate", REPORT)
    with pytest.raises(journal_styles.StyleValidationError, match=re.escape(sentence)):
        journal_styles.create_styled_note(UID, {**payload, "earningsFollowup": {"reportDate": report}}, member.conn)


def test_switch_off_refuses_and_both_prefills_at_once_refuse(member, monkeypatch):
    with pytest.raises(journal_styles.StyleValidationError, match="Choose one"):
        journal_styles.create_styled_note(UID, {"kindId": "trade_plan", "ticker": "ORCL", "planPrefill": True,
                                                "earningsFollowup": {"reportDate": REPORT}}, member.conn)
    monkeypatch.delenv("NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED")
    with pytest.raises(journal_styles.StyleValidationError, match=re.escape(fp.OFF_SENTENCE)):
        _followup(member)


def test_without_the_payload_flag_the_style_is_only_the_outline(member):
    note, _ = journal_styles.create_styled_note(UID, {"kindId": "earnings_followup", "ticker": "ORCL"}, member.conn)
    text = _text(_body(note))
    assert "Quarter:" not in text and "Your prep note" not in text


def test_a_prep_note_is_dated_in_et_not_in_utc(member):
    """V5: createdAt is a UTC ISO string. 01:00 UTC on Oct 15 is 21:00 ET on Oct 14, the report day, so it counts;
    its UTC date (Oct 15) is after the report date. A `[:10]` read would drop it."""
    evening = member.prep(created="2026-10-15T01:00:00+00:00")
    assert fp._created_et_day("2026-10-15T01:00:00+00:00") == date(2026, 10, 14)
    assert _links(_body(_followup(member)[0])) == [evening["id"]]
    # and the other side of the same midnight: 05:00 UTC on Oct 15 is 01:00 ET on Oct 15, after the report day
    after = member.prep(created="2026-10-15T05:00:00+00:00")
    assert fp._created_et_day("2026-10-15T05:00:00+00:00") == date(2026, 10, 15)
    assert after["id"] != evening["id"]
    assert _links(_body(_followup(member)[0])) == [evening["id"]]


def test_the_newest_qualifying_prep_note_wins(member):
    older = member.prep(created="2026-10-10T14:00:00+00:00")
    newer = member.prep(created="2026-10-13T14:00:00+00:00")
    assert _links(_body(_followup(member)[0])) == [newer["id"]]
    assert older["id"] != newer["id"]


def test_the_report_date_window_is_120_days_back_and_never_ahead(member):
    """F1: the clock is `_today_et`, pinned. The 120-day edge is pinned on both sides, and tomorrow is refused."""
    edge = (TODAY - timedelta(days=fp.MAX_AGE_DAYS)).isoformat()
    assert fp.clean_request({"reportDate": edge}, kind_id=fp.FOLLOWUP_KIND, ticker="ORCL") == edge
    over = (TODAY - timedelta(days=fp.MAX_AGE_DAYS + 1)).isoformat()
    with pytest.raises(journal_styles.StyleValidationError, match=re.escape(fp.DATE_SENTENCE)):
        fp.clean_request({"reportDate": over}, kind_id=fp.FOLLOWUP_KIND, ticker="ORCL")
    assert fp.clean_request({"reportDate": TODAY.isoformat()}, kind_id=fp.FOLLOWUP_KIND, ticker="ORCL") == TODAY.isoformat()
    tomorrow = (TODAY + timedelta(days=1)).isoformat()
    with pytest.raises(journal_styles.StyleValidationError, match=re.escape(fp.DATE_SENTENCE)):
        fp.clean_request({"reportDate": tomorrow}, kind_id=fp.FOLLOWUP_KIND, ticker="ORCL")
    for bad in (None, "2026-10-1", 20261014, ["2026-10-14"], {"reportDate": None}):
        with pytest.raises(journal_styles.StyleValidationError):
            fp.clean_request(bad, kind_id=fp.FOLLOWUP_KIND, ticker="ORCL")


def test_the_clock_is_read_through_today_et_only(monkeypatch):
    """A caller that passes `today` wins; otherwise the pinned `_today_et` answers, never the wall clock."""
    monkeypatch.setattr(fp, "_today_et", lambda: date(2030, 1, 1))
    assert fp.clean_request({"reportDate": "2029-12-31"}, kind_id=fp.FOLLOWUP_KIND, ticker="ORCL") == "2029-12-31"
    assert fp.clean_request({"reportDate": "2026-10-14"}, kind_id=fp.FOLLOWUP_KIND, ticker="ORCL",
                            today=date(2026, 10, 15)) == "2026-10-14"


def test_the_ticker_shape_is_the_servers_own_validator(member):
    """A16 / F19: the shape is notes._validate_ticker, the one authority. A class share with a dot and a digit name are
    accepted by the server and so by the follow-up; a string the server refuses is refused here with the same sentence."""
    from api.services.journal_two import notes
    for sym in ("BRK.B", "BF-B", "X1"):
        assert notes._validate_ticker(sym) == sym and fp.valid_symbol(sym)
    for sym in ("bad ticker!", "A$B", "", None, 7, "X" * 40):
        assert not fp.valid_symbol(sym)
        with pytest.raises(journal_styles.StyleValidationError, match=re.escape(fp.NEEDS_TICKER_SENTENCE)):
            fp.clean_request({"reportDate": REPORT}, kind_id=fp.FOLLOWUP_KIND, ticker=sym)
    note, _ = _followup(member, ticker="BRK.B")
    assert note["id"] and note["ticker"] == "BRK.B"


def test_the_held_payload_is_only_read_never_written(member, monkeypatch):
    """Task 5 review: get_earnings_held hands back the SHARED cached object. Building a note must not touch it."""
    shared = copy.deepcopy(INTEL)
    snapshot = copy.deepcopy(shared)
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: shared)
    _followup(member)
    assert shared == snapshot


def test_the_source_time_comes_from_retrieved_at_alone(member, monkeypatch):
    """Only the memory layer carries meta.age_seconds / meta.stale; retrieved_at is on both layers. A payload with
    retrieved_at and nothing else dates its source line; one without says so instead of inventing a time."""
    held = copy.deepcopy(INTEL)
    held["meta"] = {"retrieved_at": INTEL["meta"]["retrieved_at"]}
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    assert "retrieved Oct 15, 2026, 4:52 PM ET." in _text(_body(_followup(member)[0]))
    held["meta"] = {"age_seconds": 30, "stale": False}
    assert "retrieved at a time not recorded." in _text(_body(_followup(member)[0]))


def test_the_create_makes_no_provider_call(member, monkeypatch):
    """The autouse fixture makes get_earnings raise; this adds the vendor seams the create door must never reach."""
    from api.services import finnhub_client
    monkeypatch.setattr(finnhub_client, "fh_get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("provider call")))
    note, _ = _followup(member)
    assert note["id"]


# ---- I1: the reporting currency ------------------------------------------------------------------------------------

def _twd():
    held = copy.deepcopy(INTEL)
    held["currency"] = "TWD"
    q = held["quarters"][0]
    q.update(eps_actual=17.44, eps_estimate=16.0, eps_surprise_pct=9.0,
             revenue_actual=2.9e12, revenue_estimate=2.8e12, rev_surprise_pct=3.6)
    return held


def test_a_non_usd_filer_gets_its_code_on_revenue_and_a_bare_eps(member, monkeypatch):
    """The repo's convention (useLatestReport.js, FundamentalsWidget.jsx): revenue carries the ISO code, EPS carries NO
    symbol, nothing is converted. TSM reports in TWD; "$17.44" would tell a member the wrong thing."""
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: _twd())
    text = _happened(_body(_followup(member)[0]))
    assert "EPS: 17.44 actual vs 16.00 expected (+9.0% surprise)." in text
    assert "Revenue: TWD 2.90T actual vs TWD 2.80T expected (+3.6% surprise)." in text
    assert "Revenue in TWD, the company's reporting currency. EPS carries no currency symbol" in text
    assert "$" not in text


@pytest.mark.parametrize("ccy", ["USD", "usd", None, "", 7, "TWDX", "T$D"])
def test_usd_and_an_unknown_currency_render_with_a_dollar_sign_as_before(member, monkeypatch, ccy):
    """The same convention: USD and an absent or unreadable currency render exactly as before ("$")."""
    held = copy.deepcopy(INTEL)
    held["currency"] = ccy
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _happened(_body(_followup(member)[0]))
    assert "EPS: $1.47 actual vs $1.42 expected (+3.5% surprise)." in text
    assert "Revenue: $15.2B actual vs $15.0B expected (+1.3% surprise)." in text
    assert "reporting currency" not in text


def test_a_lowercase_padded_code_is_normalised():
    assert fp.foreign_currency(" twd ") == "TWD" and fp.foreign_currency("USD") is None
    assert fp.foreign_currency(None) is None and fp.foreign_currency("TWDX") is None


# ---- I3: the surprise printed is the one earnings_intel STORED, never a recomputation ---------------------------------

def test_a_stored_none_surprise_prints_no_percent_tail(member, monkeypatch):
    """earnings_intel stores eps_surprise_pct=None when the estimate is near zero (|est| < 0.05): +0.04 on 0.01 would be
    +400%, which overstates a four-cent beat. The note must print no percent, not compute one."""
    held = copy.deepcopy(INTEL)
    held["quarters"][0].update(eps_actual=0.05, eps_estimate=0.01, eps_surprise_pct=None, eps_surprise_abs=0.04,
                               revenue_actual=15.2e9, revenue_estimate=15.0e9, rev_surprise_pct=None)
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _happened(_body(_followup(member)[0]))
    assert "EPS: $0.05 actual vs $0.01 expected." in text
    assert "Revenue: $15.2B actual vs $15.0B expected." in text
    assert "400" not in text and "surprise" not in text


def test_the_stored_surprise_wins_over_the_arithmetic(member, monkeypatch):
    held = copy.deepcopy(INTEL)
    held["quarters"][0].update(eps_surprise_pct=9.9)                 # the arithmetic on 1.47 vs 1.42 is +3.5
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _happened(_body(_followup(member)[0]))
    assert "(+9.9% surprise)" in text and "+3.5%" not in text


# ---- I4: a reaction is only printed once the session that traded the report has closed ---------------------------------

def _held_at(report, retrieved, drop_retrieved=False):
    held = copy.deepcopy(INTEL)
    held["quarters"][0]["report_date"] = report
    held["reaction"]["events"][1]["report_date"] = report
    held["meta"] = {} if drop_retrieved else {"retrieved_at": retrieved.timestamp()}
    return held


def _utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


@pytest.mark.parametrize("report, retrieved, shown", [
    ("2026-10-14", _utc(2026, 10, 14, 20, 52), False),    # an after-close report read the evening it came out
    ("2026-10-14", _utc(2026, 10, 15, 19, 59), False),    # one minute before the next session's 16:00 ET close
    ("2026-10-14", _utc(2026, 10, 15, 20, 0), True),      # exactly at that close
    ("2026-10-14", _utc(2026, 10, 16, 9, 0), True),
    ("2026-10-09", _utc(2026, 10, 10, 14, 0), False),     # a Friday report read Saturday: the date is later, the session is not
    ("2026-10-09", _utc(2026, 10, 12, 19, 59), False),    # Monday, one minute before the close
    ("2026-10-09", _utc(2026, 10, 12, 20, 0), True),
])
def test_the_reaction_waits_for_the_first_session_after_the_report_to_close(member, monkeypatch, report, retrieved, shown):
    """The event carries no session date and earnings_reaction._move_for falls back to the report-day session when the
    next one has no bar yet, so only the payload's retrieval time can say whether the move is the reaction."""
    held = _held_at(report, retrieved)
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _happened(_body(_followup(member, report=report)[0]))
    if shown:
        assert "Reaction: −4.2% close to close, on the session that first traded the result." in text
    else:
        assert "Reaction: — (not measured yet" in text and "−4.2%" not in text


def test_an_unknown_retrieval_time_means_no_reaction(member, monkeypatch):
    held = _held_at(REPORT, None, drop_retrieved=True)
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _happened(_body(_followup(member)[0]))
    assert "Reaction: — (not measured yet" in text and "−4.2%" not in text
    assert "retrieved at a time not recorded." in text


# ---- minors ---------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("offset, matched", [(3, True), (-3, True), (4, False), (-4, False)])
def test_the_match_window_is_three_days(member, monkeypatch, offset, matched):
    """M1: a provider can date one report a day or two apart; three matches and four is a different report."""
    held = copy.deepcopy(INTEL)
    held["quarters"][0]["report_date"] = (date.fromisoformat(REPORT) + timedelta(days=offset)).isoformat()
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _happened(_body(_followup(member)[0]))
    if matched:
        assert "Quarter: FY2027 Q1" in text
    else:
        assert "The numbers: — UCT's earnings data does not have the Oct 14, 2026 report yet." in text


def test_a_quarter_that_has_not_reported_is_never_used(member, monkeypatch):
    """The `reported` filter in quarter_for: an estimate-only row dated on the report day must not beat a reported
    quarter two days off."""
    held = copy.deepcopy(INTEL)
    held["quarters"] = [{"label": "FUTURE", "report_date": REPORT, "reported": False, "eps_actual": 9.99},
                        {"label": "REAL", "report_date": "2026-10-16", "reported": True, "eps_actual": 1.1}]
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: held)
    text = _happened(_body(_followup(member)[0]))
    assert "Quarter: REAL" in text and "FUTURE" not in text and "9.99" not in text
    assert fp.quarter_for(held, REPORT)["label"] == "REAL"
    held["quarters"] = held["quarters"][:1]
    assert fp.quarter_for(held, REPORT) is None


def test_an_archived_prep_note_is_never_linked(member):
    """M4: an archived note is out of the library; the follow-up must not point at it."""
    kept = member.prep(created="2026-10-12T14:00:00+00:00")
    gone = member.prep(created="2026-10-13T14:00:00+00:00")
    member.conn.execute("UPDATE j2_notes SET archived_at = ? WHERE id = ?", ("2026-10-14T12:00:00+00:00", gone["id"]))
    member.conn.commit()
    assert _links(_body(_followup(member)[0])) == [kept["id"]]


def test_other_names_prep_notes_never_use_up_the_scan_window(member, monkeypatch):
    """M5: the ticker goes to list_notes, so a member with many newer prep notes on OTHER names still gets the link."""
    monkeypatch.setattr(fp, "PREP_SCAN", 3)
    mine = member.prep(created="2026-10-01T14:00:00+00:00")
    for day in (5, 6, 7, 8):
        member.prep(ticker="AMD", created=f"2026-10-0{day}T14:00:00+00:00")
    assert _links(_body(_followup(member)[0])) == [mine["id"]]


def test_the_tag_and_the_date_sentence_are_derived_not_restated():
    """M6: PREP_TAG is sample_examples.EARNINGS_PREP_TAG; the sentence names MAX_AGE_DAYS."""
    import inspect
    from api.services.journal_two import sample_examples
    assert fp.PREP_TAG == sample_examples.EARNINGS_PREP_TAG
    assert '"earnings-prep"' not in inspect.getsource(fp)                  # imported, never respelled here
    assert fp.DATE_SENTENCE == f"Choose a report date from the last {fp.MAX_AGE_DAYS} days."


def test_the_numbers_come_through_the_real_held_read(member, monkeypatch):
    """M7: every other test replaces get_earnings_held. This one uses the real function over a payload seeded in the
    memory layer the way earnings_intel itself would hold it, so a renamed key or a changed return shape is seen."""
    key = f"{earnings_intel._KIND}::ORCL"
    cache.set(key, copy.deepcopy(INTEL), 300)
    try:
        monkeypatch.setattr(earnings_intel, "get_earnings_held", _REAL_HELD)
        assert earnings_intel.get_earnings_held("ORCL")["ticker"] == "ORCL"
        text = _happened(_body(_followup(member)[0]))
        assert "EPS: $1.47 actual vs $1.42 expected (+3.5% surprise)." in text
        assert "Reaction: −4.2% close to close" in text
    finally:
        cache.invalidate(key)
