"""A field the server emits cannot be dropped on its way to the screen.

⭐ THE DEFECT THIS EXISTS FOR, MEASURED ON THIS BRANCH.

`452290bd` added `{kind, reason}` beside the expected move, wired three calendar
surfaces to it, and shipped 30 green component tests. Its own mutation pass then
cut one line out of `mergeEnrichment`'s allow-list — severing the field one hop
before the screen — and **all thirty stayed green.** The router still emitted the
field. The components still rendered whatever they were handed. Nothing in
between was under test, so nothing failed and the member saw nothing. That is
`lesson_built_tested_green_and_unreachable`, and this repo has measured eleven
instances of it.

The predecessor's answer was a rail that derived the emitted key set from a REAL
router response and required every key to be named in `mergeEnrichment`. It
worked — and it policed exactly one hop, by name. Two more were already open the
day it shipped: `toModalRow` (the modal's second allow-list) and
`/api/research/expected-move`'s `live_outcome`, which was correct, tested, and
**read by no code at all**.

⛔ SO THIS RAIL DOES NOT NAME HOPS. It finds them.

`tools/js_key_census.mjs` parses every non-test source under `app/src` with the
frontend's own acorn + acorn-jsx and reports two facts per file: every
object-literal key WRITTEN, and every property name READ. From that census:

  R1 — any function that projects >= MIN_PROJECTION_OVERLAP of a payload's keys
       into one object literal IS an allow-list on that payload's path, and must
       name ALL of them. A fourth hop added tomorrow is policed the moment it
       exists, because it is discovered by shape, not by a list kept here.

  R2 — every key a member-facing router emits must be READ by code somewhere in
       `app/src`. This is the rail that goes red on "emitted, serialized,
       correct, and consumed by nothing".

⛔ AST, NEVER GREP — and here that is not a slogan. `useCalendarData.js`'s own
comment block contains the string `expected_move_outcome`, and `cardBits.jsx`
discusses the reason vocabulary at length. A text search would report both keys
as "consumed" on the strength of prose alone (see
`lesson_probe_names_must_be_derived_not_typed`: "a grep reported 5 call sites;
all five were prose"). `test_the_census_sees_code_and_never_prose` is the
control that proves this census does not make that mistake.

R2's known limitation, stated rather than hidden: it asks whether ANY module
reads a property of that name, so a payload key whose name collides with an
unrelated property elsewhere (`history`, `grade`) can be reported reachable on
the strength of the collision. It is a floor — it catches the total-absence case
that actually shipped — and the per-surface behavioural rails in
`app/src/pages/calendar/refusalLastHops.test.jsx` cover the rest.
"""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
from functools import lru_cache
from unittest import mock

import pytest

from api.services import implied_move as _im
from tests.test_implied_reason_on_the_wire import (
    _current_week_day, _enrich, _reading, _research_client,
)

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / "app"
CENSUS_JS = ROOT / "tools" / "js_key_census.mjs"

#: An object literal naming this many keys of one payload is a projection OF
#: that payload, not a coincidence. Two names can collide by chance across 865
#: files (`live`, `history`, `grade` are ordinary words); three drawn from the
#: same wire shape, in one literal, is the shape of an allow-list. Measured on
#: this tree the threshold separates cleanly: the two real hops score 5 and 5,
#: and nothing else in `app/src` scores above 0.
MIN_PROJECTION_OVERLAP = 3


def _run_census(src_dir: pathlib.Path) -> dict:
    node = shutil.which("node")
    assert node, ("node is not on PATH — this rail parses the frontend with the "
                  "frontend's own acorn, and a rail that cannot run is not a gate")
    assert CENSUS_JS.exists(), f"missing {CENSUS_JS}"
    proc = subprocess.run([node, str(CENSUS_JS), str(src_dir), str(APP)],
                          capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, f"census failed: {proc.stderr.strip()[:2000]}"
    return json.loads(proc.stdout)


@lru_cache(maxsize=1)
def census() -> dict:
    """The census of the shipped frontend. One node run per test session."""
    return _run_census(APP / "src")


# ── The payloads, derived from REAL router responses ─────────────────────────
#
# Never a typed list of field names: a test that restated the wire shape would
# be a second authority over the one value it exists to police, and would go
# green the day the two drifted. Both fixtures drive the real router through the
# same mocked chain read the sibling suite uses.

def _enrichment_keys(monkeypatch) -> list[str]:
    body = _enrich(_current_week_day(), _reading(_im.REFUSED_NO_ATM_STRIKE),
                   monkeypatch=monkeypatch)
    return sorted(body["TSTX"])


def _research_keys() -> list[str]:
    from api.main import app

    c, em_router = _research_client()
    try:
        with mock.patch.object(em_router.implied_move, "get_expected_move",
                               side_effect=_reading(_im.REFUSED_NO_ATM_STRIKE)), \
             mock.patch.object(em_router.implied_store, "get_implied_history", return_value=[]), \
             mock.patch.object(em_router.implied_store, "get_earliest_report_date", return_value=None), \
             mock.patch.object(em_router.setup_grade, "get_setup_grade", return_value=None):
            body = c.get("/api/research/expected-move/TSTX").json()
    finally:
        app.dependency_overrides.clear()
    return sorted(body)


@pytest.fixture(scope="module")
def payloads() -> dict[str, list[str]]:
    mp = pytest.MonkeyPatch()
    try:
        return {"calendar enrichment": _enrichment_keys(mp),
                "research expected-move": _research_keys()}
    finally:
        mp.undo()


def _hops(payload_keys: list[str]) -> list[dict]:
    """Every object literal in `app/src` that projects this payload.

    Discovered BY SHAPE. Nothing here knows that `mergeEnrichment` or
    `toModalRow` exist; a fourth one is found the day it is written."""
    keys = set(payload_keys)
    out = []
    for lit in census()["literals"]:
        named = keys & set(lit["keys"])
        if len(named) >= MIN_PROJECTION_OVERLAP:
            out.append({**lit, "named": named, "dropped": sorted(keys - named)})
    return out


# ── The census itself must be able to fail ───────────────────────────────────

def test_the_census_reads_the_whole_frontend_and_parses_all_of_it():
    """Abort-on-zero. A census that scanned nothing, or quietly skipped the one
    file carrying a hop, would make every assertion below pass vacuously — the
    `lesson_test_that_passes_vacuously` shape. A file we cannot parse is a file
    we cannot clear, so an unparseable source fails here rather than being
    silently dropped from the sweep."""
    c = census()
    assert c["files"] >= 500, f"census scanned only {c['files']} files"
    assert c["parse_errors"] == [], (
        "unparseable sources: " + ", ".join(e["file"] for e in c["parse_errors"]))
    assert len(c["literals"]) >= 1000, len(c["literals"])
    assert len(c["reads"]) >= 500, len(c["reads"])


def test_the_census_sees_code_and_never_prose(tmp_path):
    """THE anti-grep control, and the reason this rail is worth its node
    subprocess. The fixture below mentions a key in a comment, in a string, and
    in JSX text — every place a text search would score a hit — and reads a
    DIFFERENT key in actual code. A grep would report the first as consumed."""
    (tmp_path / "prose.jsx").write_text(
        "// discussed_only is carried by the payload and must be named here\n"
        "const NOTE = 'discussed_only'\n"
        "export default function P({ payload }) {\n"
        "  return <div title={NOTE}>discussed_only: {payload.genuinely_read}</div>\n"
        "}\n", encoding="utf-8")
    reads = _run_census(tmp_path)["reads"]
    assert "genuinely_read" in reads, "the control read nothing — it proves nothing"
    assert "discussed_only" not in reads, (
        "the census counted prose as a read; it is a grep wearing an AST's coat")


def test_the_census_finds_a_projection_hop_by_its_shape(tmp_path):
    """The detector must actually detect. Without this, a broken walker would
    report zero hops for every payload and R1 below would pass by finding
    nothing to check."""
    (tmp_path / "hop.js").write_text(
        "export function project(e) {\n"
        "  return { alpha: e.alpha, beta: e.beta, gamma: e.gamma }\n"
        "}\n", encoding="utf-8")
    lits = _run_census(tmp_path)["literals"]
    hop = [l for l in lits if set(l["keys"]) >= {"alpha", "beta", "gamma"}]
    assert len(hop) == 1, lits
    assert hop[0]["fn"] == "project", hop[0]


def test_the_frontend_still_carries_more_than_one_allow_list_hop(payloads):
    """Abort-on-zero on the discovery itself, without restating WHICH hops. The
    enrichment payload crosses two allow-lists today (the merge and the modal
    row projection). If that ever reads as fewer, either a hop was inlined —
    fine, but the drop it used to police moved somewhere — or the detector
    stopped working, which is the failure this catches."""
    found = _hops(payloads["calendar enrichment"])
    assert len(found) >= 2, [f"{h['file']}::{h['fn']}" for h in found]


# ── R1 — no hop may drop a key ───────────────────────────────────────────────

@pytest.mark.parametrize("payload", ["calendar enrichment", "research expected-move"])
def test_no_hop_between_the_router_and_the_screen_drops_an_emitted_key(payload, payloads):
    """The generalization of `452290bd`'s single-hop rail: the key set is
    derived from a real router response, the HOPS are derived from the AST, and
    every hop must name every key.

    Names are built into the message on purpose. pytest elides a set diff with
    `...` and a bare `assert missing == []` on a long list tells the next
    engineer nothing; a rail whose whole job is naming a dropped field must not
    depend on the differ to do it."""
    keys = payloads[payload]
    assert keys, f"{payload} emitted no keys — this rail is checking nothing"
    offenders = [f"{h['file']}::{h['fn']} (line {h['line']}) drops "
                 + ", ".join(h["dropped"])
                 for h in _hops(keys) if h["dropped"]]
    assert offenders == [], (
        f"{payload}: a field is emitted by the router and dropped before the "
        f"screen — {' | '.join(offenders)}")


# ── R2 — an emitted key that nothing reads never reaches anyone ──────────────

@pytest.mark.parametrize("payload", ["calendar enrichment", "research expected-move"])
def test_every_key_a_member_facing_router_emits_is_read_by_code(payload, payloads):
    """`live_outcome` shipped correct, tested, and read by NOTHING — the payload
    was right and the canvas was silent. Component tests cannot see that: they
    are handed a prop and asked whether they render it. Only a question asked of
    the whole tree can.

    A read is a MemberExpression or a destructuring binding in the AST, so a
    comment naming the field is not an answer."""
    keys = payloads[payload]
    assert keys, f"{payload} emitted no keys — this rail is checking nothing"
    reads = census()["reads"]
    unread = [k for k in keys if k not in reads]
    assert unread == [], (
        f"{payload}: emitted by the router and read by no code under app/src — "
        + ", ".join(unread))


def test_the_outcome_field_is_present_on_both_payloads(payloads):
    """Abort-on-zero on the fixtures. Both rails above iterate a derived key
    set; if a router regressed to emitting no outcome at all, they would sweep a
    shorter list and pass while the reason stopped reaching anyone."""
    assert "expected_move_outcome" in payloads["calendar enrichment"], payloads
    assert "live_outcome" in payloads["research expected-move"], payloads
