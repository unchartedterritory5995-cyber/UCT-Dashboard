"""FILING-WATCH PARITY — the protected-consumer contract over `alert_taxonomy`.

WHY THIS FILE EXISTS
────────────────────
`api/services/alert_taxonomy/` is S7's package, built by the Terminal-Next
program (`e994f5337`). A SECOND, separate feature — the member-facing
**filing watch** ("Notify me about new SEC filings for {sym}") — was later
built INSIDE it (`d71326261` durable in-app bridge · `8ec29b457` duplicate-
predicate guard · `ca9093c00` dual-write durable read state · `5f4597ae0`
Stage 4/5 UI) and has been LIVE TO MEMBERS since 2026-09-11 12:07:29 ET.

Terminal-Next owns the package. Filing watch is a PROTECTED CONSUMER. Before
S7 adds any of its seven remaining trigger types, this file must prove that
filing watch's OBSERVABLE behaviour cannot be broken by a predicate- or
receipt-shape change.

⛔ THIS FILE PINS THE SHIPPED SHAPE, DELIBERATELY — NOT THE SPEC'S ORIGINAL ONE
──────────────────────────────────────────────────────────────────────────────
Writing it surfaced two places where what shipped and what SPEC-S7 described
had diverged. Both were taken to the owner and both were RATIFIED on
2026-09-11, so the spec was amended to match the code rather than the reverse.
These assertions are therefore intentional, and a future reader comparing them
against an older copy of the spec should not "correct" them:

  * `entity_scope.symbol` — SPEC-S7 §5.2 originally defined `entity_scope` as
    `{kind, id, asOf}`. Filing watch joins on `symbol` and NOTHING ELSE:
    `useFilingWatch.getWatch` matches on it, `document_arrival._evaluate_one`
    uses it as the SEC fetch ticker, and the delivered title, message and
    `/research/` URL all derive from it. A predicate conforming to the ORIGINAL
    text would be invisible to every filing-watch surface and would deliver
    entity-id-shaped copy to members — which is exactly what mutation M1
    demonstrates. §5.2 now declares `symbol` optional in general and REQUIRED
    for `document-arrival`.
    → FOLLOW-UP F-S7-1: migrate filing watch to join on `{kind, id}` once S3
      entity ids are the canonical key across alert types. Sequenced with the
      first trigger type that needs entity-scoped matching, NEVER standalone —
      alone it would touch a live member-facing feature for no member benefit.
      When that lands, these `symbol` assertions change with it, on purpose.

  * `alert_fires.detail` — SPEC-S7 §5.3's table had no such column, because
    `triggering_value REAL` cannot hold a filing. Four of the eight trigger
    types are non-numeric, so a numbers-only receipt cannot serve a taxonomy
    whose premise is one table for eight types. `detail` is now ratified in
    §5.3; `triggering_value` stays, unchanged, for the numeric types.

SCOPE — three observables, and only these three:
  1. FIRES     — a fixture filing-arrival event matches the same predicate set
                 and writes the same fire rows.
  2. DELIVERY  — the same channels are invoked with the same payload shape.
  3. RECEIPTS  — the same receipt rows and the same read-state transitions,
                 INCLUDING the dual-write path (`ca9093c00`).

⛔ GOLDEN SHAPE, NOT A SNAPSHOT. Every assertion below names the specific
fields filing watch actually reads, derived by reading its own source:

  · `app/src/hooks/useFilingWatch.js`               → predicate rows
  · `app/src/components/settings/FilingWatchesPanel.jsx` → predicate rows
  · `app/src/components/AlertBell.jsx`              → the in-app alert shape
  · `api/services/alerts.py` (`_s7_durable_alerts`, `_dual_write_s7_read_
     if_applicable`, `get_alerts`, `mark_read`, `mark_all_read`)

A whole-row snapshot would go red on every unrelated column addition and be
muted inside a week (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`),
so nothing here asserts an exact key SET — only that the named fields are
present and carry the values filing watch depends on.

⛔ THE DURABLE ROW IS `alert_fires`, NEVER `user_alerts` (standing owner
ruling). `user_alerts` is `api/services/alert_durability.py`'s LEGACY table and
`should_persist()` explicitly EXCLUDES document-arrival from it. This file
never writes or reads it.

⛔ TEMP DB ONLY. `at_db.DB_PATH` is redirected to `tmp_path`; the repo-root
`conftest.py`'s own pins (AUTH_DB_PATH / DATA_DIR) are never overridden —
`/data` is `C:\\data` on this box and resolves to the owner's LIVE files.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

from api.services import alerts as _alerts
from api.services import watchlist_alert_service as _was
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import document_arrival as da
from api.services.alert_taxonomy import predicates as _predicates
from api.services.alert_taxonomy import receipts as _receipts
from api.services.cache import cache as _cache
from api.services.entity_master import api as em_api
from api.services.entity_master import schema as em_schema
from api.services.entity_master import store as em_store

# ── The fields filing watch actually reads, named explicitly ───────────────
# Each tuple is a citation, not a guess — see the module docstring for where
# each one was read from.

#: `useFilingWatch.js` (`p.entity_scope?.symbol`, `p.suspended_at`, `p.id`)
#: + `FilingWatchesPanel.jsx` (`w.created_at`, `w.entity_scope?.id` fallback).
FILING_WATCH_PREDICATE_FIELDS = ("id", "entity_scope", "suspended_at", "created_at")
#: `useFilingWatch.getWatch` joins on `entity_scope.symbol` ALONE; the panel
#: falls back to `entity_scope.id` for its label. Both must survive.
FILING_WATCH_ENTITY_SCOPE_FIELDS = ("symbol", "id")

#: `AlertBell.jsx` reads exactly these off every feed row.
FILING_WATCH_ALERT_FIELDS = (
    "id", "type", "severity", "title", "message", "timestamp", "read", "data",
)
#: `AlertBell` click-through reads `data.research_url`; the filing-watch
#: producer additionally promises these (document_arrival.alert_shape_for_fire).
FILING_WATCH_ALERT_DATA_FIELDS = (
    "symbol", "source", "sym", "research_url", "filing_url", "accession", "form",
)

#: The durable receipt columns the bridge + read-state paths read back.
FILING_WATCH_FIRE_FIELDS = (
    "id", "predicate_id", "trigger_type", "user_id", "entity_ref", "fire_key",
    "detail", "source_data_class", "freshness_class", "as_of", "fired_at",
    "delivered_at", "delivery_channels", "read_at",
)

_USER = "filing-watch-parity-user"
_SYM = "AAPL"
_BASELINE_ACCESSION = "0000320193-26-000001"
_NEW_ACCESSION = "0000320193-26-000042"
_NEW_FORM = "8-K"
_NEW_FILED = "2026-09-10"
_NEW_URL = "https://www.sec.gov/Archives/edgar/data/320193/000032019326000042/a8k.htm"
_COMPANY = "Apple Inc."


def _filings_payload(accession: str, *, form: str = _NEW_FORM,
                     filed: str = _NEW_FILED, url: str = _NEW_URL) -> dict:
    """The fixture filing-arrival event. Shaped exactly like
    `sec_filings.recent_filings`'s real return (newest first)."""
    return {
        "ticker": _SYM, "company": _COMPANY, "cik": "320193",
        "form_filter": "ANY", "count": 1,
        "filings": [{"form": form, "filed": filed, "period": "",
                     "accession": accession, "url": url}],
    }


class _SecStub:
    """A driveable stand-in for the SEC submissions lookup. `advance()` is the
    fixture 'a new filing arrived' event."""

    def __init__(self) -> None:
        self.payload = _filings_payload(_BASELINE_ACCESSION)
        self.calls: list[tuple] = []

    def advance(self, accession: str = _NEW_ACCESSION, **kw) -> None:
        self.payload = _filings_payload(accession, **kw)

    def __call__(self, ticker, form_type="", count=10):
        self.calls.append((ticker, form_type, count))
        return self.payload


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    """Temp alert_taxonomy.db + temp Entity Master + a clean ephemeral feed.

    ⛔ Never touches the repo-root conftest's AUTH_DB_PATH / DATA_DIR pins."""
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))

    em_db_path = str(tmp_path / "em_default.db")
    monkeypatch.setattr(em_schema, "DB_PATH", em_db_path)
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False
    em_schema.init_db(db_path=em_db_path)

    # The in-app feed is a process-wide TTLCache — scrub this member's keys so
    # one test can never read another's leftovers.
    def _scrub():
        _cache.invalidate(_alerts._user_key(_USER))
        _cache.invalidate(_alerts._read_key(_USER))

    _scrub()
    da.register()
    yield
    _scrub()
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False


@pytest.fixture
def sec(monkeypatch) -> _SecStub:
    stub = _SecStub()
    monkeypatch.setattr(da.sec_filings, "recent_filings", stub)
    return stub


@pytest.fixture
def entity_id() -> str:
    """A REAL resolved S3 entity, so `entity_scope.id` is an opaque entity id
    that is NOT the ticker. This is the case where filing watch's join key
    (`entity_scope.symbol`) is load-bearing rather than coincidentally equal."""
    r = em_api.apply_event(
        "new_entity",
        {"entity_type": "equity", "initial_alias": _SYM, "initial_alias_valid_from": "2020-01-01"},
        dedup_key=f"filing-watch-parity:{_SYM}", source="admin_manual",
    )
    assert r.accepted
    return r.entity_id


@pytest.fixture
def captured_delivery(monkeypatch) -> list[dict]:
    """Records every `deliver_alert_payload` invocation (the multi-channel
    fan-out filing watch rides) without running the channels."""
    calls: list[dict] = []

    def _fake(**kwargs):
        calls.append(kwargs)
        return {
            "claimed": True,
            "channels": {"in_app": "ok", "discord": "skipped", "email": "skipped"},
            "channels_ok": 1, "channels_failed": 0, "errors": {},
        }

    monkeypatch.setattr(_was, "deliver_alert_payload", _fake)
    return calls


@pytest.fixture
def real_delivery(monkeypatch):
    """The REAL delivery path with only the outbound transports stubbed, so the
    ephemeral in-app row filing watch actually renders really gets written."""
    monkeypatch.setattr(_was, "_get_user_email", lambda user_id: None)
    monkeypatch.setattr(_alerts, "_DISCORD_WEBHOOK", "")


def _arm_watch(sec: _SecStub, *, form_type: str | None = None) -> str:
    """Register a filing watch the way the member's own route does."""
    return da.register_predicate_for_user(_USER, _SYM, form_type=form_type)


def _the_fire() -> dict:
    fires = _receipts.list_fires(_USER, limit=10)
    assert len(fires) == 1, f"expected exactly one durable fire, got {len(fires)}"
    return fires[0]


# ══════════════════════════════════════════════════════════════════════════
# OBSERVABLE 1 — FIRES
# ══════════════════════════════════════════════════════════════════════════
class TestFires:
    def test_the_predicate_row_carries_every_field_the_filing_watch_ui_reads(self, sec, entity_id):
        pid = _arm_watch(sec)
        rows = _predicates.list_predicates(type_id=da.TYPE_ID, user_id=_USER, active_only=False)
        assert [r["id"] for r in rows] == [pid]
        row = rows[0]

        missing = [f for f in FILING_WATCH_PREDICATE_FIELDS if f not in row]
        assert not missing, f"filing watch reads these predicate fields and they are gone: {missing}"

        scope = row["entity_scope"]
        missing_scope = [f for f in FILING_WATCH_ENTITY_SCOPE_FIELDS if f not in scope]
        assert not missing_scope, (
            "useFilingWatch.getWatch joins on entity_scope.symbol and "
            f"FilingWatchesPanel labels off entity_scope.id; missing: {missing_scope}"
        )
        # The join key must be the UPPERCASE ticker even though `id` is an
        # opaque entity id — this is the whole reason `symbol` exists.
        assert scope["symbol"] == _SYM
        assert scope["id"] == entity_id != _SYM
        assert row["suspended_at"] is None          # → watchState() 'ACTIVE'
        assert isinstance(row["created_at"], float)  # → panel sort + "Created"

    def test_a_pre_existing_filing_at_arm_time_never_fires(self, sec, entity_id, captured_delivery):
        _arm_watch(sec)
        report = da.run_document_arrival_sweep()
        assert report["checked"] == 1
        assert report["fired"] == 0
        assert [r["outcome"] for r in report["results"]] == ["no_new_filing"]
        assert _receipts.list_fires(_USER, limit=10) == []
        assert captured_delivery == []

    def test_a_new_filing_writes_one_fire_row_in_the_golden_receipt_shape(self, sec, entity_id, captured_delivery):
        pid = _arm_watch(sec)
        sec.advance()

        report = da.run_document_arrival_sweep()
        assert report["checked"] == 1 and report["fired"] == 1
        assert report["errors"] == []

        fire = _the_fire()
        missing = [f for f in FILING_WATCH_FIRE_FIELDS if f not in fire]
        assert not missing, f"receipt fields the filing-watch bridge reads are gone: {missing}"

        assert fire["predicate_id"] == pid
        assert fire["trigger_type"] == da.TYPE_ID == "document-arrival"
        assert fire["user_id"] == _USER
        assert fire["entity_ref"] == entity_id
        assert fire["source_data_class"] == "sec_filing"
        # Honest "not established" — SEC filings are not a D1-typed feed.
        assert fire["freshness_class"] is None
        assert fire["read_at"] is None
        # `detail` is the ONLY thing alert_shape_for_fire may read, so every
        # key it consumes has to be frozen here at fire time.
        detail = fire["detail"]
        for key, expected in (("form", _NEW_FORM), ("accession", _NEW_ACCESSION),
                              ("url", _NEW_URL), ("filed", _NEW_FILED),
                              ("company", _COMPANY), ("ticker", _SYM)):
            assert detail[key] == expected, f"detail[{key!r}] drifted"

    def test_the_fire_key_is_the_accession_occurrence_key(self, sec, entity_id, captured_delivery):
        """⭐ `occ:{accession}` is a CROSS-STORE JOIN KEY, not an internal
        detail: `alerts._dual_write_s7_read_if_applicable` reconstructs it from
        the EPHEMERAL alert's `data.accession` to find the durable row. Change
        the format on one side only and read state silently stops dual-writing."""
        _arm_watch(sec)
        sec.advance()
        da.run_document_arrival_sweep()
        assert _the_fire()["fire_key"] == f"occ:{_NEW_ACCESSION}"

    def test_the_same_filing_never_fires_twice(self, sec, entity_id, captured_delivery):
        _arm_watch(sec)
        sec.advance()
        assert da.run_document_arrival_sweep()["fired"] == 1
        second = da.run_document_arrival_sweep()
        assert second["fired"] == 0
        assert [r["outcome"] for r in second["results"]] == ["no_new_filing"]
        assert len(_receipts.list_fires(_USER, limit=10)) == 1
        assert len(captured_delivery) == 1

    def test_a_suspended_watch_is_not_in_the_matched_predicate_set(self, sec, entity_id, captured_delivery):
        pid = _arm_watch(sec)
        assert _predicates.suspend_predicate(pid, _USER) is True
        sec.advance()
        report = da.run_document_arrival_sweep()
        assert report["checked"] == 0 and report["fired"] == 0
        assert _receipts.list_fires(_USER, limit=10) == []
        # …and the row is still visible to the Settings panel, which is what
        # makes the member's Reactivate button reachable.
        rows = _predicates.list_predicates(type_id=da.TYPE_ID, user_id=_USER, active_only=False)
        assert [r["id"] for r in rows] == [pid]
        assert rows[0]["suspended_at"] is not None  # → watchState() 'SUSPENDED'

    def test_reactivating_reuses_the_same_predicate_row_and_re_baselines_it(self, sec, entity_id, captured_delivery):
        """Stage 3/4: the UI's Reactivate calls the SAME create endpoint, and a
        watch that sat suspended must not replay everything it missed."""
        pid = _arm_watch(sec)
        _predicates.suspend_predicate(pid, _USER)
        sec.advance()
        again = _arm_watch(sec)
        assert again == pid
        assert _predicates.get_predicate(pid)["suspended_at"] is None
        assert da.run_document_arrival_sweep()["fired"] == 0, \
            "re-arming must re-baseline, never replay filings that arrived while suspended"


# ══════════════════════════════════════════════════════════════════════════
# OBSERVABLE 2 — DELIVERY
# ══════════════════════════════════════════════════════════════════════════
class TestDelivery:
    def test_delivery_is_invoked_once_with_the_payload_shape_filing_watch_renders(
            self, sec, entity_id, captured_delivery):
        _arm_watch(sec)
        sec.advance()
        da.run_document_arrival_sweep()

        assert len(captured_delivery) == 1, "exactly one multi-channel fan-out per fire"
        call = captured_delivery[0]
        assert call["user_id"] == _USER
        # The SYMBOL, never the opaque entity id — every downstream channel
        # (bell title, email subject, /research link) shows this to a member.
        assert call["sym"] == _SYM
        assert call["source"] == "document_arrival"
        assert call["severity"] == "info"
        assert call["title"] == f"New {_NEW_FORM} — {_SYM}"
        assert call["message"] == f"{_COMPANY} filed a {_NEW_FORM} on {_NEW_FILED}."

        extra = call["extra_data"]
        for key, expected in (("sym", _SYM), ("research_url", f"/research/{_SYM}"),
                              ("filing_url", _NEW_URL), ("accession", _NEW_ACCESSION),
                              ("form", _NEW_FORM)):
            assert extra[key] == expected, f"extra_data[{key!r}] drifted"

    def test_the_real_fan_out_records_its_per_channel_verdict_on_the_fire_row(
            self, sec, entity_id, real_delivery):
        """The receipt has to say what actually happened per channel — 'we
        tried and it did not land' and 'we never tried' are different facts."""
        _arm_watch(sec)
        sec.advance()
        da.run_document_arrival_sweep()

        fire = _the_fire()
        assert fire["delivered_at"] is not None
        assert fire["delivery_attempts"] == 1
        channels = fire["delivery_channels"]
        assert set(channels) == {"in_app", "discord", "email"}, \
            f"the channel vocabulary filing watch reports on changed: {channels}"
        assert channels["in_app"] == "ok"
        assert channels["discord"] == "skipped"   # no webhook configured here
        assert channels["email"] == "skipped"     # no address on file here
        assert fire["channels_failed"] == 0

    def test_a_second_delivery_of_the_same_fire_is_refused_by_the_lease(
            self, sec, entity_id, captured_delivery):
        _arm_watch(sec)
        sec.advance()
        da.run_document_arrival_sweep()
        fire_id = _the_fire()["id"]

        report = da._delivery.deliver(
            fire_id, _USER, _SYM, "t", "m", source="document_arrival", severity="info")
        assert report["claimed"] is False
        assert report["channels"] == {}
        assert len(captured_delivery) == 1, "a refused claim must never re-run a channel"

    def test_the_real_fan_out_writes_the_in_app_row_filing_watch_renders(
            self, sec, entity_id, real_delivery):
        _arm_watch(sec)
        sec.advance()
        da.run_document_arrival_sweep()

        feed = _alerts.get_alerts(limit=50, user_id=_USER)
        mine = [a for a in feed if isinstance(a.get("data"), dict)
                and a["data"].get("source") == "document_arrival"]
        assert len(mine) == 1, f"expected one filing-watch row in the bell, got {len(mine)}"
        alert = mine[0]
        missing = [f for f in FILING_WATCH_ALERT_FIELDS if f not in alert]
        assert not missing, f"AlertBell reads these and they are gone: {missing}"
        assert alert["severity"] == "info"
        assert alert["read"] is False
        assert alert["data"]["accession"] == _NEW_ACCESSION
        assert alert["data"]["research_url"] == f"/research/{_SYM}"


# ══════════════════════════════════════════════════════════════════════════
# OBSERVABLE 3 — RECEIPTS + READ STATE (incl. the dual-write path, ca9093c00)
# ══════════════════════════════════════════════════════════════════════════
class TestReceiptsAndReadState:
    def _fire_once(self, sec) -> dict:
        _arm_watch(sec)
        sec.advance()
        da.run_document_arrival_sweep()
        return _the_fire()

    def test_the_durable_fire_reconstructs_the_in_app_alert_shape(
            self, sec, entity_id, captured_delivery):
        fire = self._fire_once(sec)
        shape = da.alert_shape_for_fire(fire)

        missing = [f for f in FILING_WATCH_ALERT_FIELDS if f not in shape]
        assert not missing, f"the durable reconstruction lost fields AlertBell reads: {missing}"
        assert shape["id"] == f"s7fire_{fire['id']}"
        assert shape["id"].startswith(_alerts._S7_FIRE_PREFIX), \
            "alerts.mark_read routes on this prefix — change it and mark-read stops working"
        assert shape["type"] == "document_arrival"
        assert shape["severity"] == "info"
        assert shape["title"] == f"New {_NEW_FORM} — {_SYM}"
        assert shape["message"] == f"{_COMPANY} filed a {_NEW_FORM} on {_NEW_FILED}."
        assert shape["read"] is False
        assert shape["user_id"] == _USER
        assert shape["timestamp"], "AlertBell sorts and renders timeAgo() off this"

        data = shape["data"]
        missing_data = [f for f in FILING_WATCH_ALERT_DATA_FIELDS if f not in data]
        assert not missing_data, f"reconstruction dropped alert.data fields: {missing_data}"
        assert data["symbol"] == data["sym"] == _SYM
        assert data["source"] == "document_arrival"
        assert data["research_url"] == f"/research/{_SYM}"
        assert data["filing_url"] == _NEW_URL
        assert data["accession"] == _NEW_ACCESSION
        assert data["form"] == _NEW_FORM

    def test_the_feed_shows_the_fire_once_while_both_stores_hold_it(
            self, sec, entity_id, real_delivery):
        self._fire_once(sec)
        feed = _alerts.get_alerts(limit=50, user_id=_USER)
        accessions = [a["data"].get("accession") for a in feed
                      if isinstance(a.get("data"), dict)]
        assert accessions.count(_NEW_ACCESSION) == 1, \
            "the ephemeral copy and the durable reconstruction must dedup by accession"

    def test_the_durable_reconstruction_takes_over_when_the_ephemeral_copy_is_gone(
            self, sec, entity_id, real_delivery):
        self._fire_once(sec)
        _cache.invalidate(_alerts._user_key(_USER))  # redeploy / TTL / eviction

        feed = _alerts.get_alerts(limit=50, user_id=_USER)
        rows = [a for a in feed if str(a.get("id", "")).startswith(_alerts._S7_FIRE_PREFIX)]
        assert len(rows) == 1, "a filing watch must survive the process that delivered it"
        assert rows[0]["data"]["accession"] == _NEW_ACCESSION
        assert rows[0]["read"] is False

    def test_marking_the_ephemeral_copy_read_DUAL_WRITES_the_durable_row(
            self, sec, entity_id, real_delivery):
        """`ca9093c00`. While both stores hold the fire, the ephemeral copy is
        the ONLY one the member can see or mark. Without the dual-write the
        mark lives in process memory alone, and the durable reconstruction
        reappears UNREAD the moment the cache is gone."""
        fire = self._fire_once(sec)
        ephemeral = [a for a in (_cache.get(_alerts._user_key(_USER)) or [])
                     if a["data"].get("source") == "document_arrival"]
        assert len(ephemeral) == 1
        ephemeral_id = ephemeral[0]["id"]
        assert not ephemeral_id.startswith(_alerts._S7_FIRE_PREFIX), \
            "the two stores use different id schemes — that is why fire_key is the join"

        assert _alerts.mark_read(ephemeral_id, _USER) is True

        # THE DUAL WRITE: the durable row, found via occ:{accession}.
        assert _receipts.list_fires(_USER, limit=10)[0]["read_at"] is not None, \
            "the ephemeral mark-read did not reach the durable alert_fires row"

        # …and it survives losing the ephemeral copy.
        _cache.invalidate(_alerts._user_key(_USER))
        rows = [a for a in _alerts.get_alerts(limit=50, user_id=_USER)
                if str(a.get("id", "")).startswith(_alerts._S7_FIRE_PREFIX)]
        assert len(rows) == 1 and rows[0]["read"] is True, \
            "a read filing watch must not come back unread after a redeploy"
        assert fire["id"] == _receipts.list_fires(_USER, limit=10)[0]["id"]

    def test_the_dual_write_is_ownership_scoped(self, sec, entity_id, real_delivery):
        self._fire_once(sec)
        _receipts.mark_fire_read_by_fire_key(f"occ:{_NEW_ACCESSION}", "somebody-else")
        assert _receipts.list_fires(_USER, limit=10)[0]["read_at"] is None, \
            "another member's mark-read must never touch this member's fire"

    def test_marking_the_durable_reconstruction_read_by_its_s7fire_id(
            self, sec, entity_id, captured_delivery):
        fire = self._fire_once(sec)
        assert _alerts.mark_read(f"{_alerts._S7_FIRE_PREFIX}{fire['id']}", _USER) is True
        assert _receipts.list_fires(_USER, limit=10)[0]["read_at"] is not None
        # Idempotent: a second mark is a no-op success, never a double state.
        first_read_at = _receipts.list_fires(_USER, limit=10)[0]["read_at"]
        assert _alerts.mark_read(f"{_alerts._S7_FIRE_PREFIX}{fire['id']}", _USER) is True
        assert _receipts.list_fires(_USER, limit=10)[0]["read_at"] == first_read_at

    def test_mark_all_read_covers_the_durable_filing_watch_fires(
            self, sec, entity_id, captured_delivery):
        self._fire_once(sec)
        assert _alerts.mark_all_read(_USER) >= 1
        assert _receipts.list_fires(_USER, limit=10)[0]["read_at"] is not None


# ══════════════════════════════════════════════════════════════════════════
# THE CONTROL
# ══════════════════════════════════════════════════════════════════════════
_PACKAGE_DIR = Path(__file__).resolve().parents[1] / "api" / "services" / "alert_taxonomy"


def _declared_trigger_types() -> tuple[list[str], dict[str, str]]:
    """Every module-level `TYPE_ID = "..."` in the alert_taxonomy package, read
    from the AST — never a grep, never a hand-typed roster."""
    files = sorted(p for p in _PACKAGE_DIR.glob("*.py"))
    declared: dict[str, str] = {}
    for path in files:
        for node in ast.parse(path.read_text(encoding="utf-8")).body:
            if not isinstance(node, ast.Assign):
                continue
            for target in node.targets:
                if (isinstance(target, ast.Name) and target.id == "TYPE_ID"
                        and isinstance(node.value, ast.Constant)):
                    declared[path.name] = node.value.value
    return [p.name for p in files], declared


def test_CONTROL_document_arrival_is_still_the_only_trigger_type_in_the_package():
    """⛔ THIS IS THE CONTROL, AND IT IS *MEANT* TO FLIP.

    Everything above pins filing watch's own three observables. This one
    assertion pins the SCOPE those observables were measured against: S7 has
    seven remaining trigger types to add, and the day the first one lands this
    test goes RED — on purpose.

    It is what proves this file is a filing-watch parity rail rather than a
    blanket pin on the module: if every test here passed no matter what S7
    added, the file would be measuring nothing about the seam.

    WHEN IT FLIPS, DO NOT DELETE IT. Do this instead:
      1. Add the new type to `_EXPECTED` below.
      2. Give `alerts._s7_durable_alerts` a reconstruction branch for it —
         without one its fires are silently dropped from the member's feed
         (proved by the sibling test below).
      3. Re-run the three observable classes above against the new type's own
         fixture event, and re-run the mutation proof.
    """
    # ⛔ UPDATED BY NAMING, NEVER BY DELETING THE ASSERTION -- the docstring's own
    # instruction. Flipped twice:
    #   2026-09-12  `price-level`      GATE-S7-PRICE-LEVEL CP1
    #   2026-09-12  `event-proximity`  GATE-S7-EVENT-PROXIMITY CP1
    #   2026-09-12  `catalyst-match`   GATE-S7-CATALYST-MATCH CP1
    #   2026-09-13  `position-risk`    GATE-S7-POSITION-RISK CP1-CP2
    #
    # ⚠️ STEPS 2 AND 3 ABOVE ARE STILL DELIBERATELY NOT DONE, and this is the
    # record of that decision rather than an oversight.
    #
    # `event-proximity` CP1 registers the type and ships NO evaluator, so it
    # cannot fire at all -- step 2 guards fires being dropped from the member's
    # feed, and there are none; step 3 needs a fire to run against.
    #
    # `catalyst-match` CP1-CP2 is the same case for a stricter reason: it has an
    # evaluator, but NOTHING WIRES IT and it records no fire at all. It imports
    # neither `receipts` nor `delivery`, every predicate it sees is armed by its
    # own comparison harness, and
    # `test_the_harness_is_the_only_caller_of_would_fire` is the rail that keeps
    # that true. There is no fire to reconstruct and no feed row to drop.
    # ⛔ Step 2 becomes a PRECONDITION the moment CP3 projects real cohort rows,
    # not a follow-up -- same rule as price-level's below.
    #
    # `position-risk` CP1-CP2 is the same case as `catalyst-match` and the
    # reason is worth stating rather than inheriting: it HAS a dark evaluator
    # and it RECORDS NO FIRE. `position_risk.py` imports neither `receipts` nor
    # `delivery`; `position_risk_compare.py` owns exactly two tables of its own
    # (`position_risk_comparison_spans`, `position_risk_heartbeat`) and calls
    # `record_fire` nowhere --
    # `test_the_harness_records_no_fire_and_writes_no_member_visible_row` reads
    # both facts off the source, and
    # `test_the_harness_is_the_only_caller_of_would_fire` keeps the evaluator
    # reachable from the harness and from nothing else. So there is no fire to
    # reconstruct and no feed row to drop, and step 3 has no fire to run
    # against.
    # ⛔ AND FOR THIS TYPE STEP 2 IS THE LOUDEST OF THE FOUR AT CP3. Its legacy
    # already away-delivers: `stop_hit` scores 10, clears
    # `engine._DELIVER_IMPORTANCE_FLOOR = 8`, and emails + Discords the member.
    # A projected fire that reached the taxonomy store with no reconstruction
    # branch would be silently absent from the feed of a member who is used to
    # being TOLD when a stop is hit. Precondition of the CP3 PR, never a
    # follow-up.
    #
    # ⛔ `price-level` IS DIFFERENT NOW AND THE DISTINCTION MATTERS. It has an
    # evaluator (CP2) that is WIRED and ARMED (CP3/CP3b), writing real
    # alert_fires rows for the admin cohort. It still owes no reconstruction
    # branch only because it delivers NOTHING -- the dark rail
    # `test_no_cp3_module_imports_delivery` asserts that from the source, with a
    # non-vacuity control. ⭐ The day price-level flips, step 2 is a PRECONDITION
    # of that PR, not a follow-up: a fire that reaches the taxonomy store but has
    # no reconstruction branch is silently absent from the member's feed, which
    # is the hazard the sibling test below demonstrates.
    #
    # ⚰️ This block cited `test_the_registration_is_not_wired_yet`. That test was
    # INVERTED when CP3 wired register() -- it is now
    # `test_the_registration_is_wired_ONCE_and_nowhere_else`. Corrected here
    # rather than left pointing at a name that no longer exists.
    _EXPECTED = {"document-arrival", "price-level", "event-proximity",
                 "catalyst-match", "position-risk"}

    files, declared = _declared_trigger_types()

    # NON-VACUITY CONTROL — an empty scan is a failed invocation, and an empty
    # set satisfies almost any check anyone writes.
    assert "document_arrival.py" in files, (
        "the AST scan did not even see the package's own trigger module — the "
        f"path is wrong, not the answer. Saw: {files}")
    assert declared, "the scan found no TYPE_ID declaration at all; it is broken, not green"
    assert declared.get("document_arrival.py") == "document-arrival"

    assert set(declared.values()) == _EXPECTED, (
        "a NEW S7 trigger type was added to api/services/alert_taxonomy/ "
        f"({sorted(set(declared.values()) - _EXPECTED)}). Filing watch's parity "
        "coverage has NOT been extended to it — see this test's docstring for "
        "the four steps before this line may be updated."
    )


def test_the_feed_bridge_silently_drops_a_trigger_type_it_has_no_branch_for(
        sec, entity_id, captured_delivery):
    """Why the control above matters, demonstrated rather than asserted in
    prose: `alerts._s7_durable_alerts` dispatches on `trigger_type` with ONE
    branch. A fire of any other type produces NO feed row and NO error — the
    member is simply never told. That is the failure a new trigger type walks
    into, and it is invisible without this."""
    pid = _arm_watch(sec)
    fire_id = _receipts.record_fire(
        predicate_id=pid, trigger_type="price-threshold-not-yet-built",
        user_id=_USER, entity_ref=_SYM, fire_key="occ:hypothetical",
        detail={"ticker": _SYM}, source_data_class="quote",
        freshness_class="real_time", as_of=1_757_000_000.0,
    )
    assert fire_id is not None, "the fixture fire must actually land, or this proves nothing"
    assert len(_receipts.list_fires(_USER, limit=10)) == 1

    feed = _alerts.get_alerts(limit=50, user_id=_USER)
    assert [a for a in feed if str(a.get("id", "")).startswith(_alerts._S7_FIRE_PREFIX)] == [], \
        "a trigger type with no reconstruction branch is dropped from the feed"
