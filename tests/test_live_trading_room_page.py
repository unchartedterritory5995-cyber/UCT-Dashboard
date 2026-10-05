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
WHOP_TOS = "https://whop.com/tos"
WHOP_PRIVACY = "https://whop.com/privacy"
TERMS_PAGE = PAGE_DIR / "terms.html"
TERMS_PATH = "/live-trading-room/terms"
TERMS_CANONICAL = "https://uctintelligence.com/live-trading-room/terms"
PRIVACY_PAGE = PAGE_DIR / "privacy.html"
PRIVACY_PATH = "/live-trading-room/privacy"
PRIVACY_CANONICAL = "https://uctintelligence.com/live-trading-room/privacy"
# v4 (owner-locked 2026-10-04, uct-growth/salespage/SITE-v4.md): five new
# questions go in AFTER "Who are the traders?", in this order.
FAQ_QUESTIONS = [
    "What time is the live session, and what if I can't watch?",
    "Who are the traders?",
    "I'm new to trading. Is this for me?",
    "Is this signals to copy?",
    "Stocks or options?",
    "What do I need to get started?",
    "Where do I join?",
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


def _parsed(page: Path = PAGE) -> _Collect:
    p = _Collect()
    p.feed(page.read_text(encoding="utf-8"))
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
    # The only outbound link is the Whop CTA. The footer's Terms and Privacy
    # are the room's own pages (Privacy moved off Whop's policy 2026-10-04).
    assert set(external) == {WHOP}, f"unexpected outbound links: {sorted(set(external))}"
    ctas = [a["href"] for t, a in p.tags if t == "a" and "btn" in (a.get("class") or "").split()]
    assert ctas and set(ctas) == {WHOP}, f"a CTA button points somewhere else: {ctas}"
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


def test_the_sitemap_lists_the_terms_page():
    assert f"<loc>{TERMS_CANONICAL}</loc>" in SITEMAP.read_text(encoding="utf-8")


def test_the_sitemap_lists_the_privacy_page():
    assert f"<loc>{PRIVACY_CANONICAL}</loc>" in SITEMAP.read_text(encoding="utf-8")


# -- the room page stays on the room -----------------------------------------
# The site root is the pre-launch app's "coming soon" page, so a room visitor
# who clicked the logo or "Home" landed somewhere that says nothing about the
# room, and "Terms"/"Privacy" went to the APP's terms (with its trial wording).

def _footer_links() -> list[tuple[str, str]]:
    html = PAGE.read_text(encoding="utf-8")
    foot = html[html.index("<footer"):html.index("</footer>")]
    return re.findall(r'<a [^>]*href="([^"]+)"[^>]*>([^<]+)</a>', foot)


def test_the_logo_links_to_the_room_not_the_site_root():
    p = _parsed()
    brand = [a for t, a in p.tags if t == "a" and "brand" in (a.get("class") or "").split()]
    assert len(brand) == 1, brand
    assert brand[0]["href"] == "/live-trading-room"


def test_the_footer_points_terms_and_privacy_at_the_rooms_own_pages():
    links = {text.strip(): href for href, text in _footer_links()}
    assert links.get("Terms") == TERMS_PATH, links
    assert links.get("Privacy") == PRIVACY_PATH, links
    assert "/" not in links.values(), f"a footer link still goes to the site root: {links}"
    assert "/terms" not in links.values() and "/privacy" not in links.values(), links


# -- the terms page source ---------------------------------------------------

TERMS_BULLETS = [
    "Uncharted Territory's Live Trading Room is sold and billed through Whop (whop.com).",
    "Plans renew every 28 days or once a year, depending on the plan you choose, until you cancel in your Whop account.",
    "There is no free trial. Payments are non-refundable.",
    "Everything in the room is education only, not financial advice. Trading carries real risk of loss.",
    "Whop's own Terms of Service and Privacy Policy also apply to your purchase.",
    "Questions: reply to any message from us, or reach us in the Discord.",
]


def _visible_text(html: str) -> str:
    import html as _h
    body = re.sub(r"<script.*?</script>|<style.*?</style>|<head.*?</head>", "", html, flags=re.S)
    text = re.sub(r"<[^>]+>", "", body)
    return re.sub(r"\s+", " ", _h.unescape(text))


def test_the_terms_page_has_its_own_head():
    p = _parsed(TERMS_PAGE)
    assert p.title.strip() == "Terms | Uncharted Territory Live Trading Room"
    assert (_meta(p, name="description") or "").strip()
    canon = [a.get("href") for t, a in p.tags if t == "link" and a.get("rel") == "canonical"]
    assert canon == [TERMS_CANONICAL]
    assert _meta(p, name="viewport")


def test_the_terms_page_says_exactly_the_approved_terms():
    html = TERMS_PAGE.read_text(encoding="utf-8")
    text = _visible_text(html)
    assert re.search(r"<h1[^>]*>\s*Live Trading Room terms\s*</h1>", html), "H1 missing or changed"
    for line in TERMS_BULLETS:
        assert line in text, f"missing: {line}"
    items = [a for t, a in _parsed(TERMS_PAGE).tags if t == "li"]
    assert len(items) == len(TERMS_BULLETS), f"expected {len(TERMS_BULLETS)} bullets, got {len(items)}"


def test_the_terms_page_links_whops_terms_privacy_and_back_to_the_room():
    p = _parsed(TERMS_PAGE)
    hrefs = [a.get("href") for t, a in p.tags if t == "a"]
    assert WHOP_TOS in hrefs and WHOP_PRIVACY in hrefs, hrefs
    assert "/live-trading-room" in hrefs, "no link back to the room"
    external = {h for h in hrefs if h and h.startswith("http")}
    assert external == {WHOP_TOS, WHOP_PRIVACY}, external
    for t, a in p.tags:
        if t == "img":
            assert (PAGE_DIR / a["src"].rsplit("/", 1)[1]).is_file(), a["src"]


def test_the_terms_page_has_no_prices_and_no_em_dashes():
    html = TERMS_PAGE.read_text(encoding="utf-8")
    assert "$" not in _visible_text(html), "a price (or a dollar sign) appeared on the terms page"
    assert "\u2014" not in html and "&mdash;" not in html, "an em dash appeared on the terms page"
    assert "\ufffd" not in html


# -- the privacy page source -------------------------------------------------

PRIVACY_BULLETS = [
    "Uncharted Territory runs a live trading room on Discord, sold through Whop.",
    "When you ask us to contact you (for example through a form on Facebook or Instagram), we collect what you send: your name, email, phone number and your answers to the form's questions.",
    "We use it only to contact you about the live trading room, by phone, text, email or direct message, and to answer your questions.",
    "We don't sell your information or share it with anyone else for their own marketing.",
    "Purchases and memberships are handled by Whop, under Whop's Privacy Policy. Our emails are sent with Kit, and every email has an unsubscribe link.",
    "To have your information deleted or to stop hearing from us, reply to any message from us or reach us in the Discord, and we'll take care of it.",
]


def test_the_privacy_page_has_its_own_head():
    p = _parsed(PRIVACY_PAGE)
    assert p.title.strip() == "Privacy | Uncharted Territory Live Trading Room"
    assert (_meta(p, name="description") or "").strip()
    canon = [a.get("href") for t, a in p.tags if t == "link" and a.get("rel") == "canonical"]
    assert canon == [PRIVACY_CANONICAL]
    assert _meta(p, name="viewport")


def test_the_privacy_page_says_exactly_the_approved_copy():
    html = PRIVACY_PAGE.read_text(encoding="utf-8")
    text = _visible_text(html)
    assert re.search(r"<h1[^>]*>\s*Privacy\s*</h1>", html), "H1 missing or changed"
    for line in PRIVACY_BULLETS:
        assert line in text, f"missing: {line}"
    items = [a for t, a in _parsed(PRIVACY_PAGE).tags if t == "li"]
    assert len(items) == len(PRIVACY_BULLETS), f"expected {len(PRIVACY_BULLETS)} bullets, got {len(items)}"


def test_the_privacy_page_links_whops_policy_and_back_to_the_room():
    p = _parsed(PRIVACY_PAGE)
    hrefs = [a.get("href") for t, a in p.tags if t == "a"]
    assert "/live-trading-room" in hrefs, "no link back to the room"
    assert "Back to the live trading room" in _visible_text(PRIVACY_PAGE.read_text(encoding="utf-8"))
    external = {h for h in hrefs if h and h.startswith("http")}
    assert external == {WHOP_PRIVACY}, external
    for t, a in p.tags:
        if t == "img":
            assert (PAGE_DIR / a["src"].rsplit("/", 1)[1]).is_file(), a["src"]


def test_the_privacy_page_has_no_prices_and_no_em_dashes():
    html = PRIVACY_PAGE.read_text(encoding="utf-8")
    assert "$" not in _visible_text(html), "a price (or a dollar sign) appeared on the privacy page"
    assert "\u2014" not in html and "&mdash;" not in html, "an em dash appeared on the privacy page"
    assert "\ufffd" not in html


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


def test_the_terms_builder_serves_the_terms_page_as_html(temp_dist):
    main = temp_dist
    app = FastAPI()
    app.add_api_route(main.LIVE_TRADING_ROOM_TERMS_PATH, main.live_trading_room_terms_response,
                      methods=["GET", "HEAD"])
    with TestClient(app) as c:
        r = c.get(TERMS_PATH)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/html")
        assert "Live Trading Room terms" in r.text
        assert c.head(TERMS_PATH).status_code == 200


def test_the_privacy_builder_serves_the_privacy_page_as_html(temp_dist):
    main = temp_dist
    app = FastAPI()
    app.add_api_route(main.LIVE_TRADING_ROOM_PRIVACY_PATH, main.live_trading_room_privacy_response,
                      methods=["GET", "HEAD"])
    with TestClient(app) as c:
        r = c.get(PRIVACY_PATH)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/html")
        assert re.search(r"<h1[^>]*>\s*Privacy\s*</h1>", r.text)
        assert c.head(PRIVACY_PATH).status_code == 200


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


def test_main_registers_the_terms_page_and_its_slash_redirect_before_the_static_mount():
    """The /live-trading-room static mount answers every path under it, so a
    terms route registered AFTER it would never be reached (the mount would
    look for a file called `terms` and 404)."""
    body = _dist_guard_body(ast.parse(MAIN.read_text(encoding="utf-8")))
    routes = {}
    mount_line = None
    for node in body:
        if isinstance(node, ast.FunctionDef):
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and dec.args:
                    routes[node.name] = (node.lineno, ast.unparse(dec))
        if isinstance(node, ast.If):
            for sub in ast.walk(node):
                if (isinstance(sub, ast.Call) and ast.unparse(sub.func) == "app.mount"
                        and sub.args and ast.unparse(sub.args[0]) == "LIVE_TRADING_ROOM_PATH"):
                    mount_line = sub.lineno
    assert mount_line is not None, "control: the room's static mount must be visible to this walk"
    page = routes.get("_serve_live_trading_room_terms")
    slash = routes.get("_redirect_live_trading_room_terms_slash")
    assert page and slash, sorted(routes)
    assert "LIVE_TRADING_ROOM_TERMS_PATH" in page[1] and "'GET'" in page[1] and "'HEAD'" in page[1]
    assert "LIVE_TRADING_ROOM_TERMS_PATH + '/'" in slash[1]
    assert page[0] < mount_line and slash[0] < mount_line, "terms route registered after the static mount"


def test_main_registers_the_privacy_page_and_its_slash_redirect_before_the_static_mount():
    body = _dist_guard_body(ast.parse(MAIN.read_text(encoding="utf-8")))
    routes = {}
    mount_line = None
    for node in body:
        if isinstance(node, ast.FunctionDef):
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and dec.args:
                    routes[node.name] = (node.lineno, ast.unparse(dec))
        if isinstance(node, ast.If):
            for sub in ast.walk(node):
                if (isinstance(sub, ast.Call) and ast.unparse(sub.func) == "app.mount"
                        and sub.args and ast.unparse(sub.args[0]) == "LIVE_TRADING_ROOM_PATH"):
                    mount_line = sub.lineno
    assert mount_line is not None, "control: the room's static mount must be visible to this walk"
    page = routes.get("_serve_live_trading_room_privacy")
    slash = routes.get("_redirect_live_trading_room_privacy_slash")
    assert page and slash, sorted(routes)
    assert "LIVE_TRADING_ROOM_PRIVACY_PATH" in page[1] and "'GET'" in page[1] and "'HEAD'" in page[1]
    assert "LIVE_TRADING_ROOM_PRIVACY_PATH + '/'" in slash[1]
    assert page[0] < mount_line and slash[0] < mount_line, "privacy route registered after the static mount"


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
        t = c.get(TERMS_PATH)
        assert t.status_code == 200 and "Live Trading Room terms" in t.text
        ts = c.get(TERMS_PATH + "/", follow_redirects=False)
        assert ts.status_code == 301 and ts.headers["location"] == TERMS_PATH
        pv = c.get(PRIVACY_PATH)
        assert pv.status_code == 200 and re.search(r"<h1[^>]*>\s*Privacy\s*</h1>", pv.text)
        ps = c.get(PRIVACY_PATH + "/", follow_redirects=False)
        assert ps.status_code == 301 and ps.headers["location"] == PRIVACY_PATH


# ── the page's .webp images are served AS images ───────────────────────────
# Production runs Python 3.12 (nixpacks.toml / runtime.txt), whose built-in
# `mimetypes` table has NO `.webp` entry (it arrived in 3.13), and the nix
# container ships no /etc/mime.types to fill the gap. Starlette's StaticFiles
# then falls back to `text/plain; charset=utf-8` for all 11 page images.
# A dev box on 3.13+ cannot see that, so the rail REBUILDS a 3.12-shaped table
# (the default one with `.webp` taken out) and serves the mount against it.

@pytest.fixture
def py312_mimetypes(monkeypatch):
    import mimetypes
    db = mimetypes.MimeTypes()
    for strict in (True, False):
        db.types_map[strict].pop(".webp", None)
    db.types_map_inv[True].pop("image/webp", None)
    db.types_map_inv[False].pop("image/webp", None)
    monkeypatch.setattr(mimetypes, "_db", db)
    assert mimetypes.guess_type("x.webp") == (None, None), "simulation failed"
    return mimetypes


def _ltr_mount_app(tmp_path):
    from fastapi.staticfiles import StaticFiles
    shutil.copytree(PAGE_DIR, tmp_path / "live-trading-room")
    app = FastAPI()
    app.mount("/live-trading-room", StaticFiles(directory=str(tmp_path / "live-trading-room")))
    return app


def test_control_a_py312_mime_table_reproduces_the_text_plain_bug(tmp_path, py312_mimetypes):
    with TestClient(_ltr_mount_app(tmp_path)) as c:
        r = c.get("/live-trading-room/mark-96.webp")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/plain"), r.headers["content-type"]


def test_registered_mime_types_serve_every_page_webp_as_image_webp(tmp_path, py312_mimetypes):
    main = _main()
    main.register_static_mime_types()
    webps = sorted(p.name for p in PAGE_DIR.glob("*.webp"))
    assert len(webps) >= 11, webps
    with TestClient(_ltr_mount_app(tmp_path)) as c:
        for name in webps:
            r = c.get(f"/live-trading-room/{name}")
            assert r.status_code == 200, name
            assert r.headers["content-type"] == "image/webp", (name, r.headers["content-type"])


def test_main_registers_mime_types_at_module_level_before_the_dist_guard():
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    call_at = guard_at = None
    for i, node in enumerate(tree.body):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
                and ast.unparse(node.value) == "register_static_mime_types()"):
            call_at = i
        if (isinstance(node, ast.If) and ast.unparse(node.test) == "os.path.exists(DIST)"):
            guard_at = i
    assert guard_at is not None, "control: the DIST guard must be visible to this walk"
    assert call_at is not None, "register_static_mime_types() is not called at module level"
    assert call_at < guard_at, "mime types must be registered BEFORE the static mounts"


# -- the v4 copy, locked line by line by the owner (SITE-v4.md, 2026-10-04) --

V4_H1 = "A live trading room run by traders who trade, and teach, every single day"
V4_INTRO = [
    "Before you join any trading room, you should see what happens inside it and meet the people "
    "who run it. Here's ours.",
    "Every market morning, about 20 minutes before the 9:30 AM ET open, co-founders TSDR (Patrick) "
    "and Bracco go live on Zoom. They lay out the plan and the levels, then trade the open on screen "
    "share and talk through every decision. Around them: five traders, an options flow team, and a "
    "productive, helpful and focused main chat.",
]
V4_TIMELINE = [
    ("About 9:10 AM ET.", "The Zoom link drops in the live Zoom links channel."),
    ("Before the open.", "TSDR and Bracco walk through the market, the levels and the names on their list."),
    ("9:30 AM ET.", "They trade the open live on screen share and talk through each decision."),
    ("During the day.", "Each trader posts ideas and alerts in his own channel. Options flow and news "
                        "run all day. Questions go in main chat."),
    ("After the close.", "Every session is recorded, with a recap the same day. About 15 minutes catches you up."),
    ("The weekend.", "Sunday Scans lands with the prep for the week ahead."),
]
V4_TRADERS = [
    ("TSDR and Bracco", "Run the morning Zoom, wrote the strategy book, and explain every trade, "
                        "including the ones they pass on."),
    ("ChartMaster", "Swing trade ideas, educational workshops, and always easy to reach. Years of "
                    "his workshops are in the library."),
    ("Alex Jones and a team of three skilled contributors", "Run our robust options flow feed."),
    ("Manrav and Jersace", "Trade ideas and alerts, each in his own channel."),
]
V4_TRADERS_CLOSING = "Every trader, contributor and member is helpful, easy to reach, and happy to teach."
V4_INSIDE = [
    "Every session recorded, with a recap the same day",
    "Live options flow and news all day",
    "Sunday Scans to prep the week",
    "Years of recorded workshops",
    "The strategy book TSDR and Bracco wrote",
    "Post your own charts for feedback from the traders",
    "A productive, helpful and focused main chat",
    "A free 1-on-1 onboarding call to get you set up",
]
V4_NEW_FAQ_ANSWERS = {
    "I'm new to trading. Is this for me?":
        "Yes. You'll see how experienced traders plan the day and manage a trade, start with one or "
        "two traders whose style fits you, and get a free 1-on-1 call to get set up. Ask anything in main chat.",
    "Is this signals to copy?":
        "No. The traders post their ideas and alerts and explain the why, so you learn to make your "
        "own calls. Education only, not financial advice.",
    "Stocks or options?":
        "Both. The traders cover stocks and options, day trades and swings, and the options flow feed runs all day.",
    "What do I need to get started?":
        "A Discord account. After you join on Whop, you connect Discord, land in the room, and we set "
        "up a free 1-on-1 call to walk you through it.",
    "Where do I join?":
        "Only through whop.com/uncharted. We don't run other sign-up sites, free-trial pages or DM offers.",
}


def _norm(s: str) -> str:
    import html as _h
    return re.sub(r"\s+", " ", _h.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def _blocks(tag: str, cls: str | None = None) -> list[str]:
    html = PAGE.read_text(encoding="utf-8")
    attr = rf'[^>]*class="[^"]*\b{cls}\b[^"]*"' if cls else r"[^>]*"
    return [_norm(m) for m in re.findall(rf"<{tag}{attr}>(.*?)</{tag}>", html, flags=re.S)]


def _section(heading_id: str) -> str:
    html = PAGE.read_text(encoding="utf-8")
    start = html.index(f'aria-labelledby="{heading_id}"')
    return html[start:html.index("</section>", start)]


def _hero() -> str:
    html = PAGE.read_text(encoding="utf-8")
    start = html.index('class="hero"')
    return html[start:html.index("<section", start)]


def test_v4_h1_is_the_locked_headline():
    assert _blocks("h1") == [V4_H1]
    assert "Uncharted Territory" in _parsed().title


def test_v4_intro_is_two_locked_paragraphs_and_keeps_the_cta_lines():
    assert _blocks("p", "lede") == V4_INTRO
    hero = _norm(_hero())
    assert "Use code JOINUCT for a nice discount to join the group." in hero
    assert "4.9 stars from 173 member reviews on Whop." in hero
    assert "Join the live trading room" in hero


def test_v4_a_day_inside_timeline_sits_between_the_intro_and_the_traders():
    html = PAGE.read_text(encoding="utf-8")
    day = _section("day")
    assert re.search(r'<h2 id="day">\s*A day inside\s*</h2>', day)
    assert "How a day works" in _norm(day)
    items = [_norm(li) for li in re.findall(r"<li[^>]*>(.*?)</li>", day, flags=re.S)]
    assert items == [f"{when} {what}" for when, what in V4_TIMELINE]
    for when, _ in V4_TIMELINE:
        assert re.search(rf"<strong[^>]*>\s*{re.escape(when)}\s*</strong>", day), when
    assert html.index('class="hero"') < html.index('aria-labelledby="day"') < html.index('aria-labelledby="traders"')


def test_v4_traders_carry_the_teaching_lines_and_the_closing_line():
    sec = _section("traders")
    cards = re.findall(r'<li class="trader"><h3>(.*?)</h3><p>(.*?)</p></li>', sec, flags=re.S)
    assert [(_norm(h), _norm(p)) for h, p in cards] == V4_TRADERS
    assert [_norm(n) for n in re.findall(r'<p class="note">(.*?)</p>', sec, flags=re.S)] == [V4_TRADERS_CLOSING]


def test_v4_also_inside_lists_the_eight_locked_items():
    sec = _section("inside")
    ul = sec[sec.index('<ul class="inside">'):sec.index("</ul>")]
    assert [_norm(li) for li in re.findall(r"<li>(.*?)</li>", ul, flags=re.S)] == V4_INSIDE


def test_v4_visible_faq_questions_are_in_the_locked_order_and_match_the_json_ld():
    sec = _section("faq")
    visible_q = [_norm(q) for q in re.findall(r"<summary>(.*?)</summary>", sec, flags=re.S)]
    visible_a = [_norm(a) for a in re.findall(r"</summary>\s*<p>(.*?)</p>", sec, flags=re.S)]
    assert visible_q == FAQ_QUESTIONS
    p = _parsed()
    faq = next(json.loads(b) for a, b in p.scripts
               if a.get("type") == "application/ld+json" and json.loads(b).get("@type") == "FAQPage")
    assert [(q["name"], q["acceptedAnswer"]["text"]) for q in faq["mainEntity"]] == list(zip(visible_q, visible_a))
    for q, a in V4_NEW_FAQ_ANSWERS.items():
        assert visible_a[visible_q.index(q)] == a, q


def test_v4_page_has_no_em_dash_and_no_dollar_sign():
    html = PAGE.read_text(encoding="utf-8")
    assert "\u2014" not in html and "&mdash;" not in html and "&#8212;" not in html, "an em dash appeared"
    assert "$" not in html, "a dollar sign appeared on the page"
    assert "\ufffd" not in html
