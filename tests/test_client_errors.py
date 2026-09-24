"""The client error beacon's server half (D14): scrub, rate limit, kill
switch, retention, the byte ceiling, the log line, and the doors.

Every test points `CLIENT_ERRORS_DB_PATH` at its own tmp file, so nothing here
can reach the shared data root (the repo-root conftest would fail the run if
it did).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import client_errors as ce

TOKEN = "tok_7f3a9c1e5b2d4f60"   # the planted secret: must never be stored


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "client_errors.db"
    monkeypatch.setenv("CLIENT_ERRORS_DB_PATH", str(path))
    monkeypatch.delenv(ce.KILL_SWITCH, raising=False)
    monkeypatch.setattr(ce, "_last_prune", 0.0)
    return path


def _rows(path):
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute("SELECT * FROM client_errors ORDER BY id")]
    finally:
        c.close()


def _report(**over):
    r = {"kind": "error", "name": "TypeError",
         "message": "Cannot read properties of undefined (reading …)",
         "template": "cannot-read-properties",
         "stack": "    at render (https://uctintelligence.com/assets/index-abc.js:12:34)",
         "page": "/journal/notebook", "ts": 1.0}
    r.update(over)
    return r


# ── The transport scrub ──────────────────────────────────────────────────────

def test_a_token_in_a_url_FRAGMENT_is_never_stored(store):
    """The login-link token rides in a fragment (`/smoke-login#token=…`). A
    fragment is the one part of a URL a server never sees on the wire — and the
    one part a JS error message happily quotes back."""
    ce.record_reports([_report(
        page=f"/smoke-login#token={TOKEN}",
        message=f"Failed to load https://uctintelligence.com/smoke-login#token={TOKEN}",
        stack=f"    at go (https://uctintelligence.com/assets/app.js?t={TOKEN}:9:3)",
    )], user_id=None, ip="1.2.3.4", user_agent="UA")
    [row] = _rows(store)
    assert TOKEN not in json.dumps(row)
    assert row["page"] == "/smoke-login"
    assert "https://uctintelligence.com/smoke-login" in row["message"]
    # The frame keeps its location — :line:col is not a secret, the query was.
    assert row["stack"].endswith("assets/app.js:#:#)")


def test_query_strings_relative_urls_bare_fragments_and_credentials_all_go(store):
    ce.record_reports([_report(
        message=(f"GET /api/j2/notes?q=my+private+search failed; hash #access_token={TOKEN}; "
                 f"retry with key={TOKEN}; see smoke-login#t=SECRETvalue1 ok"),
        page="/journal/notebook?note=abc123&task=2",
    )], user_id=None, ip="1.2.3.4", user_agent="UA")
    [row] = _rows(store)
    assert TOKEN not in row["message"]
    assert "my+private+search" not in row["message"]
    assert "SECRETvalue" not in row["message"]
    assert "/api/:id/notes" in row["message"]            # the path is REDUCED, segment by segment
    assert "key=[removed]" in row["message"]
    assert row["page"] == "/journal/notebook"


def test_every_digit_in_a_text_field_is_masked(store):
    """Defence in depth: a client that skips its own scrub still stores no
    price, size or time."""
    ce.record_reports([_report(message="Buy 500 NVDA at 132.50, stop 128.75")],
                      user_id=None, ip="1.2.3.4", user_agent="UA")
    [row] = _rows(store)
    assert not re.search(r"\d", row["message"] + row["stack"] + row["component_stack"])


def test_a_data_uri_never_carries_its_payload(store):
    ce.record_reports([_report(message="bad image data:image/png;base64,QUJDREVGRw==")],
                      user_id=None, ip="1.2.3.4", user_agent="UA")
    [row] = _rows(store)
    assert "QUJDREVGRw" not in row["message"]
    assert "data:[removed]" in row["message"]


def test_fields_are_capped_in_UTF8_BYTES_and_control_characters_removed(store):
    ce.record_reports([_report(message="x" * 5000, stack="y" * 50000, name="N\x00ame" * 100)],
                      user_id=None, ip="1.2.3.4", user_agent="U" * 9000)
    ce.record_reports([_report(message="\U0001F600" * 5000, stack="\U0001F600" * 5000,
                               componentStack="\U0001F600" * 5000)],
                      user_id=None, ip="1.2.3.5", user_agent="\U0001F600" * 5000)
    first, emoji = _rows(store)
    assert len(first["message"]) == ce.CAP_MESSAGE
    assert len(first["stack"]) == ce.CAP_STACK
    assert first["name"] == "Error"                        # not an engine-shaped name
    assert len(first["user_agent"]) == ce.CAP_USER_AGENT
    # 4-byte characters: the cap is on BYTES, so a row cannot grow fourfold.
    assert len(emoji["message"].encode("utf-8")) <= ce.CAP_MESSAGE
    assert len(emoji["stack"].encode("utf-8")) <= ce.CAP_STACK
    assert len(emoji["component_stack"].encode("utf-8")) <= ce.CAP_COMPONENT_STACK
    assert len(emoji["user_agent"].encode("utf-8")) <= ce.CAP_USER_AGENT
    total = sum(len(str(v).encode("utf-8")) for v in emoji.values() if v is not None)
    assert total <= ce.MAX_ROW_BYTES


def test_an_unknown_kind_is_not_stored(store):
    out = ce.record_reports([_report(kind="evil"), "not a dict", _report()],
                            user_id=None, ip="1.2.3.4", user_agent="UA")
    assert out == {"stored": 1, "dropped": 0, "invalid": 2}


# ── R1-2: one report is judged alone; it never fails the batch around it ─────

def _post_raw(app, body: str):
    """The door, with a server fault surfacing as its status code (a 500), not
    as an exception inside the test."""
    return TestClient(app, raise_server_exceptions=False).post(
        "/api/client-errors", content=body.encode("utf-8"),
        headers={"content-type": "application/json"})


def test_a_lone_surrogate_in_one_report_never_fails_the_batch(app, store):
    """`JSON.stringify` escapes an unpaired surrogate as `\\udXXX`, and that
    escape parses back to a code point UTF-8 cannot encode. Measured before
    this rail: a 500 with 0 rows stored — the valid reports went with it."""
    body = ('{"reports": ['
            '{"kind": "error", "name": "TypeError", "message": "first is not a function"},'
            '{"kind": "error", "name": "TypeError", "message": "a\\ud83d",'
            ' "stack": "    at f (https://x.test/\\udc00.js:1:2)",'
            ' "componentStack": "    at C (https://x.test/a.js:1:2)\\ud800",'
            ' "page": "/journal/\\ud83d", "template": "\\udfff"},'
            '{"kind": "error", "name": "TypeError", "message": "third is not a function"}]}')
    r = _post_raw(app, body)
    assert r.status_code == 200
    assert r.json()["stored"] == 3 and r.json()["invalid"] == 0
    rows = _rows(store)
    assert [row["message"] for row in rows] == ["first is not a function", "a\ufffd",
                                                "third is not a function"]
    # The middle report is kept, every unencodable code point replaced — so
    # every field of every row encodes.
    for row in rows:
        for v in row.values():
            if isinstance(v, str):
                v.encode("utf-8")


def test_one_report_that_cannot_be_stored_is_dropped_alone(store, monkeypatch):
    """Whatever else a report can carry that its scrub or its row cannot take,
    the fault stays with that report: it is counted `invalid`, and the rest of
    the batch is stored normally."""
    real = ce._scrubbed

    def flaky(b):
        if b["message"] == "poison":
            raise ValueError("this report cannot be sanitised")
        return real(b)

    monkeypatch.setattr(ce, "_scrubbed", flaky)
    out = ce.record_reports([_report(message="one"), _report(message="poison"), _report(message="two")],
                            user_id=None, ip="1.2.3.4", user_agent="UA")
    assert out == {"stored": 2, "dropped": 0, "invalid": 1}
    assert [r["message"] for r in _rows(store)] == ["one", "two"]


def test_a_broken_STORE_is_not_mistaken_for_a_bad_report(store, monkeypatch):
    """CONTROL: the per-report boundary catches what a REPORT can cause. A
    database fault is not one — swallowing it would read as `invalid` reports
    while every write failed."""
    def broken(b):
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(ce, "_scrubbed", broken)
    with pytest.raises(sqlite3.OperationalError):
        ce.record_reports([_report()], user_id=None, ip="1.2.3.4", user_agent="UA")


def test_a_timestamp_no_float_can_hold_is_dropped_never_a_500(app, store):
    """`1` and 400 zeros is a valid JSON number and an OverflowError on
    `float()`; `1e400` parses to inf. Neither is a time, and neither may cost
    the report — or the batch — its row."""
    body = ('{"reports": [{"kind": "error", "message": "x is not a function", "ts": 1' + "0" * 400 + '},'
            ' {"kind": "error", "message": "y is not a function", "ts": 1e400},'
            ' {"kind": "error", "message": "z is not a function", "ts": 1234.5}]}')
    r = _post_raw(app, body)
    assert r.status_code == 200 and r.json()["stored"] == 3
    assert [row["client_ts"] for row in _rows(store)] == [None, None, 1234.5]


def test_the_row_holds_a_hash_never_the_raw_address(store):
    ce.record_reports([_report()], user_id=None, ip="203.0.113.77", user_agent="UA")
    raw = store.read_bytes()
    assert b"203.0.113.77" not in raw
    assert _rows(store)[0]["rate_key"] == ce.rate_key_for(None, "203.0.113.77")


def test_a_template_id_is_kept_only_in_its_own_shape_else_derived_from_the_message(store):
    ce.record_reports([
        _report(template="not-a-function"),
        _report(template="#kfbpaocd"),
        _report(template="Buy NVDA at 132", message="some text"),
        _report(template=None, message="some text"),
    ], user_id=None, ip="1.2.3.4", user_agent="UA")
    t = [r["template"] for r in _rows(store)]
    assert t[0] == "not-a-function" and t[1] == "#kfbpaocd"
    assert re.fullmatch(r"#[a-p]{8}", t[2]) and t[2] == t[3]


# ── B-1: paths are reduced segment by segment; a share token never lands ─────

SHARE_ROUTES = [
    ("/share/n/:token", "k9Qz_Xr2-Lm4pT8vWn1Ys6uEa3Bc0Dh5"),
    ("/track/:token", "Tq7pLm2Xz9Rw4Yb1Kc8Nd3"),
    ("/screener/shared/:token", "qwertasdfgz"),                 # all lowercase: a route word by shape
    ("/formulas/shared/:token", "sh_0123456789abcdef0123456789abcdef"),
]


@pytest.mark.parametrize("route,token", SHARE_ROUTES)
def test_a_share_token_in_a_path_is_never_stored_or_logged(store, caplog, route, token):
    caplog.set_level(logging.WARNING, logger=ce.__name__)
    path = route.replace(":token", token)
    ce.record_reports([_report(
        page=path,
        message=f"Failed to load https://uctintelligence.com{path}",
        stack=f"    at f (https://uctintelligence.com{path}:1:2)",
        componentStack=f"    at C (https://uctintelligence.com{path}:1:2)",
    )], user_id=None, ip="1.2.3.4", user_agent="UA")
    [row] = _rows(store)
    assert token not in json.dumps(row)
    assert row["page"] == route.replace(":token", ":id")
    lines = "\n".join(r.getMessage() for r in caplog.records)
    assert token not in lines
    assert route.replace(":token", ":id") in lines


def test_the_server_token_routes_are_the_clients_four_constants():
    """ONE FACT IN TWO FILES, PINNED: the route patterns are READ out of the
    four client modules (template literals resolved) and compared, so neither
    side can gain or lose a route alone."""
    sources = {
        "app/src/pages/journal-2-0/lib/noteShareLink.js": "SHARED_NOTE_ROUTE",
        "app/src/pages/journal-2-0/lib/trackRecordLink.js": "TRACK_RECORD_ROUTE",
        "app/src/pages/screener/screenShareLink.js": "SHARED_SCREEN_ROUTE",
        "app/src/pages/formulas/formulaShareLink.js": "SHARED_FORMULA_ROUTE",
    }
    derived = []
    for path, const in sources.items():
        src = Path(path).read_text(encoding="utf-8")
        consts = dict(re.findall(r"export const (\w+) = ['`]([^'`]*)['`]", src))
        value = consts[const]
        value = re.sub(r"\$\{(\w+)\}", lambda m: consts[m.group(1)], value)
        derived.append(value)
    assert len(derived) == 4 and all(v.endswith("/:token") for v in derived)   # non-vacuity
    assert sorted(derived) == sorted(ce.TOKEN_ROUTES)


def test_reduce_path_keeps_route_words_only():
    assert ce.reduce_path("/journal/notebook") == "/journal/notebook"
    assert ce.reduce_path("/journal-2-0/report") == "/:id/report"
    assert ce.reduce_path("/screener/shared/abcdefghij") == "/screener/shared/:id"
    assert ce.reduce_path("/NVDA/Buy_NVDA") == "/:id/:id"


# ── B-3: the door's order of work, off the loop, and linear ──────────────────

def test_the_url_finder_is_linear():
    """The old `_SCHEMED_URL` regex took 0.73 s on 32k letters (quadratic).
    Stated bound: a 60,000-character run of each hostile shape in < 100 ms."""
    for s in ("a" * 60_000, "ab:" * 20_000, "https://" * 7_500, "a" * 59_997 + "://"):
        t0 = time.perf_counter()
        ce.scrub_text(s)
        assert time.perf_counter() - t0 < 0.1, s[:12]


def test_a_60KB_single_field_body_is_recorded_in_under_50ms(store):
    ce.record_reports([_report()], user_id=None, ip="9.9.9.1", user_agent="UA")   # warm the schema
    body = [_report(stack="a" * 60_000)]
    t0 = time.perf_counter()
    ce.record_reports(body, user_id=None, ip="9.9.9.2", user_agent="UA")
    assert time.perf_counter() - t0 < 0.05


def test_fields_are_capped_BEFORE_any_pattern_runs(store, monkeypatch):
    seen = []
    real = ce.scrub_text
    monkeypatch.setattr(ce, "scrub_text", lambda s: (seen.append(len(s)), real(s))[1])
    ce.record_reports([_report(message="m" * 50_000, stack="s" * 60_000, componentStack="c" * 60_000)],
                      user_id=None, ip="1.2.3.4", user_agent="UA")
    assert seen, "the scrub never ran (non-vacuity)"
    assert max(seen) <= ce.CAP_STACK


def test_the_rate_limit_is_checked_BEFORE_any_pattern_runs(store, monkeypatch):
    now = 7_000_000.0
    for _ in range(ce.RATE_LIMIT // ce.MAX_REPORTS_PER_REQUEST):
        ce.record_reports([_report()] * ce.MAX_REPORTS_PER_REQUEST, user_id=None, ip="4.3.2.1",
                          user_agent="UA", now=now)
    calls = []
    real = ce.scrub_text
    monkeypatch.setattr(ce, "scrub_text", lambda s: (calls.append(1), real(s))[1])
    out = ce.record_reports([_report(stack="a" * 4000)] * 10, user_id=None, ip="4.3.2.1",
                            user_agent="UA", now=now + 1)
    assert out["stored"] == 0 and out["dropped"] == 10
    assert calls == [], "an over-quota request paid for the scrub"
    # Control: a request with room DOES scrub, so the spy can see.
    ce.record_reports([_report()], user_id=None, ip="4.3.2.2", user_agent="UA", now=now + 1)
    assert calls


# ── S-1: the store is bounded in bytes ───────────────────────────────────────

def test_the_stated_ceiling_holds_arithmetically():
    """MAX_ROWS × MAX_ROW_BYTES is the stated ceiling, and every field cap sums
    under MAX_ROW_BYTES. On disk a row is at most three 4 KiB pages."""
    caps = (ce.CAP_NAME + ce.CAP_MESSAGE + ce.CAP_TEMPLATE + ce.CAP_STACK + ce.CAP_COMPONENT_STACK
            + ce.CAP_PAGE + ce.CAP_USER_AGENT + ce.CAP_RATE_KEY + ce.CAP_USER_ID + ce.FIXED_ROW_BYTES)
    assert caps <= ce.MAX_ROW_BYTES
    assert ce.CEILING_BYTES == ce.MAX_ROWS * ce.MAX_ROW_BYTES
    assert ce.MAX_ROWS * 3 * 4096 <= 250_000_000
    doc = ce.__doc__ or ""
    assert f"{ce.MAX_ROWS:,}" in doc and "250 MB" in doc


def test_the_row_count_is_hard_capped_and_the_OLDEST_rows_go(store, monkeypatch):
    monkeypatch.setattr(ce, "MAX_ROWS", 5)
    for i in range(9):
        ce.record_reports([_report(name="TypeError", message=f"m{'x' * i}")], user_id=None,
                          ip=f"10.1.0.{i}", user_agent="UA", now=8_000_000.0 + i)
    rows = _rows(store)
    assert len(rows) == 5
    assert [r["created_at"] for r in rows] == [8_000_000.0 + i for i in range(4, 9)]


def test_the_file_stays_inside_the_stated_per_row_page_budget(store, monkeypatch):
    """Empirical half of the ceiling: fill past MAX_ROWS with the largest rows
    the caps allow (4-byte characters) and measure the database file."""
    monkeypatch.setattr(ce, "MAX_ROWS", 60)
    big = "\U0001F600" * 5000
    for i in range(12):
        ce.record_reports([_report(message=big, stack=big, componentStack=big, name="TypeError",
                                   page="/" + "journal/" * 60)] * 10,
                          user_id=f"{i:02d}" + "u" * 34, ip="10.2.0.1", user_agent=big,
                          now=9_000_000.0 + i)
    c = sqlite3.connect(store)
    try:
        c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        pages, size = c.execute("PRAGMA page_count").fetchone()[0], c.execute("PRAGMA page_size").fetchone()[0]
        n = c.execute("SELECT COUNT(*) FROM client_errors").fetchone()[0]
    finally:
        c.close()
    assert n == 60
    assert pages * size <= (60 + ce.MAX_REPORTS_PER_REQUEST) * 3 * 4096 + 64 * 1024


# ── The rate limit ───────────────────────────────────────────────────────────

def test_the_rate_limit_is_per_key_and_counted_from_the_store(store):
    now = 1_000_000.0
    first = ce.record_reports([_report()] * ce.MAX_REPORTS_PER_REQUEST,
                              user_id=None, ip="1.1.1.1", user_agent="UA", now=now)
    assert first["stored"] == ce.MAX_REPORTS_PER_REQUEST
    for _ in range(ce.RATE_LIMIT // ce.MAX_REPORTS_PER_REQUEST):
        ce.record_reports([_report()] * ce.MAX_REPORTS_PER_REQUEST,
                          user_id=None, ip="1.1.1.1", user_agent="UA", now=now + 1)
    assert len(_rows(store)) == ce.RATE_LIMIT
    over = ce.record_reports([_report()], user_id=None, ip="1.1.1.1", user_agent="UA", now=now + 2)
    assert over == {"stored": 0, "dropped": 1, "invalid": 0}
    # A different address is its own bucket …
    other = ce.record_reports([_report()], user_id=None, ip="2.2.2.2", user_agent="UA", now=now + 2)
    assert other["stored"] == 1
    # … and a signed-in member is keyed by id, not by the shared address.
    member = ce.record_reports([_report()], user_id="u1", ip="1.1.1.1", user_agent="UA", now=now + 2)
    assert member["stored"] == 1
    # Once the window has passed, the same address may report again.
    later = ce.record_reports([_report()], user_id=None, ip="1.1.1.1", user_agent="UA",
                              now=now + ce.RATE_WINDOW_S + 5)
    assert later["stored"] == 1


def test_the_global_ceiling_holds_across_rotating_addresses(store, monkeypatch):
    monkeypatch.setattr(ce, "GLOBAL_LIMIT_PER_HOUR", 5)
    now = 2_000_000.0
    stored = sum(ce.record_reports([_report()], user_id=None, ip=f"10.0.0.{i}",
                                   user_agent="UA", now=now)["stored"] for i in range(9))
    assert stored == 5


def test_more_than_the_per_request_cap_is_dropped_not_stored(store):
    out = ce.record_reports([_report()] * (ce.MAX_REPORTS_PER_REQUEST + 3),
                            user_id=None, ip="3.3.3.3", user_agent="UA")
    assert out["stored"] == ce.MAX_REPORTS_PER_REQUEST
    assert out["dropped"] == 3


# ── Retention ────────────────────────────────────────────────────────────────

def test_rows_past_fourteen_days_are_pruned(store):
    day = 86400
    now = 5_000_000.0
    ce.record_reports([_report(message="old")], user_id=None, ip="4.4.4.4", user_agent="UA",
                      now=now - (ce.RETENTION_DAYS + 1) * day)
    ce.record_reports([_report(message="recent")], user_id=None, ip="4.4.4.4", user_agent="UA",
                      now=now - (ce.RETENTION_DAYS - 1) * day)
    assert ce.prune(now=now) == 1
    assert [r["message"] for r in _rows(store)] == ["recent"]


def test_a_write_prunes_opportunistically(store):
    day = 86400
    now = 6_000_000.0
    ce.record_reports([_report(message="old")], user_id=None, ip="5.5.5.5", user_agent="UA",
                      now=now - 20 * day)
    ce._last_prune = 0.0
    ce.record_reports([_report(message="new")], user_id=None, ip="5.5.5.6", user_agent="UA", now=now)
    assert [r["message"] for r in _rows(store)] == ["new"]


# ── N-1: the log line ────────────────────────────────────────────────────────

def test_the_log_line_carries_kind_route_template_and_count_NEVER_the_message(store, caplog):
    caplog.set_level(logging.WARNING, logger=ce.__name__)
    planted = "Could not save note Short at the open with full size"
    ce.record_reports([_report(page=f"/x#token={TOKEN}", message=planted, template="#kfbpaocd"),
                       _report(page=f"/x#token={TOKEN}", message=planted, template="#kfbpaocd"),
                       _report()],
                      user_id="u9", ip="6.6.6.6", user_agent="UA")
    lines = [r.getMessage() for r in caplog.records if "[client-error]" in r.getMessage()]
    assert len(lines) == 2                                   # one line per (kind, route, template)
    payloads = [json.loads(line.split("[client-error] ", 1)[1]) for line in lines]
    assert {tuple(sorted(p)) for p in payloads} == {("count", "kind", "route", "template")}
    grouped = next(p for p in payloads if p["template"] == "#kfbpaocd")
    assert grouped == {"kind": "error", "route": "/x", "template": "#kfbpaocd", "count": 2}
    text = "\n".join(lines)
    assert TOKEN not in text and "Short at the open" not in text and "save note" not in text


# ── The kill switch ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("value,expected", [
    (None, True), ("1", True), ("true", True), ("", True),
    ("0", False), ("false", False), ("OFF", False), (" no ", False),
])
def test_the_kill_switch_reads_unset_as_on(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv(ce.KILL_SWITCH, raising=False)
    else:
        monkeypatch.setenv(ce.KILL_SWITCH, value)
    assert ce.enabled() is expected


# ── The doors ────────────────────────────────────────────────────────────────

@pytest.fixture
def app(store):
    from api.routers import client_errors as router_mod
    fa = FastAPI()
    fa.include_router(router_mod.router)
    fa.dependency_overrides[authmw.get_current_user_optional] = lambda: None
    yield fa
    fa.dependency_overrides.clear()


def test_the_door_takes_a_report_without_a_session(app, store):
    r = TestClient(app).post("/api/client-errors", json={"reports": [_report()]})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "enabled": True, "stored": 1, "dropped": 0, "invalid": 0}
    assert _rows(store)[0]["user_id"] is None


def test_a_signed_in_report_carries_the_member_id(app, store):
    app.dependency_overrides[authmw.get_current_user_optional] = lambda: {"id": "u42"}
    TestClient(app).post("/api/client-errors", json=_report())
    assert _rows(store)[0]["user_id"] == "u42"


def test_the_kill_switch_is_read_PER_REQUEST_and_off_writes_nothing(app, store, monkeypatch):
    client = TestClient(app)
    monkeypatch.setenv(ce.KILL_SWITCH, "0")
    off = client.post("/api/client-errors", json={"reports": [_report()]})
    assert off.status_code == 200 and off.json()["enabled"] is False
    assert not store.exists() or _rows(store) == []
    # Same process, no restart: turning it back on takes effect on the next request.
    monkeypatch.delenv(ce.KILL_SWITCH)
    on = client.post("/api/client-errors", json={"reports": [_report()]})
    assert on.json()["stored"] == 1


class _SpyJson:
    """Stands in for the router's `json` module: records what it was asked to parse."""
    def __init__(self):
        self.calls = []

    def loads(self, s, *a, **k):
        self.calls.append(len(s))
        return json.loads(s, *a, **k)


def test_an_oversized_body_is_a_413_BEFORE_it_is_parsed(app, monkeypatch):
    from api.routers import client_errors as router_mod
    spy = _SpyJson()
    monkeypatch.setattr(router_mod, "json", spy)
    big = json.dumps({"reports": [_report(message="x" * 70_000)]}).encode()
    assert TestClient(app).post("/api/client-errors", content=big,
                                headers={"content-type": "application/json"}).status_code == 413
    assert spy.calls == []
    # Control: a body under the limit IS parsed, so the spy can see.
    TestClient(app).post("/api/client-errors", json={"reports": [_report()]})
    assert spy.calls


def test_a_declared_length_over_the_cap_is_refused_before_a_byte_is_read():
    """The streaming cap below would ALSO stop this body — so this rail drives
    the reader directly and proves the declared length alone refuses it, with
    the stream never touched."""
    from fastapi import HTTPException
    from api.routers import client_errors as router_mod

    class _Req:
        headers = {"content-length": str(ce.MAX_BODY_BYTES + 1)}
        read = False

        async def stream(self):
            _Req.read = True
            yield b"{}"

    with pytest.raises(HTTPException) as exc:
        asyncio.run(router_mod._read_capped(_Req()))
    assert exc.value.status_code == 413
    assert _Req.read is False
    # Control: an honest length is read.
    _Req.headers = {"content-length": "2"}
    assert asyncio.run(router_mod._read_capped(_Req())) == b"{}" and _Req.read is True


def test_a_streamed_body_with_no_length_is_capped_while_it_is_read(app, monkeypatch):
    from api.routers import client_errors as router_mod
    spy = _SpyJson()
    monkeypatch.setattr(router_mod, "json", spy)

    def chunks():
        yield b'{"reports": [{"kind": "error", "message": "'
        for _ in range(80):
            yield b"x" * 1024
        yield b'"}]}'

    r = TestClient(app).post("/api/client-errors", content=chunks(),
                             headers={"content-type": "application/json"})
    assert r.status_code == 413
    assert spy.calls == []


def test_the_store_is_never_touched_on_the_event_loop(app, monkeypatch):
    from api.routers import client_errors as router_mod
    seen = []

    def fake_record(reports, **kw):
        try:
            asyncio.get_running_loop()
            seen.append("on-loop")
        except RuntimeError:
            seen.append("off-loop")
        return {"stored": len(reports), "dropped": 0, "invalid": 0}

    monkeypatch.setattr(router_mod.client_errors, "record_reports", fake_record)
    r = TestClient(app).post("/api/client-errors", json={"reports": [_report()]})
    assert r.status_code == 200
    assert seen == ["off-loop"]


def test_a_non_json_body_is_a_400(app):
    r = TestClient(app).post("/api/client-errors", content=b"not json",
                             headers={"content-type": "application/json"})
    assert r.status_code == 400
    deep = TestClient(app).post("/api/client-errors", content=b"[" * 50_000,
                                headers={"content-type": "application/json"})
    assert deep.status_code == 400


def test_the_admin_read_is_admin_only_and_groups(app, store):
    client = TestClient(app)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "m", "role": "member"}
    assert client.get("/api/admin/client-errors").status_code == 403
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "a", "role": "admin"}
    client.post("/api/client-errors", json={"reports": [_report(), _report(), _report(name="RangeError")]})
    body = client.get("/api/admin/client-errors?days=1").json()
    assert body["total"] == 3 and body["enabled"] is True
    assert body["groups"][0]["n"] == 2
    assert body["groups"][0]["template"] == "cannot-read-properties"
