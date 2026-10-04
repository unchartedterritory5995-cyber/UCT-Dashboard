"""/live-trading-room is a REAL static page, served before the SPA catch-all.

Every other public path answers with the SPA shell, so a crawler sees only the
shell's title and meta. This page exists to be read without JavaScript: its own
<title>, description, canonical, Open Graph tags and Organization + FAQPage
JSON-LD, all in the HTML the server sends.

Same rail shape as tests/test_public_note_headers.py, for the same reason: the
route is registered only `if os.path.exists(DIST)`, and an unbuilt checkout has
no app/dist, so a rail that only asked the real app would be green by skipping.
So:
  1. the REAL response builder (`api.main.live_trading_room_response`) is
     mounted on a throwaway app with `api.main.DIST` pointed at a temp dir that
     holds the real page, and asked over HTTP (GET and HEAD);
  2. an AST check pins that main.py registers it inside the DIST guard, for GET
     and HEAD, BEFORE the SPA catch-all (registered after, the catch-all would
     win and the page would never be served);
  3. the page source itself is checked for the SEO contract and the approved
     facts (every CTA goes to the Whop link, no prices, every image exists and
     carries width/height/alt), and the sitemap lists the canonical URL;
  4. when app/dist IS built, the real app is asked too.
"""
from __future__ import annotations

import ast
import json
import re
import shutil
from html.parser import HTMLParser
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parents[1]
PAGE_DIR = REPO / "app" / "public" / "live-trading-room"
PAGE = PAGE_DIR / "index.html"
SITEMAP = REPO / "app" / "public" / "sitemap.xml"
MAIN = REPO / "api" / "main.py"

CANONICAL = "https://uctintelligence.com/live-trading-room"
WHOP = "https://whop.com/c/uncharted/uct-site"
FAQ_QUESTIONS = [
    "What time is the live session, and what if I can't watch?",
    "Who are the traders?",
    "Can I cancel anytime?",
    "What makes Uncharted Territory different?",
]


class _Collect(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags: list[tuple[str, dict]] = []
        self.scripts: list[tuple[dict, str]] = []
        self._in_script: dict | None = None
        self._buf: list[str] = []
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.tags.append((tag, a))
        if tag == "script":
            self._in_script, self._buf = a, []
        if tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "script" and self._in_script is not None:
            self.scripts.append((self._in_script, "".join(self._buf)))
            self._in_script = None
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_script is not None:
            self._buf.append(data)
        if self._in_title:
            self.title += data


def _parsed() -> _Collect:
    p = _Collect()
    p.feed(PAGE.read_text(encoding="utf-8"))
    return p


def _meta(p: _Collect, **match) -> str | None:
    for tag, a in p.tags:
        if tag == "meta" and all(a.get(k) == v for k, v in match.items()):
            return a.get("content")
    return None


# ── the page source ─────────────────────────────────────────────────────────

def test_the_page_carries_its_own_seo_head():
    p = _parsed()
    assert p.title.strip(), "no <title>"
    assert "Uncharted Territory" in p.title
    assert (_meta(p, name="description") or "").strip()
    canon = [a.get("href") for t, a in p.tags if t == "link" and a.get("rel") == "canonical"]
    assert canon == [CANONICAL]
    assert _meta(p, property="og:url") == CANONICAL
    for prop in ("og:title", "og:description", "og:image", "og:type"):
        assert (_meta(p, property=prop) or "").strip(), f"missing {prop}"
    assert _meta(p, name="robots") != "noindex"


def test_the_json_ld_is_valid_and_the_faq_matches_the_visible_faq():
    p = _parsed()
    blocks = [json.loads(body) for a, body in p.scripts if a.get("type") == "application/ld+json"]
    types = {b.get("@type") for b in blocks}
    assert {"Organization", "FAQPage"} <= types
    faq = next(b for b in blocks if b["@type"] == "FAQPage")
    names = [q["name"] for q in faq["mainEntity"]]
    assert names == FAQ_QUESTIONS
    html = PAGE.read_text(encoding="utf-8")
    for q in faq["mainEntity"]:
        # Google requires structured FAQ content to be visible on the page.
        assert q["name"] in html, f"FAQ question not visible: {q['name']}"
        assert q["acceptedAnswer"]["text"] in html, f"FAQ answer not visible: {q['name']}"


def test_every_cta_goes_to_the_whop_link_and_there_are_no_prices():
    p = _parsed()
    external = [a["href"] for t, a in p.tags if t == "a" and a.get("href", "").startswith("http")]
    assert external, "no outbound CTA found -- the check is pointed at nothing"
    assert set(external) == {WHOP}, f"unexpected outbound links: {sorted(set(external))}"
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", PAGE.read_text(encoding="utf-8"), flags=re.S)
    assert not re.search(r"\$\s?\d", text), "a price appeared on the page"
    assert "JOINUCT" in text


def test_every_image_exists_and_has_dimensions_and_alt():
    p = _parsed()
    imgs = [a for t, a in p.tags if t == "img"]
    assert len(imgs) >= 6, "expected the hero, four gallery images and the logo"
    for a in imgs:
        assert a.get("width") and a.get("height"), f"no dimensions: {a.get('src')}"
        assert "alt" in a, f"no alt: {a.get('src')}"
        srcs = [a["src"]] + [s.strip().split()[0] for s in (a.get("srcset") or "").split(",") if s.strip()]
        for src in srcs:
            assert src.startswith("/live-trading-room/"), src
            assert (PAGE_DIR / src.rsplit("/", 1)[1]).is_file(), f"missing asset {src}"
    og = _meta(p, property="og:image")
    assert (PAGE_DIR / og.rsplit("/", 1)[1]).is_file(), og


def test_the_sitemap_lists_the_canonical_url():
    assert f"<loc>{CANONICAL}</loc>" in SITEMAP.read_text(encoding="utf-8")


# ── the real response builder, over HTTP ────────────────────────────────────

def _main():
    import api.main as main  # noqa: WPS433 -- late import, after the root conftest pins
    return main


@pytest.fixture
def temp_dist(tmp_path, monkeypatch):
    main = _main()
    shutil.copytree(PAGE_DIR, tmp_path / "live-trading-room")
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    return main


def test_the_builder_serves_the_real_page_as_html(temp_dist):
    main = temp_dist
    app = FastAPI()
    app.add_api_route(main.LIVE_TRADING_ROOM_PATH, main.live_trading_room_response, methods=["GET", "HEAD"])
    with TestClient(app) as c:
        r = c.get("/live-trading-room")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/html")
        assert f'<link rel="canonical" href="{CANONICAL}"' in r.text
        h = c.head("/live-trading-room")
        assert h.status_code == 200


# ── what production registers ───────────────────────────────────────────────

def _dist_guard_body(tree: ast.Module) -> list[ast.stmt]:
    for node in tree.body:
        if (isinstance(node, ast.If) and isinstance(node.test, ast.Call)
                and ast.unparse(node.test) == "os.path.exists(DIST)"):
            return node.body
    raise AssertionError("the `if os.path.exists(DIST):` block is gone")


def test_main_registers_the_page_inside_the_guard_before_the_catch_all():
    body = _dist_guard_body(ast.parse(MAIN.read_text(encoding="utf-8")))
    order: list[str] = []
    for node in body:
        if isinstance(node, ast.FunctionDef):
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and dec.args:
                    order.append((node.name, ast.unparse(dec.args[0]), ast.unparse(dec)))
    names = [n for n, _, _ in order]
    assert "_serve_live_trading_room" in names, "the landing-page route is not registered"
    assert "spa_fallback" in names, "control: the catch-all must be visible to this walk"
    assert names.index("_serve_live_trading_room") < names.index("spa_fallback"), (
        "the landing page is registered AFTER the SPA catch-all, which would answer first")
    page = next(o for o in order if o[0] == "_serve_live_trading_room")
    assert page[1] == "LIVE_TRADING_ROOM_PATH"
    assert "'GET'" in page[2] and "'HEAD'" in page[2]
    fn = next(n for n in body if isinstance(n, ast.FunctionDef) and n.name == "_serve_live_trading_room")
    assert ast.unparse(fn.body[-1]) == "return live_trading_room_response()"


@pytest.mark.skipif(not (REPO / "app" / "dist" / "live-trading-room" / "index.html").is_file(),
                    reason="app/dist not built (the gate builds it)")
def test_the_real_app_serves_the_page_and_its_assets():
    from api.main import app
    with TestClient(app) as c:
        r = c.get("/live-trading-room")
        assert r.status_code == 200 and CANONICAL in r.text
        assert "<div id=\"root\"" not in r.text, "got the SPA shell, not the page"
        s = c.get("/live-trading-room/", follow_redirects=False)
        assert s.status_code == 301 and s.headers["location"] == "/live-trading-room"
        img = c.get("/live-trading-room/room-traders-800.webp")
        assert img.status_code == 200 and img.headers["content-type"] == "image/webp"
