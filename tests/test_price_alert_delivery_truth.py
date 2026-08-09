"""🔴 THE WATCHLIST PRICE-ALERT LANE RECORDED A FAILED DELIVERY AS A SUCCESS.

`deliver_alert_payload` — the *indicator* lane — was fixed in `c5e1bb2c`.
`_deliver_alert`, the lane a member reaches through the bell icon on a watchlist
row, had the identical defect and was deliberately left then. This is that lane.

Every channel sat in its own `try/except … _logger.warning`, the function
returned ``None`` whether all three landed or all three raised, and
`check_alerts_against_prices` discarded even that. The only sentence the lane
ever spoke was ``"Triggered %d price alert(s)"`` — a count of PRICE CROSSINGS
printed as if it were a count of members told.

⛔ AND IT IS WORSE HERE THAN IN THE INDICATOR LANE, because there is no retry.
`_trigger_alert` sets ``is_active = 0`` *before* any channel runs, so the row is
never selected again. A bounced email is permanent silence: the member asked to
be told, the price crossed, and nothing anywhere — not the row, not the log —
recorded that nobody reached them.

⭐ PARTIAL SUCCESS IS THE COMMON CASE AND MUST BE REPRESENTABLE. "in-app ok,
email failed" is the truth most of the time (Resend unset in dev, one global
Discord webhook, a member with no address on file) and collapsing it in EITHER
direction is a lie.

⛔ WHAT THESE TESTS MAY NOT BREAK: the fire-once ordering. It is not a CAS in
this lane — it is the deactivate-then-deliver sequence in
`check_alerts_against_prices`, and `test_a_total_delivery_failure_does_not_re_fire`
is the assertion that reporting a failure did not turn into retrying it.
"""
from __future__ import annotations

import pytest

from api.services import alerts as alerts_svc
from api.services import auth_db
from api.services import watchlist_alert_service as wls


ALERT = {"id": "a1", "user_id": "u_a", "sym": "AKAM",
         "direction": "above", "target_price": 95.0}


@pytest.fixture
def quiet(monkeypatch):
    """Every channel silent and SUCCEEDING unless a case says otherwise.

    ⛔ `add_alert` is the REAL one — it owns two of the three channels and fills
    its own two entries in the out-dict, and a fake here would be this file
    asserting against its own stub. Only the webhook underneath it is cut.
    """
    monkeypatch.setattr(alerts_svc, "_DISCORD_WEBHOOK", "", raising=False)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: "member@test")
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: True)


# ─── the report exists at all ───────────────────────────────────────────────

def test_a_clean_delivery_reports_every_channel_and_zero_failures(quiet):
    r = wls._deliver_alert(dict(ALERT), 96.25)
    assert r["channels_failed"] == 0
    assert r["channels"][alerts_svc.CHANNEL_IN_APP] == alerts_svc.CHANNEL_OK
    assert r["channels"][alerts_svc.CHANNEL_EMAIL] == alerts_svc.CHANNEL_OK
    assert r["errors"] == {}


def test_the_report_covers_EVERY_channel_this_lane_is_responsible_for(quiet):
    """⛔ DERIVED FROM `DELIVERY_CHANNELS`, never retyped. A channel missing
    from the report is a channel nobody can be told failed — the exact silence
    this file exists to end, one channel wide instead of three."""
    r = wls._deliver_alert(dict(ALERT), 96.25)
    assert set(r["channels"]) == set(wls.DELIVERY_CHANNELS)


# ─── the planted raising channel — THE case that was RED first ──────────────

def test_a_RAISING_in_app_channel_is_reported_as_failed(quiet, monkeypatch):
    """🔴 THE DEFECT, PLANTED. `add_alert` raises; before this change the
    function returned `None` and the caller logged a delivered alert."""
    def boom(*a, **k):
        raise RuntimeError("cache is down")
    monkeypatch.setattr(wls, "add_alert", boom)

    r = wls._deliver_alert(dict(ALERT), 96.25)
    assert r["channels"][alerts_svc.CHANNEL_IN_APP] == alerts_svc.CHANNEL_FAILED
    assert r["channels_failed"] >= 1
    assert "RuntimeError" in r["errors"][alerts_svc.CHANNEL_IN_APP]


def test_a_RAISING_channel_does_not_abort_the_others(quiet, monkeypatch):
    """An email must not be lost because the in-app write blew up."""
    sent = []
    monkeypatch.setattr(wls, "add_alert",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    monkeypatch.setattr(wls, "send_email",
                        lambda *a, **k: (sent.append(a) or True))

    r = wls._deliver_alert(dict(ALERT), 96.25)
    assert sent, "the in-app failure swallowed the email"
    assert r["channels"][alerts_svc.CHANNEL_EMAIL] == alerts_svc.CHANNEL_OK


def test_email_that_RETURNS_FALSE_is_a_failure_not_a_send(quiet, monkeypatch):
    """🔴 THE MUTATION THAT SURVIVED THE FIRST PASS IN THE INDICATOR LANE.

    `send_email`'s production failure mode is a False RETURN — Resend
    unconfigured, a 10s timeout, a 429 — not an exception. A suite that only
    ever makes it RAISE proves nothing about the shape that actually happens.
    """
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: False)
    r = wls._deliver_alert(dict(ALERT), 96.25)
    assert r["channels"][alerts_svc.CHANNEL_EMAIL] == alerts_svc.CHANNEL_FAILED
    assert r["channels_failed"] >= 1
    assert alerts_svc.CHANNEL_EMAIL in r["errors"]


def test_partial_success_is_representable_in_both_directions(quiet, monkeypatch):
    """Neither collapse is available: something landed AND something did not."""
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: False)
    r = wls._deliver_alert(dict(ALERT), 96.25)
    assert r["channels_ok"] >= 1, "a partial failure was collapsed into total"
    assert r["channels_failed"] >= 1, "a partial failure was collapsed into success"


# ─── skipped is not failed ──────────────────────────────────────────────────

def test_a_member_with_no_address_is_SKIPPED_not_failed(quiet, monkeypatch):
    """Read as a failure this sends somebody hunting an outage that does not
    exist — and it is the single most common state in dev."""
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    r = wls._deliver_alert(dict(ALERT), 96.25)
    assert r["channels"][alerts_svc.CHANNEL_EMAIL] == alerts_svc.CHANNEL_SKIPPED
    assert r["channels_failed"] == 0


def test_an_unset_discord_webhook_is_SKIPPED_not_failed(quiet):
    r = wls._deliver_alert(dict(ALERT), 96.25)
    assert r["channels"][alerts_svc.CHANNEL_DISCORD] == alerts_svc.CHANNEL_SKIPPED
    assert r["channels_failed"] == 0


# ─── the counts are DERIVED ─────────────────────────────────────────────────

def test_the_counts_are_computed_from_the_map_not_carried_beside_it(quiet,
                                                                    monkeypatch):
    """⛔ A counter incremented next to the map is this repo's most repeated
    defect: the two drift and the reader trusts whichever lied."""
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: False)
    r = wls._deliver_alert(dict(ALERT), 96.25)
    ch = r["channels"]
    assert r["channels_ok"] == sum(1 for v in ch.values()
                                   if v == alerts_svc.CHANNEL_OK)
    assert r["channels_failed"] == sum(1 for v in ch.values()
                                       if v == alerts_svc.CHANNEL_FAILED)


# ─── the report reaches the caller, and the dedup is untouched ──────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    """⚠️ `auth_db._DB_PATH` is captured at MODULE IMPORT, so `setenv` reaches
    nothing — the attribute is what `get_connection` reads.

    ⚠️ `watchlist_alerts.user_id` carries a real FOREIGN KEY, so the member has
    to exist. `USER_ID` is read back off the created row rather than typed —
    the id is the store's to mint.
    """
    from api.services import auth_service
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()
    user = auth_service.create_user("member@test", "TestPass2026!", "Member")
    return user["id"]


def test_check_alerts_appends_ONE_report_PER_FIRE(db, quiet, monkeypatch):
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: False)
    wls.create_alert(db, "AKAM", 95.0, "above")
    wls.create_alert(db, "NVDA", 10.0, "above")

    reports: list[dict] = []
    fired = wls.check_alerts_against_prices({"AKAM": 96.0, "NVDA": 11.0},
                                            reports=reports)
    assert len(fired) == 2
    assert len(reports) == 2, "the out-list lost a fire"
    assert all(r["channels_failed"] >= 1 for r in reports)


def test_the_out_list_is_OPTIONAL_and_omitting_it_changes_nothing(db, quiet):
    wls.create_alert(db, "AKAM", 95.0, "above")
    assert len(wls.check_alerts_against_prices({"AKAM": 96.0})) == 1


def test_a_total_delivery_failure_does_not_re_fire(db, quiet, monkeypatch):
    """⛔ THE FIRE-ONCE INVARIANT, ASSERTED RATHER THAN ASSUMED.

    Reporting a failure must not become retrying it. `_trigger_alert`
    deactivates the row before any channel runs; a second poll at the same
    price must select nothing, even though every channel just failed.
    """
    monkeypatch.setattr(wls, "add_alert",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: False)
    wls.create_alert(db, "AKAM", 95.0, "above")

    first: list[dict] = []
    assert len(wls.check_alerts_against_prices({"AKAM": 96.0}, reports=first)) == 1
    assert first[0]["channels_ok"] == 0, (
        "this case is meant to be a TOTAL failure and something landed — it "
        "proves nothing about re-firing after one")

    second: list[dict] = []
    assert wls.check_alerts_against_prices({"AKAM": 96.0}, reports=second) == []
    assert second == [], "a failed delivery re-fired — the member is told twice"
