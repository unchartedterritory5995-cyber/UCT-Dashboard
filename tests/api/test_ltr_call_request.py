# tests/api/test_ltr_call_request.py
"""The /live-trading-room "talk to the team first" call request.

Covers the endpoint (validation, honeypot, per-IP rate limit, the Discord post and
its exact text, the DB row, the no-JS form fallback, no PII in logs) and the page
markup (the locked button and form copy, the privacy link, no em dash, no "$").
"""
import importlib
import logging
import re
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parents[2]
PAGE = REPO / "app" / "public" / "live-trading-room" / "index.html"
ENDPOINT = "/api/ltr/call-request"
LEADS_URL = "https://discord.test/api/webhooks/leads/token"
ADMIN_URL = "https://discord.test/api/webhooks/admin/token"

GOOD = {
    "name": "Jane Trader",
    "phone": "(555) 123-4567",
    "email": "jane@example.com",
    "best_time": "Afternoon",
    "trades": "Options",
}


class _Resp:
    def __init__(self, status_code=204):
        self.status_code = status_code


@pytest.fixture
def env(tmp_path, monkeypatch):
    db = tmp_path / "auth_test.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db))
    import api.services.auth_db as auth_db
    importlib.reload(auth_db)
    auth_db.init_db()

    from api.limiter import limiter
    monkeypatch.setattr(limiter, "enabled", False)

    import api.routers.ltr_call_request as mod
    mod._reset_rate_limit_for_tests()

    calls = []

    def fake_post(url, json=None, timeout=None, **kw):
        calls.append({"url": url, "json": json, "timeout": timeout})
        return _Resp(fake_post.status)

    fake_post.status = 204
    monkeypatch.setattr(mod.httpx, "post", fake_post)
    monkeypatch.setenv(mod.LEADS_WEBHOOK_ENV, LEADS_URL)

    from api.main import app
    c = TestClient(app)
    return {"client": c, "calls": calls, "fake": fake_post, "mod": mod, "db": str(db),
            "monkeypatch": monkeypatch}


def _rows(db):
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM ltr_call_requests ORDER BY id")]
    finally:
        conn.close()


# ── the happy path ─────────────────────────────────────────────────────────

def test_a_valid_request_is_stored_and_posted_to_the_leads_webhook(env):
    r = env["client"].post(ENDPOINT, json=GOOD)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    rows = _rows(env["db"])
    assert len(rows) == 1
    row = rows[0]
    assert (row["name"], row["phone"], row["email"], row["best_time"], row["trades"]) == (
        "Jane Trader", "(555) 123-4567", "jane@example.com", "Afternoon", "Options")
    assert row["discord_posted"] == 1

    assert len(env["calls"]) == 1
    call = env["calls"][0]
    assert call["url"] == LEADS_URL
    assert call["timeout"] and call["timeout"] <= 10
    body = call["json"]
    # Nobody's name in a lead can ping the channel.
    assert body["allowed_mentions"] == {"parse": []}
    content = body["content"]
    assert content.startswith("**Call request (website)** Jane Trader · (555) 123-4567 · "
                              "jane@example.com · best time Afternoon · trades Options · ")
    assert re.search(r"· \w{3} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M ET$", content), content
    assert "—" not in content


def test_optional_fields_can_be_left_out(env):
    r = env["client"].post(ENDPOINT, json={"name": "Sam", "phone": "+1 555 000 1111"})
    assert r.status_code == 200, r.text
    content = env["calls"][0]["json"]["content"]
    assert "Sam · +1 555 000 1111 · no email · best time not given · trades not given" in content
    assert _rows(env["db"])[0]["email"] in (None, "")


def test_an_unset_leads_variable_fails_closed_and_never_uses_another_channel(env):
    """No #leads webhook = an honest 503, never a fake "sent", and never a phone
    number posted to the admin channel instead."""
    mp = env["monkeypatch"]
    mp.delenv(env["mod"].LEADS_WEBHOOK_ENV, raising=False)
    import api.services.discord_notify as dn
    mp.setattr(dn, "DISCORD_ADMIN_WEBHOOK", ADMIN_URL, raising=False)
    r = env["client"].post(ENDPOINT, json=GOOD)
    assert r.status_code == 503
    body = r.json()
    assert body["ok"] is False
    assert "not available" in body["error"].lower()
    assert env["calls"] == []                       # nothing posted anywhere
    rows = _rows(env["db"])                         # kept as a record only
    assert len(rows) == 1 and rows[0]["discord_posted"] == 0


def test_a_blank_leads_variable_also_fails_closed(env):
    env["monkeypatch"].setenv(env["mod"].LEADS_WEBHOOK_ENV, "   ")
    r = env["client"].post(ENDPOINT, json=GOOD)
    assert r.status_code == 503
    assert env["calls"] == []


def test_an_unset_leads_variable_redirects_a_no_js_post_to_the_unavailable_state(env):
    env["monkeypatch"].delenv(env["mod"].LEADS_WEBHOOK_ENV, raising=False)
    r = env["client"].post(ENDPOINT, data=GOOD, follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/live-trading-room#call-unavailable"


def test_a_discord_refusal_is_not_reported_as_sent_even_though_the_row_is_saved(env):
    env["fake"].status = 500
    r = env["client"].post(ENDPOINT, json=GOOD)
    assert r.status_code == 503
    assert r.json()["ok"] is False
    assert "try again" in r.json()["error"].lower()
    assert _rows(env["db"])[0]["discord_posted"] == 0


def test_a_discord_exception_is_not_reported_as_sent(env, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("network down")
    monkeypatch.setattr(env["mod"].httpx, "post", boom)
    r = env["client"].post(ENDPOINT, json=GOOD)
    assert r.status_code == 503
    assert len(_rows(env["db"])) == 1


def test_a_db_failure_still_succeeds_when_leads_got_the_post(env, monkeypatch):
    def no_db():
        raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(env["mod"], "_connect", no_db)
    r = env["client"].post(ENDPOINT, json=GOOD)
    assert r.status_code == 200
    assert len(env["calls"]) == 1


def test_if_neither_the_db_nor_discord_take_it_the_caller_is_told_to_retry(env, monkeypatch):
    env["fake"].status = 500

    def no_db():
        raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(env["mod"], "_connect", no_db)
    r = env["client"].post(ENDPOINT, json=GOOD)
    assert r.status_code == 503
    assert r.json()["ok"] is False
    assert "try again" in r.json()["error"].lower()


def test_visitor_text_cannot_format_or_mask_link_in_the_leads_channel(env):
    r = env["client"].post(ENDPOINT, json={**GOOD, "name": "[click](http://x.test) **big** @everyone"})
    assert r.status_code == 200
    content = env["calls"][0]["json"]["content"]
    assert "\[click\](http://x.test) \*\*big\*\* @everyone" in content
    assert env["calls"][0]["json"]["allowed_mentions"] == {"parse": []}


# ── validation ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("patch,field", [
    ({"name": ""}, "name"),
    ({"name": "   "}, "name"),
    ({"name": "x" * 81}, "name"),
    ({"phone": ""}, "phone"),
    ({"phone": "12345"}, "phone"),                 # 5 digits
    ({"phone": "1" * 21}, "phone"),                # 21 digits
    ({"phone": "call me maybe 5551234"}, "phone"),  # letters
    ({"email": "not-an-email"}, "email"),
    ({"email": "a@b.c" + "x" * 260}, "email"),
    ({"best_time": "Midnight"}, "best_time"),
    ({"trades": "Crypto"}, "trades"),
])
def test_bad_input_is_rejected_with_the_field_named(env, patch, field):
    r = env["client"].post(ENDPOINT, json={**GOOD, **patch})
    assert r.status_code == 422, r.text
    assert r.json()["ok"] is False
    assert r.json()["field"] == field
    assert env["calls"] == []
    assert _rows(env["db"]) == []


def test_phone_digit_bounds_are_inclusive(env):
    assert env["client"].post(ENDPOINT, json={**GOOD, "phone": "5551234"}).status_code == 200
    assert env["client"].post(ENDPOINT, json={**GOOD, "phone": "1" * 20}).status_code == 200


def test_a_non_object_body_is_rejected(env):
    r = env["client"].post(ENDPOINT, content=b"[1,2]", headers={"content-type": "application/json"})
    assert r.status_code == 422


def test_newlines_cannot_forge_extra_lines_in_the_discord_message(env):
    r = env["client"].post(ENDPOINT, json={**GOOD, "name": "Jane\n**Call request (website)** fake"})
    assert r.status_code == 200
    assert "\n" not in env["calls"][0]["json"]["content"]


# ── honeypot ──────────────────────────────────────────────────────────────

def test_a_filled_honeypot_looks_like_success_but_stores_and_posts_nothing(env):
    r = env["client"].post(ENDPOINT, json={**GOOD, "website": "http://spam.example"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert env["calls"] == []
    assert _rows(env["db"]) == []


# ── rate limit ────────────────────────────────────────────────────────────

def test_the_sixth_request_in_an_hour_from_one_ip_is_refused(env):
    c = env["client"]
    for _ in range(5):
        assert c.post(ENDPOINT, json=GOOD).status_code == 200
    r = c.post(ENDPOINT, json=GOOD)
    assert r.status_code == 429
    assert r.json()["ok"] is False
    assert len(env["calls"]) == 5


def test_the_rate_limit_window_expires(env, monkeypatch):
    mod = env["mod"]
    now = [1_000_000.0]
    monkeypatch.setattr(mod, "_now", lambda: now[0])
    c = env["client"]
    for _ in range(5):
        assert c.post(ENDPOINT, json=GOOD).status_code == 200
    assert c.post(ENDPOINT, json=GOOD).status_code == 429
    now[0] += 3601
    assert c.post(ENDPOINT, json=GOOD).status_code == 200


# ── method, no-JS fallback, logs ──────────────────────────────────────────

def test_get_is_405(env):
    r = env["client"].get(ENDPOINT)
    assert r.status_code == 405
    assert r.headers.get("allow") == "POST"


def test_get_is_405_even_behind_a_spa_catch_all():
    """Production mounts a GET catch-all that serves index.html for ANY path,
    /api/* included. The router's own GET must win over it."""
    from fastapi import FastAPI
    from fastapi.responses import HTMLResponse
    import api.routers.ltr_call_request as mod
    app = FastAPI()
    app.include_router(mod.router)

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        return HTMLResponse("<div id=root></div>")

    c = TestClient(app)
    assert c.get(ENDPOINT).status_code == 405
    assert c.get("/anything-else").status_code == 200   # control: the catch-all is live


def test_a_plain_html_form_post_redirects_back_to_the_page_state(env):
    c = env["client"]
    r = c.post(ENDPOINT, data=GOOD, follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/live-trading-room#call-sent"
    assert len(_rows(env["db"])) == 1

    bad = c.post(ENDPOINT, data={**GOOD, "phone": "12"}, follow_redirects=False)
    assert bad.status_code == 303
    assert bad.headers["location"] == "/live-trading-room#call-error"


def test_no_pii_reaches_the_logs(env, caplog):
    caplog.set_level(logging.DEBUG)
    env["fake"].status = 500           # the failure path logs too
    env["client"].post(ENDPOINT, json=GOOD)
    env["client"].post(ENDPOINT, json={**GOOD, "phone": "12"})
    text = "\n".join(r.getMessage() for r in caplog.records)
    for secret in ("Jane", "123-4567", "5551234567", "jane@example.com", LEADS_URL):
        assert secret not in text, secret


# ── the page ──────────────────────────────────────────────────────────────

def _html():
    return PAGE.read_text(encoding="utf-8")


def test_the_page_has_the_locked_button_and_copy():
    html = _html()
    assert "Not sure yet? Talk to the team first" in html
    assert "Leave your number and the Uncharted Territory team will set up a quick call." in html
    assert "Request a call" in html
    assert "Thanks. The Uncharted Territory team will reach out soon to set up your call." in html
    assert 'id="call-unavailable"' in html
    assert re.search(r"We'll only use this to contact you about the room\.\s*"
                     r'<a href="/live-trading-room/privacy">Privacy</a>', html), "privacy line"


def test_the_talk_button_sits_beside_the_hero_join_button():
    html = _html()
    hero = html[html.index('class="hero"'):html.index("<section", html.index('class="hero"'))]
    assert "Join the live trading room" in hero
    assert "Not sure yet? Talk to the team first" in hero


def test_the_form_posts_to_the_endpoint_and_has_every_field():
    html = _html()
    form = re.search(r"<form[^>]*>.*?</form>", html, flags=re.S).group(0)
    assert re.search(r'action="/api/ltr/call-request"', form)
    assert re.search(r'method="post"', form)
    assert re.search(r'<input[^>]*name="name"[^>]*required', form)
    assert re.search(r'<input[^>]*type="tel"[^>]*name="phone"[^>]*required', form)
    email = re.search(r'<input[^>]*name="email"[^>]*>', form).group(0)
    assert "required" not in email and 'type="email"' in email
    for v in ("Morning", "Afternoon", "Evening"):
        assert re.search(rf'name="best_time" value="{v}"', form), v
    for v in ("Stocks", "Options", "Both", "Just starting"):
        assert re.search(rf'name="trades" value="{v}"', form), v
    assert "Best time to call (ET)" in form
    assert "What do you trade" in form
    # The honeypot is in the form, off-screen, and not tabbable or autofilled.
    hp = re.search(r'<input[^>]*name="website"[^>]*>', form).group(0)
    assert 'tabindex="-1"' in hp and 'autocomplete="off"' in hp


def test_the_page_has_no_em_dash_and_no_dollar_sign_anywhere_including_the_script():
    html = _html()
    assert "—" not in html and "&mdash;" not in html and "&#8212;" not in html
    assert "$" not in html


def test_the_removed_where_do_i_join_faq_is_gone_from_page_and_json_ld():
    import json
    html = _html()
    assert "DM offers" not in html
    assert "Where do I join?" not in html
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, flags=re.S)
    assert blocks, "JSON-LD present"
    parsed = [json.loads(b) for b in blocks]
    faq = [b for b in parsed if b.get("@type") == "FAQPage"]
    assert len(faq) == 1
    names = [q["name"] for q in faq[0]["mainEntity"]]
    assert "Where do I join?" not in names
    visible = re.findall(r"<summary>(.*?)</summary>", html)
    assert set(names) <= set(visible), "every JSON-LD question is also on the page"


def test_the_page_has_a_clear_retry_message():
    assert re.search(r"try again", _html(), flags=re.I)
