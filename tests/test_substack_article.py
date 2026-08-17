"""Converter rails for the native Desk article reader.

The load-bearing choice here is the FIXTURE: a real 322 KB Sunday Scans body
pulled from the live publication (62 images, 124 icon buttons, the subscribe
form, 5 whop links), not markup written by hand to match the parser. Every
defect this file exists to catch -- the whitelist eating srcset, the CTA drop
keyed on a shared class, alt text that was never there -- is invisible to a
hand-written fixture, because a hand-written fixture only ever contains what its
author already knew to put in it.
"""
from __future__ import annotations

import gzip
import os
import re

import pytest

from api.services import substack_article as sa

_FIXTURE = os.path.join(
    os.path.dirname(__file__), "fixtures", "substack_sunday_scans_2026-08-16.html.gz"
)


@pytest.fixture(scope="module")
def raw() -> str:
    with gzip.open(_FIXTURE, "rt", encoding="utf-8") as fh:
        return fh.read()


@pytest.fixture(scope="module")
def art(raw: str) -> sa.ConvertedArticle:
    return sa.convert(raw, utm={"utm_source": "uct_desk", "utm_medium": "article"})


# -- the fixture is what the tests claim it is --------------------------------
# Without this, every assertion below can pass vacuously against an empty or
# truncated download.

def test_fixture_is_the_real_thing(raw: str):
    assert len(raw) > 300_000, "fixture truncated -- the rest of this file is vacuous"
    assert raw.count("<img") == 62
    assert raw.count("<button") == 124
    assert "subscription-widget" in raw
    assert raw.count("whop.com") >= 5


# -- what must SURVIVE ---------------------------------------------------------

def test_every_image_survives(art):
    assert art.images == 62
    assert art.html.count("<img") == 62


def test_responsive_attributes_survive_on_every_image(art):
    """A tag-and-attribute whitelist that forgets these makes our reader
    measurably slower than the Substack page it replaces."""
    imgs = re.findall(r"<img[^>]*>", art.html)
    assert len(imgs) == 62
    assert all("srcset=" in i for i in imgs), "srcset dropped -- full-size images everywhere"
    assert all('loading="lazy"' in i for i in imgs), "lazy loading dropped -- 62 eager images"
    assert all(re.search(r'\swidth="\d+"', i) for i in imgs), "width dropped -- layout shift"
    assert all(re.search(r'\sheight="\d+"', i) for i in imgs), "height dropped -- layout shift"


def test_srcset_keeps_all_four_width_candidates(art):
    first = re.search(r"<img[^>]*>", art.html).group(0)
    srcset = re.search(r'srcset="([^"]+)"', first).group(1)
    assert re.findall(r"\s(\d+w)", srcset) == ["424w", "848w", "1272w", "1456w"]


def test_srcset_urls_are_not_shredded_by_their_own_commas(art):
    """Substack's CDN carries its transform options in the path
    (`$s_!IyPQ!,w_424,c_limit,f_auto,...`). Splitting candidates on a bare comma
    yields fragments that still pass URL validation, so the srcset stays
    well-formed while pointing at nothing. Count the intact transforms, not the
    commas."""
    srcsets = re.findall(r'srcset="([^"]+)"', art.html)
    assert len(srcsets) == 62
    for srcset in srcsets:
        urls = re.findall(r"(https://\S+?)\s+\d+w", srcset)
        assert len(urls) == 4, "candidate count wrong -- URLs were split apart"
        assert all("c_limit" in u and "fl_progressive" in u for u in urls)


def test_sizes_is_rewritten_off_100vw(art):
    """The one image attribute we deliberately do NOT preserve."""
    assert 'sizes="100vw"' not in art.html
    assert art.html.count(f"{sa.READER_MAX_PX}px") >= 62


def test_whop_call_to_action_survives_with_tracking(art):
    """`class="button primary"` is on the subscribe submit AND on this anchor,
    so a class-keyed drop kills the only conversion path in the post."""
    hrefs = re.findall(r'href="(https://whop\.com[^"]*)"', art.html)
    assert len(hrefs) >= 5, "whop CTAs were dropped"
    assert all("utm_source=uct_desk" in h for h in hrefs)
    assert "Get Started for $7" in art.html


def test_the_cta_is_marked_so_it_can_be_styled_as_a_button(art):
    """The whitelist drops `class`, so without a re-tag the membership button
    lands as a bare link in a wall of prose — the same defect these posts
    already collected on Substack."""
    assert art.html.count("uctArticleCta") >= 4
    cta = re.search(r'<a[^>]*uctArticleCta[^>]*>', art.html)
    assert cta and "whop.com" in cta.group(0)


def test_existing_query_params_are_not_clobbered_by_utm():
    out = sa.convert(
        '<p><a href="https://whop.com/x?utm_source=mine&amp;plan=7">go</a></p>',
        utm={"utm_source": "uct_desk"},
    )
    assert "utm_source=mine" in out.html
    assert "utm_source=uct_desk" not in out.html


def test_prose_and_structure_survive(art):
    assert "WHAT WE WILL COVER TODAY" in art.html
    assert art.html.count("<hr") >= 30
    assert art.words > 3_000


# -- what must NOT survive -----------------------------------------------------

def test_substack_chrome_is_gone(art):
    for junk in ("<button", "<svg", "<input", "<form", "pencraft", "image-link-expand"):
        assert junk not in art.html, f"{junk} survived conversion"


def test_subscribe_form_is_gone_but_its_neighbours_are_not(art):
    assert "subscription-widget" not in art.html
    assert "Type your email" not in art.html
    assert "Subscribe for free to receive new posts" not in art.html
    # The prose on either side of the widget is untouched.
    assert "8-10 hours throughout the weekend" in art.html


@pytest.mark.parametrize("payload,banned", [
    ('<p onclick="steal()">hi</p>', "onclick"),
    ('<p><a href="javascript:alert(1)">x</a></p>', "javascript:"),
    ('<p><a href="data:text/html;base64,PHNjcmlwdD4=">x</a></p>', "data:"),
    ('<script>alert(1)</script><p>ok</p>', "alert"),
    ('<p><img src="x" onerror="alert(1)"></p>', "onerror"),
    ('<style>body{display:none}</style><p>ok</p>', "display:none"),
    ('<iframe src="https://evil.test"></iframe><p>ok</p>', "iframe"),
    ('<p><a href="//evil.test">x</a></p>', "evil.test"),
])
def test_hostile_markup_cannot_reach_the_reader(payload, banned):
    """Publications are admin-configurable, so this runs on markup we do not
    control -- and the output goes into dangerouslySetInnerHTML."""
    assert banned not in sa.convert(payload).html


def test_unknown_tags_unwrap_rather_than_vanish():
    out = sa.convert("<p>keep <weirdtag>this text</weirdtag> too</p>")
    assert "weirdtag" not in out.html
    assert "keep this text too" in re.sub(r"<[^>]+>", "", out.html)


def test_text_is_escaped_on_the_way_out():
    out = sa.convert("<p>5 &lt; 6 &amp; 7 &gt; 6</p>")
    assert "&lt;" in out.html and "&amp;" in out.html
    assert "<script" not in out.html


# -- what we ADD ---------------------------------------------------------------

def test_headings_get_stable_unique_ids(art):
    ids = re.findall(r'<h[23] id="([^"]+)"', art.html)
    assert len(ids) >= 8
    assert len(ids) == len(set(ids)), "duplicate anchor ids -- TOC links would collide"
    assert [s["id"] for s in art.sections if s["level"] in (2, 3)][:1] == ids[:1]


def test_table_of_contents_matches_the_post(art):
    texts = [s["text"] for s in art.sections]
    assert "WHAT WE WILL COVER TODAY" in texts
    assert any("Market Breadth Data" in t for t in texts)
    assert any("Index" in t and "ETF" in t for t in texts)


def test_charts_covered_becomes_ticker_chips(art):
    assert "uctTickerChips" in art.html
    assert 'data-ticker="INTC"' in art.html
    assert 'href="/research/INTC"' in art.html
    # The heading's own 34 names lead, in the author's order.
    assert art.tickers[:34] == [
        "INTC", "ALAB", "ARM", "DELL", "HPE", "MU", "MRVL", "AMD", "NBIS", "TER",
        "RBRK", "SNOW", "PLTR", "FSLY", "ANET", "CRWD", "HNGE", "LLY", "BA",
        "AMZN", "FROG", "RNG", "FIVN", "DOCN", "MDB", "TSEM", "NOW", "DDOG",
        "AAOI", "BFLY", "UMAC", "CCXI", "CBRS", "EROC",
    ]


def test_chart_labels_are_a_second_ticker_source(art):
    """"Charts Covered" appears in well under half the archive, so keying only
    on it leaves most issues with no symbols. Every chart carries its own label
    ("QQQ (Daily, Weekly, and Hourly)"), which generalises."""
    # The ETF walk is labelled but absent from the Charts Covered line.
    for etf in ("QQQ", "SPY", "IWM", "SMH", "XBI"):
        assert etf in art.tickers, f"{etf} was charted but not surfaced"
    assert len(art.tickers) > 34, "the label source added nothing"


def test_the_label_source_works_with_no_charts_covered_heading():
    body = ("<p><strong>QQQ (Daily, Weekly, and Hourly)</strong></p>"
            "<p><strong>INTC (Daily)</strong></p>"
            "<p><strong>ARM (Daily &amp; Weekly)</strong></p>")
    assert sa.convert(body).tickers == ["QQQ", "INTC", "ARM"]


@pytest.mark.parametrize("line", [
    "Just good consistent participation, good to see.",
    "UCT Breadth Monitor",
    "A (nice) reminder",
    "WHAT WE WILL COVER TODAY",
])
def test_ordinary_prose_is_not_read_as_a_chart_label(line):
    """The timeframe in parentheses is what keeps this off normal sentences."""
    assert sa.convert(f"<p>{line}</p>").tickers == []


def test_an_ordinary_all_caps_heading_is_not_mistaken_for_tickers():
    """"WHAT WE WILL COVER TODAY" is five short all-caps words -- a shape-only
    ticker test matches it. The label is what discriminates."""
    out = sa.convert("<h2><strong>WHAT WE WILL COVER TODAY</strong></h2>")
    assert "uctTickerChips" not in out.html
    assert out.tickers == []


def test_empty_alt_is_filled_from_the_chart_label(art):
    """Substack ships alt="" on all 62 charts (data-attrs confirms alt: null),
    so a screen reader gets nothing without this."""
    alts = re.findall(r'<img[^>]*\salt="([^"]*)"', art.html)
    assert len(alts) == 62
    assert sum(1 for a in alts if a.strip()) >= 55


def test_reading_time_is_derived_not_guessed(art):
    assert art.reading_minutes == max(1, round(art.words / 225))
    assert 12 <= art.reading_minutes <= 30


# -- degenerate input ----------------------------------------------------------

@pytest.mark.parametrize("value", ["", "   ", None])
def test_empty_input_is_an_empty_article(value):
    out = sa.convert(value)
    assert out.html == "" and out.images == 0 and out.sections == []


def test_mis_nested_tags_do_not_leak_unclosed_elements():
    out = sa.convert("<p><strong>bold <em>both</strong> still em</em></p>")
    assert out.html.count("<strong") == out.html.count("</strong")
    assert out.html.count("<em") == out.html.count("</em")


def test_unclosed_document_is_closed_off():
    out = sa.convert("<p>dangling")
    assert out.html.endswith("</p>")
