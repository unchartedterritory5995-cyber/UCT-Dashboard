"""What a search engine reads at https://uctintelligence.com/ before launch.

`/` is served by the SPA catch-all, so a crawler gets app/index.html after the
pre-launch swap in app/comingSoonMeta.js (a vite `transformIndexHtml` plugin,
on while VITE_COMING_SOON=1, which is what production builds with). Until
2026-10-07 that HTML said "Coming soon", carried no text and no link, and so
passed nothing on to /live-trading-room, the one public page open today.

This runs the REAL transform under plain node against the REAL index.html, the
way the build does, and reads the result with an HTML parser that does not run
scripts (which is what a non-rendering crawler is). It needs no node_modules.

It also pins robots.txt and sitemap.xml: the sitemap must list only pages that
answer with their own HTML and their own canonical.
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess
from html.parser import HTMLParser

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
APP = REPO / "app"
INDEX = APP / "index.html"
MODULE = APP / "comingSoonMeta.js"
VITE_CONFIG = APP / "vite.config.js"
ROBOTS = APP / "public" / "robots.txt"
SITEMAP = APP / "public" / "sitemap.xml"
ROOM_PAGE = APP / "public" / "live-trading-room" / "index.html"

HOME = "https://uctintelligence.com/"
ROOM_PATH = "/live-trading-room"

# Google cuts a title at about 60 characters and a description at about 155 to 160.
TITLE_MAX = 60
DESC_MIN, DESC_MAX = 70, 160

DASHES = ("—", "–", "&mdash;", "&ndash;", "&#8212;", "&#8211;")

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def _node(script: str) -> str:
    proc = subprocess.run(
        [shutil.which("node"), "--input-type=module", "-e", script],
        cwd=str(APP), capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    assert proc.returncode == 0, f"the JS bridge did not run (exit {proc.returncode}).\n{proc.stderr}"
    return proc.stdout


def _served(coming_soon: str | None = "1") -> str:
    """index.html after the plugin's own hook, with VITE_COMING_SOON as given."""
    env = "delete process.env.VITE_COMING_SOON;" if coming_soon is None else (
        f"process.env.VITE_COMING_SOON = {json.dumps(coming_soon)};")
    return _node(
        "import { readFileSync } from 'node:fs';\n"
        f"import {{ comingSoonMeta }} from {json.dumps(MODULE.as_uri())};\n"
        f"{env}\n"
        f"const html = readFileSync({json.dumps(str(INDEX))}, 'utf8');\n"
        "process.stdout.write(comingSoonMeta().transformIndexHtml(html));\n"
    )


class _Page(HTMLParser):
    """A reader that runs no scripts: <noscript> children are ordinary elements."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags: list[tuple[str, dict]] = []
        self.title = ""
        self.body_text: list[str] = []
        self.links: list[tuple[str, str]] = []   # (href, text) for <a> in <body>
        self._stack: list[str] = []
        self._a: dict | None = None
        self._a_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.tags.append((tag, a))
        if tag not in ("meta", "link", "br", "img", "input", "hr"):
            self._stack.append(tag)
        if tag == "a" and "body" in self._stack:
            self._a, self._a_text = a, []

    def handle_endtag(self, tag):
        if tag == "a" and self._a is not None:
            self.links.append((self._a.get("href", ""), "".join(self._a_text).strip()))
            self._a = None
        if tag in self._stack:          # `<meta ... />` ends a tag that was never pushed
            while self._stack.pop() != tag:
                pass

    def handle_data(self, data):
        if "title" in self._stack and "head" in self._stack:
            self.title += data
        if "body" in self._stack and not {"script", "style"} & set(self._stack):
            self.body_text.append(data)
            if self._a is not None:
                self._a_text.append(data)


def _parse(html: str) -> _Page:
    p = _Page()
    p.feed(html)
    return p


def _meta(p: _Page, **match) -> str | None:
    for tag, a in p.tags:
        if tag == "meta" and all(a.get(k) == v for k, v in match.items()):
            return a.get("content")
    return None


@pytest.fixture(scope="module")
def served() -> str:
    return _served("1")


@pytest.fixture(scope="module")
def page(served) -> _Page:
    return _parse(served)


# ── the head ────────────────────────────────────────────────────────────────

@needs_node
def test_the_title_names_the_room_and_fits_a_search_result(page):
    title = page.title.strip()
    assert "coming soon" not in title.lower(), title
    assert title.startswith("UCT Intelligence"), "the browser tab reads the brand first"
    assert "Uncharted Territory" in title and "Live Trading Room" in title
    assert len(title) <= TITLE_MAX, (len(title), title)


@needs_node
def test_the_description_fits_and_says_what_is_open_today(page):
    desc = _meta(page, name="description") or ""
    assert DESC_MIN <= len(desc) <= DESC_MAX, (len(desc), desc)
    assert "live trading room on Discord" in desc
    assert "launch list" not in desc.lower()


@needs_node
def test_canonical_open_graph_and_twitter_all_agree(page):
    canon = [a.get("href") for t, a in page.tags if t == "link" and a.get("rel") == "canonical"]
    assert canon == [HOME]
    assert _meta(page, property="og:url") == HOME
    assert _meta(page, property="og:type") == "website"
    title, desc = page.title.strip(), _meta(page, name="description")
    assert _meta(page, property="og:title") == title
    assert _meta(page, name="twitter:title") == title
    assert _meta(page, property="og:description") == desc
    assert _meta(page, name="twitter:description") == desc
    assert _meta(page, name="twitter:card") == "summary_large_image"
    image = _meta(page, property="og:image") or ""
    assert image == _meta(page, name="twitter:image")
    assert image.startswith(HOME)
    # the card is a real file the server has a route for
    name = image[len(HOME):].split("?")[0]
    assert (APP / "public" / name).is_file(), name
    assert f'"/{name}"' in (REPO / "api" / "main.py").read_text(encoding="utf-8")


@needs_node
def test_nothing_tells_a_crawler_to_stay_away(page):
    assert "noindex" not in (_meta(page, name="robots") or "")


@needs_node
def test_the_json_ld_still_parses_and_offers_nothing_for_sale(served):
    blocks = re.findall(r'<script type="application/ld\+json">([\s\S]*?)</script>', served)
    assert len(blocks) == 1
    data = json.loads(blocks[0])
    assert data["url"] == HOME
    assert "offers" not in data


# ── the body a reader with no JavaScript gets ───────────────────────────────

@needs_node
def test_the_raw_html_has_a_real_link_to_the_live_trading_room(page):
    room = [(h, t) for h, t in page.links if h == ROOM_PATH]
    assert len(room) == 1, page.links
    assert room[0][1], "the link has no text"
    # and the page it points at exists and names that address as its own
    assert f'<link rel="canonical" href="{HOME.rstrip("/")}{ROOM_PATH}"' in ROOM_PAGE.read_text(encoding="utf-8")


@needs_node
def test_the_raw_html_has_one_heading_and_readable_text(page):
    assert [t for t, _ in page.tags if t == "h1"] == ["h1"]
    text = " ".join(" ".join(page.body_text).split())
    assert "live trading room on Discord" in text
    assert "Patrick (TSDR)" in text
    assert "coming soon" in text.lower(), "the app is still pre-launch and the fallback says so"


@needs_node
def test_the_fallback_is_noscript_only_and_react_still_owns_an_empty_root(served):
    # A browser that runs JavaScript never renders <noscript>, so the app and its
    # members see nothing new. The mount point must stay empty and come first.
    assert served.count('<div id="root"></div>') == 1
    assert served.count("<noscript>") == served.count("</noscript>") == 1
    root, ns_open, ns_close = (served.index('<div id="root"></div>'),
                               served.index("<noscript>"), served.index("</noscript>"))
    assert root < ns_open < ns_close < served.index("</body>")
    assert served.count(f'href="{ROOM_PATH}"') == 1
    assert ns_open < served.index(f'href="{ROOM_PATH}"') < ns_close
    assert ns_open < served.index("<h1") < ns_close
    # the entry script is untouched and still after the mount point
    assert served.index('<script type="module"') > root


# ── the wording rules ───────────────────────────────────────────────────────

@needs_node
def test_the_new_copy_follows_the_wording_rules(page, served):
    ns = served[served.index("<noscript>"):served.index("</noscript>")]
    copy = {
        "title": page.title,
        "description": _meta(page, name="description") or "",
        "noscript": ns,
    }
    for where, text in copy.items():
        for d in DASHES:
            assert d not in text, f"a dash ({d!r}) in the {where}"
        # the owner is always "Patrick (TSDR)"
        assert text.count("TSDR") == text.count("Patrick (TSDR)"), where
        # "700+ members" is the only member count there is
        for m in re.finditer(r"([\d,.]+\s*[kK]?\+?)\s+(?:members|traders|subscribers)", text):
            assert m.group(0).startswith("700+ members"), (where, m.group(0))
        low = text.lower()
        for banned in ("strategy book", "win rate", "profit", "returns", "guarantee",
                       "% ", "signals", "$"):
            assert banned not in low, f"{banned!r} in the {where}"


# ── the switch ──────────────────────────────────────────────────────────────

@needs_node
def test_with_the_flag_off_the_launch_html_comes_back_untouched():
    source = INDEX.read_text(encoding="utf-8")
    assert _served(None) == source
    assert _served("0") == source
    assert "<noscript>" not in source


def test_the_build_uses_the_module_this_file_tests():
    cfg = VITE_CONFIG.read_text(encoding="utf-8")
    assert "from './comingSoonMeta.js'" in cfg
    assert re.search(r"plugins:\s*\[[^\]]*\bcomingSoonMeta\(\)", cfg)
    assert "function comingSoonMeta" not in cfg, "a second copy of the plugin in vite.config.js"
    assert not re.search(r"^\s*import\s", MODULE.read_text(encoding="utf-8"), re.M), \
        "comingSoonMeta.js must stay import-free so it runs without node_modules"


# ── robots.txt and sitemap.xml ──────────────────────────────────────────────

def test_robots_allows_the_public_pages_and_names_the_sitemap():
    lines = [l.strip() for l in ROBOTS.read_text(encoding="utf-8").splitlines()]
    assert "User-agent: *" in lines and "Allow: /" in lines
    assert f"Sitemap: {HOME}sitemap.xml" in lines
    disallowed = [l.split(":", 1)[1].strip() for l in lines if l.startswith("Disallow:")]
    assert disallowed, "the control: the parser found the Disallow lines"
    for path in ("/", ROOM_PATH):
        assert not any(path == d or (d != "/" and path.startswith(d.rstrip("/") + "/")) for d in disallowed), path
    assert "/" not in disallowed


def test_the_sitemap_lists_only_pages_with_their_own_html():
    locs = re.findall(r"<loc>([^<]+)</loc>", SITEMAP.read_text(encoding="utf-8"))
    assert locs[0] == HOME
    assert f"{HOME.rstrip('/')}{ROOM_PATH}" in locs
    assert len(locs) == len(set(locs))
    # Every address other than the homepage must be a static page with its own
    # file. An SPA route (/terms, /privacy) answers with the shell, whose
    # canonical is the homepage, so listing it tells Google two different things.
    main_py = (REPO / "api" / "main.py").read_text(encoding="utf-8")
    for loc in locs[1:]:
        assert loc.startswith(f"{HOME.rstrip('/')}{ROOM_PATH}"), f"{loc} is served by the SPA shell"
        rel = loc[len(HOME):]
        name = rel.split("/", 1)[1] + ".html" if "/" in rel else "index.html"
        page = APP / "public" / "live-trading-room" / name
        assert page.is_file(), loc
        assert f'<link rel="canonical" href="{loc}"' in page.read_text(encoding="utf-8"), loc
    assert '"/sitemap.xml"' in main_py and '"/robots.txt"' in main_py
