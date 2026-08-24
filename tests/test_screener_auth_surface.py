"""The screener surface is inside the boot-time auth audit.

Closes concern #3 of the 2026-08-23 backtest wiring review: *"No auth-rail
completeness assertion. Independent of this feature: any new router added to
this repo today lands unchecked."*

⭐ THE GAP WAS NARROWER THAN THE CONCERN STATED, AND WORTH SAYING PRECISELY.
`api/auth_surface_check.py` already existed and is thorough — it reads the LIVE
route objects at boot on both pods, sorts every mutating route into gated /
middleware-gated / allowed-open / delegated / ungated, and pages on the last.
What it did not do was LOOK at `/api/screener`: `AUDITED_PREFIXES` covered
`/api/flow`, `/api/live`, `/api/oi` and `/api/admin` only.

⛔ AND THE SCREENER IS EXACTLY THE SURFACE THAT NEEDS IT, because the backtest
router is mounted BEHIND A FLAG. `tests/test_screener_backtest_auth.py` proves
the code is gated, which is a fact about git. Whether this pod is serving those
routes at all depends on `SCREEN_BACKTEST_ENABLED` at boot, and that is a fact
only the running process holds.
"""
import pytest


@pytest.fixture(scope="module")
def app():
    from api.main import app as _app
    return _app


@pytest.fixture(scope="module")
def asc():
    from api import auth_surface_check as _asc
    return _asc


def test_the_screener_surface_is_audited(asc):
    assert "/api/screener" in asc.AUDITED_PREFIXES, (
        "the screener's mutating routes are outside the boot-time audit — a "
        "gate removed there would not page")


def test_no_screener_route_is_ungated(app, asc):
    """⛔ NOT A PROBE. This reads route objects; it sends no request and runs no
    handler. The obvious canary — fire an unauthenticated POST and expect a
    401 — is unsafe by construction: it is harmless only WHEN THE GATE WORKS,
    and in the one case it exists to detect the handler RUNS. During the
    2026-07-26 audit exactly that probe executed a real production job."""
    result = asc.audit_routes(app)
    offenders = [r for r in result["ungated"] if r[1].startswith("/api/screener")]
    assert offenders == [], f"ungated mutating screener routes: {offenders}"


def test_the_audit_still_finds_nothing_ungated_anywhere(app, asc):
    """The prefix was added on the measured basis that it cannot page. If this
    goes red, read the list before assuming the rail is wrong — it is far more
    likely that a real gate went missing."""
    result = asc.audit_routes(app)
    assert result["ungated"] == [], (
        f"boot would page with {len(result['ungated'])} ungated route(s): "
        f"{result['ungated'][:8]}")


def test_the_backtest_route_is_gated_whenever_it_is_mounted(app):
    """The flag gates the MOUNT, so this asserts a conditional: if the route is
    being served, it carries a gate. Vacuous while the flag is off — and it
    says so rather than looking like coverage it does not have."""
    import inspect

    served = [r for r in app.routes
              if getattr(r, "path", "").startswith("/api/screener/backtest")]
    if not served:
        pytest.skip("SCREEN_BACKTEST_ENABLED is off — the router is not mounted, "
                    "so there is no served route to check (this is the flag "
                    "working, not a gap)")

    def reaches_auth(dependant):
        for d in getattr(dependant, "dependencies", []):
            call = getattr(d, "call", None)
            mod = getattr(inspect.unwrap(call), "__module__", "") if call else ""
            if "auth_middleware" in (mod or "") or reaches_auth(d):
                return True
        return False

    for r in served:
        assert reaches_auth(r.dependant), f"{r.path} reaches no auth dependency"
