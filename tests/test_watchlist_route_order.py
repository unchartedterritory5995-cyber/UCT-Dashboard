"""Literal watchlist routes must not be shadowed by /api/watchlists/{wl_id}.

FastAPI matches in REGISTRATION order, so any literal path registered after the
`/{wl_id}` wildcard is unreachable — the wildcard claims it and the handler
404s with "Watchlist not found". `digest-settings` sat below it and both its
GET and PUT were dead. (The Settings UI survived only because it ALSO writes
the value through the generic preferences endpoint, which is what the digest
scheduler actually reads.)

This asserts on the resolved ROUTE OBJECT rather than on a 404, so it fails for
the real reason instead of any incidental error.
"""

import pytest

from api.main import app


def _watchlist_routes():
    out = []
    for r in app.routes:
        path = getattr(r, "path", "")
        if path.startswith("/api/watchlists"):
            out.append((path, sorted(getattr(r, "methods", []) or [])))
    return out


def _index_of(path: str, method: str) -> int:
    for i, (p, methods) in enumerate(_watchlist_routes()):
        if p == path and method in methods:
            return i
    raise AssertionError(f"route {method} {path} is not registered at all")


WILDCARD = "/api/watchlists/{wl_id}"


@pytest.mark.parametrize("literal,method", [
    ("/api/watchlists/digest-settings", "GET"),
    ("/api/watchlists/digest-settings", "PUT"),
    ("/api/watchlists/flagged", "GET"),
    ("/api/watchlists/public", "GET"),
])
def test_literal_route_is_registered_before_the_wildcard(literal, method):
    assert _index_of(literal, method) < _index_of(WILDCARD, method), (
        f"{method} {literal} is registered AFTER {WILDCARD} and is therefore "
        f"unreachable — the wildcard swallows it. Move it above."
    )


def test_wildcard_still_exists():
    """Guard against 'fixing' the ordering by deleting the wildcard."""
    assert any(p == WILDCARD for p, _ in _watchlist_routes())
