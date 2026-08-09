"""🔴 AN ALERT THAT REACHED NOBODY WAS RECORDED AS DELIVERED.

`watchlist_alert_service.deliver_alert_payload` wrapped each channel in its own
`try/except … _logger.warning` and returned ``None`` **whether every channel
landed or every one raised**. `_delivery_failed` therefore read False on every
real return value, `delivered_at` was stamped either way, and an alert whose
email bounced, whose Discord webhook 403'd and whose in-app write failed was
indistinguishable from one that reached the member on all three.

That is this phase's own defect class — a confident success over an absent
result — in the one place where a member ACTS on it: they believe they were
told, and they were not.

⭐ PARTIAL SUCCESS IS THE COMMON CASE, and it is what these tests are mostly
about. "in-app ok, email failed" is the truth most of the time (Resend unset in
dev, one global Discord webhook, a member with no address) and collapsing it in
EITHER direction is a lie: called a success it hides a missing email, called a
failure it releases the lease and re-sends an in-app alert the member already
has.

⛔ WHAT THESE TESTS MAY NOT BREAK, and each is asserted here rather than
assumed: `UNIQUE(alert_id, fire_key)` and the `claim_delivery` compare-and-set
taken BEFORE any channel. A retry must not double-deliver, and the CAS is what
prevents it.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services import alert_fired_log as fl
from api.services import alerts as alerts_svc
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import watchlist_alert_service as wls


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    monkeypatch.setattr(fl, "_last_fire_prune_at", 0.0, raising=False)
    ias.init_schema()
    return db_path


def _bars(closes, start_t=1_700_000_000, step=300):
    out = []
    for i, c in enumerate(closes):
        c = float(c)
        out.append({"t": start_t + i * step, "o": c, "h": c * 1.002,
                    "l": c * 0.998, "c": c, "v": 100_000})
    return out


_RISING = _bars([100.0 + i for i in range(80)])


@pytest.fixture
def bars(monkeypatch):
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])


@pytest.fixture
def armed(tmp_db, bars):
    """One armed alert whose condition is true on the fixture bars."""
    aid = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                     condition="above", threshold=50.0, tf="5")
    value, triggered, _idx = ev._evaluate_for_cycle(ias.get(aid), _RISING)
    assert triggered is True, (
        "the fixture's condition is not true — every assertion below would be "
        "a statement about an alert that never fired")
    return aid


def _raiser(msg):
    def _fn(*a, **k):
        raise RuntimeError(msg)
    return _fn


class _CacheProxy:
    """The real alert cache, with an in-app write that can be taken down.

    ⛔ A PROXY RATHER THAN A REPLACEMENT, so `add_alert` is exercised as written
    — the feed really is populated on the healthy path, which is what makes
    "in_app: ok" a measurement instead of a label.
    """

    def __init__(self, real, down):
        self._real, self._down = real, down

    def get(self, *a, **k):
        return self._real.get(*a, **k)

    def set(self, *a, **k):
        if "in_app" in self._down:
            raise RuntimeError("alert store unavailable")
        return self._real.set(*a, **k)

    def invalidate(self, *a, **k):
        return self._real.invalidate(*a, **k)


@pytest.fixture
def channels_up(monkeypatch):
    """Every channel healthy — the positive control every refusal needs.

    ⛔ NOTHING LEAVES THE PROCESS. `add_alert` is the REAL one (it owns the
    in-app write and the Discord decision, which is exactly what is under test);
    only the transport underneath it is stubbed, and `requests.post` is replaced
    so a webhook can never be posted from a test run.

    ``sent["down"]`` is a live set of channel names: adding one takes that
    channel down mid-test and removing it heals it. That is how the retry tests
    recover a provider — ⛔ NEVER `monkeypatch.undo()`, which also reverts the
    tmp-database patch and silently points the whole test at the shared
    `C:\\data\\auth.db`.
    """
    sent: dict = {"email": [], "discord": [], "down": set()}

    def _send_email(*a, **k):
        if "email" in sent["down"]:
            raise RuntimeError("Resend 429 rate limited")
        sent["email"].append(a)
        return True

    monkeypatch.setattr(wls, "_get_user_email", lambda uid: "u@example.test")
    monkeypatch.setattr(wls, "send_email", _send_email)
    monkeypatch.setattr(alerts_svc, "_DISCORD_WEBHOOK", "https://discord.test/hook")
    monkeypatch.setattr(alerts_svc, "cache",
                        _CacheProxy(alerts_svc.cache, sent["down"]))

    import requests

    class _R:
        status_code = 204

    def _post(url, **kw):
        if "discord" in sent["down"]:
            raise RuntimeError("Discord 503")
        sent["discord"].append({"url": url, **kw})
        return _R()

    monkeypatch.setattr(requests, "post", _post)
    return sent


def _row(alert_id):
    return fl.fires_for_alert(alert_id)[0]


def _deliver(alert_id, **kw):
    return wls.deliver_alert_payload(
        user_id="u1", sym="AAPL", title="t", message="m",
        source="indicator_alert", extra_data={"alert_id": alert_id}, **kw)


# ─── 1. THE GATE: a channel that fails silently makes this RED ──────────────

def test_CONTROL_a_healthy_delivery_reports_every_channel_ok(armed, channels_up):
    """The positive control. Without it, every "reports failed" claim below
    could be satisfied by a function that reports failure unconditionally."""
    assert ias.record_trigger(armed, last_value=75.0) is True
    out = _deliver(armed)

    assert out["claimed"] is True
    assert out["channels"] == {"in_app": "ok", "discord": "ok", "email": "ok"}, out
    assert out["channels_ok"] == 3 and out["channels_failed"] == 0, out
    assert out["errors"] == {}
    assert ev._delivery_failed(out) is False
    assert len(channels_up["email"]) == 1 and len(channels_up["discord"]) == 1


def test_a_channel_that_FAILS_SILENTLY_is_recorded_as_a_failure(armed, channels_up,
                                                                monkeypatch):
    """🔴 THE DELIVERABLE. Plant a raising channel; the record must say so.

    Before the fix this whole scenario returned ``None``, `_delivery_failed`
    read False, the row was stamped `delivered_at` with no `delivery_failed_at`,
    and the ONLY trace was one `_logger.warning` line nobody reads.
    """
    monkeypatch.setattr(wls, "send_email", _raiser("Resend 429 rate limited"))

    assert ias.record_trigger(armed, last_value=75.0) is True
    out = _deliver(armed)

    assert out["channels"]["email"] == "failed", out
    assert out["channels_failed"] == 1, out
    assert "Resend 429 rate limited" in out["errors"]["email"], out["errors"]


def test_an_email_that_RETURNS_FALSE_is_a_failure_too(armed, channels_up,
                                                      monkeypatch):
    """🔴 THE MOST COMMON EMAIL FAILURE DOES NOT RAISE — IT RETURNS FALSE.

    `email_service.send_email` catches its own exceptions and returns a bool:
    False when Resend is not configured, when the 10-second send times out, and
    when the SDK raises (a 429). So the production shape of "the email did not
    go" is a return value, not a traceback — and this call site discarded it.

    ⚠️ THIS TEST EXISTS BECAUSE A MUTATION SURVIVED. Replacing
    `CHANNEL_OK if ok else CHANNEL_FAILED` with a bare `CHANNEL_OK` passed every
    other test in this file, all of which make the send RAISE. A suite that only
    exercises the exception path proves nothing about the branch that matters.
    """
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: False)

    assert ias.record_trigger(armed, last_value=75.0) is True
    out = _deliver(armed)

    assert out["channels"]["email"] == "failed", out
    assert out["channels_failed"] == 1, out
    assert out["errors"]["email"], "a failure was recorded with no reason"

    row = _row(armed)
    assert row["delivered_at"] is not None, "a partial delivery released its lease"


def test_CONTROL_an_email_that_returns_TRUE_is_ok(armed, channels_up,
                                                  monkeypatch):
    """The control for the test above: if `send_email`'s bool were ignored in
    the other direction, "returns False ⇒ failed" would be satisfied by a call
    site that always reports failure."""
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: True)

    assert ias.record_trigger(armed, last_value=75.0) is True
    out = _deliver(armed)

    assert out["channels"]["email"] == "ok", out
    assert out["channels_failed"] == 0 and out["errors"] == {}, out


def test_the_FIRE_ROW_names_the_channel_that_failed(armed, channels_up,
                                                    monkeypatch, tmp_db):
    """The record, not just the return value — through the REAL cycle.

    ⛔ ONLY THE CHANNEL LEAVES ARE STUBBED. `_run_one_cycle` → `_dispatch_
    delivery` → the real `deliver_alert_payload` → the real `claim_delivery`
    all run, so cutting any wire between them fails this.
    """
    monkeypatch.setattr(wls, "send_email", _raiser("Resend 429 rate limited"))

    summary = ev._run_one_cycle()
    assert summary["triggered"] == 1, summary

    row = _row(armed)
    assert row["delivery_channels"] is not None, (
        "the row records nothing about the channels — a member who missed the "
        "email is invisible again")
    assert row["delivery_channels"]["email"] == "failed", row["delivery_channels"]
    assert row["channels_failed"] == 1, row

    # …and the raw column really holds it, not just the decoder's imagination.
    con = sqlite3.connect(str(tmp_db))
    try:
        raw, n = con.execute(
            "SELECT delivery_channels, channels_failed FROM "
            "indicator_alert_fires WHERE id=?", (row["id"],)).fetchone()
    finally:
        con.close()
    assert json.loads(raw)["email"] == "failed"
    assert n == 1


def test_EVERY_channel_failing_releases_the_lease_and_names_the_reason(
        armed, channels_up):
    """Total failure is still total failure: nothing landed ⇒ retry, and the
    stored reason NAMES the channels instead of a constant sentence."""
    channels_up["down"].update({"in_app", "email"})

    summary = ev._run_one_cycle()
    assert summary["triggered"] == 1, summary

    row = _row(armed)
    assert row["delivered_at"] is None, (
        "no channel landed and the fire is still marked delivered — the "
        "member was never told and nothing will retry")
    assert row["delivery_failed_at"] is not None
    assert "429" in (row["delivery_error"] or ""), row["delivery_error"]
    assert row["delivery_channels"]["in_app"] == "failed", row["delivery_channels"]


# ─── 2. PARTIAL SUCCESS: one channel up, one down ───────────────────────────

def test_a_PARTIAL_delivery_is_recorded_as_partial_and_is_NOT_retried(
        armed, channels_up, monkeypatch):
    """⭐ THE COMMON CASE, AND BOTH COLLAPSES ARE REFUSED IN ONE TEST.

    In-app landed and email did not. Called a success, the missing email is
    invisible; called a failure, the lease is released and the next cycle
    re-sends an in-app alert the member already has. The truth is BOTH: the row
    stays delivered AND names the channel that failed.
    """
    monkeypatch.setattr(wls, "send_email", _raiser("Resend 429 rate limited"))

    ev._run_one_cycle()
    row = _row(armed)

    assert row["delivery_channels"] == {"in_app": "ok", "discord": "ok",
                                        "email": "failed"}, row["delivery_channels"]
    assert row["delivered_at"] is not None, (
        "a partial delivery released its lease — the in-app alert the member "
        "already received will be sent again")
    assert row["delivery_failed_at"] is None
    assert row["channels_failed"] == 1

    health = fl.delivery_health(alert_id=armed)
    assert health["partial"] == 1, health
    assert health["delivered"] == 0, (
        "a partial delivery is counted as a clean one — which is the lie this "
        "column exists to remove, one size smaller")
    assert health["failed"] == 0 and health["pending"] == 0, health


def test_a_partial_failure_APPEARS_in_the_failure_read(armed, channels_up,
                                                       monkeypatch):
    """D5: the failure has somewhere to appear, and partials appear there too.

    `delivery_failures` used to filter on `delivery_failed_at IS NOT NULL`
    alone, which is NULL on every partial — so a board could read clean while
    every member was missing every email.
    """
    monkeypatch.setattr(wls, "send_email", _raiser("Resend 429 rate limited"))
    ev._run_one_cycle()

    rows = fl.delivery_failures(user_id="u1")
    assert len(rows) == 1, rows
    assert rows[0]["sym"] == "AAPL"
    assert rows[0]["delivery_channels"]["email"] == "failed"

    # SCOPED: another member's read cannot see it.
    assert fl.delivery_failures(user_id="someone_else") == []


def test_CONTROL_a_clean_delivery_appears_in_NO_failure_read(armed, channels_up):
    """The control for the two tests above: if `delivery_failures` returned
    everything, "the partial appears" would be worth nothing."""
    ev._run_one_cycle()
    assert fl.delivery_failures(user_id="u1") == []
    assert fl.delivery_health(user_id="u1")["trouble"] == 0
    assert fl.delivery_health(user_id="u1")["delivered"] == 1


def test_a_SKIPPED_channel_is_not_a_FAILED_one(armed, channels_up, monkeypatch):
    """⚠️ "we did not try" ≠ "we tried and it did not land".

    An unset Discord webhook and a member with no address on file are both
    `skipped`. Reported as failures they would send somebody hunting an outage
    that does not exist — and, worse, a fire with every channel skipped would
    release its lease and retry forever.
    """
    monkeypatch.setattr(alerts_svc, "_DISCORD_WEBHOOK", "")
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)

    assert ias.record_trigger(armed, last_value=75.0) is True
    out = _deliver(armed)

    assert out["channels"] == {"in_app": "ok", "discord": "skipped",
                               "email": "skipped"}, out
    assert out["channels_failed"] == 0 and out["channels_ok"] == 1, out
    assert ev._delivery_failed(out) is False
    assert fl.delivery_health(alert_id=armed)["partial"] == 0


def test_a_discord_webhook_that_REFUSES_the_post_is_a_failure(armed, channels_up,
                                                              monkeypatch):
    """A 403 from a rotated webhook used to leave through the success path —
    `_fire_discord` swallowed the STATUS as well as the exception."""
    import requests

    class _Refused:
        status_code = 403

    monkeypatch.setattr(requests, "post", lambda url, **kw: _Refused())

    assert ias.record_trigger(armed, last_value=75.0) is True
    out = _deliver(armed)

    assert out["channels"]["discord"] == "failed", out
    assert out["channels"]["in_app"] == "ok", (
        "a refused webhook took the in-app channel down with it")


# ─── 3. NO DOUBLE-DELIVERY: the CAS is untouched ────────────────────────────

def test_the_CAS_still_refuses_a_second_delivery_of_one_fire(armed, channels_up):
    """⛔ THE PROPERTY THE WHOLE DESIGN RESTS ON. Asserted through the REAL
    hook, because the claim lives inside it."""
    assert ias.record_trigger(armed, last_value=75.0) is True

    first = _deliver(armed)
    second = _deliver(armed)

    assert first["claimed"] is True
    assert second["claimed"] is False, (
        "two calls both owned one delivery — the compare-and-set is gone")
    assert second["channels"] == {}, second
    assert len(channels_up["email"]) == 1, (
        f"one recorded fire sent {len(channels_up['email'])} emails")


def test_a_refused_claim_is_NOT_read_as_a_delivery_failure(armed, channels_up):
    """⛔ THE TRAP THE REPORT OPENS, CLOSED.

    A refused claim legitimately carries ``channels_ok: 0`` — nothing ran and
    nothing was owed. Read as "no channel reached the member" it would release a
    lease this frame never held, and the next cycle would re-send a delivered
    alert. `_delivery_failed` checks `claimed` FIRST for exactly this reason.
    """
    assert ias.record_trigger(armed, last_value=75.0) is True
    _deliver(armed)
    refused = _deliver(armed)

    assert refused["channels_ok"] == 0, (
        "the fixture no longer produces the shape under test")
    assert ev._delivery_failed(refused) is False, (
        "a refused claim reads as a delivery failure — the lease would be "
        "released and the member's alert sent twice")
    assert _row(armed)["delivered_at"] is not None


def test_MANY_cycles_over_a_true_condition_deliver_exactly_once(armed,
                                                                channels_up):
    """The fire-once guarantee, across cycles, with the report in place.

    `above` is a LEVEL condition: it stays true on every one of these cycles.
    """
    for _ in range(8):
        ev._run_one_cycle()

    assert fl.count_fires(armed) == 1, "one armed episode recorded >1 fire"
    assert len(channels_up["email"]) == 1, (
        f"one armed episode sent {len(channels_up['email'])} emails")
    assert len(channels_up["discord"]) == 1


def test_a_released_lease_is_retried_and_still_only_ONE_fire_exists(
        armed, channels_up):
    """A retry re-sends something that was never sent — and cannot record a
    second fire while doing it."""
    channels_up["down"].update({"in_app", "email", "discord"})
    ev._run_one_cycle()
    assert _row(armed)["delivered_at"] is None, "nothing failed"
    assert len(channels_up["email"]) == 0

    # Providers recover.
    channels_up["down"].clear()
    ev._run_one_cycle()

    assert fl.count_fires(armed) == 1, "the retry recorded a SECOND fire"
    row = _row(armed)
    assert row["delivered_at"] is not None
    assert row["delivery_channels"]["in_app"] == "ok", row["delivery_channels"]
    assert row["channels_failed"] == 0, (
        "the recovered retry left the previous attempt's failed channels on the "
        "row — a healed delivery reading as a permanent failure")


# ─── 4. the record survives the sweep ───────────────────────────────────────

def test_the_retention_sweep_may_not_delete_a_PARTIAL_failure(armed,
                                                              channels_up):
    """A defect whose only evidence has been swept is a defect nobody can
    report. The sweep already spared total failures; a partial keeps
    `delivered_at` and no `delivery_failed_at`, so it looked exactly like a
    clean old row."""
    channels_up["down"].add("email")
    ev._run_one_cycle()
    partial_id = _row(armed)["id"]
    assert fl.fires_for_alert(armed)[0]["channels_failed"] == 1

    # `keep_per_alert` protects the NEWEST fire of every alert, so a partial
    # that is also the only fire would survive for a reason that has nothing to
    # do with the clause under test. Each alert gets a newer, clean fire on top.
    def _clean(alert_id, key, sym):
        assert fl.record_fire(alert_id, "u1", sym, "rsi", "above", "5",
                              key, 75.0) is True
        assert fl.claim_delivery(alert_id) is True

    _clean(armed, "ep:newer", "AAPL")
    other = ias.create(user_id="u1", sym="MSFT", indicator="rsi",
                       condition="above", threshold=50.0, tf="5")
    _clean(other, "ep:older", "MSFT")      # the control row: old, clean, sweepable
    _clean(other, "ep:newest", "MSFT")

    import time as _t
    con = sqlite3.connect(fl.db_path())
    try:
        con.execute("UPDATE indicator_alert_fires SET fired_at=?",
                    (_t.time() - 400 * 86400,))
        con.commit()
    finally:
        con.close()

    out = fl.prune_fires(older_than_days=90, keep_per_alert=1)
    assert out["deleted"] == 1, (
        f"CONTROL BROKEN: the sweep deleted {out['deleted']} rows, not the one "
        "old clean row — it cannot delete anything, so 'it spared the partial' "
        "proves nothing")
    assert partial_id in [r["id"] for r in fl.fires_for_alert(armed)], (
        "the sweep ate the record that a member missed an email")
