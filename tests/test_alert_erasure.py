"""Account deletion takes a member's ALERTS with it -- in every database that holds them.

Owner-approved 2026-10-30. `api/services/alert_erasure.py` purges five databases outside
auth.db (alert_taxonomy, screener, calendar_alerts, transcript_alerts, catalysts); the auth.db
alert tables (`inbound_alert_tokens`, `inbound_alert_receipts`, `user_alerts`,
`web_push_subscriptions`, ...) are rows of `account_purge._DIRECT_USER_TABLES`, railed by
`tests/test_journal_two_account_purge.py` (one row per table, a control member untouched).

What this file makes impossible:
  1. A member table in one of the five stores that the purge misses, or one it reaches for the
     WRONG member -- seeded for two members through each store's own schema, purged for one,
     counted by name: (deleted, other) must go (1, 1) -> (0, 1). Rows with no member id of
     their own (a fire's read state, a rule's comparison spans, a standing screen's snapshots)
     are counted by the PARENT ID they carried, never through a join after the parents are
     gone (a join counts zero whether the side rows went or not).
  2. A member table in those stores' own schemas that `alert_erasure` does not list -- read
     from the schemas, failing by name.
  3. A restore that brings the member's alerts back: each store is in
     `account_tombstones.STORE_REPLAYS`, and the replay on a restored copy deletes them.
  4. An evaluator or scheduler that crashes on, or DELIVERS to, an alert that vanished under
     it: the outbound drain, the reminder sweep, the S7 delivery lease, the event-proximity
     tick, the lifecycle sweep and the standing-screen nightly run, each with the purge landing
     MID-RUN where the evaluator can be made to reach that point.
  5. THE CENSUS: every table any module under `api/` creates with a member-id column is purged,
     cascaded by a foreign key to `users(id)`, emptied by a trigger, or named in `KNOWN_UNPURGED`
     with the reason -- read from the SQL string constants of every module (an AST read, so
     implicit string concatenation and comments cannot hide a table), failing by name.
"""
from __future__ import annotations

import ast
import importlib
import json
import pkgutil
import re
import shutil
import sqlite3
import sys
import time
from datetime import date
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import account_deletion_manifest as gen  # noqa: E402

from api.services import alert_erasure as ae  # noqa: E402

GONE, STAYS = "member-gone-0001", "member-stays-0002"

#: Columns that are a CHECK / JSON / enum the generic filler cannot guess.
_OVERRIDES = {
    "alert_predicates": {"entity_scope": '{"kind": "symbol", "id": "AAA"}', "params": "{}"},
    "alert_routing_rule": {},
}


# ── the five stores, built in tmp from their own schemas ───────────────────────────────────

def _build_schemas(paths: dict[str, Path]) -> None:
    """Every table the stores' own modules create, in tmp. alert_taxonomy: `db.init_db` plus every
    module in the package that ensures its own tables through `_conn(db_path)`."""
    from api.services.alert_taxonomy import db as _db
    import api.services.alert_taxonomy as pkg
    c = _db.connect(str(paths["alert_taxonomy"]))
    _db.init_db(c)
    c.close()
    for info in pkgutil.iter_modules(pkg.__path__):
        mod = importlib.import_module(f"api.services.alert_taxonomy.{info.name}")
        opener = getattr(mod, "_conn", None)
        if callable(opener):
            k = opener(str(paths["alert_taxonomy"]))
            k.close()
    from api.services.screener import screen_alerts, spec_alerts
    from api.services import calendar_alerts, transcript_keyword_alerts as tka
    from api.services.catalyst import store as cstore
    for name, ddl in (("screener", screen_alerts._SCHEMA + spec_alerts._SCHEMA),
                      ("calendar_alerts", calendar_alerts._SCHEMA),
                      ("transcript_alerts", tka._SCHEMA),
                      ("catalysts", cstore._SCHEMA)):
        k = sqlite3.connect(paths[name])
        k.executescript(ddl)
        k.commit()
        k.close()


@pytest.fixture
def stores(tmp_path, monkeypatch):
    """The five stores at tmp paths, pointed at through each module's OWN path attribute."""
    from api.services.alert_taxonomy import db as _db
    from api.services.screener import screen_alerts, spec_alerts
    from api.services import calendar_alerts, transcript_keyword_alerts as tka
    from api.services.catalyst import store as cstore
    paths = {s.name: tmp_path / s.db for s in ae.STORES}
    monkeypatch.setattr(_db, "DB_PATH", str(paths["alert_taxonomy"]))
    monkeypatch.setenv("SCREENER_DB_PATH", str(paths["screener"]))
    monkeypatch.setattr(calendar_alerts, "_DB_PATH", str(paths["calendar_alerts"]))
    monkeypatch.setattr(tka, "DB_PATH", str(paths["transcript_alerts"]))
    monkeypatch.setattr(cstore, "_DB_PATH", str(paths["catalysts"]))
    screen_alerts._done.clear()
    spec_alerts._done.clear()
    _build_schemas(paths)
    # Non-vacuity: the purge resolves exactly these files.
    assert {s.name: s.path() for s in ae.STORES} == {k: str(v) for k, v in paths.items()}
    return paths


def _insert(conn, table: str, values: dict) -> int:
    cols = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    assert cols, f"{table} is not in this store's schema"
    pk = [c for c in cols if c[5]]
    solo_int_pk = len(pk) == 1 and "INT" in (pk[0][2] or "").upper()
    row = {}
    for _cid, name, ctype, notnull, _dflt, is_pk in cols:
        ctype = (ctype or "").upper()
        if name in values:
            row[name] = values[name]
        elif name in _OVERRIDES.get(table, {}):
            row[name] = _OVERRIDES[table][name]
        elif is_pk and solo_int_pk:
            continue
        elif notnull or is_pk:
            row[name] = 1 if ("INT" in ctype or "REAL" in ctype) else f"{table}.{name}.{values.get('user_id', 'x')}"
    cur = conn.execute(f'INSERT INTO "{table}" ({",".join(row)}) VALUES ({",".join("?" * len(row))})',
                       tuple(row.values()))
    return cur.lastrowid


def _seed(paths: dict) -> dict:
    """One row per member table per member, then one row per JOIN table hanging off each
    member's parent row. Returns {store: {table: {member: key the rows are counted by}}}."""
    keys: dict = {}
    for store in ae.STORES:
        conn = sqlite3.connect(paths[store.name])
        keys[store.name] = {}
        for table in store.tables:
            keys[store.name][table] = {}
            for uid in (GONE, STAYS):
                _insert(conn, table, {"user_id": uid})
                keys[store.name][table][uid] = ("user_id", uid)
        for table, fk, parent in store.joins:
            keys[store.name][table] = {}
            for uid in (GONE, STAYS):
                pid = conn.execute(f"SELECT id FROM {parent} WHERE user_id = ?", (uid,)).fetchone()[0]
                _insert(conn, table, {fk: pid})
                keys[store.name][table][uid] = (fk, pid)
        conn.commit()
        conn.close()
    return keys


def _counts(paths: dict, keys: dict) -> dict:
    out = {}
    for store in ae.STORES:
        conn = sqlite3.connect(paths[store.name])
        for table, by_member in keys[store.name].items():
            out[(store.db, table)] = tuple(
                conn.execute(f'SELECT COUNT(*) FROM "{table}" WHERE "{col}" = ?', (val,)).fetchone()[0]
                for col, val in (by_member[GONE], by_member[STAYS]))
        conn.close()
    return out


# ── 1. every table purged for the member, untouched for the other ──────────────────────────

def test_every_alert_table_in_every_store_loses_the_members_rows_and_only_theirs(stores):
    keys = _seed(stores)
    before = _counts(stores, keys)
    # Non-vacuity, by name, on both kinds of row.
    assert before[("alert_taxonomy.db", "alert_predicates")] == (1, 1)
    assert before[("alert_taxonomy.db", "alert_fire_channel_reads")] == (1, 1)
    assert before[("screener.db", "spec_alert_snapshots")] == (1, 1)
    unseeded = {k: v for k, v in before.items() if v != (1, 1)}
    assert not unseeded, unseeded
    report = ae.purge_user(GONE)
    assert report["errors"] == [], report["errors"]
    after = _counts(stores, keys)
    wrong = {k: v for k, v in after.items() if v != (0, 1)}
    assert not wrong, f"(deleted member, other member) rows after the purge, want (0, 1): {wrong}"
    # The report names every table it covers, store by store.
    for store in ae.STORES:
        named = set(report["stores"][store.db]["rows_deleted"])
        assert named == set(store.tables) | {t for t, _f, _p in store.joins}, store.db


def test_a_store_that_does_not_exist_is_reported_absent_and_is_never_created(tmp_path, monkeypatch):
    from api.services import transcript_keyword_alerts as tka
    path = tmp_path / "never" / "transcript_alerts.db"
    monkeypatch.setattr(tka, "DB_PATH", str(path))
    rep = ae._purge_live_store(ae.BY_NAME["transcript_alerts"], GONE)
    assert rep["absent"] is True and rep["errors"] == []
    assert set(rep["rows_deleted"]) == {"keyword_subs", "keyword_fired"}
    assert not path.exists() and not path.parent.exists()


def test_credentials_are_revoked_first_and_each_half_commits_on_its_own(stores):
    """The inbound receiver token (auth.db) and the outbound endpoints (alert_taxonomy.db) go
    before anything else, each COMMITTED -- read back on a separate connection."""
    _seed(stores)
    auth = sqlite3.connect(":memory:")
    from api.services import inbound_alerts as ia
    auth.executescript(ia._SCHEMA)
    for uid in (GONE, STAYS):
        auth.execute("INSERT INTO inbound_alert_tokens (token_hash, user_id, hint, created_at) "
                     "VALUES (?, ?, 'tvr_x', 't')", (f"h-{uid}", uid))
    auth.commit()
    out = ae.revoke_credentials(GONE, auth)
    assert out == {"inbound_alert_tokens": 1, "alert_webhooks": 1, "errors": []}
    assert not auth.in_transaction
    assert [r[0] for r in auth.execute("SELECT user_id FROM inbound_alert_tokens")] == [STAYS]
    other = sqlite3.connect(stores["alert_taxonomy"])
    assert [r[0] for r in other.execute("SELECT user_id FROM alert_webhooks")] == [STAYS]
    other.close()


# ── 2. the stores' own schemas: no member table unlisted ───────────────────────────────────

#: Tables in these five files that hold no member's data: shared market data, run logs,
#: heartbeats, the trigger registry. Named so a NEW table must be decided, never defaulted.
_STORE_NOT_MEMBER = {
    "alert_trigger_registry", "_migrations", "alert_sweep_runs",
    "catalyst_match_heartbeat", "event_proximity_sweep_heartbeat", "indicator_condition_heartbeat",
    "position_risk_heartbeat", "price_level_sweep_heartbeat", "rating_change_heartbeat",
    "regime_change_heartbeat", "regime_change_projection_watermark", "scan_membership_heartbeat",
    "catalysts", "catalyst_cost_log", "catalyst_gate_rejections", "catalyst_learned_rules",
    "catalyst_learn_state", "catalyst_deep_context_done", "catalyst_runs",
}
#: A column that ties a row to a member's row without naming the member.
_HANGS_OFF = {"predicate_id", "fire_id", "sub_id", "webhook_id"}


def test_every_member_table_in_the_five_schemas_is_listed_in_alert_erasure(stores):
    unlisted, seen = [], set()
    for store in ae.STORES:
        conn = sqlite3.connect(stores[store.name])
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
        listed = set(store.tables) | {t for t, _f, _p in store.joins}
        for t in tables:
            cols = {c[1] for c in conn.execute(f'PRAGMA table_info("{t}")')}
            seen.add(t)
            member = "user_id" in cols or bool(cols & _HANGS_OFF)
            if member and t not in listed:
                unlisted.append(f"{store.db}:{t}")
            if not member and t not in listed and t not in _STORE_NOT_MEMBER:
                unlisted.append(f"{store.db}:{t} (no member column -- add it to _STORE_NOT_MEMBER if so)")
        conn.close()
    assert "alert_fires" in seen and "spec_alerts_fired" in seen, "non-vacuity: schemas not read"
    assert not unlisted, f"member tables alert_erasure does not purge: {unlisted}"


# ── 3. a restore re-purges ──────────────────────────────────────────────────────────────────

def test_each_store_is_replayed_on_restore_and_the_replay_deletes_the_member(stores, tmp_path):
    from api.services import account_tombstones as at
    keys = _seed(stores)
    restored = {}
    for store in ae.STORES:
        assert at.STORE_REPLAYS.get(store.name) is not None, f"{store.name} not in STORE_REPLAYS"
        copy = tmp_path / f"restored-{store.db}"
        shutil.copyfile(stores[store.name], copy)            # the backup, taken before the deletion
        restored[store.name] = copy
    ae.purge_user(GONE)                                      # the live deletion
    for store in ae.STORES:                                  # ...then a restore of the old copy
        conn = sqlite3.connect(restored[store.name])
        try:
            assert ae.still_present(store, conn, [GONE]) == [GONE], "non-vacuity: the copy has them"
            rep = at.STORE_REPLAYS[store.name](conn, [GONE])
        finally:
            conn.close()
        assert rep["errors"] == [] and rep["still_present"] == [], (store.name, rep)
        assert rep["replayed"] == [GONE] and rep["rows_deleted"] > 0
    after = _counts({k: v for k, v in restored.items()}, keys)
    wrong = {k: v for k, v in after.items() if v != (0, 1)}
    assert not wrong, f"rows a replayed restore still holds: {wrong}"


def test_the_restore_tool_refuses_a_copy_the_replay_could_not_clear(stores, tmp_path):
    """`store_restore.replay_preparer` is what `--restore` runs on an alert store's copy."""
    sys.path.insert(0, str(REPO / "tools"))
    import store_restore
    _seed(stores)
    copy = tmp_path / "copy.db"
    shutil.copyfile(stores["calendar_alerts"], copy)
    prepare = store_restore.replay_preparer("calendar_alerts", {GONE: "2026-10-30"})
    assert prepare is not None
    rep = prepare(copy)
    assert rep["still_present"] == []
    assert rep["members"] == [STAYS]          # who the restored copy still holds (STORE_MEMBERS)
    k = sqlite3.connect(copy)
    assert [r[0] for r in k.execute("SELECT user_id FROM calendar_alerts_fired")] == [STAYS]
    k.close()


# ── 4. evaluators and schedulers on a vanished alert ───────────────────────────────────────

def _member_row(path, table, col, uid):
    k = sqlite3.connect(path)
    try:
        return k.execute(f"SELECT {col} FROM {table} WHERE user_id = ?", (uid,)).fetchone()[0]
    finally:
        k.close()


def test_the_outbound_drain_never_posts_to_an_endpoint_deleted_mid_batch(stores, monkeypatch):
    """`due` is read once. The member's account is deleted DURING the first send; their
    delivery, already in `due`, must not be posted from the stale row."""
    from api.services.alert_taxonomy import outbound_webhooks as ow
    from api.services import crypto_box
    monkeypatch.setenv(ow.FLAG, "1")
    monkeypatch.setattr(crypto_box, "decrypt", lambda s: "secret")
    k = sqlite3.connect(stores["alert_taxonomy"])
    for i, uid in enumerate((STAYS, GONE)):                 # STAYS is due first
        k.execute("INSERT INTO alert_webhooks (id, user_id, url, secret_enc, secret_hint, created_at)"
                  " VALUES (?, ?, ?, 'enc', 'h', 0)", (f"wh-{uid}", uid, f"https://{uid}.example/hook"))
        k.execute("INSERT INTO alert_webhook_deliveries (id, webhook_id, user_id, event, payload,"
                  " status, next_attempt_at, created_at) VALUES (?, ?, ?, 'alert.fired', '{}',"
                  " 'pending', ?, 0)", (f"d-{uid}", f"wh-{uid}", uid, 10 + i))
    k.commit()
    k.close()
    posted = []

    def poster(url, body, headers):
        posted.append(url)
        if len(posted) == 1:
            assert ae.purge_user(GONE)["errors"] == []      # the deletion lands mid-batch
        return 200

    out = ow.drain(poster=poster, resolver=lambda h: ["93.184.216.34"], now=100.0)
    assert posted == [f"https://{STAYS}.example/hook"], posted
    assert out["delivered"] == 1


def test_the_reminder_sweep_never_reminds_about_a_fire_deleted_after_it_was_read(stores, monkeypatch):
    from api.services.alert_taxonomy import remind
    monkeypatch.setenv(remind.FLAG, "1")
    now = 10_000.0
    k = sqlite3.connect(stores["alert_taxonomy"])
    for uid in (GONE, STAYS):
        k.execute("INSERT INTO alert_predicates (id, type_id, user_id, entity_scope, params, created_at,"
                  " updated_at, remind_after_s) VALUES (?, 'price-level', ?, ?, '{}', 0, 0, 60)",
                  (f"p-{uid}", uid, json.dumps({"kind": "symbol", "id": uid})))
        k.execute("INSERT INTO alert_fires (predicate_id, trigger_type, user_id, fire_key, as_of,"
                  " fired_at, delivery_channels) VALUES (?, 'price-level', ?, 'k', 0, ?, ?)",
                  (f"p-{uid}", uid, now - 600, json.dumps({"in_app": "ok"})))
    k.commit()
    k.close()
    real_conn, calls = remind._conn, []

    def conn(db_path):
        calls.append(1)
        if len(calls) == 2:                                 # rows read; the first claim is next
            assert ae.purge_user(GONE)["errors"] == []
        return real_conn(db_path)

    monkeypatch.setattr(remind, "_conn", conn)
    sent = []
    remind.remind_due(now=now, deliver=lambda **kw: sent.append(kw["user_id"]) or {"channels_ok": 1},
                      routing=lambda u: None)
    assert sent == [STAYS], sent
    k = sqlite3.connect(stores["alert_taxonomy"])
    claims = k.execute("SELECT COUNT(*) FROM alert_fire_reminders").fetchone()[0]
    k.close()
    assert claims == 1, "a claim row was written for the vanished fire"


def test_the_s7_delivery_lease_refuses_a_vanished_fire_and_delivers_nothing(stores, monkeypatch):
    from api.services.alert_taxonomy import delivery, receipts
    import api.services.watchlist_alert_service as was
    _seed(stores)
    fire_id = _member_row(stores["alert_taxonomy"], "alert_fires", "id", GONE)
    ae.purge_user(GONE)
    called = []
    monkeypatch.setattr(was, "deliver_alert_payload", lambda **kw: called.append(kw))
    rep = delivery.deliver(fire_id, GONE, "AAA", "t", "m", source="price_level")
    assert rep["claimed"] is False and called == []
    assert receipts.release_delivery(fire_id)["found"] is False
    assert receipts.record_delivery_channels(fire_id, {"in_app": "ok"}) is True   # a no-op, no raise


def test_the_event_proximity_tick_skips_a_vanished_rule_and_records_no_fire(stores):
    from api.services.alert_taxonomy import event_proximity
    _seed(stores)
    pid = _member_row(stores["alert_taxonomy"], "alert_predicates", "id", GONE)
    ae.purge_user(GONE)
    out = event_proximity.evaluate(today=date(2026, 10, 30), predicate_ids=[pid])
    assert out.get("skipped", {}).get(pid) == "unknown predicate", out
    k = sqlite3.connect(stores["alert_taxonomy"])
    assert k.execute("SELECT COUNT(*) FROM alert_fires WHERE user_id = ?", (GONE,)).fetchone()[0] == 0
    k.close()


def test_the_lifecycle_sweep_and_routing_lookup_tolerate_a_purged_member(stores, monkeypatch):
    from api.services.alert_taxonomy import lifecycle, routing_rule
    monkeypatch.setenv(lifecycle.FLAG, "1")
    monkeypatch.setenv(routing_rule.FLAG, "1")
    _seed(stores)
    ae.purge_user(GONE)
    assert lifecycle.expire_due(now=time.time()) == 0
    rule = routing_rule.effective(GONE)
    assert rule is not None and not rule.suspended            # the default rule, not a crash


def test_the_standing_screen_run_drops_a_subscription_deleted_mid_run(stores, monkeypatch):
    """`subs` is read once at the top of `spec_alerts.run_nightly`. The member's account is
    deleted while the run is on the FIRST subscription; theirs is the second."""
    from api.services.screener import spec_alerts as SA
    monkeypatch.setenv(SA.FLAG, "1")
    spec = {"filters": [{"key": "price", "op": "gte", "min": 10}]}
    SA.subscribe({"id": STAYS}, "Mine", spec, "both", validate=lambda s: None)
    gone_sub = SA.subscribe({"id": GONE}, "Theirs", spec, "both", validate=lambda s: None)
    night = {"n": 0, "purge": False}

    def snapshotter(spec_, user_id):
        if night["purge"]:
            night["purge"] = False
            assert ae.purge_user(GONE)["errors"] == []
        return (["AAA"], 1, "2026-10-01") if night["n"] == 0 else (["BBB"], 1, "2026-10-02")

    sent = []
    deliver = lambda **kw: sent.append(kw["user_id"])         # noqa: E731
    SA.run_nightly(deliver=deliver, snapshotter=snapshotter, routing=lambda u: None)
    night.update(n=1, purge=True)
    r = SA.run_nightly(deliver=deliver, snapshotter=snapshotter, routing=lambda u: None)
    assert sent == [STAYS], sent
    assert r.get("vanished") == 1, r
    sub_id = gone_sub.get("id") if isinstance(gone_sub, dict) else gone_sub
    k = sqlite3.connect(stores["screener"])
    left = {t: k.execute(f"SELECT COUNT(*) FROM {t} WHERE sub_id = ?", (sub_id,)).fetchone()[0]
            for t in ("spec_alert_snapshots", "spec_alerts_fired")}
    k.close()
    assert left == {"spec_alert_snapshots": 0, "spec_alerts_fired": 0}, left


# ── 5. THE CENSUS ───────────────────────────────────────────────────────────────────────────

_CREATE = re.compile(r"CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"`\[]?(\w+)[\"`\]]?\s*\(", re.I)
#: A column that names a member, by any of the spellings the codebase uses.
_MEMBER_COLUMNS = {"user_id", "member_id", "owner_id", "owner_user_id", "author_id",
                   "discord_user_id", "created_by", "subscriber_id", "viewer_id", "follower_id",
                   "referred_user_id", "referrer_user_id", "email", "user_email"}

#: Emptied by an AFTER DELETE trigger on a table the purge deletes -- fired and counted by
#: `tests/test_account_deletion_manifest.py::test_the_tables_only_a_trigger_empties_...`.
TRIGGER_EMPTIED = {"j2_notes_fts", "j2_note_document_pages_fts", "j2_note_excerpts_fts",
                   "j2_note_tag_index", "j2_note_task_digest"}

#: ⛔ What an account deletion does NOT delete today, each with WHY. A new member table must be
#: purged or land here BY NAME, with its reason -- never by default. Not alert data; each
#: needs its own ruling (owner), so this branch reports them rather than deleting them.
KNOWN_UNPURGED = {
    # -- deleted at the end of the cascade itself (`DELETE FROM users WHERE id = ?`) --
    "users": "the account row; `_cascade_delete_user` deletes it last",
    # -- not a member: an operator, a prospect, or a public author --
    "admin_todos": "AMBIGUOUS: an admin's to-do list; `created_by` is the admin's email",
    "waitlist": "AMBIGUOUS: a pre-signup email (no member id); may equal a member's email",
    "ltr_call_requests": "AMBIGUOUS: a sales-call request (name, phone, email); no member id",
    "team_members": "NOT MEMBER: The Desk's staff roster (desk_store), keyed by staff email",
    "tsdr_lessons": "NOT MEMBER: the TSDR lesson archive; `author_id` is the public author",
    "mentions": "NOT MEMBER: public social-media mentions (buzz_store); `author_id` is the poster",
    "wisdom_discord_messages": "NOT MEMBER: the public-trader archive (Discord authors)",
    "wisdom_twitter_tweets": "NOT MEMBER: the public-trader archive (tweet authors)",
    "wisdom_source_attributions": "NOT MEMBER: the public-trader archive",
    "wisdom_golden_candidates": "NOT MEMBER: the public-trader archive",
    "wisdom_archive_records": "NOT MEMBER: the public-trader archive",
    "wisdom_archive_calls": "NOT MEMBER: the public-trader archive",
    "wisdom_vocab_candidate_uses": "NOT MEMBER: the public-trader archive",
    # -- MEMBER DATA in a second database, NOT purged: needs an owner ruling per store --
    "acks": "UNPURGED member data: community.db",
    "call_record_optin": "UNPURGED member data: community.db",
    "chat_read_state": "UNPURGED member data: community.db",
    "floor_attachments": "UNPURGED member data: community.db (owner_id)",
    "floor_bookmarks": "UNPURGED member data: community.db",
    "floor_reactions": "UNPURGED member data: community.db",
    "floor_votes": "UNPURGED member data: community.db",
    "message_reactions": "UNPURGED member data: community.db",
    "messages": "UNPURGED member data: community.db (author_id; shared content -- delete or anonymize?)",
    "muted_users": "UNPURGED member data: community.db",
    "poll_votes": "UNPURGED member data: community.db",
    "posts": "UNPURGED member data: community.db (author_id; shared content -- delete or anonymize?)",
    "reactions": "UNPURGED member data: community.db",
    "read_state": "UNPURGED member data: community.db",
    "threads": "UNPURGED member data: community.db (author_id; shared content -- delete or anonymize?)",
    "agent_conversations": "UNPURGED member data: uct_agent store",
    "agent_turns": "UNPURGED member data: uct_agent store",
    "agent_telemetry": "UNPURGED member data: uct_agent store",
    "agent_inflight": "UNPURGED member data: uct_agent store",
    "agent_rate_events": "UNPURGED member data: uct_agent store",
    "agent_requests": "UNPURGED member data: uct_agent store",
    "agent_spend": "UNPURGED member data: uct_agent store",
    "ais_threads": "UNPURGED member data: ai_search_member.db",
    "ais_saved": "UNPURGED member data: ai_search_member.db",
    "ais_briefings": "UNPURGED member data: AI search briefings store",
    "ais_deep_jobs": "UNPURGED member data: AI search deep-research jobs",
    "artifact_versions": "UNPURGED member data: artifact_versions store",
    "artifact_version_prune_log": "UNPURGED member data: artifact_versions store",
    "charts_layouts": "UNPURGED member data: charts_layouts.db",
    "chart_layout_shares": "UNPURGED member data: charts_layouts.db",
    "theme_sets": "UNPURGED member data: theme_sets.db",
    "wire_feedback": "UNPURGED member data: wire_feedback.db",
    "workspace_doc_versions": "UNPURGED member data: workspace_docs.db",
    "workspace_doc_prune_log": "UNPURGED member data: workspace_docs.db",
    "workspace_key_guard": "UNPURGED member data: workspace_docs.db",
    "workspace_parse_failures": "UNPURGED member data: workspace_docs.db",
    "workspace_writebacks": "UNPURGED member data: workspace_docs.db",
    "study_attempts": "UNPURGED member data: study store",
    "study_badges": "UNPURGED member data: study store",
    "study_checkpoints": "UNPURGED member data: study store",
    "study_feedback": "UNPURGED member data: study store",
    "study_item_state": "UNPURGED member data: study store",
    "study_profile": "UNPURGED member data: study store",
    "study_reminder_log": "UNPURGED member data: study store",
    "study_sessions": "UNPURGED member data: study store",
    "study_skill": "UNPURGED member data: study store",
    "study_weekly_xp": "UNPURGED member data: study store",
    "edu_video_notes": "UNPURGED member data: education.db",
    "edu_video_progress": "UNPURGED member data: education.db",
    "pattern_feedback": "UNPURGED member data: patterns.db",
    "hub_reports": "UNPURGED member data: hub_reports store (user_id + user_email)",
    "discord_render_jobs": "UNPURGED member data: discord render job queue",
    "prefs": "UNPURGED member data: discord_chart_prefs.db (keyed by DISCORD user id, not ours)",
    "client_errors": "AMBIGUOUS: browser error reports tagged with the member id (diagnostics)",
    "flow_explain_user_requests": "AMBIGUOUS: per-member rate/usage log for flow-explain",
}


def _sql_strings(path: Path) -> list[str]:
    """Every string a module holds, with implicit concatenation already joined by the parser
    and an f-string's holes as `{}` -- so a `# comment` between two fragments, or a `--` SQL
    comment, can neither split a CREATE TABLE nor invent one."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            out.append(node.value)
        elif isinstance(node, ast.JoinedStr):
            out.append("".join(v.value if isinstance(v, ast.Constant) else "{}" for v in node.values))
    return [re.sub(r"--[^\n]*", "", s) for s in out]


def _body(s: str, open_at: int) -> str:
    depth = 0
    for j in range(open_at, len(s)):
        depth += s[j] == "("
        depth -= s[j] == ")"
        if depth == 0:
            return s[open_at + 1:j]
    return s[open_at + 1:]


def _columns(body: str) -> set[str]:
    cols, depth, cur = set(), 0, ""
    for ch in body + ",":
        depth += ch == "("
        depth -= ch == ")"
        if ch == "," and depth == 0:
            tok = cur.strip().split()
            if tok:
                cols.add(tok[0].strip('"`[]').lower())
            cur = ""
        else:
            cur += ch
    return cols


def census(root: Path = REPO / "api") -> dict[str, dict]:
    """{table: {"files": [...], "columns": member columns, "fk_users": bool}} for every table any
    module under `root` creates with a member-id column. Tests are not product schema."""
    found: dict[str, dict] = {}
    for path in sorted(root.rglob("*.py")):
        if path.name.startswith("test_") or path.name.endswith("_test.py") or "tests" in path.parts:
            continue
        in_auth_db = "auth_db" in path.read_text(encoding="utf-8")
        for s in _sql_strings(path):
            for m in _CREATE.finditer(s):
                body = _body(s, m.end() - 1)
                member = _columns(body) & _MEMBER_COLUMNS
                if not member:
                    continue
                entry = found.setdefault(m.group(1), {"files": set(), "columns": set(),
                                                      "fk_users_in_auth_db": False})
                entry["files"].add(path.relative_to(root.parent).as_posix())
                entry["columns"] |= member
                entry["fk_users_in_auth_db"] |= in_auth_db and bool(
                    re.search(r"REFERENCES\s+users\s*\(", body, re.I))
    return found


def _auth_db_cascaded(table: str, info: dict) -> bool:
    """Cascaded by `_cascade_delete_user`'s PRAGMA walk: declares REFERENCES users(id) in a
    module that writes auth.db (it imports `auth_db`). A foreign key in a module on another
    database references nothing that walk can see."""
    return info["fk_users_in_auth_db"]


def _accounted_by_the_deletion() -> set[str]:
    """Deleted by the purge, ANONYMISED by it, or deleted beside the account row by the cascade
    (`auth.DELETED_WITH_THE_ACCOUNT_ROW`) -- each a class the manifest lists on its own."""
    return gen.purged_tables() | gen.anonymised_tables() | gen.with_account_row_tables()


def unaccounted(found: dict) -> list[str]:
    purged = _accounted_by_the_deletion()
    out = []
    for table, info in sorted(found.items()):
        if table in purged or table in TRIGGER_EMPTIED or table in KNOWN_UNPURGED:
            continue
        if _auth_db_cascaded(table, info):
            continue
        out.append(f"{table} ({', '.join(sorted(info['files']))}: {', '.join(sorted(info['columns']))})")
    return out


def test_THE_CENSUS_every_member_keyed_table_is_purged_cascaded_or_named_with_its_reason():
    found = census()
    # Non-vacuity, by name, on each way a table is accounted for -- and on the AST read itself:
    # `ais_saved` and `wisdom_archive_calls` are built from implicitly concatenated fragments
    # with comments between them, which a line-oriented scan of the source misses.
    for name in ("j2_notes", "alert_predicates", "inbound_alert_tokens", "watchlists",
                 "ais_saved", "wisdom_archive_calls", "study_profile"):
        assert name in found, f"the census did not see {name}"
    assert _auth_db_cascaded("watchlists", found["watchlists"])
    missing = unaccounted(found)
    assert not missing, (
        "member-keyed tables an account deletion neither purges nor names: add each to the purge "
        "(account_purge._DIRECT_USER_TABLES for auth.db, a store's erasure module otherwise) or "
        f"to KNOWN_UNPURGED with the reason:\n  " + "\n  ".join(missing))


def test_the_census_ledger_has_no_stale_entries():
    """An entry that names a table the purge now deletes, or one no module creates any more,
    is a ledger that has stopped describing the code."""
    found, purged = census(), _accounted_by_the_deletion()
    stale = sorted(t for t in KNOWN_UNPURGED if t in purged)
    assert not stale, f"KNOWN_UNPURGED names tables the purge deletes: {stale}"
    gone = sorted(t for t in KNOWN_UNPURGED if t not in found)
    assert not gone, f"KNOWN_UNPURGED names tables no module creates: {gone}"


def test_the_census_fails_by_name_on_an_unlisted_member_table(tmp_path):
    """The rail can fail: a module that creates a member table nobody listed is named."""
    pkg = tmp_path / "api" / "services"
    pkg.mkdir(parents=True)
    (pkg / "fresh_feature.py").write_text(
        'X = ("CREATE TABLE IF NOT EXISTS fresh_member_notes ("  # a comment between fragments\n'
        '     " id TEXT PRIMARY KEY,"\n'
        '     " user_id TEXT NOT NULL)")\n', encoding="utf-8")
    found = census(tmp_path / "api")
    assert set(found) == {"fresh_member_notes"}
    assert unaccounted(found) == ["fresh_member_notes (api/services/fresh_feature.py: user_id)"]


# ── 6. the LIVE tombstone sweep catches a late write in every alert store ─────────────────

def _auth_with_late_alert_rows(tmp_path):
    """An auth.db where GONE is tombstoned (no users row) and STAYS is a member, and BOTH hold
    an inbound receiver token, a receipt, a bell row and a push subscription -- GONE's written
    AFTER their purge (a late delivery, a token minted on a stale session)."""
    from api.services import account_tombstones as at
    from api.services import inbound_alerts as ia
    path = tmp_path / "auth.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT)")
    conn.execute("INSERT INTO users VALUES (?, 'stays@example.test')", (STAYS,))
    at.ensure_table(conn)
    conn.execute(f"INSERT INTO {at.TABLE} (user_id, deleted_at) VALUES (?, '2026-10-30')", (GONE,))
    conn.executescript(ia._SCHEMA)
    from api.services import alert_durability, web_push
    conn.executescript(alert_durability._SCHEMA)
    conn.executescript(web_push._SCHEMA)
    for uid in (GONE, STAYS):
        _insert(conn, "inbound_alert_tokens", {"user_id": uid, "token_hash": f"h-{uid}"})
        _insert(conn, "inbound_alert_receipts", {"user_id": uid})
        _insert(conn, "user_alerts", {"user_id": uid, "id": f"a-{uid}"})
        _insert(conn, "web_push_subscriptions", {"user_id": uid})
    conn.commit()
    return conn


_SWEPT_AUTH = ("inbound_alert_tokens", "inbound_alert_receipts", "user_alerts", "web_push_subscriptions")


def test_the_live_sweep_deletes_late_alert_rows_in_every_store_and_auth_db(stores, tmp_path, monkeypatch):
    from api.services import tombstone_sweep
    from api.services import user_definitions as ud
    monkeypatch.setattr(ud, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    keys = _seed(stores)                      # GONE's rows: "late", the purge already ran
    auth = _auth_with_late_alert_rows(tmp_path)
    try:
        rep = tombstone_sweep.sweep(auth_conn=auth)
        left = {t: [r[0] for r in auth.execute(f"SELECT user_id FROM {t} ORDER BY user_id")]
                for t in _SWEPT_AUTH}
    finally:
        auth.close()
    assert rep["errors"] == [], rep["errors"]
    assert left == {t: [STAYS] for t in _SWEPT_AUTH}, left
    # The inbound receiver token is the sweep's FIRST auth.db delete.
    assert tombstone_sweep.AUTH_SWEEP[0][0] == "inbound_alert_tokens"
    for store in ae.STORES:
        assert store.name in rep["stores"], f"the sweep did not reach {store.name}"
    after = _counts(stores, keys)
    wrong = {k: v for k, v in after.items() if v != (0, 1)}
    assert not wrong, f"rows the sweep left (want (0, 1)): {wrong}"


def test_the_live_sweep_skips_an_alert_store_this_pod_never_created(tmp_path, monkeypatch):
    from api.services import tombstone_sweep
    from api.services import transcript_keyword_alerts as tka
    from api.services import user_definitions as ud
    monkeypatch.setattr(ud, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    missing = tmp_path / "nope" / "transcript_alerts.db"
    monkeypatch.setattr(tka, "DB_PATH", str(missing))
    auth = _auth_with_late_alert_rows(tmp_path)
    try:
        rep = tombstone_sweep.sweep(auth_conn=auth)
    finally:
        auth.close()
    assert rep["stores"]["transcript_alerts"] == {"absent": True}
    assert not missing.exists() and not missing.parent.exists()
    assert not [e for e in rep["errors"] if "transcript_alerts" in e], rep["errors"]


# ── 7. review fixes: 2FA goes only with the account row; page_views/feedback are anonymised ──

def _auth_db(tmp_path):
    """An auth.db with the real `users`, `page_views` and `feedback` DDL (auth_db._SCHEMA) and the
    2FA tables (totp_service._SCHEMA); two members, each with a page view, a feedback, 2FA."""
    from api.services import auth_db, totp_service
    conn = sqlite3.connect(tmp_path / "auth.db")
    conn.row_factory = sqlite3.Row
    conn.executescript(auth_db._SCHEMA)
    conn.executescript(totp_service._SCHEMA)
    for uid in (GONE, STAYS):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) "
                     "VALUES (?, ?, 'x', 'n', 'member')", (uid, f"{uid}@example.test"))
        conn.execute("INSERT INTO page_views (id, user_id, page) VALUES (?, ?, '/charts')", (f"pv-{uid}", uid))
        conn.execute("INSERT INTO feedback (id, user_id, email, page, message) VALUES (?, ?, ?, '/x', ?)",
                     (f"fb-{uid}", uid, f"{uid}@example.test", f"message from {uid}"))
        conn.execute("INSERT INTO user_totp (user_id, secret_encrypted, enabled, created_at) "
                     "VALUES (?, 's', 1, 't')", (uid,))
        conn.execute("INSERT INTO user_backup_codes (user_id, code_hash, created_at) VALUES (?, 'h', 't')", (uid,))
    conn.commit()
    return conn


def _row(conn, sql, *a):
    r = conn.execute(sql, a).fetchone()
    return tuple(r) if r is not None else None


def test_page_views_and_feedback_are_ANONYMISED_kept_and_unidentifiable_and_others_untouched(tmp_path, monkeypatch):
    from api.services import account_tombstones as at
    from api.services.journal_two import account_purge
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "tombs"))
    conn = _auth_db(tmp_path)
    try:
        stays_before = (_row(conn, "SELECT * FROM page_views WHERE id = ?", f"pv-{STAYS}"),
                        _row(conn, "SELECT * FROM feedback WHERE id = ?", f"fb-{STAYS}"))
        rep = account_purge.purge_user_data(GONE, conn)
        assert rep["rows_anonymised"] == {"page_views": 1, "feedback": 1}, rep["rows_anonymised"]
        pv = _row(conn, "SELECT user_id, page FROM page_views WHERE id = ?", f"pv-{GONE}")
        fb = _row(conn, "SELECT user_id, email, message FROM feedback WHERE id = ?", f"fb-{GONE}")
        stays_after = (_row(conn, "SELECT * FROM page_views WHERE id = ?", f"pv-{STAYS}"),
                       _row(conn, "SELECT * FROM feedback WHERE id = ?", f"fb-{STAYS}"))
        named = [t for t in ("page_views", "feedback")
                 if conn.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = ?", (GONE,)).fetchone()[0]]
        mailed = conn.execute("SELECT COUNT(*) FROM feedback WHERE email = ?",
                              (f"{GONE}@example.test",)).fetchone()[0]
    finally:
        conn.close()
    assert pv == ("", "/charts"), pv                         # kept; NOT NULL id column cleared to ''
    assert fb == (None, None, f"message from {GONE}"), fb    # kept; id and email cleared, text kept
    assert named == [] and mailed == 0
    assert stays_after == stays_before


def test_2FA_goes_IF_AND_ONLY_IF_the_account_row_goes(tmp_path, monkeypatch):
    """Review fix: the purge runs BEFORE the cascade. If 2FA were deleted there and the cascade then
    failed, a LIVE account would be left password-only. So: a failed cascade leaves the account AND
    its 2FA intact; a successful one takes both, and never the other member's."""
    from api.routers.auth import _cascade_delete_user
    from api.services import account_tombstones as at
    from api.services.journal_two import account_purge
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "tombs"))
    conn = _auth_db(tmp_path)

    def twofa(uid):
        return (conn.execute("SELECT COUNT(*) FROM user_totp WHERE user_id = ?", (uid,)).fetchone()[0],
                conn.execute("SELECT COUNT(*) FROM user_backup_codes WHERE user_id = ?", (uid,)).fetchone()[0])

    try:
        account_purge.purge_user_data(GONE, conn)
        assert twofa(GONE) == (1, 1), "the purge (before the cascade) deleted the member's 2FA"
        conn.execute("CREATE TRIGGER refuse BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'refused'); END")
        conn.commit()
        with pytest.raises(sqlite3.Error):
            _cascade_delete_user(conn, GONE)                  # the cascade FAILS
        assert _row(conn, "SELECT id FROM users WHERE id = ?", GONE) == (GONE,)
        assert twofa(GONE) == (1, 1), "a failed deletion left a live account without its 2FA"
        conn.execute("DROP TRIGGER refuse")
        conn.commit()
        _cascade_delete_user(conn, GONE)                      # the cascade SUCCEEDS
        assert _row(conn, "SELECT id FROM users WHERE id = ?", GONE) is None
        assert twofa(GONE) == (0, 0) and twofa(STAYS) == (1, 1)
    finally:
        conn.close()


# ── 8. every delete the sweep runs by member is an INDEXED lookup ──────────────────────────

def _plan(conn, sql, *args) -> str:
    return " | ".join(r[-1] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, args))


def _scans(plan: str, table: str) -> bool:
    """Does the plan read `table` without an index? (`SCAN <table>` with no `USING`.)"""
    return any(step.strip().startswith(f"SCAN {table}") and "USING" not in step
               for step in plan.split("|"))


def test_every_member_delete_in_every_alert_store_uses_an_index(stores):
    """The live sweep replays every tombstoned id against every store, every 6 hours, under the
    store's write lock: a full-table SCAN per id per table is the cost that grows with both."""
    scans = []
    for store in ae.STORES:
        conn = sqlite3.connect(stores[store.name])
        for table in store.tables:
            plan = _plan(conn, f"DELETE FROM {table} WHERE user_id = ?", "x")
            if _scans(plan, table):
                scans.append(f"{store.db}:{table}: {plan}")
        for table, fk, parent in store.joins:
            plan = _plan(conn, f"DELETE FROM {table} WHERE {fk} IN (SELECT id FROM {parent} WHERE user_id = ?)", "x")
            if _scans(plan, table) or _scans(plan, parent):
                scans.append(f"{store.db}:{table}: {plan}")
        conn.close()
    assert not scans, "member deletes that scan the whole table:\n  " + "\n  ".join(scans)


def test_every_auth_db_delete_the_sweep_runs_uses_an_index(tmp_path):
    from api.services import tombstone_sweep, inbound_alerts, alert_durability, web_push
    from api.services import indicator_alert_service as ias, alert_fired_log as afl, alert_rev_migration as arm
    conn = sqlite3.connect(tmp_path / "auth.db")
    for ddl in (inbound_alerts._SCHEMA, alert_durability._SCHEMA, web_push._SCHEMA,
                ias._SCHEMA, afl._SCHEMA, arm._SCHEMA):
        conn.executescript(ddl)
    scans = []
    for table, sql in tombstone_sweep.AUTH_SWEEP:
        plan = _plan(conn, sql, "x")
        if _scans(plan, table) or _scans(plan, "indicator_alerts"):
            scans.append(f"{table}: {plan}")
    conn.close()
    assert not scans, "sweep deletes that scan the whole table:\n  " + "\n  ".join(scans)


def test_every_member_delete_in_the_saved_indicator_store_uses_an_index(tmp_path, monkeypatch):
    """The sixth store the sweep replays (`user_definitions.db`)."""
    from api.services import user_definitions as ud, user_definitions_erasure as ude
    from api.services import user_definition_relint as relint
    monkeypatch.setattr(ud, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    ud._init_db()
    conn = sqlite3.connect(ud._DB_PATH)
    conn.executescript(relint._LOG_SCHEMA)
    scans = [f"{t}: {plan}" for t in ude.MEMBER_TABLES
             if _scans(plan := _plan(conn, f"DELETE FROM {t} WHERE user_id = ?", "x"), t)]
    conn.close()
    assert not scans, scans


# ── 9. the outbound drain runs ONE at a time ────────────────────────────────────────────────

def test_a_second_concurrent_drain_returns_busy_and_posts_nothing(stores, monkeypatch):
    from api.services.alert_taxonomy import outbound_webhooks as ow
    monkeypatch.setenv(ow.FLAG, "1")
    posted = []
    assert ow._DRAIN_LOCK.acquire(blocking=False)             # a drain is in flight
    try:
        out = ow.drain(poster=lambda *a: posted.append(a) or 200, now=1.0)
    finally:
        ow._DRAIN_LOCK.release()
    assert out["skipped"] == "busy" and posted == []
    assert ow.drain(poster=lambda *a: 200, now=1.0).get("skipped") is None   # free again: it runs


def test_the_drain_job_is_registered_single_instance_and_coalesced():
    """Read from api/main.py's AST: the `alert_webhooks_drain` add_job call."""
    tree = ast.parse((REPO / "api" / "main.py").read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
             and getattr(n.func, "attr", None) == "add_job"
             and any(k.arg == "id" and isinstance(k.value, ast.Constant)
                     and k.value.value == "alert_webhooks_drain" for k in n.keywords)]
    assert len(calls) == 1, f"found {len(calls)} registrations of alert_webhooks_drain"
    kw = {k.arg: k.value.value for k in calls[0].keywords if isinstance(k.value, ast.Constant)}
    assert kw.get("max_instances") == 1 and kw.get("coalesce") is True, kw
