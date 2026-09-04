"""⛔⛔ THE EVIDENCE TAB'S ENDPOINT WAS JOINED TO NOTHING.

`EvidenceTab.jsx` declares the path it calls::

    export const BACKTEST_ENDPOINT = '/api/screener/backtest'

Three frontend tests assert the request went to that address -- and all three
IMPORT THE CONSTANT to build the expectation, while their `fetch` stubs route on
the same constant. Both sides move together, so they are tautologies about the
wire. The backend tests use the literal path and never look at the frontend.
Measured before writing this file: changing `BACKTEST_ENDPOINT` to
`/api/screener/backtestt` fails ZERO tests in either suite.

🔴 AND THIS ONE IS UNIQUELY INVISIBLE IN PRODUCTION, which is what makes it worth
a file. While `SCREEN_BACKTEST_ENABLED` was off, a WRONG path and the RIGHT path
answered identically: nothing serves POST on either, both fall to the SPA
catch-all's 405, and `EvidenceTab` renders the same reassuring sentence for both
-- *"Backtested evidence is not switched on for this site yet"*. A member, and a
reviewer, would read a typo as a feature flag. The defect could only ever surface
on the day the flag was armed, which was 2026-09-02.

⭐ SO THE JOIN IS MADE HERE, ACROSS THE LANES, and it is the same shape
`tests/test_startup_fingerprint.py` already uses to read `barsIDB.js`'s cache
version from Python: one side PARSES the other's declaration rather than
restating it. Nothing in this file types the path.

⛔ IT REFUSES RATHER THAN GUESSES. If the declaration cannot be found, that is a
failure -- not a default -- because a probe that silently falls back to a typed
path is exactly the second authority this exists to remove.
"""

from __future__ import annotations

import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from tests.mainreload import app_built_with  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
EVIDENCE_TAB = (ROOT / "app" / "src" / "components" / "chart" / "builder"
                / "EvidenceTab.jsx")

#: `export const BACKTEST_ENDPOINT = '/api/screener/backtest'`
_DECL = re.compile(
    r"""export\s+const\s+BACKTEST_ENDPOINT\s*=\s*['"]([^'"]+)['"]""")


def frontend_endpoint() -> str:
    """The path the shipped Evidence tab calls, read off its own declaration."""
    text = EVIDENCE_TAB.read_text(encoding="utf-8")
    found = _DECL.findall(text)
    assert len(found) == 1, (
        f"expected exactly one BACKTEST_ENDPOINT declaration in "
        f"{EVIDENCE_TAB.name}, found {len(found)}: {found}. This rail reads the "
        f"frontend's own address; it will not guess one.")
    return found[0]


def _served(app) -> set[tuple[str, str]]:
    """Every (method, path) the built app actually serves."""
    out: set[tuple[str, str]] = set()
    for route in app.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None) or ()
        if path:
            for m in methods:
                out.add((m, path))
    return out


def test_the_declaration_is_readable_and_is_a_path():
    """⛔ NON-VACUITY FIRST. Every assertion below is about this string, so a
    regex that quietly matched nothing would make them all pass over an empty
    subject."""
    endpoint = frontend_endpoint()
    assert endpoint.startswith("/api/"), endpoint
    assert not endpoint.endswith("/"), endpoint


def test_the_path_the_evidence_tab_calls_is_a_path_this_app_SERVES():
    """⭐⭐ THE JOIN. The frontend's address must name a route the backend mounts
    -- both the POST that starts the study and the GET the tab polls for its
    receipt, since a member who cannot poll sits on 'Replaying…' forever.
    """
    endpoint = frontend_endpoint()
    app = app_built_with(SCREEN_BACKTEST_ENABLED="1")
    served = _served(app)

    assert ("POST", endpoint) in served, (
        f"the Evidence tab POSTs to {endpoint!r} and nothing serves it. "
        f"Nearby screener routes that ARE served: "
        f"{sorted(p for m, p in served if p.startswith('/api/screener'))}")

    # ⛔ THE POLL LEG TOO, and it is not the same claim. The tab starts a job on
    # the POST and reads the receipt from `${BACKTEST_ENDPOINT}/${job}`; a served
    # POST with an unserved poll is a study that runs and is never shown.
    poll = f"{endpoint}/{{job}}"
    assert ("GET", poll) in served, (
        f"the Evidence tab polls {poll!r} and nothing serves it")


def test_the_probe_can_say_NO_and_is_reading_the_real_table():
    """⛔⛔ A CHECK THAT CANNOT FAIL PROVES NOTHING. This asserts the two
    directions the test above needs to be worth running: a path nobody serves is
    reported ABSENT, and a route this file is not looking for is reported
    PRESENT -- so the probe is reading the live route table rather than agreeing
    with itself.
    """
    app = app_built_with(SCREEN_BACKTEST_ENABLED="1")
    served = _served(app)

    typo = frontend_endpoint() + "t"
    assert ("POST", typo) not in served, (
        "a deliberately wrong path resolved; this probe cannot distinguish")

    # The screener's own scan door — a different router at a neighbouring prefix.
    assert ("POST", "/api/screener/scan") in served, (
        "the probe cannot see a route that is definitely mounted, so its "
        "verdict about the backtest route means nothing")


def test_with_the_flag_OFF_the_route_is_absent__which_is_why_a_typo_hid_here():
    """⚰️ THE RECORD OF WHY THIS FILE EXISTS, asserted rather than narrated.

    With the flag off, the endpoint is not served — and neither is a typo of it.
    The two states are INDISTINGUISHABLE from the frontend, which is exactly how
    a wrong address could have survived review: it renders as "not switched on".
    """
    endpoint = frontend_endpoint()
    app = app_built_with(SCREEN_BACKTEST_ENABLED="0")
    served = _served(app)

    assert ("POST", endpoint) not in served
    assert ("POST", endpoint + "t") not in served
    # ⭐ AND THE APP IS OTHERWISE REAL — without this, "nothing is served" would
    # also be satisfied by an app that failed to build.
    assert ("POST", "/api/screener/scan") in served
