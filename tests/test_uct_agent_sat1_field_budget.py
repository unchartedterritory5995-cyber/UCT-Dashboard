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
    from api.services.screener import filters, fund_trends, volume_volatility, beats_insiders_funds
    from api.services.screener import store_columns, short_columns, row_columns
    omitted = {f["key"] for f in filters.field_catalog() if f.get("agent_omit")}
    # Pin moved 2026-11-14 (RS screens U1): every key the RS screens programme adds is kept out
    # of the Agent's list (`filters.RS_SCREENS_KEYS`); the budget has no room for them.
    # Pin moved 2026-11-21 (fundamental trend filters): the eight trend columns
    # (`fund_trends.COLUMNS`) are member controls kept out of the Agent's list the same way;
    # the Agent's screen tools were out of that unit's scope and the recorded requests did not move.
    trends = set(fund_trends.COLUMNS)
    # Pin moved 2026-11-23 (new Screener columns): the six volume & volatility columns
    # (`volume_volatility.COLUMNS`) and the five beats, insiders & funds columns
    # (`beats_insiders_funds.COLUMNS`) are member controls kept out of the Agent's list the same
    # way: the budget sat 77 bytes under the line on 2026-11-13 and has no room for eleven more
    # fields; the recorded requests did not move.
    vv, bif = set(volume_volatility.COLUMNS), set(beats_insiders_funds.COLUMNS)
    # Pin moved 2026-11-23 (held-store columns): the ten `store_columns.COLUMNS` and the short interest change
    # (`short_columns.CHANGE_COLUMN`) are member controls kept out of the Agent's list the same way; the
    # recorded requests did not move.
    held = dict(store_columns.CATEGORY, **{short_columns.CHANGE_COLUMN: "ownership"})
    # Pin moved 2026-11-24 (row columns): the twelve `row_columns.COLUMNS` (days to lockup, this month's seasonality,
    # the post-earnings drift, factor loadings, up / down capture) are member controls kept out of the Agent's list the
    # same way, each in its own family (`row_columns.CATEGORY`); the recorded requests did not move.
    held.update(row_columns.CATEGORY)
    assert omitted == ({"rs_quick_break_bars_ago", "rs_quicksand_bars_ago", "rs_dead_break_bars_ago"}
                       | set(filters.RS_SCREENS_KEYS) | trends | vv | bif | set(held))
    full = [s["fields"] for s in sections if isinstance(s.get("fields"), str) and ":" in s["fields"]]
    assert full, "no full field list was recorded"
    for line in full:
        keys = {part.split(":", 1)[0] for part in line.split(";")}
        assert {"rs_exit_last", "rs_exit_bars_ago"} <= keys
        assert not (keys & omitted), sorted(keys & omitted)
    assert len(filters.RS_SCREENS_KEYS) >= 9
    # still member filters: the screener, starters and saved screens keep every one
    for key in omitted:
        family = ("fundamental_trends" if key in trends else "volume_volatility" if key in vv
                  else "beats_insiders_funds" if key in bif else held[key] if key in held
                  else "relative_strength")
        assert key in filters.FILTERS and filters.FILTERS[key]["category"] == family
