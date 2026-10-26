"""Wave 6 (D14) — the Notebook telemetry events: the client names them, the
server accepts them, the admin read counts them.

⛔ THE MIRROR, NOT A SECOND COPY (`lesson_rail_the_mirror_not_just_the_lane`).
The event names are READ out of the client helper and asserted against the
server allow-list, so the two can never drift into a state where each looks
right alone. A client rail proving "we posted it" would be green against a
server that 400s every one.
"""
from __future__ import annotations

import importlib
import json
import os
import re
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.routers.journal_two import _J2_TELEMETRY_EVENTS

CLIENT = Path("app/src/pages/journal-2-0/lib/notebookTelemetry.js")


def _client_event_names() -> list[str]:
    src = CLIENT.read_text(encoding="utf-8")
    block = src.split("export const NOTEBOOK_EVENTS = Object.freeze({", 1)[1].split("})", 1)[0]
    return re.findall(r"^\s*[A-Z_]+:\s*'([a-z_]+)',?\s*$", block, re.MULTILINE)


def test_the_client_names_are_read_not_typed_and_the_read_is_not_empty():
    names = _client_event_names()
    # Non-vacuity: a parse that silently returned nothing would make the next
    # test pass over an empty set.
    assert "note_open_ms" in names and "switcher_used" in names
    assert len(names) == len(set(names))


def test_every_client_event_is_on_the_server_allow_list():
    missing = [n for n in _client_event_names() if n not in _J2_TELEMETRY_EVENTS]
    assert not missing, f"the server would 400 these, and the count would read zero: {missing}"


def test_the_allow_list_is_still_a_list():
    # CONTROL: deleting the membership check would leave the test above green.
    assert "anything_at_all" not in _J2_TELEMETRY_EVENTS


def _client_schemas() -> dict[str, dict[str, object]]:
    """EVENT_SCHEMAS, PARSED out of the client helper — never retyped."""
    src = CLIENT.read_text(encoding="utf-8")
    body = src.split("export const EVENT_SCHEMAS = Object.freeze({", 1)[1].split("\n})", 1)[0]
    schemas: dict[str, dict[str, object]] = {}
    current = None
    for line in body.splitlines():
        m = re.match(r"^  ([a-z_]+): \{$", line)
        if m:
            current = m.group(1)
            schemas[current] = {}
            continue
        m = re.match(r"^    ([a-zA-Z_]+): (num|bool|oneOf\((.*)\)),?$", line)
        if m and current:
            if m.group(3) is not None:
                schemas[current][m.group(1)] = frozenset(re.findall(r"'([^']*)'", m.group(3)))
            else:
                schemas[current][m.group(1)] = m.group(2)
    return schemas


def _server_schemas() -> dict[str, dict[str, object]]:
    from api.routers.journal_two import _NOTEBOOK_PROP_SCHEMAS
    return {ev: {k: (frozenset(v) if isinstance(v, tuple) else v) for k, v in spec.items()}
            for ev, spec in _NOTEBOOK_PROP_SCHEMAS.items()}


def test_the_server_prop_schema_is_the_client_schema_read_from_its_source():
    """ONE FACT IN TWO FILES, PINNED AGAINST EACH OTHER (saved-views precedent):
    the client sanitises before sending, the server sanitises on arrival, and
    this reads BOTH so neither can widen alone."""
    client = _client_schemas()
    # Non-vacuity: every event, every key, and a real enum were read.
    assert set(client) == set(_client_event_names())
    assert client["search_used"]["mode"] == frozenset({"text", "tag", "ticker", "filter"})
    assert sum(len(v) for v in client.values()) >= 20
    assert _server_schemas() == client


class _Logged:
    def __init__(self):
        self.rows = []

    def __call__(self, user_id, action, details="", ip_address=""):
        self.rows.append((user_id, action, details))


@pytest.fixture
def telemetry_app(monkeypatch):
    from api.routers import journal_two
    from api.services import auth_service
    logged = _Logged()
    monkeypatch.setattr(auth_service, "log_activity", logged)
    fa = FastAPI()
    fa.include_router(journal_two.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    yield TestClient(fa), logged
    fa.dependency_overrides.clear()


def test_the_server_drops_free_text_from_a_notebook_event_whoever_sent_it(telemetry_app):
    """A raw fetch that never went through the client helper: the member's
    query, an unlisted key, a free-text enum and a non-bool bool all arrive —
    none of the text is stored."""
    client, logged = telemetry_app
    r = client.post("/api/j2/telemetry", content=json.dumps({
        "event": "search_used",
        "props": {"q": "my private thesis on NVDA", "results": 3.5, "mode": "my private words",
                  "filters": 2, "ms": "fast"},
    }), headers={"content-type": "application/json"})
    assert r.status_code == 200
    [(uid, action, details)] = logged.rows
    assert action == "j2:search_used"
    assert json.loads(details) == {"results": 4, "mode": "other", "filters": 2}
    assert "private" not in details and "NVDA" not in details


def test_numbers_must_be_finite_bools_must_be_bools_and_enums_must_be_strings(telemetry_app):
    client, logged = telemetry_app
    client.post("/api/j2/telemetry", content=(
        '{"event": "switcher_used", "props": {"results": Infinity, "rank": 2.5, '
        '"picked": "yes", "mode": 5}}'), headers={"content-type": "application/json"})
    client.post("/api/j2/telemetry", json={"event": "note_open_ms", "props": ["not", "a", "dict"]})
    client.post("/api/j2/telemetry", json={"event": "ask_used", "props": {"inserted": True, "scope": "note"}})
    got = [json.loads(d) for _, _, d in logged.rows]
    assert got[0] == {"rank": 3, "mode": "other"}           # JS Math.round(2.5) is 3
    assert got[1] == {}
    assert got[2] == {"inserted": True, "scope": "note"}


def test_a_number_no_float_can_hold_is_dropped_never_a_500(telemetry_app):
    """R1-5. `1` and 400 zeros is a valid JSON number — Python parses it to an
    int — and `math.isfinite` on it raises OverflowError: measured, a 500 on
    the sender's own request. It is treated like any other invalid value for
    a `num` prop: dropped. A numeric-looking STRING is not a number either
    (the client keeps `typeof v === 'number'` only), so it is dropped too."""
    client, logged = telemetry_app
    raw = TestClient(client.app, raise_server_exceptions=False)
    huge = "1" + "0" * 400
    r = raw.post("/api/j2/telemetry", content=(
        '{"event": "search_used", "props": {"results": ' + huge + ', "filters": "' + huge + '",'
        ' "ms": -' + huge + ', "mode": "text"}}'), headers={"content-type": "application/json"})
    assert r.status_code == 200
    [(_, action, details)] = logged.rows
    assert action == "j2:search_used"
    assert json.loads(details) == {"mode": "text"}
    # CONTROL: a number a double CAN hold still converts and rounds — as the
    # client's JSON would carry it — so the guard is not "drop every big number".
    big = "1" + "0" * 300
    r = raw.post("/api/j2/telemetry", content='{"event": "switcher_used", "props": {"results": ' + big + '}}',
                 headers={"content-type": "application/json"})
    assert r.status_code == 200
    assert json.loads(logged.rows[1][2]) == {"results": int(float(big))}


def test_the_wave10_core_action_events_are_on_both_sides_and_read_not_typed():
    """Wave 10 (10D, R-16): the eight events that complete "every core action".
    Read out of the client like the seven — this only proves the read SAW them
    (non-vacuity for the parity rails above, which now cover fifteen)."""
    names = set(_client_event_names())
    wave10 = {"save_success", "export_used", "import_used", "share_used", "publish_used",
              "writing_help_used", "dictation_used", "bulk_used"}
    assert wave10 <= names, wave10 - names
    assert wave10 <= _J2_TELEMETRY_EVENTS


def test_bulk_used_op_is_the_batch_routes_own_op_list():
    """`bulk_used.op` names exactly what POST /notes/batch accepts — an op the
    route gains would otherwise be counted as 'other' forever."""
    from api.routers.journal_two import NOTE_BATCH_OPS, _NOTEBOOK_PROP_SCHEMAS
    assert set(_NOTEBOOK_PROP_SCHEMAS["bulk_used"]["op"]) == set(NOTE_BATCH_OPS)


def test_the_server_drops_free_text_from_the_wave10_events_whoever_sent_it(telemetry_app):
    """⛔ A raw fetch carrying a share token, a note title, a file name and a
    typed instruction: none of it is stored. (Mutation: keep an unlisted prop ->
    this reds.)"""
    client, logged = telemetry_app
    sends = [
        ("share_used", {"action": "create", "token": "s3cr3t-token", "note": "My NVDA thesis"},
         {"action": "create"}),
        ("export_used", {"format": "my private file.docx", "scope": "note", "count": 1, "title": "x"},
         {"format": "other", "scope": "note", "count": 1}),
        ("writing_help_used", {"action": "rewrite", "scope": "whole", "replaced": False,
                               "instruction": "make my thesis on NVDA sound smarter"},
         {"action": "rewrite", "scope": "whole", "replaced": False}),
        ("import_used", {"source": "notion", "created": 3, "failed": 0, "folder": "Private"},
         {"source": "notion", "created": 3, "failed": 0}),
        ("dictation_used", {"words": 7, "transcript": "buy the dip on NVDA"}, {"words": 7}),
        ("bulk_used", {"op": "addTag", "changed": 2, "failed": 0, "tag": "my secret tag"},
         {"op": "addTag", "changed": 2, "failed": 0}),
    ]
    for event, props, _ in sends:
        r = client.post("/api/j2/telemetry", json={"event": event, "props": props})
        assert r.status_code == 200
    got = [(a, json.loads(d)) for _, a, d in logged.rows]
    assert got == [(f"j2:{e}", want) for e, _, want in sends]
    blob = json.dumps(got)
    for leaked in ("s3cr3t", "NVDA", "private", "Private", "secret"):
        assert leaked not in blob, leaked


def test_the_p3a_library_events_are_on_both_sides_and_read_not_typed():
    """P3a Task 11: the community style library's two events. Read out of the
    client like the rest; the parity rails above already hold the schemas equal,
    so this proves the read SAW them (non-vacuity) and that the type enum is the
    gallery's own LISTED_ITEM_TYPES plus 'all' (a type the library gains would
    otherwise count as 'other' forever)."""
    from api.routers.journal_two import _NOTEBOOK_PROP_SCHEMAS
    from api.services.journal_two import template_gallery
    names = set(_client_event_names())
    assert {"library_viewed", "style_adopted"} <= names
    assert {"library_viewed", "style_adopted"} <= _J2_TELEMETRY_EVENTS
    # P3b (R-P3b-2): an example note is never a chip, so never a viewed type: the enum is "all" plus the LISTED
    # types (the client's own rail, notebookTelemetry.test.js, reads it the same way). This compared against
    # ITEM_TYPES and was red from P3b until wave 11 (ruling W11-R17 c2).
    assert set(_NOTEBOOK_PROP_SCHEMAS["library_viewed"]["type"]) == {"all", *template_gallery.LISTED_ITEM_TYPES}
    assert set(template_gallery.TOOL_ITEM_TYPES) <= set(_NOTEBOOK_PROP_SCHEMAS["library_viewed"]["type"])   # non-vacuity: wave 11 counted
    assert _NOTEBOOK_PROP_SCHEMAS["style_adopted"] == {"notify": "bool"}


def test_the_server_drops_ids_titles_and_handles_from_the_library_events(telemetry_app):
    """⛔ A raw fetch carrying the item's id, its title and its author's handle:
    none of it is stored."""
    client, logged = telemetry_app
    sends = [
        ("library_viewed", {"type": "style", "view": "author", "handle": "anon-7f3a", "q": "my NVDA swing"},
         {"type": "style", "view": "author"}),
        ("library_viewed", {"type": "my private words", "view": "following"},
         {"type": "other", "view": "following"}),
        ("style_adopted", {"notify": True, "id": "gal_123", "title": "My private NVDA style"},
         {"notify": True}),
        ("style_adopted", {"notify": "yes"}, {}),
    ]
    for event, props, _ in sends:
        assert client.post("/api/j2/telemetry", json={"event": event, "props": props}).status_code == 200
    got = [(a, json.loads(d)) for _, a, d in logged.rows]
    assert got == [(f"j2:{e}", want) for e, _, want in sends]
    blob = json.dumps(got)
    for leaked in ("anon-7f3a", "NVDA", "gal_123", "private"):
        assert leaked not in blob, leaked


def test_an_event_outside_the_seven_keeps_its_own_props(telemetry_app):
    # CONTROL: the schema is applied to the Notebook events only; the older
    # instrumented events keep what their own rails pin.
    client, logged = telemetry_app
    client.post("/api/j2/telemetry", json={"event": "notebook_offline_opt_in", "props": {"sid": "abc"}})
    assert json.loads(logged.rows[0][2]) == {"sid": "abc"}


def test_the_schemas_never_name_a_content_field():
    """The schema IS the set of keys that can leave the browser. A key named
    like content would be a door for it, whatever its type."""
    src = CLIENT.read_text(encoding="utf-8")
    body = src.split("export const EVENT_SCHEMAS", 1)[1].split("\n})", 1)[0]
    keys = set(re.findall(r"^\s{4}([a-zA-Z_]+):", body, re.MULTILINE))
    assert keys, "could not read the schema keys"
    for forbidden in ("title", "body", "bodyJson", "query", "q", "text", "question",
                      "content", "patch", "subtitle", "name", "url"):
        assert forbidden not in keys, f"schema carries {forbidden!r}"


# ── The admin counts read ────────────────────────────────────────────────────

@pytest.fixture
def db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid in ("u1", "u2", "u3"):
        conn.execute("INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
                     (uid, f"{uid}@x.test", "x", "member"))
    conn.commit()
    conn.close()
    yield tmp.name
    os.unlink(tmp.name)


def _log(uid, event, details, days_ago=0.0):
    from api.services import auth_db
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO activity_log (id, user_id, action, details, created_at)"
        " VALUES (lower(hex(randomblob(8))), ?, ?, ?, datetime('now', ?))",
        (uid, f"j2:{event}", json.dumps(details), f"-{days_ago * 24} hours"),
    )
    conn.commit()
    conn.close()


def test_counts_cover_both_windows_zero_fill_and_count_members(db):
    from api.services.journal_two import notebook_telemetry as nt
    _log("u1", "search_used", {"results": 3}, days_ago=1)
    _log("u1", "search_used", {"results": 0}, days_ago=2)
    _log("u2", "search_used", {"results": 1}, days_ago=10)   # 30-day window only
    _log("u3", "search_used", {"results": 1}, days_ago=40)   # neither window
    _log("u1", "unrelated_action", {}, days_ago=1)           # not an allow-listed event
    out = nt.event_counts(["search_used", "ask_used"])
    w7, w30 = out["windows"]["7"], out["windows"]["30"]
    assert w7["search_used"] == {"count": 2, "members": 1}
    assert w30["search_used"] == {"count": 3, "members": 2}
    assert w7["ask_used"] == {"count": 0, "members": 0}      # present, zero
    assert "unrelated_action" not in w30


def test_note_open_reports_percentiles_from_the_ms_prop_only(db):
    from api.services.journal_two import notebook_telemetry as nt
    for ms in (100, 200, 300, 400, 1000):
        _log("u1", "note_open_ms", {"ms": ms, "source": "list"})
    _log("u1", "note_open_ms", {"ms": "fast"})                 # not a number: ignored
    w7 = nt.event_counts(["note_open_ms"])["windows"]["7"]["note_open_ms"]
    assert w7["count"] == 6
    assert w7["p50_ms"] == 300.0
    assert w7["p95_ms"] == 880.0


def test_the_admin_door_counts_every_allow_listed_event_and_is_admin_only(db):
    from api.routers import client_errors as router_mod
    fa = FastAPI()
    fa.include_router(router_mod.router)
    client = TestClient(fa)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    assert client.get("/api/admin/notebook-telemetry").status_code == 403
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "admin"}
    _log("u1", "switcher_used", {"results": 4, "picked": True})
    body = client.get("/api/admin/notebook-telemetry").json()
    assert set(body["events"]) == set(_J2_TELEMETRY_EVENTS)
    assert body["windows"]["7"]["switcher_used"]["count"] == 1
    # P5 Task 6: the three journal-style events are counted too (derived from the allow-list, never typed there).
    for ev in ("style_applied", "style_created", "block_used"):
        assert ev in body["events"], ev
        assert ev in body["windows"]["7"] and ev in body["windows"]["30"], ev


# ── P5 Task 6: style_applied, style_created and block_used ───────────────────

P5_EVENTS = {"style_applied", "style_created", "block_used"}


def _client_block_used_kind_line() -> list[str]:
    """`block_used.kind`'s values IN SOURCE ORDER, read off its ONE line (the schema parser above is single-line,
    P5-R-C8: a oneOf wrapped over two lines would not parse, so this also proves it is one line)."""
    src = CLIENT.read_text(encoding="utf-8")
    lines = [ln for ln in src.splitlines() if re.match(r"^    kind: oneOf\(", ln)
             and "'positionSizing'" in ln]
    assert len(lines) == 1, f"block_used.kind must be ONE oneOf line, found {len(lines)}"
    return re.findall(r"'([^']*)'", lines[0])


def test_the_p5_events_are_on_both_sides_and_read_not_typed():
    names = set(_client_event_names())
    assert P5_EVENTS <= names, P5_EVENTS - names
    assert P5_EVENTS <= _J2_TELEMETRY_EVENTS
    # P5-R-C7: 17 + 3 = 20 names on the client.
    assert len(_client_event_names()) == 20


def test_block_used_kind_is_the_block_catalog_both_sides():
    """P5-R-C8: `block_used.kind` is exactly journal_styles.BLOCK_KINDS' ids (13 since P2 Tier 3), in that order,
    on the client and on the server; and every trader block (trader_blocks.BLOCK_IDS, the `block: true` registry
    rows) is one of them, so a block can never be counted as 'other'. A drift on either side reds here."""
    from api.routers.journal_two import _NOTEBOOK_PROP_SCHEMAS
    from api.services.journal_two import journal_styles, trader_blocks
    catalog = [k["id"] for k in journal_styles.BLOCK_KINDS]
    assert len(catalog) == 13                                    # control: the catalog was read
    assert list(_NOTEBOOK_PROP_SCHEMAS["block_used"]["kind"]) == catalog
    assert _client_block_used_kind_line() == catalog
    assert set(trader_blocks.BLOCK_IDS) <= set(catalog)
    assert len(trader_blocks.BLOCK_IDS) == 10                    # control: the trader blocks were read


def test_the_style_events_carry_only_their_closed_via():
    from api.routers.journal_two import _NOTEBOOK_PROP_SCHEMAS
    assert _NOTEBOOK_PROP_SCHEMAS["style_applied"] == {"via": ("new_note", "switch", "update")}
    assert _NOTEBOOK_PROP_SCHEMAS["style_created"] == {"via": ("editor", "duplicate", "from_note")}
    assert set(_NOTEBOOK_PROP_SCHEMAS["block_used"]) == {"kind"}


def test_unknown_kind_is_other(telemetry_app):
    client, logged = telemetry_app
    r = client.post("/api/j2/telemetry", json={"event": "block_used", "props": {"kind": "free text"}})
    assert r.status_code == 200
    [(_, action, details)] = logged.rows
    assert action == "j2:block_used"
    assert json.loads(details) == {"kind": "other"}


def test_the_server_drops_style_names_ids_and_params_from_the_p5_events(telemetry_app):
    client, logged = telemetry_app
    sends = [
        ("style_applied", {"via": "switch", "styleId": "s_123", "name": "My NVDA swing style"}, {"via": "switch"}),
        ("style_applied", {"via": "my private words"}, {"via": "other"}),
        ("style_created", {"via": "from_note", "noteId": "n_9", "title": "My private NVDA plan"},
         {"via": "from_note"}),
        ("block_used", {"kind": "positionSizing", "params": {"entry": 123.45}, "ticker": "NVDA"},
         {"kind": "positionSizing"}),
    ]
    for event, props, _ in sends:
        assert client.post("/api/j2/telemetry", json={"event": event, "props": props}).status_code == 200
    got = [(a, json.loads(d)) for _, a, d in logged.rows]
    assert got == [(f"j2:{e}", want) for e, _, want in sends]
    blob = json.dumps(got)
    for leaked in ("s_123", "NVDA", "private", "n_9", "123.45"):
        assert leaked not in blob, leaked
