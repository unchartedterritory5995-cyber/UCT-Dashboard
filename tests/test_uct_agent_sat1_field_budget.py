"""UCT Agent's screener field list vs the context budget, read off the SAT-1 capture.

The Agent sends the Screener's field list (`agent/capabilities/screener.js`, the `screener` context
provider) with every screen request, under `CONTEXT_BUDGET_BYTES` (20,000). Over it, the provider's
`compact` drops the field DEFINITIONS (`fieldNotes`) and sends `fieldNotesDetail` instead, so the
Agent screens with less to go on. On 2026-11-13 the five RS Exit Warning columns pushed 11 of the 30
recorded screener requests over the line (master sat 77 bytes under it). The fix: the three
per-warning ages are member-only (`filters._agent_omit`), and the two the Agent keeps carry short
labels. These rails read the capture the real client code recorded
(`app/src/agent/agentScanSat1Requests.test.jsx`, UPDATE_SAT1_REQUESTS=1), so a field added later
that tips a request over the budget goes red here, at review, instead of silently costing members.
"""
from __future__ import annotations

import json
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CAPTURE = ROOT / "api" / "services" / "uct_agent" / "scan" / "sat" / "section_b_requests.json"


def _screener_sections(doc) -> list:
    out = []

    def walk(o):
        if isinstance(o, dict):
            ctx = o.get("context")
            if isinstance(ctx, dict) and isinstance(ctx.get("screener"), list):
                out.extend(s for s in ctx["screener"] if isinstance(s, dict))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(doc)
    return out


def _dropped(sections) -> int:
    return sum(1 for s in sections if "fieldNotesDetail" in s)


@pytest.fixture(scope="module")
def sections():
    s = _screener_sections(json.loads(CAPTURE.read_text(encoding="utf-8")))
    assert len(s) >= 30, "the capture holds no screener sections: the rails below would be vacuous"
    return s


def test_no_recorded_screener_request_drops_its_field_definitions(sections):
    assert _dropped(sections) == 0, (
        "a recorded screener request went over CONTEXT_BUDGET_BYTES and lost its field definitions "
        "(fieldNotes). Make the new field cheaper for the Agent (filters._agent_omit, a shorter label) "
        "rather than re-recording the drop.")


def test_CONTROL_a_dropped_section_is_counted(sections):
    doctored = [dict(sections[0], fieldNotesDetail="field definitions omitted for size")] + sections[1:]
    assert _dropped(doctored) == 1


def test_the_agent_lists_the_two_rs_exit_fields_and_not_the_three_member_only_ages(sections):
    from api.services.screener import filters
    omitted = {f["key"] for f in filters.field_catalog() if f.get("agent_omit")}
    assert omitted == {"rs_quick_break_bars_ago", "rs_quicksand_bars_ago", "rs_dead_break_bars_ago"}
    full = [s["fields"] for s in sections if isinstance(s.get("fields"), str) and ":" in s["fields"]]
    assert full, "no full field list was recorded"
    for line in full:
        keys = {part.split(":", 1)[0] for part in line.split(";")}
        assert {"rs_exit_last", "rs_exit_bars_ago"} <= keys
        assert not (keys & omitted), sorted(keys & omitted)
    # still member filters: the screener, starters and saved screens keep every one
    for key in omitted:
        assert key in filters.FILTERS and filters.FILTERS[key]["category"] == "relative_strength"
