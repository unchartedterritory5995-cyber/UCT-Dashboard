"""R39 sign-in acquisition: the SERVER's answer decides, never the header markup.

⚰️ 2026-09-18, the owner's first real sign-in run: the layout tab landed on the
HOME page ("TradingView — Track All Markets"), whose signed-out control is a
"Get started" SPAN inside an A. The DOM probe reads an element's OWN text on
button/a/[role=button] only, so it saw neither marker and the tool exited 2
(INCONCLUSIVE) before it ever asked the owner to sign in.

⭐ THE PRODUCT'S OWN ANSWER, MEASURED THE SAME DAY: a background request for the
private layout, sharing the browser context's cookie jar, returns **403 with
"Chart Not Found"** to a stranger — no tab touched. The owner can open their own
layout, so the same request flipping to a plain 200 is the sign-in. The 403 must
carry the marker: Cloudflare's bot wall is also a 403, and it is not a verdict
about who is signed in.
"""
from __future__ import annotations

import pytest

from tools import pine_vendor_capture as pvc

STRANGER_BODY = "<html><head><title>Chart Not Found — TradingView</title></head></html>"
OWNER_BODY = "<html><head><title>NVDA 180.00 UCT CAPTURE RIG — no studies</title></head></html>"
CF_BODY = "<html><title>Access denied | tradingview.com used Cloudflare</title>error 1010</html>"


HOME_URL = "https://www.tradingview.com/"
HOME_BODY = "<html><head><title>TradingView — Track All Markets</title></head></html>"


@pytest.mark.parametrize(
    "status, body, final_url, expected",
    [
        (403, STRANGER_BODY, pvc.LAYOUT, "signed_out"),   # measured 2026-09-18
        (200, OWNER_BODY, pvc.LAYOUT, "signed_in"),
        (200, OWNER_BODY, pvc.LAYOUT + "?symbol=NVDA", "signed_in"),
        # ⛔ a stranger bounced to the home page is a plain 200 with no marker.
        # Following that redirect must never read as the owner's layout opening.
        (200, HOME_BODY, HOME_URL, "inconclusive"),
        (403, CF_BODY, pvc.LAYOUT, "inconclusive"),       # a bot wall is not a verdict
        (200, STRANGER_BODY, pvc.LAYOUT, "inconclusive"), # soft-404: never measured
        (404, STRANGER_BODY, pvc.LAYOUT, "inconclusive"),
        (429, "", pvc.LAYOUT, "inconclusive"),
        (503, "", pvc.LAYOUT, "inconclusive"),
        (200, "", pvc.LAYOUT, "inconclusive"),
        (None, None, None, "inconclusive"),
    ],
)
def test_layout_access_classifier(status, body, final_url, expected):
    assert pvc.classify_layout_access(status, body, final_url) == expected


class _Resp:
    def __init__(self, status, body, url):
        self.status, self._body, self.url = status, body, url

    def text(self):
        return self._body


class _Request:
    """Scripted server answers: (status, body) or (status, body, final_url)."""

    def __init__(self, script):
        self.script, self.calls = list(script), 0

    def get(self, url, **_kw):
        assert url == pvc.LAYOUT
        self.calls += 1
        entry = self.script[min(self.calls, len(self.script)) - 1]
        status, body, final = (*entry, pvc.LAYOUT)[:3]
        return _Resp(status, body, final)


class _Page:
    """The run-1 page: the HOME page, where the DOM probe sees neither marker."""

    def __init__(self, script):
        self.context = type("Ctx", (), {})()
        self.context.request = _Request(script)
        self.url = "https://www.tradingview.com/"
        self.gotos = []

    def evaluate(self, _js):
        return {"signedOut": [], "signedIn": [], "ambiguous": ["Open user menu"],
                "title": "TradingView — Track All Markets"}

    def goto(self, url, **_kw):
        self.gotos.append(url)
        self.url = url

    def wait_for_timeout(self, _ms):
        pass


def test_home_page_variant_prompts_and_then_detects_the_sign_in(capsys):
    """THE REGRESSION: neither DOM marker, server says 403 -> the owner is asked
    to sign in; the server flipping to 200 -> signed in, and the tab is put back
    on the layout for recon."""
    page = _Page([(403, STRANGER_BODY), (403, STRANGER_BODY), (200, OWNER_BODY)])
    assert pvc.acquire(page, wait_s=60) == 0
    out = capsys.readouterr().out
    assert "SIGN IN TO TRADINGVIEW" in out
    assert page.gotos and page.gotos[-1] == pvc.LAYOUT


def test_already_signed_in_needs_no_keyboard(capsys):
    page = _Page([(200, OWNER_BODY)])
    assert pvc.acquire(page, wait_s=60) == 0
    assert "SIGN IN TO TRADINGVIEW" not in capsys.readouterr().out
    assert page.gotos[-1] == pvc.LAYOUT


def test_an_unreadable_first_answer_is_inconclusive_not_a_prompt(capsys):
    page = _Page([(503, "")])
    assert pvc.acquire(page, wait_s=60) == 2
    assert "SIGN IN TO TRADINGVIEW" not in capsys.readouterr().out


def test_a_stranger_bounced_home_is_never_read_as_signed_in(capsys):
    page = _Page([(200, HOME_BODY, HOME_URL)])
    assert pvc.acquire(page, wait_s=60) == 2
    assert "already signed in" not in capsys.readouterr().out


def test_no_sign_in_inside_the_wait_is_inconclusive(capsys):
    page = _Page([(403, STRANGER_BODY)])
    assert pvc.acquire(page, wait_s=0) == 2
    assert page.gotos == []
