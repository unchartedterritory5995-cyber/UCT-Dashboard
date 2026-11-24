"""FED, the Terminal's Fed watch (`api/services/fed_watch.py`, `fed_watch_parse.py`, the route).

EVERY SAMPLE HERE IS INVENTED: the feed items, the statement sentences, the projections, the survey
answers and the headlines are made up in the SHAPE of the public pages (read once on 2026-11-21,
never copied). No test asks a website: the one HTTP reader is replaced by a fake that counts.

  * the parsers: the Board's RSS, a statement page, the redline, the projections table, the survey
    workbook, the Fed headline words, the calendar's FOMC rows;
  * the reader: nothing is fetched on the request, one fetch per feed per lifetime, a statement page
    is read once for good, refusals / failures / bad shapes are answers and are remembered, a restart
    answers from disk, `held_answer` never fetches;
  * the blocks: headlines from the store (bounded, newest first), the calendar's next meeting and
    this week's speakers, the rates (null with a reason, never 0);
  * the route: one paid GET, 401 / 402, its own gate, a plain def, mounted.
"""
from __future__ import annotations

import io
import pathlib
import threading
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import fed_watch as route
from api.services import fed_watch as fw
from api.services import fed_watch_parse as P

NY = ZoneInfo("America/New_York")
B = "https://www.federalreserve.gov"
FREE_USER = {"id": "fw-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "fw-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}


# ── invented samples in the public pages' shapes ───────────────────────────────────────────────

def rss(title: str, items: list[tuple[str, str, str, str]]) -> bytes:
    """(title, link, description, pubDate) items as one Board-style RSS 2.0 feed, with its BOM."""
    body = "".join(
        f"<item><title>{t}</title><link><![CDATA[{ln}]]></link><guid><![CDATA[{ln}]]></guid>"
        f"<description><![CDATA[{d}]]></description><category>Invented</category>"
        f"<pubDate><![CDATA[{pd}]]></pubDate></item>" for t, ln, d, pd in items)
    return ("﻿<?xml version=\"1.0\" encoding=\"utf-8\" ?><rss version=\"2.0\"><channel>"
            f"<title>{title}</title><link><![CDATA[{B}/feeds/feeds.htm]]></link>{body}</channel></rss>").encode("utf-8")


MONETARY = rss("FRB: Press Release - Monetary Policy", [
    ("Minutes of the Federal Open Market Committee, March 3-4, 2031", f"{B}/newsevents/pressreleases/monetary20310325a.htm",
     "Minutes", "Tue, 25 Mar 2031 18:00:00 GMT"),
    ("Federal Reserve issues FOMC statement", f"{B}/newsevents/pressreleases/monetary20310304a.htm",
     "Statement", "Tue, 04 Mar 2031 19:00:00 GMT"),
    ("Federal Reserve Board and Federal Open Market Committee release economic projections from the March 3-4 FOMC meeting",
     f"{B}/newsevents/pressreleases/monetary20310304b.htm", "Projections", "Tue, 04 Mar 2031 19:00:00 GMT"),
    ("Federal Reserve issues FOMC statement on longer-run goals", f"{B}/newsevents/pressreleases/monetary20310201a.htm",
     "Goals", "Sat, 01 Feb 2031 19:00:00 GMT"),
    ("Federal Reserve issues FOMC statement", f"{B}/newsevents/pressreleases/monetary20310128a.htm",
     "Statement", "Tue, 28 Jan 2031 19:00:00 GMT"),
])
SPEECHES = rss("FRB: Speeches", [
    ("Quillfeather, Notes on Orchard Credit", f"{B}/newsevents/speech/quillfeather20310320a.htm",
     "Speech At the Invented Lending Forum, Lakeview, Minnesota", "Thu, 20 Mar 2031 15:00:00 GMT"),
    ("Brindlewood, Opening Remarks", f"{B}/newsevents/speech/brindlewood20310318a.htm",
     "Speech At the Example Conference, Bras&iacute;lia, Brazil", "Tue, 18 Mar 2031 13:00:00 GMT"),
])
TESTIMONY = rss("FRB: Testimony", [
    ("Quillfeather, Semiannual Invented Report", f"{B}/newsevents/testimony/quillfeather20310319a.htm",
     "Testimony Before the Committee on Invented Affairs", "Wed, 19 Mar 2031 14:00:00 GMT"),
])


def statement_page(date_text: str, paragraphs: list[str], impl: str = "monetary20310304a1") -> bytes:
    body = "\n".join(f"<p>{p}</p>" for p in paragraphs)
    return (f'<html><body><div id="article"><div class="heading"><p class="article__time">{date_text}</p>'
            f'<h3 class="title">Federal Reserve issues FOMC statement</h3><p class="releaseTime">For release</p></div>'
            f'<div class="col-xs-12">{body}<p>&nbsp;</p>'
            f'<p>For media inquiries, please call the invented desk.</p>'
            f'<p><a href="/newsevents/pressreleases/{impl}.htm">Implementation Note issued {date_text}</a></p>'
            f'</div></div><div id="lastUpdate">Last Update</div></body></html>').encode("utf-8")


OLD_WORDS = ["The Committee voted 9-1 on this invented statement.",
             "Orchard output grew at a calm pace. Invented prices rose slowly.",
             "The Committee decided to keep the target range at 7-1/4 to 7-1/2 percent."]
NEW_WORDS = ["The Committee voted 10-0 on this invented statement.",
             "Orchard output grew at a brisk pace. Invented prices rose slowly.",
             "The Committee decided to lower the target range to 7 to 7-1/4 percent.",
             "Voting for the action were every invented member."]
STATEMENT_NEW = statement_page("March 4, 2031", NEW_WORDS)
STATEMENT_OLD = statement_page("January 28, 2031", OLD_WORDS, impl="monetary20310128a1")

PROJECTIONS = ("""<html><h3>March 4, 2031: FOMC Projections materials, accessible version </h3>
<table aria-labelledby="xt1 xt1p1b" class="pubtables"><thead><tr>
<th class="colhead" id="xt1a1" rowspan="2">Variable</th>
<th class="colhead" colspan="4" id="xt1a2">Median<a href="#f1"><sup>1</sup></a></th>
<th class="colhead" colspan="4" id="xt1a3">Central Tendency</th></tr><tr>
<th class="colhead" headers="xt1a2" id="xt1b1">2031</th><th class="colhead" headers="xt1a2" id="xt1b2">2032</th>
<th class="colhead" headers="xt1a2" id="xt1b3">2033</th><th class="colhead" headers="xt1a2" id="xt1b4">Longer run</th>
<th class="colhead" headers="xt1a3" id="xt1b5">2031</th><th class="colhead" headers="xt1a3" id="xt1b6">2032</th>
<th class="colhead" headers="xt1a3" id="xt1b7">2033</th><th class="colhead" headers="xt1a3" id="xt1b8">Longer run</th>
</tr></thead><tbody>
<tr><th class="stub" headers="xt1a1" id="xt1r1">Unemployment rate</th>
<td class="data" headers="xt1a2 xt1b1 xt1r1">8.8</td><td class="data" headers="xt1a2 xt1b2 xt1r1">8.7</td>
<td class="data" headers="xt1a2 xt1b3 xt1r1">8.6</td><td class="data" headers="xt1a2 xt1b4 xt1r1">8.5</td></tr>
<tr><th class="stub" headers="xt1a1" id="xt1r9">Federal funds rate</th>
<td class="data" headers="xt1a2 xt1b1 xt1r9">7.4</td><td class="data" headers="xt1a2 xt1b2 xt1r9">6.9</td>
<td class="data" headers="xt1a2 xt1b3 xt1r9">6.4</td><td class="data" headers="xt1a2 xt1b4 xt1r9">5.9</td>
<td class="data" headers="xt1a3 xt1b5 xt1r9">7.1&#8211;7.6</td><td class="data" headers="xt1a3 xt1b6 xt1r9">6.4&#8211;7.1</td>
<td class="data" headers="xt1a3 xt1b7 xt1r9">6.1&#8211;6.9</td><td class="data" headers="xt1a3 xt1b8 xt1r9">5.6&#8211;6.1</td></tr>
<tr><th class="stub in1" headers="xt1a1 xt1r9" id="xt1r10">December projection</th>
<td class="data" headers="xt1a2 xt1b1 xt1r9 xt1r10">7.9</td></tr>
</tbody></table></html>""").encode("utf-8")

SURVEY_PAGE = (b'<html><table><tr><td><a href="/medialibrary/media/markets/survey/2031/jan-2031-data.xlsx">Data</a></td></tr>'
               b'<tr><td><a href="/medialibrary/media/markets/survey/2031/mar-2031-data.xlsx">Data</a></td></tr>'
               b'<tr><td><a href="/medialibrary/media/markets/survey/2030/dec-2031-data.xlsx">Odd</a></td></tr></table></html>')
SURVEY_FILE_URL = "https://www.newyorkfed.org/medialibrary/media/markets/survey/2031/mar-2031-data.xlsx"

COLUMNS = ["survey_release_date", "survey_due_date", "panel_type", "subject", "question_type", "question_tag",
           "top_header_value", "left_header_value", "horizon", "horizon_date", "bucket_range", "bucket_low",
           "bucket_high", "aggregation", "aggregation_value"]


def survey_rows() -> list[list]:
    rows = []
    base = ["2031-02-17", "2031-02-21"]
    for panel in ("Combined", "Dealer"):
        for label, day, med in (("Mar. 3-4 2031", "2031-03-04", 0.0738), ("Apr. 28-29 2031", "2031-04-29", 0.0713),
                                ("Jun. 9-10 2031", "2031-06-10", 0.0688), ("Jul. 28-29 2031", "2031-07-29", 0.0688),
                                ("Sep. 15-16 2031", "2031-09-16", 0.0663), ("2032 Q1", "2032-03-31", 0.0638)):
            for agg, val in (("count", 41), ("pctl25", med - 0.0025), ("pctl50", med if panel == "Combined" else 0.5),
                             ("pctl75", med + 0.0025)):
                rows.append(base + [panel, "fed_funds_target_range", "path_of_modes", "fftr_pathofmodes", label,
                                    "Target rate / midpoint of target range", label, day, None, None, None, agg, val])
        for tag, left, horizon, day in (("fftr_probdist_20310304", "March 3-4", "Mar 3-4", "2031-03-04"),
                                        ("fftr_probdist_2031", "Year-end 2031", "2031", "2031-12-31"),
                                        ("fftr_probdist_longerrun", None, "Longer run", None)):
            for rng, low, high, p in (("<= 6.50%", None, 0.065, 0.05), ("6.51 - 6.75%", 0.0651, 0.0675, 0.15),
                                      ("6.76 - 7.00%", 0.0676, 0.07, 0.5), (">= 7.01%", 0.0701, None, 0.3)):
                for agg, val in (("count", 40), ("avg", p)):
                    rows.append(base + [panel, "fed_funds_target_range", "probability_distribution", tag, rng, left,
                                        horizon, day, rng, low, high, agg, val])
    rows.append(base + ["Combined", "unemployment_rate", "path_of_modes", "ur", "2031", None, "2031", "2031-12-31",
                        None, None, None, "pctl50", 0.088])
    return rows


def xlsx(header: list[str], rows: list[list], doctype: bool = False) -> bytes:
    """A minimal workbook in the shape the survey file has (shared strings, one sheet)."""
    shared: list[str] = []

    def sidx(v: str) -> int:
        if v not in shared:
            shared.append(v)
        return shared.index(v)

    def col(i: int) -> str:
        s = ""
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s

    out_rows = []
    for ri, row in enumerate([header] + rows, start=1):
        cells = []
        for ci, v in enumerate(row):
            if v is None:
                continue
            ref = f"{col(ci)}{ri}"
            if isinstance(v, str):
                cells.append(f'<c r="{ref}" t="s"><v>{sidx(v)}</v></c>')
            else:
                cells.append(f'<c r="{ref}"><v>{v}</v></c>')
        out_rows.append(f'<row r="{ri}">{"".join(cells)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    dt = '<!DOCTYPE x [<!ENTITY a "b">]>' if doctype else ""
    sheet = f'<?xml version="1.0"?>{dt}<worksheet {ns}><sheetData>{"".join(out_rows)}</sheetData></worksheet>'
    sst = f'<?xml version="1.0"?><sst {ns}>' + "".join(f"<si><t>{escape(s)}</t></si>" for s in shared) + "</sst>"
    wb = (f'<?xml version="1.0"?><workbook {ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
          '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
    rels = ('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/sharedStrings.xml", sst)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


SURVEY_FILE = xlsx(COLUMNS, survey_rows())


# ── the parsers ────────────────────────────────────────────────────────────────────────────────

def test_rss_items_come_in_feed_order_with_utc_times_and_board_links_only():
    feed = rss("x", [("A title &amp; more", f"{B}/a.htm", "Speech At Caf&eacute; Place", "Wed, 05 Mar 2031 15:30:00 GMT"),
                     ("Elsewhere", "https://example.test/a.htm", "d", "not a date")])
    items = P.parse_rss(feed)
    assert [i["title"] for i in items] == ["A title & more", "Elsewhere"]
    assert items[0] == {"title": "A title & more", "link": f"{B}/a.htm", "description": "Speech At Café Place",
                        "published": "2031-03-05T15:30:00+00:00", "category": "Invented"}
    assert items[1]["link"] is None and items[1]["published"] is None       # never followed, never guessed


@pytest.mark.parametrize("body, why", [
    (b"", "an empty answer"),
    (b"<!DOCTYPE html><html><body>maintenance</body></html>", "a web page"),
    (b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "b">]><rss><channel/></rss>', "document type"),
    (b'<?xml version="1.0"?><feed></feed>', "not an RSS feed"),
    (b"<rss><channel>", "not well formed"),
])
def test_a_body_that_is_not_a_feed_is_refused_in_words(body, why):
    with pytest.raises(P.Shape) as err:
        P.parse_rss(body)
    assert why in err.value.why


def test_only_an_exactly_titled_statement_on_the_board_host_counts_newest_first():
    items = P.parse_rss(MONETARY) + [{"title": "Federal Reserve issues FOMC statement", "link": None}]
    got = P.statement_items(items)
    assert [(s["date"], s["url"].rsplit("/", 1)[1]) for s in got] == [
        ("2031-03-04", "monetary20310304a.htm"), ("2031-01-28", "monetary20310128a.htm")]
    assert P.minutes_item(items) == {"meeting": "March 3-4, 2031", "url": f"{B}/newsevents/pressreleases/monetary20310325a.htm",
                                     "date": "2031-03-25"}
    assert P.projections_item(items) == {
        "meeting": "March 3-4", "date": "2031-03-04", "release_url": f"{B}/newsevents/pressreleases/monetary20310304b.htm",
        "table_url": f"{B}/monetarypolicy/fomcprojtabl20310304.htm"}


def test_speeches_name_the_speaker_and_where_and_the_merge_is_bounded_newest_first():
    sp = P.speech_items(P.parse_rss(SPEECHES), "speech")
    assert sp[0]["speaker"] == "Quillfeather" and sp[0]["title"] == "Notes on Orchard Credit"
    assert sp[0]["where"] == "the Invented Lending Forum, Lakeview, Minnesota"
    assert sp[1]["where"] == "the Example Conference, Brasília, Brazil"
    many = [{"kind": "speech", "speaker": "X", "title": str(i), "published": f"2031-03-{i:02d}T00:00:00+00:00"} for i in range(1, 21)]
    top, total = P.merge_speeches(many)
    assert total == 20 and len(top) == P.MAX_SPEECHES == 15 and top[0]["title"] == "20" and top[-1]["title"] == "6"
    assert P.speech_items([{"title": "No comma here", "link": None}], "speech")[0]["speaker"] is None


def test_a_statement_page_gives_the_boards_paragraphs_up_to_the_media_line_and_the_note_link():
    got = P.extract_statement(STATEMENT_NEW)
    assert got["paragraphs"] == NEW_WORDS
    assert got["date_text"] == "March 4, 2031"
    assert got["implementation_note_url"] == f"{B}/newsevents/pressreleases/monetary20310304a1.htm"


@pytest.mark.parametrize("body", [b"", b"<html>nothing here</html>",
                                  b'<div id="article"><p>One paragraph only about orchards.</p></div>'])
def test_a_page_that_is_not_a_statement_is_refused(body):
    with pytest.raises(P.Shape):
        P.extract_statement(body)


def test_the_redline_marks_added_and_removed_words_in_the_new_statements_order():
    red = P.redline(OLD_WORDS, NEW_WORDS)
    assert red["state"] == "ok"
    ops = [(s["op"], s["text"]) for s in red["segments"]]
    assert ops[:5] == [("same", "The Committee voted"), ("removed", "9-1"), ("added", "10-0"),
                       ("same", "on this invented statement."), ("break", "")]
    assert ("removed", "calm") in ops and ("added", "brisk") in ops
    assert ("added", "Voting for the action were every invented member.") in ops
    # the new statement reads back whole from its same and added words
    rebuilt = " ".join(s["text"] for s in red["segments"] if s["op"] in ("same", "added"))
    assert rebuilt.split() == " ".join(NEW_WORDS).split()
    gone = " ".join(s["text"] for s in red["segments"] if s["op"] in ("same", "removed"))
    assert gone.split() == " ".join(OLD_WORDS).split()
    assert red["added"] == sum(len(s["text"].split()) for s in red["segments"] if s["op"] == "added")
    assert red["removed"] == sum(len(s["text"].split()) for s in red["segments"] if s["op"] == "removed")


def test_the_redline_of_identical_statements_is_same_and_an_oversized_one_is_refused():
    same = P.redline(NEW_WORDS, NEW_WORDS)
    assert same["state"] == "same" and same["added"] == same["removed"] == 0
    assert all(s["op"] in ("same", "break") for s in same["segments"])
    huge = ["word " * (P.MAX_STATEMENT_WORDS + 1)]
    assert P.redline(huge, NEW_WORDS)["state"] == "too_long"


def test_the_projections_page_gives_the_median_fed_funds_path_in_table_order():
    got = P.parse_projections(PROJECTIONS)
    assert got == {"medians": [{"label": "2031", "value": 7.4}, {"label": "2032", "value": 6.9},
                               {"label": "2033", "value": 6.4}, {"label": "Longer run", "value": 5.9}],
                   "materials_date": "March 4, 2031"}


def test_a_projections_page_without_the_row_or_with_too_few_medians_is_refused():
    with pytest.raises(P.Shape):
        P.parse_projections(PROJECTIONS.replace(b">Federal funds rate<", b">Something else<"))
    thin = PROJECTIONS.replace(b">6.9<", b">n.a.<").replace(b">6.4<", b">&nbsp;<")
    with pytest.raises(P.Shape):
        P.parse_projections(thin)


def test_the_survey_page_links_name_the_newest_data_file_and_ignore_a_mismatched_one():
    links = P.survey_data_links(SURVEY_PAGE)
    assert [ln["url"] for ln in links] == [SURVEY_FILE_URL,
                                           "https://www.newyorkfed.org/medialibrary/media/markets/survey/2031/jan-2031-data.xlsx"]


def test_the_survey_workbook_gives_the_combined_panels_path_and_probabilities_in_percent():
    ex = P.survey_extract(P.read_xlsx_rows(SURVEY_FILE))
    assert ex["questions_sent"] == "2031-02-17" and ex["responses_due"] == "2031-02-21"
    assert [h["label"] for h in ex["path"]][:2] == ["Mar. 3-4 2031", "Apr. 28-29 2031"]
    assert ex["path"][1] == {"label": "Apr. 28-29 2031", "date": "2031-04-29", "median": 7.13, "p25": 6.88, "p75": 7.38,
                             "respondents": 41}
    year_end = next(d for d in ex["distributions"] if d["label"] == "Year-end 2031")
    assert year_end["respondents"] == 40
    assert [(b["range"], b["probability"]) for b in year_end["buckets"]] == [
        ("<= 6.50%", 5.0), ("6.51 - 6.75%", 15.0), ("6.76 - 7.00%", 50.0), (">= 7.01%", 30.0)]
    assert next(d for d in ex["distributions"] if d["label"] == "Longer run")["date"] is None


def test_the_survey_view_keeps_only_what_is_ahead_and_says_what_passed():
    ex = P.survey_extract(P.read_xlsx_rows(SURVEY_FILE))
    v = P.survey_view(ex, "2031-03-20")
    assert v["before_meeting"] == {"label": "Mar. 3-4 2031", "date": "2031-03-04"}
    assert [h["label"] for h in v["path"]] == ["Apr. 28-29 2031", "Jun. 9-10 2031", "Jul. 28-29 2031"]   # quarters are not meetings
    assert [d["label"] for d in v["distributions"]] == ["Year-end 2031", "Longer run"]
    assert v["passed"] == 1 and v["more"] == 0
    assert P.next_meeting_from_survey(ex, "2031-03-20") == {"label": "Apr. 28-29 2031", "date": "2031-04-29"}
    assert P.next_meeting_from_survey(ex, "2033-01-01") is None


@pytest.mark.parametrize("body", [b"not a zip", xlsx(COLUMNS, survey_rows()[:3], doctype=True)])
def test_a_body_that_is_not_the_workbook_is_refused(body):
    with pytest.raises(P.Shape):
        P.read_xlsx_rows(body)


def test_a_workbook_without_the_target_rate_questions_is_refused():
    rows = [r for r in survey_rows() if r[3] != "fed_funds_target_range"]
    with pytest.raises(P.Shape):
        P.survey_extract(P.read_xlsx_rows(xlsx(COLUMNS, rows)))


ROSTER = ["Barr", "Cook", "Powell", "Waller", "Warsh", "Williams", "Logan"]


@pytest.mark.parametrize("text", [
    "Fed's Quillfeather says the invented outlook is balanced",
    "FED HOLDS RATES IN AN INVENTED DECISION",
    "FOMC minutes show an invented debate",
    "Markets eye the Federal Reserve after an invented report",
    "WALLER: INVENTED REMARKS ON BALANCE SHEET",
    "Waller says invented inflation is easing",
    "Fed Chair Warsh speaks on an invented topic",
    "Governor Cook sees invented risks",
    "President Williams comments on invented funding markets",
    "Traders price the fed funds path after Powell testifies",
])
def test_a_fed_headline_is_caught(text):
    assert P.is_fed_headline(text, ROSTER)


@pytest.mark.parametrize("text", [
    "FedEx raises invented guidance",
    "Federated Hermes launches an invented fund",
    "Consumers fed up with invented fees",
    "Cook says the invented phone sold well",                 # an ambiguous surname with a verb alone
    "Williams-Sonoma posts invented results",
    "Barrel prices rise in an invented market",
    "Logan airport traffic sets an invented record",
    "Powell Industries wins an invented contract",           # a surname with no role, quote or verb
    "",
    None,
])
def test_a_headline_that_is_not_about_the_fed_is_not(text):
    assert not P.is_fed_headline(text, ROSTER)


def test_the_calendar_names_the_fomc_decision_not_its_minutes_and_lists_this_weeks_speakers_in_order():
    assert P.is_fomc_decision("FOMC Statement") and P.is_fomc_decision("Fed Interest Rate Decision")
    assert not P.is_fomc_decision("FOMC Meeting Minutes") and not P.is_fomc_decision("FOMC Press Conference")
    days = P.calendar_days([
        {"days": {"2031-03-17": {"econ": [{"time": "10:00 AM", "event": "Invented Sales"}],
                                 "fed": [{"time": "1:00 PM", "event": "Fed Quillfeather Speech"},
                                         {"time": "9:00 AM", "event": "Fed Brindlewood Speech"}]},
                  "2031-03-19": {"econ": [{"time": "2:00 PM", "event": "FOMC Meeting Minutes"}], "fed": []}}},
        {"days": {"2031-04-29": {"econ": [{"time": "2:00 PM", "event": "FOMC Statement"}], "fed": []}}},
        None,
    ])
    assert P.next_meeting_from_calendar(days, "2031-03-18") == {"date": "2031-04-29", "time": "2:00 PM", "event": "FOMC Statement"}
    assert P.next_meeting_from_calendar(days, "2031-04-30") is None
    rows, total = P.week_speakers(days, "2031-03-17", "2031-03-21")
    assert total == 2 and [r["event"] for r in rows] == ["Fed Brindlewood Speech", "Fed Quillfeather Speech"]
    assert P.week_speakers(days, "2031-03-17", "2031-03-21", limit=1)[0] == rows[:1]


# ── the reader: fetching, holding, refreshing ─────────────────────────────────────────────────

ANSWERS = {
    fw.FEEDS["monetary"]: (200, MONETARY),
    fw.FEEDS["speeches"]: (200, SPEECHES),
    fw.FEEDS["testimony"]: (200, TESTIMONY),
    f"{B}/newsevents/pressreleases/monetary20310304a.htm": (200, STATEMENT_NEW),
    f"{B}/newsevents/pressreleases/monetary20310128a.htm": (200, STATEMENT_OLD),
    f"{B}/monetarypolicy/fomcprojtabl20310304.htm": (200, PROJECTIONS),
    fw.SURVEY_PAGE_URL: (200, SURVEY_PAGE),
    SURVEY_FILE_URL: (200, SURVEY_FILE),
}


@pytest.fixture
def web(tmp_path, monkeypatch):
    """A fresh module with a data folder of its own, a fixed clock, no pauses, and the ONE HTTP
    reader replaced by a fake that serves the invented answers and records every URL asked."""
    fw.reset_for_tests()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ECON_ENABLED", raising=False)
    monkeypatch.setattr(fw, "now_et", lambda: datetime(2031, 3, 20, 11, 0, tzinfo=NY))
    monkeypatch.setattr(fw, "_pause", lambda s: None)
    monkeypatch.setattr(fw, "headlines_block", lambda: {"state": "off", "items": [], "source": fw.SOURCE_TX})
    monkeypatch.setattr(fw, "_calendar_payloads", lambda today: [])
    answers = dict(ANSWERS)
    asked: list[str] = []

    def fake_get(url, accept, max_bytes):
        asked.append(url)
        hit = answers.get(url)
        if hit is None:
            return 404, "text/html", b"not here"
        if isinstance(hit, Exception):
            raise hit
        return hit[0], "text/xml", hit[1]

    monkeypatch.setattr(fw, "_http_get", fake_get)
    yield answers, asked
    fw.reset_for_tests()


def test_the_first_request_builds_once_in_the_background_and_every_board_block_is_filled(web):
    answers, asked = web
    got = fw.get_fed_watch(wait_s=10)
    assert set(asked) == set(ANSWERS)                                  # each address once, nothing else
    assert len(asked) == len(ANSWERS)
    st = got["statement"]
    assert st["state"] == "ok" and st["date"] == "2031-03-04" and st["source"] == "Federal Reserve Board"
    assert st["redline"]["state"] == "ok" and st["redline"]["previous"]["date"] == "2031-01-28"
    assert ("added", "10-0") in [(s["op"], s["text"]) for s in st["redline"]["segments"]]
    assert st["minutes"]["meeting"] == "March 3-4, 2031"
    assert st["implementation_note_url"].endswith("monetary20310304a1.htm")
    sp = got["speeches"]
    assert sp["state"] == "ok" and sp["total"] == 3 and [s["kind"] for s in sp["items"]] == ["speech", "testimony", "speech"]
    pr = got["projections"]
    assert pr["state"] == "ok" and pr["date"] == "2031-03-04" and pr["medians"][0] == {"label": "2031", "value": 7.4}
    sv = got["survey"]
    assert sv["state"] == "ok" and sv["survey"] == "March 2031" and sv["source"] == "Federal Reserve Bank of New York"
    assert sv["credit"].startswith("© 2031 Federal Reserve Bank of New York")
    assert [h["label"] for h in sv["path"]] == ["Apr. 28-29 2031", "Jun. 9-10 2031", "Jul. 28-29 2031"]
    assert got["calendar"]["next_meeting"] == {
        "state": "ok", "date": "2031-04-29", "time": None, "event": None, "label": "Apr. 28-29 2031",
        "source": "Federal Reserve Bank of New York (the meeting dates in its Survey of Market Expectations)",
        "days_to_go": 40}
    assert got["board_cite"] == "Source: Board of Governors of the Federal Reserve System."


def test_a_second_request_in_the_lifetime_makes_no_fetch_and_a_statement_is_never_read_twice(web):
    answers, asked = web
    fw.get_fed_watch(wait_s=10)
    n = len(asked)
    for _ in range(5):
        fw.get_fed_watch(wait_s=10)
    assert len(asked) == n                                             # the lifetime holds, whatever the callers
    with fw._lock:                                                     # the feeds' lifetime runs out
        for f in fw._state["feeds"].values():
            f["checked"] -= fw.FEED_TTL_DAY_S + 1
    fw.get_fed_watch(wait_s=10)
    _wait_idle()
    assert sorted(asked[n:]) == sorted(fw.FEEDS.values())             # the three feeds only; the pages are held for good


def _wait_idle(timeout: float = 10.0) -> None:
    with fw._lock:
        ev = fw._state["inflight"]
    if ev is not None:
        ev.wait(timeout)


def test_the_feed_lifetime_is_ten_minutes_in_working_hours_and_an_hour_otherwise():
    assert fw.feed_ttl(datetime(2031, 3, 20, 11, 0, tzinfo=NY)) == 600.0
    assert fw.feed_ttl(datetime(2031, 3, 20, 21, 0, tzinfo=NY)) == 3600.0
    assert fw.feed_ttl(datetime(2031, 3, 22, 11, 0, tzinfo=NY)) == 3600.0         # a Saturday


def test_a_refused_feed_is_an_answer_and_is_not_asked_again_inside_its_hold(web):
    answers, asked = web
    answers[fw.FEEDS["monetary"]] = (403, b"<html>no</html>")
    got = fw.get_fed_watch(wait_s=10)
    assert got["statement"]["state"] == "unavailable"
    assert got["statement"]["check"]["reason"] == "refused" and got["statement"]["check"]["http_status"] == 403
    assert got["projections"]["state"] == "unavailable"
    assert got["speeches"]["state"] == "ok"                            # the blocks fail apart
    with fw._lock:
        for name in ("speeches", "testimony"):
            fw._state["feeds"][name]["checked"] -= fw.FEED_TTL_DAY_S + 1
        fw._state["feeds"]["monetary"]["checked"] -= fw.FEED_TTL_DAY_S + 1   # past the lifetime, inside the 6 h hold
    before = asked.count(fw.FEEDS["monetary"])
    fw.get_fed_watch(wait_s=10)
    _wait_idle()
    assert asked.count(fw.FEEDS["monetary"]) == before == 1


def test_a_timeout_is_failed_and_a_page_where_the_feed_was_expected_is_a_shape_answer(web):
    answers, asked = web
    answers[fw.FEEDS["speeches"]] = TimeoutError("slow")
    answers[fw.FEEDS["testimony"]] = (200, b"<!DOCTYPE html><html>maintenance</html>")
    got = fw.get_fed_watch(wait_s=10)
    sp = got["speeches"]
    assert sp["state"] == "unavailable" and sp["items"] == [] and sp["missing"] == ["speeches", "testimony"]
    assert sp["checks"]["speeches"]["state"] == "failed" and sp["checks"]["speeches"]["reason"] == "timeout"
    assert sp["checks"]["testimony"]["reason"] == "shape"
    # a 429 holds for its own time
    answers[fw.FEEDS["speeches"]] = (429, b"")
    with fw._lock:
        fw._state["feeds"]["speeches"]["checked"] -= fw.FEED_TTL_DAY_S + 1
        fw._state["feeds"]["speeches"]["retry_at"] = 0.0
    fw.get_fed_watch(wait_s=10)
    _wait_idle()
    with fw._lock:
        f = fw._state["feeds"]["speeches"]
        assert f["check"]["reason"] == "rate_limited" and f["retry_at"] - f["checked"] == fw.RATE_LIMITED_HOLD_S


def test_a_statement_page_that_cannot_be_read_says_so_and_links_the_page(web):
    answers, asked = web
    answers[f"{B}/newsevents/pressreleases/monetary20310304a.htm"] = (200, b"<html>nothing like a statement</html>")
    got = fw.get_fed_watch(wait_s=10)
    st = got["statement"]
    assert st["state"] == "unreadable" and st["url"].endswith("monetary20310304a.htm")
    assert st["page_check"]["reason"] == "shape" and "paragraphs" not in st


def test_only_one_statement_in_the_feed_means_no_redline_and_says_why(web):
    answers, asked = web
    answers[fw.FEEDS["monetary"]] = (200, rss("m", [("Federal Reserve issues FOMC statement",
                                                     f"{B}/newsevents/pressreleases/monetary20310304a.htm", "s",
                                                     "Tue, 04 Mar 2031 19:00:00 GMT")]))
    got = fw.get_fed_watch(wait_s=10)
    assert got["statement"]["state"] == "ok" and got["statement"]["redline"] == {"state": "no_previous"}
    assert got["projections"]["state"] == "none" and got["statement"]["minutes"] is None


def test_a_feed_with_no_statement_is_none_not_an_error(web):
    answers, asked = web
    answers[fw.FEEDS["monetary"]] = (200, rss("m", []))
    got = fw.get_fed_watch(wait_s=10)
    assert got["statement"]["state"] == "none"


def test_a_restart_answers_from_disk_without_reading_any_page_again(web):
    answers, asked = web
    fw.get_fed_watch(wait_s=10)
    n = len(asked)
    with fw._lock:                                                     # a new process: memory gone, the disk copy stays
        fw._state.clear()
        fw._state.update(fw._blank_state())
    got = fw.get_fed_watch(wait_s=10)
    assert len(asked) == n
    assert got["statement"]["redline"]["state"] == "ok" and got["survey"]["state"] == "ok"


def test_held_answer_never_starts_a_build(web):
    answers, asked = web
    answer, how = fw.held_answer()
    assert how == "not_held" and asked == [] and fw._state["inflight"] is None
    assert answer["statement"]["state"] == "failed" and answer["survey"]["state"] == "failed"


def test_with_nothing_held_a_slow_build_answers_computing_at_once(web, monkeypatch):
    answers, asked = web
    gate = threading.Event()
    real = fw._http_get

    def slow(url, accept, max_bytes):
        gate.wait(5)
        return real(url, accept, max_bytes)

    monkeypatch.setattr(fw, "_http_get", slow)
    got = fw.get_fed_watch(wait_s=0.05)
    assert got["statement"]["state"] == "computing" and got["speeches"]["state"] == "computing"
    assert got["survey"]["state"] == "computing"
    gate.set()
    _wait_idle()


# ── the blocks read from the site ─────────────────────────────────────────────────────────────

class _Store:
    def __init__(self, rows):
        self.rows = rows
        self.reads = 0

    def last_seq(self):
        return self.rows[-1][0] if self.rows else 0

    def index_before(self, seq, limit):
        self.reads += 1
        return [r for r in self.rows if r[0] < seq][-limit:]


def _headline_env(monkeypatch, rows, enabled=True, pipe=True):
    from api.services.trade_exchange_news import archive, config, pipeline
    fw.reset_for_tests()
    store = _Store(rows)
    monkeypatch.setattr(config, "enabled", lambda: enabled)
    monkeypatch.setattr(pipeline, "get", lambda: (type("Pipe", (), {"store": store})() if pipe else None))
    monkeypatch.setattr(archive, "event_fields", lambda source, content: {"tickers": ["ZZZQ"] if "ZZZQ" in content else []})
    monkeypatch.setattr(fw, "_surnames", lambda: ROSTER)
    return store


def test_fed_headlines_come_from_the_store_newest_first_bounded_with_their_time(monkeypatch):
    rows = []
    for i in range(1, 81):
        text = f"Fed's Quillfeather invented remark {i}" if i % 2 else f"FedEx invented parcel item {i}"
        rows.append((i, "TX-News", text + (" ZZZQ" if i == 79 else ""), 1_900_000_000_000 + i * 1000, f"e{i}", "push", 0))
    store = _headline_env(monkeypatch, rows)
    got = fw.headlines_block()
    assert got["state"] == "ok" and got["source"] == "TradeXchange"
    assert got["matched"] == 40 and len(got["items"]) == P.MAX_HEADLINES == 30 and got["scanned"] == 80
    assert [h["seq"] for h in got["items"]][:3] == [79, 77, 75]
    assert got["items"][0]["received_at_ms"] == 1_900_000_079_000 and got["items"][0]["tickers"] == ["ZZZQ"]
    assert all("FedEx" not in h["text"] for h in got["items"])
    fw.headlines_block()
    assert store.reads == 1                                            # nothing new on the wire: no second read


@pytest.mark.parametrize("enabled, pipe, state", [(False, True, "off"), (True, False, "not_started")])
def test_a_switched_off_or_unstarted_wire_is_said_never_an_empty_list(monkeypatch, enabled, pipe, state):
    _headline_env(monkeypatch, [(1, "TX-News", "Fed invented", 1, "e", "push", 0)], enabled=enabled, pipe=pipe)
    got = fw.headlines_block()
    assert got["state"] == state and got["items"] == []


def test_a_store_that_fails_is_failed(monkeypatch):
    store = _headline_env(monkeypatch, [(1, "TX-News", "Fed invented", 1, "e", "push", 0)])
    store.index_before = lambda seq, limit: (_ for _ in ()).throw(RuntimeError("disk"))
    assert fw.headlines_block()["state"] == "failed"


def test_the_calendar_block_reads_held_weeks_only_and_counts_the_days(monkeypatch):
    from datetime import date
    from api.services.cache import cache
    fw.reset_for_tests()
    # Each held day carries the earnings buckets every calendar builder emits (`_empty_day`): the panel's
    # weeks now pass the shared TERM-030 week assertion, which refuses a day without `bmo`/`amc` as malformed.
    monkeypatch.setattr(cache, "get", lambda key: {
        "calendar_weekly": {"days": {"2031-03-19": {"bmo": [], "amc": [], "econ": [], "fed": [{"time": "9:00 AM", "event": "Fed Brindlewood Speech"}]}}},
        "calendar_week_2031-03-31": {"days": {"2031-04-01": {"bmo": [], "amc": [], "econ": [{"time": "2:00 PM", "event": "FOMC Statement"}], "fed": []}}},
    }.get(key))
    got = fw.calendar_block(date(2031, 3, 20), None)
    assert got["next_meeting"] == {"state": "ok", "date": "2031-04-01", "time": "2:00 PM", "event": "FOMC Statement",
                                   "source": "the economic calendar", "days_to_go": 12}
    assert got["this_week"]["state"] == "ok" and got["this_week"]["items"] == [
        {"date": "2031-03-19", "time": "9:00 AM", "event": "Fed Brindlewood Speech"}]
    assert (got["week_start"], got["week_end"]) == ("2031-03-17", "2031-03-21")


def test_with_no_calendar_and_no_survey_the_next_meeting_is_null_with_a_reason(monkeypatch):
    from datetime import date
    fw.reset_for_tests()
    monkeypatch.setattr(fw, "_calendar_payloads", lambda today: [None])
    got = fw.calendar_block(date(2031, 3, 20), None)
    assert got["next_meeting"] == {"state": "none", "date": None, "reason": "no_meeting_held"}
    assert got["this_week"] == {"state": "not_held", "items": [], "total": 0}


def test_the_rates_are_null_with_a_reason_while_the_economics_feature_is_off(monkeypatch):
    monkeypatch.delenv("ECON_ENABLED", raising=False)
    got = fw.rates_block()
    assert got["state"] == "off"
    for key in ("effective", "upper", "lower"):
        assert got[key] == {"value": None, "date": None, "reason": "econ_off"}       # never 0


def test_the_rates_carry_each_figure_with_its_own_date_and_a_missing_one_is_null(monkeypatch):
    from api.services.econ import serving
    monkeypatch.setenv("ECON_ENABLED", "1")
    series = {
        "USEFFR": (200, {"points": [[1, 9.11, "2031-03-17", "2031-03-17", "U"], [2, 9.12, "2031-03-18", "2031-03-18", "U"]]}, "e"),
        "USFEDFUNDSU": (200, {"points": [[1, 9.25, "2031-03-18", "2031-03-18", "U"]]}, "e"),
        "USFEDFUNDSL": (404, {"detail": "no_data"}, None),
    }
    monkeypatch.setattr(serving, "series", lambda sym: series[sym])
    got = fw.rates_block()
    assert got["state"] == "ok" and got["source"] == "Federal Reserve Bank of New York"
    assert got["effective"] == {"value": 9.12, "date": "2031-03-18", "reason": None}
    assert got["upper"] == {"value": 9.25, "date": "2031-03-18", "reason": None}
    assert got["lower"] == {"value": None, "date": None, "reason": "no_data"}
    assert "newyorkfed.org" in got["notice"]


# ── the route ──────────────────────────────────────────────────────────────────────────────────

def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(fw, "get_fed_watch", lambda: asked.append(1) or {"status": "ok"})
    (r,) = route.router.routes
    assert r.path == "/api/research/fed-watch" and r.methods == {"GET"}
    assert route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.fed_watch"            # its own gate, not a borrowed one
    assert _client(None).get("/api/research/fed-watch").status_code == 401
    refused = _client(FREE_USER).get("/api/research/fed-watch")
    assert refused.status_code == 402 and refused.json() == {"detail": "Fed watch requires a paid plan"}
    assert asked == []
    assert _client(PAID_USER).get("/api/research/fed-watch").json() == {"status": "ok"}
    assert asked == [1]


def test_the_handler_is_a_plain_def_and_the_route_is_mounted():
    import inspect
    assert not inspect.iscoroutinefunction(route.get_fed_watch)
    main = pathlib.Path(__file__).resolve().parents[1].joinpath("api", "main.py").read_text(encoding="utf-8")
    assert "from api.routers import fed_watch as fed_watch_router" in main
    assert "app.include_router(fed_watch_router.router)" in main


def test_the_new_york_fed_credit_is_its_own_default_attribution():
    import json
    notes = json.loads(pathlib.Path(__file__).resolve().parents[1].joinpath(
        "api", "services", "econ", "registry", "attributions.json").read_text(encoding="utf-8"))
    assert fw.NYFED_CREDIT == notes["nyfed"]["default_attribution"]
