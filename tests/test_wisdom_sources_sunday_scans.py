"""Wisdom sources — Sunday Scans (stream S-C, CONTRACTS.md §6.3, W1 §0.4a / §2.3).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a draft-shaped row (published_at 0 or NULL) selected for ingestion;
2. an unsigned section credited to anyone but TSDR, or without "D4 ruling";
3. a verification that calls a paywalled / different public body a match;
4. a chart image row without its label, or with a fabricated one;
5. the Substack publisher or sunday_scan publish/run/promo imported by Wisdom.
No network: the public fetch is a stub.
"""
from __future__ import annotations

import ast
import gzip
import json
import pathlib
import sqlite3

import pytest

from api.services import desk_store
from api.services.wisdom.core import store
from api.services.wisdom.sources import sunday_scans as ss

REPO = pathlib.Path(__file__).resolve().parents[1]
CDN = ("https://substackcdn.com/image/fetch/$s_!x!,w_1456,c_limit,f_auto/"
       "https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fabc_1580x780.png")

ISSUE_HTML = f"""
<p>We are excited to welcome you back.</p>
<h2>WHAT WE WILL COVER TODAY</h2><p>-Intro</p>
<h4>INTRO</h4><p>Risk management first.</p>
<h3>Earnings &amp; Economic Calendar for the Week</h3><p>CPI on Friday.</p>
<h2>Market Breadth Data</h2><p>Breadth is fine.</p>
<h2>Index &amp; ETFs</h2>
<p><strong>SPY (Daily)</strong><br>Holding the 21 EMA.</p>
<img src="{CDN}" width="1456" height="719">
<h2>Bracco&#8217;s Breakdown &amp; Top Ideas</h2>
<p>SNDK (Daily)<br>Bought on Friday.</p>
<img src="https://substackcdn.com/image/fetch/w_1456/https%3A%2F%2Fexample.com%2Fsndk.png"
     data-attrs='{{"src": "https://substack-post-media.s3.amazonaws.com/public/images/sndk.png"}}'>
<h2>TSDR&#8217;s Weekly Outlook &amp; Watchlist</h2>
<h3>Charts Covered LITE MU</h3>
<p>LITE (Daily, Weekly, and Hourly)<br>Watching the reclaim.</p>
<img src="https://example.com/lite.png">
<script>var secret = 1;</script>
"""


class _FakeBucket:
    def __init__(self):
        self.objects: dict = {}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"Metadata": {"sha256": self.objects[Key][1]}}

    def put_object(self, Bucket, Key, Body, ContentType, Metadata):
        assert Key not in self.objects
        self.objects[Key] = (Body, Metadata["sha256"])


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY", "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setattr(desk_store, "_DB_PATH", str(tmp_path / "desk.db"))
    desk_store._init_db()
    store.init_db()
    from api.services.wisdom.core import r2

    bucket = _FakeBucket()
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (bucket, "fake"))
    return bucket


def _post(pid, published_at, title="SUNDAY SCANS", body=ISSUE_HTML, slug=None):
    url = f"https://unchartedterritoryy.substack.com/p/{slug or pid}"
    desk_store.upsert_post({"id": pid, "title": title, "url": url, "published_at": published_at})
    if body is not None:
        desk_store.save_post_body(pid, {"body_raw": body, "body_html": "<p>x</p>", "display_title": title})
    return {"id": pid, "url": url, "title": title, "published_at": published_at}


def _rows(sql, *args):
    with store.read() as conn:
        return [dict(r) for r in conn.execute(sql, args)]


# ── 1. published only ────────────────────────────────────────────────────────

def test_a_draft_with_published_at_zero_cannot_be_selected():
    _post("pub", 1757200000)
    _post("draft0", 0)
    assert [p["id"] for p in ss.published_issues()] == ["pub"]


def test_a_draft_with_null_published_at_cannot_be_selected(tmp_path, monkeypatch):
    """desk.db declares published_at NOT NULL today; a legacy/hand-built table may not.
    The query must refuse NULL on its own, not lean on the constraint."""
    path = tmp_path / "legacy_desk.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE substack_posts (id TEXT, url TEXT, title TEXT, display_title TEXT, "
                 "published_at INTEGER, body_hash TEXT, image_count INTEGER)")
    conn.executemany("INSERT INTO substack_posts (id, url, title, published_at) VALUES (?, ?, ?, ?)", [
        ("null", "https://x.substack.com/p/a", "SUNDAY SCANS", None),
        ("zero", "https://x.substack.com/p/b", "SUNDAY SCANS", 0),
        ("live", "https://x.substack.com/p/c", "SUNDAY SCANS", 1757200000),
    ])
    conn.commit()
    conn.close()
    monkeypatch.setattr(desk_store, "_DB_PATH", str(path))
    assert [p["id"] for p in ss.published_issues()] == ["live"]
    assert "published_at > 0" in ss.SELECT_PUBLISHED_ISSUES_SQL


def test_other_series_are_not_sunday_scans():
    _post("scan", 1757200000)
    _post("rest", 1757300000, title="The Rest of the Week")
    assert [p["id"] for p in ss.published_issues()] == ["scan"]


# ── 2. attribution ───────────────────────────────────────────────────────────

def test_signed_sections_are_their_authors_and_unsigned_ones_are_tsdr_by_d4():
    parsed = ss.parse_issue(ISSUE_HTML)
    by_path = {s["path"]: s["attribution"] for s in parsed["segments"]}
    for unsigned in ("Preamble", "WHAT WE WILL COVER TODAY", "INTRO",
                     "Earnings & Economic Calendar for the Week", "Market Breadth Data", "Index & ETFs"):
        assert (by_path[unsigned]["author_id"], by_path[unsigned]["attribution_source"]) == ("tsdr", "D4 ruling"), unsigned
    assert by_path["Bracco's Breakdown & Top Ideas"]["author_id"] == "bracco"
    assert by_path["Bracco's Breakdown & Top Ideas"]["attribution_source"] == "signed section"
    sub = by_path["TSDR's Weekly Outlook & Watchlist > Charts Covered LITE MU"]
    assert (sub["author_id"], sub["attribution_source"], sub["rule"]) == ("tsdr", "signed section", "inherits_section")
    assert "secret" not in parsed["text"]  # <script> is never text


def test_chart_images_carry_their_nearest_short_label():
    images = ss.parse_issue(ISSUE_HTML)["images"]
    assert [(i["label_text"], ss.label_parts(i["label_text"])) for i in images] == [
        ("SPY (Daily)", ("SPY", "daily")),
        ("SNDK (Daily)", ("SNDK", "daily")),
        ("LITE (Daily, Weekly, and Hourly)", ("LITE", "daily, weekly, and hourly")),
    ]
    assert images[0]["public_url"] == "https://substack-post-media.s3.amazonaws.com/public/images/abc_1580x780.png"
    assert images[1]["public_url"] == "https://substack-post-media.s3.amazonaws.com/public/images/sndk.png"
    assert ss.label_parts("Holding the 21 EMA.") == (None, None)  # control: prose is not a label


# ── ingest ───────────────────────────────────────────────────────────────────

def test_an_issue_ingests_source_segments_attributions_and_provisional_charts(env):
    post = _post("165495160", 1757200000, slug="sunday-scans-fcd")
    out = ss.ingest_issue(ss.published_issues()[0])
    assert out["action"] == "new" and out["images_written"] == 3
    src = _rows("SELECT * FROM wisdom_sources")[0]
    assert src["stream"] == "sunday_scans" and src["published_check"] == "unchecked"
    assert src["external_ref"] == "substack:https://unchartedterritoryy.substack.com/p/sunday-scans-fcd"
    assert "SPY (Daily)" in gzip.decompress(env.objects[src["raw_r2_key"]][0]).decode("utf-8")
    attrs = _rows("SELECT author_id, attribution_source FROM wisdom_source_attributions")
    assert {(a["author_id"], a["attribution_source"]) for a in attrs} == {
        ("tsdr", "D4 ruling"), ("bracco", "signed section"), ("tsdr", "signed section")}
    charts = _rows("SELECT image_id, status, label_ticker, vision_json, r2_key FROM wisdom_chart_images")
    assert all(c["status"] == "provisional" and c["vision_json"] is None and c["r2_key"] is None for c in charts)
    assert all(c["image_id"].startswith("url-sha256:") for c in charts)
    assert {c["label_ticker"] for c in charts} == {"SPY", "SNDK", "LITE"}
    assert ss.ingest_issue(ss.published_issues()[0])["action"] == "unchanged"
    assert post["id"] == "165495160"


# ── 3. verify ────────────────────────────────────────────────────────────────

def _verify_with(payload):
    _post("p1", 1757200000)
    ss.ingest_issue(ss.published_issues()[0])
    return ss.verify_issue(ss.published_issues()[0], fetch_body=lambda url: payload)


def test_the_public_body_matching_the_stored_one_is_a_match():
    res = _verify_with({"raw": ISSUE_HTML, "audience": "everyone"})
    assert res["result"] == "public_api_match" and res["similarity"] == 1.0
    assert _rows("SELECT published_check FROM wisdom_sources")[0]["published_check"] == "public_api_match"
    assert _rows("SELECT result FROM wisdom_sunday_scans_checks")[0]["result"] == "public_api_match"


def test_a_paywalled_audience_is_a_mismatch_even_with_the_same_text():
    res = _verify_with({"raw": ISSUE_HTML, "audience": "only_paid"})
    assert res["result"] == "mismatch" and "only_paid" in res["reason"]


def test_a_different_public_body_is_a_mismatch():
    res = _verify_with({"raw": "<p>A completely different truncated preview.</p>", "audience": "everyone"})
    assert res["result"] == "mismatch" and res["similarity"] < ss.SIMILARITY_THRESHOLD


def test_an_unreachable_public_api_is_unchecked_not_a_match():
    res = _verify_with(None)
    assert res["result"] == "unchecked"
    assert _rows("SELECT published_check FROM wisdom_sources")[0]["published_check"] == "unchecked"


def test_similarity_edges():
    assert ss.similarity("a\nb\nc", "a\nb\nc") == 1.0
    assert ss.similarity("a\nb", "x\ny") == 0.0
    assert 0.0 < ss.similarity("same line\nother", "same line\nchanged") < 1.0


# ── 5. import ban ────────────────────────────────────────────────────────────

def _imports(path: pathlib.Path) -> set[str]:
    names = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            names.update(f"{base}.{a.name}" for a in node.names)
            names.add(base)
    return names


def test_no_substack_publisher_or_sunday_scan_publish_run_promo_import():
    files = sorted((REPO / "api/services/wisdom/sources").glob("*.py")) + [REPO / "api/routers/wisdom_sources.py"]
    names = set().union(*(_imports(f) for f in files))
    banned = [n for n in names if n.split(".")[0] in ("substack", "sunday_scan")
              or any(part in ("publish", "run", "promo") for part in n.split(".") if "sunday_scan" in n)]
    assert banned == []
    assert "api.services.substack_bodies" in names  # control: the scan sees the allowed public reader
