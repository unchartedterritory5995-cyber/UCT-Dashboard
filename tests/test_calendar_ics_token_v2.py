"""TERM-084 (FB-X2-02) -- the ICS export token expires, rotates and can be revoked.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
`/api/calendar/export-token` minted `hmac(PUSH_SECRET, user_id)`: no expiry, no
rotation, and the only way to kill a leaked link was to change `PUSH_SECRET`,
which kills every member's link at once. A paid session became a permanent
bearer credential.

Members have ALREADY subscribed their calendar apps with that token, so the
migration is the load-bearing half, not the crypto:

* flag OFF (`ICS_TOKEN_V2_ENABLED` unset) -- every request a member can make
  today answers byte-for-byte what it answers today;
* flag ON -- new links are `v2.` tokens with a signed expiry and a per-member
  generation. Rotating bumps the generation (every older link of that member is
  refused) AND revokes the member's legacy link. Legacy links keep working
  through a grace period the owner closes with `ICS_LEGACY_TOKEN_GRACE_UNTIL`,
  every use is COUNTED per member, and the feed itself carries a notice event
  telling the member to re-subscribe.

The clock is injected (`ics_export_token._clock`); nothing here reads the wall
clock in an assertion.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import sqlite3
from unittest import mock

import pytest
from fastapi.testclient import TestClient

SECRET = "test-push-secret-term-084"
DAY = 86400
T0 = 1_790_000_000.0          # a fixed instant (2026-09-21 UTC); never the wall clock
U1, U2 = "user-aaa-111", "user-bbb-222"
REPORTERS = [("AAPL", "2026-09-22", "bmo")]


def _legacy(uid: str) -> str:
    """TODAY's token, re-derived independently of the router (the byte-identity oracle)."""
    return hmac.new(SECRET.encode(), uid.encode(), hashlib.sha256).hexdigest()


@pytest.fixture
def env(tmp_path, monkeypatch):
    """Isolated auth.db (users + whatever the token store creates), fixed secret, fixed clock."""
    db = tmp_path / "auth.db"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT)")
    c.executemany("INSERT INTO users VALUES (?, ?)", [(U1, "a@x"), (U2, "b@x")])
    c.commit()
    c.close()

    def _conn():
        k = sqlite3.connect(db)
        k.row_factory = sqlite3.Row
        return k

    import api.services.auth_db as adb
    monkeypatch.setattr(adb, "get_connection", _conn)
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    monkeypatch.delenv("ICS_TOKEN_V2_ENABLED", raising=False)
    monkeypatch.delenv("ICS_TOKEN_TTL_DAYS", raising=False)
    monkeypatch.delenv("ICS_LEGACY_TOKEN_GRACE_UNTIL", raising=False)
    monkeypatch.delenv("DASHBOARD_URL", raising=False)

    import api.routers.calendar as cal
    from api.services import ics_export_token as tok
    clock = {"t": T0}
    monkeypatch.setattr(tok, "_clock", lambda: clock["t"])
    # the legacy decoder's 5-minute cache is process-global; start every test cold
    from api.services.cache import cache
    cache.delete_prefix("ics_token_decode_")

    from api.main import app
    who = {"id": U1}
    app.dependency_overrides[cal.require_paid] = lambda: dict(who, plan="pro")
    client = TestClient(app)
    try:
        yield {"client": client, "clock": clock, "who": who, "db": db, "tok": tok,
               "cal": cal, "monkeypatch": monkeypatch}
    finally:
        app.dependency_overrides.pop(cal.require_paid, None)


def _on(env):
    env["monkeypatch"].setenv("ICS_TOKEN_V2_ENABLED", "1")


def _feed(env, token):
    with mock.patch("api.routers.calendar._collect_reporters_for_ics",
                    return_value=list(REPORTERS)) as collect:
        r = env["client"].get("/api/calendar/export.ics", params={"scope": "mine", "token": token})
    return r, collect


def _mint(env):
    r = env["client"].get("/api/calendar/export-token")
    assert r.status_code == 200, r.text
    return r.json()


def _rotate(env):
    r = env["client"].post("/api/calendar/export-token/rotate")
    assert r.status_code == 200, r.text
    return r.json()


def _tables(db):
    c = sqlite3.connect(db)
    try:
        return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        c.close()


# ── 1. flag OFF is byte-identical to today ───────────────────────────────────

def test_flag_off_every_existing_request_answers_exactly_what_it_answers_today(env):
    c = env["client"]
    tok = _legacy(U1)

    r = c.get("/api/calendar/export-token")
    expected = json.dumps(
        {"token": tok,
         "subscribe_url": f"webcal://uctintelligence.com/api/calendar/export.ics?scope=mine&token={tok}"},
        separators=(",", ":"), ensure_ascii=False).encode()
    assert r.status_code == 200
    assert r.content == expected, r.content

    body_ok, collect = _feed(env, tok)
    assert body_ok.status_code == 200
    assert body_ok.content == env["cal"]._build_vcalendar(
        [env["cal"]._build_vevent(*REPORTERS[0])]).encode()
    assert "link" not in body_ok.text.lower()          # no notice event when OFF
    collect.assert_called_once_with("mine", U1)

    bad, _ = _feed(env, "0" * 64)
    assert (bad.status_code, bad.content) == (403, b"Invalid or expired token")

    missing = c.get("/api/calendar/export.ics", params={"scope": "mine"})
    assert (missing.status_code, missing.content) == (400, b"scope=mine requires a token parameter")

    # the rotate door does not exist while OFF -- same answer as an unknown route
    rot = c.post("/api/calendar/export-token/rotate")
    assert (rot.status_code, rot.json()) == (404, {"detail": "Not Found"})

    # and the OFF path neither creates nor writes the token store
    assert "ics_export_token_state" not in _tables(env["db"])


# ── 2. an expired token is refused ───────────────────────────────────────────

def test_an_expired_token_is_refused_with_401(env):
    _on(env)
    minted = _mint(env)
    assert minted["token"].startswith("v2.") and minted["rotatable"] is True

    ok, _ = _feed(env, minted["token"])
    assert ok.status_code == 200

    env["clock"]["t"] = T0 + 90 * DAY + 1          # default TTL is 90 days
    r, collect = _feed(env, minted["token"])
    assert r.status_code == 401, (r.status_code, r.text)
    assert "expired" in r.text.lower()
    collect.assert_not_called()


def test_expiry_is_signed_so_editing_it_in_the_url_is_refused(env):
    _on(env)
    t = _mint(env)["token"]
    v, uid, gen, exp, sig = t.split(".")
    forged = ".".join([v, uid, gen, str(int(exp) + 365 * DAY), sig])
    env["clock"]["t"] = T0 + 90 * DAY + 1
    r, _ = _feed(env, forged)
    assert r.status_code == 403


def test_the_feed_warns_the_member_inside_their_own_calendar_before_the_link_expires(env):
    _on(env)
    t = _mint(env)["token"]
    early, _ = _feed(env, t)
    assert "uct-calendar-link-notice" not in early.text
    env["clock"]["t"] = T0 + 80 * DAY                  # inside the 14-day notice window
    late, _ = _feed(env, t)
    assert late.status_code == 200
    assert late.text.count("BEGIN:VEVENT") == 2
    assert "uct-calendar-link-notice" in late.text and "Export" in late.text


# ── 3. a rotated old token is refused ────────────────────────────────────────

def test_rotation_refuses_the_old_token_and_serves_the_new_one(env):
    _on(env)
    old = _mint(env)["token"]
    assert _feed(env, old)[0].status_code == 200

    new = _rotate(env)
    assert new["token"] != old and new["subscribe_url"].endswith(new["token"])

    r_old, collect = _feed(env, old)
    assert r_old.status_code == 403, (r_old.status_code, r_old.text)
    collect.assert_not_called()
    r_new, collect = _feed(env, new["token"])
    assert r_new.status_code == 200
    collect.assert_called_once_with("mine", U1)
    # and the export-token door now hands out the NEW generation
    assert _mint(env)["token"] == new["token"]


def test_rotation_is_per_member_and_needs_no_secret_change(env):
    _on(env)
    mine = _mint(env)["token"]
    env["who"]["id"] = U2
    theirs = _mint(env)["token"]
    env["who"]["id"] = U1
    _rotate(env)
    assert _feed(env, mine)[0].status_code == 403
    assert _feed(env, theirs)[0].status_code == 200      # U2 untouched, PUSH_SECRET untouched


# ── 4. legacy tokens: served through the grace period, counted, revocable ────

def test_a_legacy_token_is_served_counted_and_told_to_migrate(env):
    _on(env)
    legacy = _legacy(U1)
    for _ in range(3):
        r, collect = _feed(env, legacy)
        assert r.status_code == 200
        collect.assert_called_once_with("mine", U1)
    assert "uct-calendar-link-notice" in r.text

    usage = env["tok"].legacy_usage()
    assert usage["uses_total"] == 3 and usage["members"] == 1 and usage["refused_total"] == 0


def test_rotating_also_revokes_the_members_legacy_link(env):
    _on(env)
    legacy = _legacy(U1)
    assert _feed(env, legacy)[0].status_code == 200
    _rotate(env)
    r, collect = _feed(env, legacy)
    assert r.status_code == 403
    collect.assert_not_called()
    assert _feed(env, _legacy(U2))[0].status_code == 200   # another member's legacy link lives


def test_after_the_grace_date_a_legacy_token_is_refused_and_the_refusal_is_counted(env):
    _on(env)
    env["monkeypatch"].setenv("ICS_LEGACY_TOKEN_GRACE_UNTIL", "2026-10-01")
    assert _feed(env, _legacy(U1))[0].status_code == 200           # T0 is 2026-09-21
    env["clock"]["t"] = T0 + 11 * DAY                               # 2026-10-02
    r, collect = _feed(env, _legacy(U1))
    assert r.status_code == 401
    collect.assert_not_called()
    usage = env["tok"].legacy_usage()
    assert (usage["uses_total"], usage["refused_total"]) == (1, 1)


def test_legacy_usage_is_readable_by_an_admin(env):
    _on(env)
    _feed(env, _legacy(U1))
    from api.main import app
    from api.middleware.auth_middleware import require_admin
    app.dependency_overrides[require_admin] = lambda: {"id": "admin", "role": "admin"}
    try:
        r = env["client"].get("/api/calendar/export-token/legacy-usage")
    finally:
        app.dependency_overrides.pop(require_admin, None)
    assert r.status_code == 200 and r.json()["uses_total"] == 1


# ── 5. a token never appears in a log line ───────────────────────────────────

def test_no_token_ever_reaches_a_log_line(env, caplog):
    _on(env)
    env["monkeypatch"].setenv("ICS_LEGACY_TOKEN_GRACE_UNTIL", "2026-10-01")
    caplog.set_level(logging.DEBUG)
    seen: list[str] = []

    minted = _mint(env)
    seen.append(minted["token"])
    _feed(env, minted["token"])                       # valid
    _feed(env, _legacy(U1))                           # legacy served
    rotated = _rotate(env)
    seen.append(rotated["token"])
    _feed(env, minted["token"])                       # revoked
    _feed(env, _legacy(U1))                           # legacy revoked
    env["clock"]["t"] = T0 + 120 * DAY
    _feed(env, rotated["token"])                      # expired
    _feed(env, _legacy(U2))                           # legacy past grace
    _feed(env, "v2.garbage.1.2.sig")                  # malformed
    seen += [_legacy(U1), _legacy(U2)]

    assert caplog.records, "the rail saw no log records at all -- it would pass vacuously"
    signatures = {t.rsplit(".", 1)[-1] for t in seen}
    for rec in caplog.records:
        text = rec.getMessage() + " " + repr(rec.args) + " " + str(rec.exc_text or "")
        for secret in set(seen) | signatures:
            assert secret not in text, f"token material logged by {rec.name}: {text[:200]}"


# ── TERM-084 (c): `scope=all` is bounded, measured by an ANONYMOUS request ────

def _anon_all(env, n):
    rows = [(f"S{i:04d}", f"2026-10-{1 + i % 28:02d}", "bmo") for i in range(n)]
    rows.sort(key=lambda x: (x[1], x[0]))
    with mock.patch("api.routers.calendar._collect_reporters_for_ics", return_value=rows):
        r = TestClient(env["client"].app).get("/api/calendar/export.ics",
                                              params={"scope": "all"}, cookies={})
    assert r.status_code == 200, r.text
    return r.text, rows


def test_an_anonymous_scope_all_is_capped_and_says_so(env):
    cap = env["cal"].ICS_ALL_MAX_EVENTS
    body, rows = _anon_all(env, cap + 250)
    assert body.count("BEGIN:VEVENT") == cap + 1            # the cap + one truncation notice
    assert f"showing the next {cap} of {cap + 250}" in body
    first = rows[0][0]
    assert f"{first}" in body                                # nearest reports kept
    assert rows[-1][0] not in body                           # the far end is what is cut


def test_under_the_cap_nothing_is_cut_and_no_notice_is_added(env):
    body, rows = _anon_all(env, 40)
    assert body.count("BEGIN:VEVENT") == 40
    assert "showing the next" not in body


def test_the_cap_does_not_touch_scope_mine(env):
    cap = env["cal"].ICS_ALL_MAX_EVENTS
    rows = [(f"M{i:04d}", "2026-10-01", "bmo") for i in range(cap + 5)]
    with mock.patch("api.routers.calendar._collect_reporters_for_ics", return_value=rows):
        r = env["client"].get("/api/calendar/export.ics",
                              params={"scope": "mine", "token": _legacy(U1)})
    assert r.status_code == 200
    assert r.text.count("BEGIN:VEVENT") == cap + 5
