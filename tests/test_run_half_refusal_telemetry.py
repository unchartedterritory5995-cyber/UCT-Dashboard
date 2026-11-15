"""ENGINE 54 (2026-11-13): run-half refusal telemetry, SERVER half
(`api/routers/pine_runtime_telemetry.py`, `POST /api/pine-runtime-telemetry/run-half`).

What it must hold:
* a refusal is counted with exactly {code, hash}: no source, no sentence, no member id in the
  row (the visitor is the router's constant);
* nothing free-form: unknown keys, a code outside the pattern (a sentence, an upper-case or
  long hash) are refused;
* the code pattern is the CLIENT's (`engine/runHalfTelemetry.js::RUN_HALF_CODE_RE`), parsed, not
  restated, and every code `nativeRegistry.withRunHalf` refuses with literally is accepted;
* signed in only; an admin-only aggregate read.

The client half is `app/src/components/chart/engine/__tests__/runHalfTelemetry.test.js`.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import pine_runtime_telemetry as tel
from api.services import auth_db

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "app" / "src" / "components" / "chart" / "engine"
URL = "/api/pine-runtime-telemetry/run-half"
GOOD = {"code": "run-half:object-rail", "hash": "0123456789ab"}


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    auth_db.init_db()
    return tmp_path


def _client(role: str = "member", signed_in: bool = True) -> TestClient:
    app = FastAPI()
    app.include_router(tel.router)
    if signed_in:
        app.dependency_overrides[get_current_user] = lambda: {"id": "u-member-7f3a", "role": role}
    return TestClient(app)


def _rows() -> list:
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM landing_events WHERE event = ?", (tel.RUN_HALF_EVENT,)).fetchall()]
    finally:
        conn.close()


def test_the_code_pattern_is_the_clients():
    src = (ENGINE / "runHalfTelemetry.js").read_text(encoding="utf-8")
    m = re.search(r"export const RUN_HALF_CODE_RE = /(.*?)/\n", src)
    assert m, "runHalfTelemetry.js no longer declares RUN_HALF_CODE_RE where this rail reads it"
    assert m.group(1) == tel.RUN_HALF_CODE_PATTERN


def test_every_literal_run_half_refusal_code_is_accepted():
    reg = (ENGINE / "nativeRegistry.js").read_text(encoding="utf-8")
    body = reg[reg.index("function withRunHalf("):reg.index("function runHalfGateSignature(")]
    codes = set(re.findall(r"refused\('([^']+)'\)", body))
    for name in re.findall(r"refused\(([A-Z_]+)\)", body):
        codes.add(re.search(rf"export const {name} = '([^']+)'", reg).group(1))
    rail = (ENGINE / "runHalfObjectRail.js").read_text(encoding="utf-8")
    codes |= set(re.findall(r"export const RUN_HALF_[A-Z_]+ = '([^']+)'", rail))
    assert {"run-half:program-unbound", "run-half:object-rail", "run-half:no-comparable-objects",
            "run-half:host-object-withheld", "run-half:rail-not-loaded"} <= codes
    for code in codes:
        assert re.fullmatch(tel.RUN_HALF_CODE_PATTERN, code), code


def test_a_refusal_is_stored_with_exactly_code_and_hash(db):
    r = _client().post(URL, json=GOOD)
    assert r.status_code == 200 and r.json() == {"ok": True, "logged": True}
    rows = _rows()
    assert len(rows) == 1
    assert rows[0]["visitor_id"] == tel.VISITOR
    assert json.loads(rows[0]["props"]) == GOOD
    assert "u-member-7f3a" not in json.dumps(rows[0])


@pytest.mark.parametrize("bad", [
    {**GOOD, "source": "//@version=5\nindicator('x')"},          # an unknown field
    {**GOOD, "code": "the run draws a label differently"},        # a sentence
    {**GOOD, "code": "run-half:object rail"},                     # a space
    {**GOOD, "code": "run-half:" + "x" * 49},                     # too long
    {**GOOD, "code": "evil:object-rail"},                         # not a guard family
    {**GOOD, "hash": "0123456789AB"},                             # upper case
    {**GOOD, "hash": "0123456789abcdef"},                         # longer than the prefix
    {"code": GOOD["code"]},                                       # no hash
])
def test_anything_free_form_is_refused(db, bad):
    r = _client().post(URL, json=bad)
    assert r.status_code == 422
    assert _rows() == []


def test_signed_in_only_and_the_read_is_admin_only(db):
    assert _client(signed_in=False).post(URL, json=GOOD).status_code in (401, 403)
    _client().post(URL, json=GOOD)
    _client().post(URL, json={**GOOD, "code": "pane:not-graded"})
    rep = tel.run_half_report(7)
    assert rep["refusals"] == 2
    assert rep["by_code"] == {"run-half:object-rail": 1, "pane:not-graded": 1}
    assert rep["by_script"][0]["hash"] == GOOD["hash"]
