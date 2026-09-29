"""TERM-061 (FB-X2-01) — the member API whitelist is GENERATED, and the committed copy cannot drift.

The committed `docs/api/member-api-whitelist.json` and `docs/api/skill.md` must equal what
`api/services/skill_whitelist.py` generates from `api.main:app` today. Regenerate with:

    UPDATE_SKILL_WHITELIST=1 python -m pytest tests/test_skill_whitelist.py -q

Controls prove the derivation can see what it must include and refuse what it must exclude.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from api.services import skill_whitelist as sw

REPO = Path(__file__).resolve().parents[1]
JSON_PATH = REPO / "docs" / "api" / "member-api-whitelist.json"
MD_PATH = REPO / "docs" / "api" / "skill.md"


@pytest.fixture(scope="module")
def data():
    from api.main import app
    return sw.build(app)


def test_the_committed_whitelist_is_exactly_what_the_route_table_generates(data):
    want_json, want_md = sw.to_json(data), sw.to_skill_md(data)
    if os.environ.get("UPDATE_SKILL_WHITELIST") == "1":
        JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
        JSON_PATH.write_bytes(want_json.encode("utf-8"))
        MD_PATH.write_bytes(want_md.encode("utf-8"))
    have_json = JSON_PATH.read_bytes().decode("utf-8").replace("\r\n", "\n")
    have_md = MD_PATH.read_bytes().decode("utf-8").replace("\r\n", "\n")
    assert have_json == want_json, "whitelist drifted from the route table - regenerate (see module docstring)"
    assert have_md == want_md, "skill.md drifted - regenerate (see module docstring)"


def test_non_vacuity_known_member_reads_are_listed_with_their_tier(data):
    by_path = {e["path"]: e for e in data["entries"]}
    assert len(by_path) > 20
    assert by_path["/api/screener/meta"]["tier"] == "paid"


def test_no_admin_auth_stream_or_render_route_is_ever_listed(data):
    for e in data["entries"]:
        assert e["method"] == "GET"
        assert not e["path"].startswith(sw.EXCLUDED_PREFIXES), e
        assert e["tier"] in ("paid", "member"), e
        assert e["rate_limit_family"], e


def test_an_admin_guarded_route_is_refused_even_when_rate_limited():
    from fastapi import Depends, FastAPI

    def require_admin():
        return {}

    def require_paid():
        return {}

    app = FastAPI()

    @app.get("/api/screener/meta")
    def paid_route(_u=Depends(require_paid)):
        return {}

    @app.get("/api/screener/refresh-status")
    def admin_route(_u=Depends(require_admin)):
        return {}

    got = {e["path"] for e in sw.build(app)["entries"]}
    assert "/api/screener/meta" in got
    assert "/api/screener/refresh-status" not in got


def test_credential_connector_and_debug_reads_are_never_listed(data):
    import re
    for e in data["entries"]:
        for pat, why in sw.EXCLUDED_PATTERNS:
            assert not re.search(pat, e["path"], re.I), (e["path"], why)
    # control: the real table HAS such member-gated routes, so the rule is doing work
    from api.main import app
    paths = {getattr(r, "path", "") for r in app.routes}
    assert "/api/j2/personal/tokens" in paths and "/api/calendar/export-token" in paths


def test_an_open_route_is_not_listed():
    from fastapi import FastAPI

    app = FastAPI()

    @app.get("/api/screener/meta")
    def open_route():
        return {}

    assert sw.build(app)["entries"] == []
