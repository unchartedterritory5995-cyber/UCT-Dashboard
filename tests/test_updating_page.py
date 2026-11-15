"""app/public/updating.html: the page Cloudflare shows in place of a gateway error during a deploy.

During the gap the origin cannot serve one extra file, so the page must be fully self-contained
(no external script, stylesheet, image or font), and it must wait for /api/health and reload.
"""
import pathlib
import re

PAGE = pathlib.Path(__file__).resolve().parents[1] / "app" / "public" / "updating.html"


def test_page_is_self_contained():
    html = PAGE.read_text(encoding="utf-8")
    assert not re.search(r"<(script|img|link|iframe)[^>]+(src|href)\s*=", html, re.I), \
        "updating.html loads a file; during the gap that file cannot be served"
    assert "@import" not in html and "url(" not in html


def test_page_waits_for_health_then_reloads_and_gives_up():
    html = PAGE.read_text(encoding="utf-8")
    assert "fetch('/api/health'" in html and "location.reload()" in html
    assert "GIVE_UP_MS" in html


def test_page_is_small_enough_for_an_edge_error_asset():
    assert PAGE.stat().st_size < 8 * 1024
