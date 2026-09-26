"""The 30-day soak's server read (wave 9, lane 9C): aggregates only, by population.

Every figure below is driven from a seeded auth.db + client-error store in a tmp
directory (the repo-root conftest fails the run if anything reaches the shared
data root). The fixture carries the rig address, both smoke accounts, an
undeclared `.internal` address, a prefix lookalike, two organic traders and an
identity whose `users` row is gone — and PLANTED content (a title, a body, a
free-text prop) that must never appear in a response.
"""
from __future__ import annotations

import importlib
import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

NOW = datetime(2026, 10, 5, 18, 0, 0, tzinfo=timezone.utc)      # 14:00 ET
SINCE = NOW - timedelta(hours=2)                                   # 12:00 ET

USERS = {
    "u-rig": "unchartedterritory5995@gmail.com",
    "u-smoke": "smoke@uctintelligence.internal",
    "u-msmoke": "member-smoke@uctintelligence.internal",
    "u-unk": "ghost@uctintelligence.internal",
    "u-xsmoke": "xsmoke@uctintelligence.internal",
    "u-org1": "trader.one@example.com",
    "u-org2": "trader.two@example.com",
}
PLANTED_TITLE = "Planted Title Alpha NVDA thesis"
PLANTED_BODY = "planted body text that must never leave"
PLANTED_REASON = "my secret plan for tomorrow"


def _at(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setenv("CLIENT_ERRORS_DB_PATH", str(tmp_path / "client_errors.db"))
    monkeypatch.delenv("CLIENT_ERROR_BEACON_ENABLED", raising=False)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid, email in USERS.items():
        conn.execute("INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
                     (uid, email, "x", "member"))
    conn.commit()
    conn.close()
    yield tmp_path


def _raw(tmp_path):
    """A connection with foreign keys OFF, so a row can name a purged user."""
    c = sqlite3.connect(tmp_path / "auth.db")
    c.execute("PRAGMA foreign_keys=OFF")
    return c


def _log(tmp_path, uid, event, details, when):
    c = _raw(tmp_path)
    c.execute("INSERT INTO activity_log (id, user_id, action, details, created_at)"
              " VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?)",
              (uid, f"j2:{event}", json.dumps(details), _at(when)))
    c.commit()
    c.close()


def _note(tmp_path, uid, updated, created=None, tags=(), import_source=None):
    c = _raw(tmp_path)
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
              " import_source, created_at, updated_at) VALUES (lower(hex(randomblob(8))),"
              " ?, ?, '{}', ?, ?, ?, ?, ?)",
              (uid, PLANTED_TITLE, PLANTED_BODY, json.dumps(list(tags)), import_source,
               created or updated, updated))
    c.commit()
    c.close()


def _err(uid, page, when):
    from api.services import client_errors as ce
    conn = ce._connect()
    conn.execute("INSERT INTO client_errors (created_at, rate_key, user_id, kind, page)"
                 " VALUES (?, ?, ?, 'error', ?)", (when.timestamp(), "k", uid, page))
    conn.commit()
    conn.close()


IN = SINCE + timedelta(minutes=30)


@pytest.fixture
def seeded(db):
    t = db
    # ── integrity events ────────────────────────────────────────────────────
    _log(t, "u-org1", "save_failed", {"reason": "network"}, IN)
    _log(t, "u-org1", "save_failed", {"reason": "network"}, IN)
    _log(t, "u-org2", "save_failed", {"reason": PLANTED_REASON}, IN)    # free text → other
    _log(t, "u-rig", "save_failed", {"reason": "http"}, IN)
    _log(t, "u-ghost", "save_failed", {"reason": "quota"}, IN)          # no users row
    _log(t, "u-org1", "save_failed", {"reason": "network"}, SINCE - timedelta(minutes=1))  # before
    _log(t, "u-org1", "save_failed", {"reason": "network"}, NOW)        # `until` is exclusive
    _log(t, "u-org1", "conflict_forked", {"door": "outbox"}, IN)
    _log(t, "u-smoke", "conflict_forked", {"door": "editor"}, IN)
    _log(t, "u-org2", "notebook_blocked_no_baseline", {}, IN)
    _log(t, "u-org1", "notebook_offline_opt_in", {}, IN)
    _log(t, "u-org1", "notebook_offline_opt_in", {}, IN)
    _log(t, "u-xsmoke", "notebook_offline_opt_in", {}, IN)
    # ── config served, by identity ──────────────────────────────────────────
    _log(t, "u-org1", "notebook_config_served", {"served": False}, IN)
    _log(t, "u-org1", "notebook_config_served", {"served": True}, IN)
    _log(t, "u-org2", "notebook_config_served", {"served": False}, IN)
    _log(t, "u-rig", "notebook_config_served", {"served": True}, IN)
    # ── speed ───────────────────────────────────────────────────────────────
    for ms in (100, 200, 300, 400, 1000):
        _log(t, "u-org1", "note_open_ms", {"ms": ms, "source": "list"}, IN)
    _log(t, "u-org1", "note_open_ms", {"ms": "fast"}, IN)                # not a number
    _log(t, "u-org2", "note_open_ms", {"ms": 50}, IN)
    _log(t, "u-rig", "note_open_ms", {"ms": 9999}, IN)
    _log(t, "u-org1", "search_used", {"ms": 80, "results": 3}, IN)
    # ── exposure (ET day of NOW = 2026-10-05; ET midnight = 04:00 UTC) ──────
    _note(t, "u-org1", "2026-10-05T17:00:00+00:00")         # in the window
    _note(t, "u-org1", "2026-10-05T10:00:00.123456+00:00")  # today ET, before `since`
    _note(t, "u-org2", "2026-10-05T03:30:00Z")              # 23:30 ET on Oct 4
    _note(t, "u-org2", "2026-10-05")                        # bare date = 20:00 ET Oct 4
    _note(t, "u-rig", "2026-10-05T16:45:00+00:00")
    # ── conflicted copies ───────────────────────────────────────────────────
    _note(t, "u-org1", "2026-10-05T17:10:00+00:00", tags=["sync-conflict"])
    _note(t, "u-org2", "2026-10-05T16:20:00Z", tags=["x", "sync-conflict"], import_source="notion")
    _note(t, "u-org1", "2026-10-01T10:00:00+00:00", tags=["sync-conflict"])   # before
    _note(t, "u-org1", "2026-10-05T17:20:00+00:00", tags=["sync-conflicts"])  # not the tag
    # ── Notebook-page client errors ─────────────────────────────────────────
    _err("u-org1", "/journal/notebook", IN)
    _err("u-org1", "/journal/notebook", IN)
    _err("u-org1", "/journal/notebook/:id", IN)
    _err("u-org2", "/journal/notebooks", IN)                # not under the prefix
    _err("u-org2", "/dashboard", IN)
    _err(None, "/journal/notebook", IN)                     # no session
    _err("u-smoke", "/journal/notebook/:id", IN)
    _err("u-org1", "/journal/notebook", SINCE - timedelta(minutes=5))
    return t


def _summary(**kw):
    from api.services.journal_two import notebook_soak
    return notebook_soak.soak_summary(SINCE, NOW, now=NOW, **kw)


# ── Figures ─────────────────────────────────────────────────────────────────

def test_integrity_events_are_split_by_population_and_prop(seeded):
    ev = _summary()["events"]
    sf = ev["save_failed"]
    assert sf["organic"]["events"] == 3 and sf["organic"]["identities"] == 2
    assert sf["organic"]["by_reason"]["network"] == 2
    assert sf["organic"]["by_reason"]["other"] == 1          # the free text, never a key
    assert sf["rig_owner"]["events"] == 1 and sf["rig_owner"]["by_reason"]["http"] == 1
    assert sf["unresolved"]["events"] == 1                   # a purged user is never organic
    assert sf["synthetic"]["events"] == 0
    cf = ev["conflict_forked"]
    assert cf["organic"]["by_door"]["outbox"] == 1 and cf["synthetic"]["by_door"]["editor"] == 1
    assert ev["notebook_blocked_no_baseline"]["organic"] == {"events": 1, "identities": 1}
    opt = ev["notebook_offline_opt_in"]
    assert opt["organic"] == {"events": 2, "identities": 1}  # BY IDENTITY, not by row
    assert opt["unknown_internal"] == {"events": 1, "identities": 1}   # the lookalike


def test_config_served_is_by_identity_and_zero_over_zero_stays_zero_over_zero(seeded):
    cs = _summary()["config_served"]
    assert cs["organic"] == "1/2"            # org1 served on its second tab; org2 never
    assert cs["rig_owner"] == "1/1"
    assert cs["synthetic"] == "0/0"          # ⛔ never 100%, never a percentage
    assert all("%" not in v for v in cs.values())


def test_speed_is_by_population_from_the_ms_prop_only(seeded):
    sp = _summary()["speed"]
    assert sp["label"] == "field: network + device"
    org = sp["note_open_ms"]["by_population"]["organic"]
    # org1 100..1000 (+ "fast" ignored) and org2 50: six numbers
    assert org["n"] == 6 and org["p50_ms"] == 250.0 and org["p95_ms"] == 850.0
    assert sp["note_open_ms"]["by_population"]["rig_owner"]["p95_ms"] == 9999.0
    assert sp["note_open_ms"]["capped"] is False
    assert sp["search_used"]["by_population"]["organic"]["p50_ms"] == 80.0
    assert sp["ask_used"]["by_population"]["organic"] == {"n": 0, "p50_ms": None, "p95_ms": None}


def test_a_capped_timed_read_says_so_beside_the_figure(seeded, monkeypatch):
    from api.services.journal_two import notebook_soak
    monkeypatch.setattr(notebook_soak, "MAX_TIMED_ROWS", 3)
    sp = _summary()["speed"]
    assert sp["note_open_ms"]["capped"] is True and sp["row_limit"] == 3
    assert sp["search_used"]["capped"] is False


def test_exposure_reads_whole_ET_days_and_the_window_total_exactly(seeded):
    ex = _summary()["exposure"]
    assert ex["since_et_day"] == "2026-10-05"
    # today (ET): org1's 17:00Z, 10:00Z, the 17:10Z conflicted copy and the
    # 17:20Z not-quite-tagged note, plus org2's 16:20Z connector sibling; the two
    # Oct-4-ET stamps (03:30Z, the bare date) fall outside the whole-day reading
    assert ex["note_edits_by_day"]["organic"] == {"2026-10-05": 5}
    assert ex["identities_editing_by_day"]["organic"] == {"2026-10-05": 2}
    # the window total is [since, until): org1 17:00Z, 17:10Z, 17:20Z; org2 16:20Z
    assert ex["notes_edited"]["organic"] == 4
    assert ex["identities_editing"]["organic"] == 2
    assert ex["identities_editing"]["rig_owner"] == 1
    assert "LAST edit" in ex["basis"]


def test_conflicted_copies_are_split_by_writer(seeded):
    cc = _summary()["conflicted_copies"]
    assert cc["offline_layer"]["organic"] == 1
    assert cc["connector"]["organic"] == 1
    assert cc["connector_lower_bound"] is True


def test_notebook_page_client_errors_by_population(seeded):
    ce = _summary()["client_errors"]
    assert ce["by_population"]["organic"] == {"errors": 3, "identities": 1}
    assert ce["by_population"]["synthetic"] == {"errors": 1, "identities": 1}
    assert ce["anonymous_errors"] == 1
    assert ce["page_prefix"] == "/journal/notebook"
    assert ce["retention_days"] == 14 and ce["window_exceeds_retention"] is False


def test_a_window_past_the_error_stores_retention_says_so(seeded):
    from api.services.journal_two import notebook_soak
    out = notebook_soak.soak_summary(NOW - timedelta(days=20), NOW, now=NOW)
    assert out["client_errors"]["window_exceeds_retention"] is True


def test_the_page_count_is_exact_where_summary_caps(db):
    """⛔ summary() returns at most 200 groups — a full page is a cap, not a count."""
    from api.services import client_errors as ce
    for i in range(250):
        _err(f"member-{i}", "/journal/notebook", IN)
    counts = ce.count_by_user_for_page("/journal/notebook", SINCE.timestamp(), NOW.timestamp())
    assert len(counts) == 250 and sum(counts.values()) == 250
    assert len(ce.summary(days=14, limit=200, now=NOW.timestamp())["recent"]) == 200


@pytest.mark.parametrize("prefix", ["journal/notebook", "/journal/notebook/", ""])
def test_the_page_count_refuses_a_prefix_that_is_not_a_reduced_route(db, prefix):
    from api.services import client_errors as ce
    with pytest.raises(ValueError):
        ce.count_by_user_for_page(prefix, 0, 1)


# ── Aggregates only ─────────────────────────────────────────────────────────

BANNED_KEYS = {"id", "user_id", "userid", "uid", "email", "emails", "title", "body",
               "body_json", "body_plain", "text", "content", "note_id", "tags", "who", "rows"}


def _walk(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield ("key", str(k), path)
            yield from _walk(v, f"{path}.{k}")
    elif isinstance(node, (list, tuple)):
        for i, v in enumerate(node):
            yield from _walk(v, f"{path}[{i}]")
    else:
        yield ("value", node, path)


def test_no_key_or_value_anywhere_is_an_id_email_title_or_body(seeded):
    out = _summary()
    items = list(_walk(out))
    assert len(items) > 100, "the walk must actually visit the response"
    keys = [(k, p) for kind, k, p in items if kind == "key"]
    bad = [(k, p) for k, p in keys if k.lower() in BANNED_KEYS]
    assert not bad, bad
    text = json.dumps(out)
    for needle in (*USERS, *USERS.values(), "u-ghost", PLANTED_TITLE, PLANTED_BODY,
                   PLANTED_REASON, "notion", '"x"'):
        assert needle not in text, needle


def test_the_walk_would_see_a_raw_row(seeded):
    """⭐ CONTROL: the walk above is not blind — a response carrying one raw
    event row fails it."""
    out = _summary()
    out["events"]["save_failed"]["organic"]["rows"] = [{"user_id": "u-org1",
                                                        "email": USERS["u-org1"]}]
    keys = [k for kind, k, _ in _walk(out) if kind == "key"]
    assert "user_id" in keys and "email" in keys


# ── The door ─────────────────────────────────────────────────────────────────

@pytest.fixture
def client(seeded):
    from api.routers import notebook_soak as router_mod
    fa = FastAPI()
    fa.include_router(router_mod.router)
    yield fa, TestClient(fa)
    fa.dependency_overrides.clear()


def test_a_member_gets_403(client):
    fa, c = client
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u-org1", "role": "member"}
    assert c.get("/api/admin/notebook-soak", params={"since": SINCE.isoformat()}).status_code == 403


def test_an_admin_gets_the_aggregates(client):
    fa, c = client
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u-rig", "role": "admin"}
    r = c.get("/api/admin/notebook-soak",
              params={"since": SINCE.strftime("%Y-%m-%dT%H:%M:%SZ"),
                      "until": NOW.strftime("%Y-%m-%dT%H:%M:%SZ")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"window", "populations", "events", "config_served", "speed",
                         "exposure", "conflicted_copies", "client_errors"}
    assert body["events"]["save_failed"]["organic"]["events"] == 3


def test_until_defaults_to_now(client):
    fa, c = client
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u-rig", "role": "admin"}
    since = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    r = c.get("/api/admin/notebook-soak", params={"since": since})
    assert r.status_code == 200, r.text
    assert abs(r.json()["window"]["hours"] - 2.0) < 0.1


@pytest.mark.parametrize("params,needle", [
    ({"since": "yesterday"}, "`since` is not an ISO 8601 timestamp"),
    ({"since": "2026-10-05T12:00:00Z", "until": "soon"}, "`until` is not an ISO 8601 timestamp"),
    ({"since": "2026-08-01T00:00:00Z", "until": "2026-10-01T00:00:00Z"}, "longer than 45 days"),
    ({"since": "2026-10-05T12:00:00Z", "until": "2026-10-05T11:00:00Z"}, "must be later"),
])
def test_a_bad_window_is_a_400_with_a_sentence(client, params, needle):
    fa, c = client
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u-rig", "role": "admin"}
    r = c.get("/api/admin/notebook-soak", params=params)
    assert r.status_code == 400 and needle in r.json()["detail"], r.text


def test_since_is_required(client):
    fa, c = client
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u-rig", "role": "admin"}
    assert c.get("/api/admin/notebook-soak").status_code in (400, 422)


# ── The plans: never a scan of a growing table ──────────────────────────────

def _plan(conn, sql, params):
    return [r[-1] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()]


def test_the_soak_queries_never_scan_a_growing_table(seeded):
    from api.services import auth_db
    from api.services.journal_two import notebook_soak as ns
    conn = auth_db.get_connection()
    try:
        plans = {
            "events": _plan(conn, ns.SQL_EVENTS, ("a", "b", *ns._ACTIONS)),
            "timed": _plan(conn, ns.SQL_TIMED, ("a", "b", "j2:note_open_ms", 5)),
            "exposure": _plan(conn, ns.SQL_EXPOSURE, ("a", "b")),
            "conflicts": _plan(conn, ns.SQL_CONFLICTS, ("a", "b")),
        }
    finally:
        conn.close()
    joined = {k: " | ".join(v) for k, v in plans.items()}
    for name, plan in joined.items():
        print(f"EXPLAIN QUERY PLAN [{name}]: {plan}")      # quoted in the lane report
        assert not re.search(r"\bSCAN (a|n|activity_log|j2_notes)\b", plan), (name, plan)
    assert "idx_activity_created" in joined["events"], joined["events"]
    assert "idx_activity_created" in joined["timed"], joined["timed"]
    assert "idx_j2_notes_user_updated" in joined["exposure"], joined["exposure"]
    assert "idx_j2_notes_user_created" in joined["conflicts"], joined["conflicts"]


def test_the_client_error_count_is_an_index_range(db, monkeypatch):
    from api.services import client_errors as ce
    seen = []
    real = ce._connect

    def traced():
        c = real()
        c.set_trace_callback(seen.append)
        return c

    monkeypatch.setattr(ce, "_connect", traced)
    ce.count_by_user_for_page("/journal/notebook", 0.0, 10.0)
    select = next(s for s in seen if s.lstrip().upper().startswith("SELECT USER_ID"))
    conn = real()
    try:
        plan = " | ".join(r[-1] for r in conn.execute("EXPLAIN QUERY PLAN " + select))
    finally:
        conn.close()
    print(f"EXPLAIN QUERY PLAN [client_errors]: {plan}")
    assert "idx_client_errors_created" in plan and "SCAN client_errors" not in plan, plan


# ── notebook_telemetry: additive helpers, `event_counts` unchanged ───────────

def test_the_public_helpers_ARE_the_ones_event_counts_uses():
    from api.services.journal_two import notebook_telemetry as nt
    assert nt.percentile is nt._percentile and nt.ms_of is nt._ms_of


def test_event_counts_output_is_unchanged(db):
    """The exact shape wave 6 shipped, on a hand-computed fixture."""
    from api.services.journal_two import notebook_telemetry as nt
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        for uid, ms, hours in (("u-org1", 100, 1), ("u-org1", 300, 2), ("u-org2", 200, 30 * 24 + 1)):
            conn.execute("INSERT INTO activity_log (id, user_id, action, details, created_at)"
                         " VALUES (lower(hex(randomblob(8))), ?, 'j2:note_open_ms', ?,"
                         " datetime('now', ?))", (uid, json.dumps({"ms": ms}), f"-{hours} hours"))
        conn.commit()
    finally:
        conn.close()
    assert nt.event_counts(["note_open_ms", "ask_used"]) == {
        "events": ["ask_used", "note_open_ms"],
        "windows": {
            "7": {"ask_used": {"count": 0, "members": 0},
                  "note_open_ms": {"count": 2, "members": 1, "p50_ms": 200.0, "p95_ms": 290.0}},
            "30": {"ask_used": {"count": 0, "members": 0},
                   "note_open_ms": {"count": 2, "members": 1, "p50_ms": 200.0, "p95_ms": 290.0}},
        },
    }
