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
from api.services.journal_two import followup_prefill as fp, journal_styles, plan_extract, sample_marker

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
    "meta": {"retrieved_at": datetime(2026, 10, 14, 20, 52, tzinfo=timezone.utc).timestamp()},
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
    assert "Source: UCT earnings data (consensus estimates and reported results), retrieved Oct 14, 2026, 4:52 PM ET." in text
    heads = [journal_styles._plain(n) for n in body["content"] if n.get("type") == "heading"]
    assert heads == list(journal_styles.FOLLOWUP_HEADINGS)
    i_happened = [journal_styles._plain(n) for n in body["content"]].index(journal_styles.FOLLOWUP_HEADINGS[1])
    assert journal_styles._plain(body["content"][i_happened + 1]).startswith("Quarter:")


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


@pytest.mark.parametrize("bad", [
    "not a dict", {"quarters": "x"}, {"quarters": [None, 5, "q"]},
    {"quarters": [{"report_date": "garbage", "reported": True}]},
    {"quarters": [{"report_date": REPORT, "reported": True, "eps_actual": "1.47", "eps_estimate": float("nan"),
                   "label": 7}], "reaction": {"events": "x"}, "meta": {"retrieved_at": "soon"}},
    {"quarters": [{"report_date": REPORT, "reported": True, "eps_actual": True, "revenue_actual": 1e400}],
     "reaction": [], "meta": None},
])
def test_malformed_earnings_data_never_fails_the_create(member, monkeypatch, bad):
    monkeypatch.setattr(earnings_intel, "get_earnings_held", lambda sym: bad)
    note, _ = _followup(member)
    assert note["id"]


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


def test_the_style_places_the_reminder_five_trading_days_out(member):
    from api.services.journal_two import note_tasks, reminder_block
    note, _ = _followup(member)
    tasks = note_tasks.extract_tasks(_body(note))
    today_et = datetime.now(timezone.utc).astimezone(reminder_block.ET).date()
    assert [t["due"] for t in tasks] == [reminder_block.add_trading_days(today_et, 5).isoformat()]


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
    assert "retrieved Oct 14, 2026, 4:52 PM ET." in _text(_body(_followup(member)[0]))
    held["meta"] = {"age_seconds": 30, "stale": False}
    assert "retrieved at a time not recorded." in _text(_body(_followup(member)[0]))


def test_the_create_makes_no_provider_call(member, monkeypatch):
    """The autouse fixture makes get_earnings raise; this adds the vendor seams the create door must never reach."""
    from api.services import finnhub_client
    monkeypatch.setattr(finnhub_client, "fh_get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("provider call")))
    note, _ = _followup(member)
    assert note["id"]
