"""WHERE the render capability may travel — and the long list of places it may not.

⛔⛔ THIS IS THE FILE THAT STOPS A CREDENTIAL LEAK. The renderer drives a real
browser over a public page; Playwright's `set_extra_http_headers` would have
attached the token to EVERY request that page makes — fonts, images, analytics,
any third-party origin the page ever acquires. The implementation therefore
attaches per-request, and `edge_token_targets` is the only thing that decides.

Each negative below is a host or path the token WOULD have reached under the
convenient implementation.
"""
from __future__ import annotations

import os
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
sys.path.insert(0, os.path.join(_ROOT, "services", "chart_renderer"))

from edge_scope import EDGE_TOKEN_HEADER, edge_token_targets  # noqa: E402

PAGE = "https://uctintelligence.com/r/chart?sym=AAPL&tf=D"


# ── where it MUST go ────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "https://uctintelligence.com/api/bars/AAPL",
    "https://uctintelligence.com/api/bars/AAPL?tf=D&bars=600",
    "https://uctintelligence.com/api/bars/QQQ?tf=D&bars=600&warm=1",
    "https://uctintelligence.com/api/bars/UCTA50?tf=D&bars=5",
    "https://uctintelligence.com/api/bars/%5EIXIC?tf=D&bars=2",
])
def test_bars_requests_on_the_page_origin_GET_the_token(url):
    assert edge_token_targets(url, PAGE) is True


# ── where it MUST NOT ───────────────────────────────────────────────────────

@pytest.mark.parametrize("url,why", [
    ("https://uctintelligence.com/api/bars-history/AAPL?tf=D&bars=60000",
     "a different path family with its own SHARED cached edge behaviour"),
    ("https://uctintelligence.com/api/bars-today-pack", "not behind the Worker"),
    ("https://uctintelligence.com/api/barspack/manifest", "not behind the Worker"),
    ("https://uctintelligence.com/api/auth/me", "the session surface"),
    ("https://uctintelligence.com/api/coverage", "resolves to the web pod"),
    ("https://uctintelligence.com/api/breadth-symbols", "not behind the Worker"),
    ("https://uctintelligence.com/r/chart-settings?token=x", "the render page's own API"),
    ("https://uctintelligence.com/", "the document itself"),
    ("https://uctintelligence.com/assets/index-abc123.js", "the JS bundle"),
    ("https://fonts.googleapis.com/css2?family=Inter", "a third-party stylesheet"),
    ("https://fonts.gstatic.com/s/inter/v1/font.woff2", "a third-party font"),
    ("https://cdn.jsdelivr.net/npm/thing/dist.js", "a third-party CDN"),
    ("https://evil.example.com/api/bars/AAPL", "another host entirely"),
    ("https://uctintelligence.com.evil.example/api/bars/AAPL", "a lookalike suffix host"),
    ("http://uctintelligence.com/api/bars/AAPL", "plaintext http"),
    ("https://uctintelligence.com:8443/api/bars/AAPL", "a different port"),
])
def test_everything_else_gets_NOTHING(url, why):
    assert edge_token_targets(url, PAGE) is False, why


def test_the_bars_history_boundary_is_the_TRAILING_SLASH():
    """⚰️ The exact trap this prefix is written to avoid: `/api/bars-history/`
    shares the first ten characters of `/api/bars/`. A prefix written without the
    trailing slash would have handed the capability to the cached historical
    surface this phase is forbidden to touch."""
    assert edge_token_targets("https://uctintelligence.com/api/bars/X", PAGE) is True
    assert edge_token_targets("https://uctintelligence.com/api/bars-history/X", PAGE) is False


@pytest.mark.parametrize("bad", ["", "not a url", "://", None, "javascript:alert(1)"])
def test_unparseable_urls_FAIL_CLOSED(bad):
    assert edge_token_targets(bad, PAGE) is False


def test_an_unparseable_PAGE_url_also_fails_closed():
    assert edge_token_targets("https://uctintelligence.com/api/bars/AAPL", "") is False


def test_the_header_name_matches_the_WORKER(monkeypatch):
    """⭐ Two files, one name. The renderer sends it and the Worker reads it; a
    rename on one side alone is a silent, total loss of machine trust."""
    worker = os.path.join(_ROOT, "edge", "bars-edge-router", "worker.js")
    with open(worker, encoding="utf-8") as fh:
        src = fh.read()
    assert f'"{EDGE_TOKEN_HEADER.lower()}"' in src, (
        f"worker.js does not read {EDGE_TOKEN_HEADER!r}")
