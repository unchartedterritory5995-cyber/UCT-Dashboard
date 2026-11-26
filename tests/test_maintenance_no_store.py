"""GET /api/maintenance is never stored by a cache (review of #2842, 2026-11-26).

Every signed-in page now asks it at boot (`app/src/lib/bootFetch.js`), and AuthGuard holds the shell on its answer.
A cached `false` replayed by a browser or a future edge rule during a maintenance window would let members past
the gate, so the route says `Cache-Control: no-store`. Driven through the REAL app (`api.main:app`), so a middleware
that rewrote or dropped the header would be caught too.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    from api.main import app
    return TestClient(app, raise_server_exceptions=False)


def test_the_maintenance_answer_is_never_stored(client):
    r = client.get("/api/maintenance")
    assert r.status_code == 200
    assert isinstance(r.json().get("maintenance"), bool)
    assert "no-store" in (r.headers.get("cache-control") or "").lower(), r.headers.get("cache-control")
