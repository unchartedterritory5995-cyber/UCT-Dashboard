"""audit-not-wired finding 4 — `/confluence` + `/confluence-scan` are a
DELIBERATE PROTOTYPE, and this file is what makes that a decision rather than an
oversight.

The finding: a complete paid signal (`api/services/signature/confluence.py`,
`tests/test_confluence.py`, a bounded scan with a background warmer, and TWO
later commits of performance work) that no member can request — the string
`confluence` occurs nowhere under `app/`.

Two honest outcomes were on the table: give it a `compute.kind: 'server'`
definition on the lane the other three Signature indicators were genericized
onto, or record it as a deliberate prototype and say why. **The lane was measured
first, and it does not fit.** The measurement is `test_a_confluence_signal_
carries_no_bar_time_...` below, and it is executable rather than asserted in
prose, because "it does not fit the lane" is exactly the kind of claim that rots
into folklore.

⛔ AND THE RECORD IS RAILED IN BOTH DIRECTIONS. `test_wiring_confluence_onto_the
_server_lane_must_move_the_record_with_it` is a biconditional: the moment a
confluence definition appears in `registry_defs.SERVER_DEFS`, the "not wired,
here is why" row in the spec has to move with it. A record that can go stale
while the code changes underneath it is the rot this repo has now found in a
writer index, a route count, a taxonomy version and a thread pool.
"""
import ast
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services.signature import confluence, flow_breakout, registry_defs, rules
from api.services.signature.flow_breakout import _bar_date_iso

REPO = pathlib.Path(__file__).resolve().parent.parent
SPEC = REPO / "docs/superpowers/specs/2026-07-31-indicator-platform-design.md"

# The row's anchor in the spec's adjudicated-decisions table. ONE literal, read
# by both halves of the biconditional below.
RECORD_ANCHOR = "D-A8 — `/confluence` + `/confluence-scan` are a DELIBERATE PROTOTYPE"

LEVEL = {"price": 100.0, "lo": 99.0, "hi": 101.0, "notional": 50e6,
         "rank": 1, "printCount": 5, "lastDate": "2026-07-15"}


def _bars(closes):
    return [{"t": 20260701 + i, "o": c, "h": c + 1, "l": c - 1, "c": float(c), "v": 1_000_000}
            for i, c in enumerate(closes)]


def _flow(bars, side, prem="2M", n=5):
    isos = {_bar_date_iso(b["t"]) for b in bars[-n:]}
    return {iso: [{"CreatedDate": "", "CallPut": side, "Premium": prem}] for iso in isos}


# ── THE MEASUREMENT THAT DECIDED IT ─────────────────────────────────────────

def test_a_confluence_signal_carries_no_bar_time_and_an_fcb_signal_does():
    """The lane's wire is COLUMNS positionally joined to `times`, and the only
    way a Signature signal becomes one is `registry_defs.event_columns`, which is
    handed `(iso_date, direction)` HITS. A signal with no bar to key on cannot
    produce one.

    `flow_breakout.fcb_signals` iterates `detect_breakouts(bars)` and every
    signal carries `barTime` — which is exactly why `_fcb_provider` can build a
    `{0, 1, NaN}` column per direction. `confluence.evaluate` scores
    `bars[-1]` — one CURRENT-STATE verdict, no history, no bar key.

    ⛔ THE POSITIVE CONTROL IS THE POINT. Without the FCB half this reads as
    "some dict lacks some key", which would stay true if the whole notion of a
    bar key were deleted from the module.
    """
    bars = _bars([97, 98, 97, 98, 100, 101, 102])
    sigs = confluence.evaluate([LEVEL], bars, _flow(bars, "CALL"))
    assert len(sigs) == 1, "the fixture stopped producing a confluence signal"

    # Nothing in the signal names a bar. Not `barTime`, and not any alias of it.
    bar_keys = {k for k in sigs[0] if "time" in k.lower() or k in ("t", "bar", "barTime")}
    assert bar_keys == set(), (
        f"a confluence signal now carries {sorted(bar_keys)} — if it genuinely "
        f"identifies the bar it fired on, the server-lane refusal recorded in the "
        f"spec has expired and must be revisited, not worked around"
    )

    # POSITIVE CONTROL — the sibling that IS a column tenant does carry one.
    # Built from the detector's OWN thresholds so a rule change moves the fixture
    # rather than silently emptying the control.
    n = rules.FCB_LOOKBACK
    quiet = _bars([100.0] * n)
    breakout = _bars([100.0] * (n + 2))[-2]
    breakout["c"] = 130.0
    breakout["h"] = 131.0
    breakout["v"] = int(1_000_000 * rules.FCB_VOL_MULT * 2)
    breakouts = flow_breakout.detect_breakouts(quiet + [breakout, _bars([100.0])[0]])
    assert breakouts, (
        "the control fixture produced no breakout at all — this test's positive "
        "control is gone and its conclusion is unsupported"
    )
    assert "barTime" in breakouts[0], (
        "flow_breakout stopped stamping `barTime`, so this test's control is gone "
        "and its conclusion is no longer supported"
    )


def test_the_confluence_payload_is_the_non_positional_shape_dpl_and_gxw_use():
    """`_DPL` and `_GXW` declare `columns: []` because a level is a horizontal
    LINE at a price and v1's `hlines` style takes a STATIC levels array the
    column wire cannot carry — so both draw through `signatureData.js`, not
    through the engine's server lane. Confluence's payload is the same shape
    (levels + a verdict), so the same limit applies to it.
    """
    dpl = registry_defs.definition("uct-darkpool-levels")
    gxw = registry_defs.definition("uct-gex-walls")
    fcb = registry_defs.definition("uct-flow-breakout")
    assert dpl["columns"] == [] and gxw["columns"] == []
    # …and the control: the one Signature definition that IS a column tenant.
    assert fcb["columns"] == ["bull", "bear"]

    bars = _bars([97, 98, 97, 98, 100, 101, 102])
    sig = confluence.evaluate([LEVEL], bars, _flow(bars, "CALL"))[0]
    # It is a LEVEL verdict: it names the price band it fired against, exactly
    # like a dark-pool level, and nothing that indexes a series.
    assert {"level", "lo", "hi", "close"} <= set(sig)


def test_the_scan_answers_about_a_LIST_of_symbols_which_no_chart_surface_asks():
    """`/confluence-scan` takes up to `_DPC_SCAN_MAX_SYMS` tickers and answers
    `pending`/`complete`. That is a SCREENER contract — a chart asks about one
    symbol — and it is the second half of why the chart lane is the wrong home.

    Read off the router's own module rather than restated, so a change to the
    bound is visible here.
    """
    from api.routers import signature as sig_router
    assert sig_router._DPC_SCAN_MAX_SYMS > 1
    doc = sig_router.confluence_scan.__doc__ or ""
    assert "pending" in doc and "complete" in doc


# ── THE RECORD, RAILED BOTH WAYS ────────────────────────────────────────────

def _spec_text() -> str:
    assert SPEC.exists(), f"the platform spec moved: {SPEC}"
    return SPEC.read_text(encoding="utf-8")


def test_the_spec_records_confluence_as_a_deliberate_prototype_and_says_why():
    """The finding's own smallest fix: *"record it as a deliberate prototype in
    the spec so the next reader does not re-optimise a dead endpoint."* Two
    performance commits were already spent on a request no member can make.
    """
    text = _spec_text()
    assert RECORD_ANCHOR in text, (
        "the deliberate-prototype record is gone from the platform spec. If "
        "confluence was WIRED, delete this test with the row; if it was not, the "
        "next reader has nothing telling them why the endpoint has no caller."
    )
    row = next(line for line in text.splitlines() if RECORD_ANCHOR in line)
    # It must name both routes, so a reader searching for either finds the record.
    for route in ("/confluence", "/confluence-scan"):
        assert route in row, f"the record does not name {route}"
    # …and it must carry the REASON, not just the status.
    assert "barTime" in row, "the record states a status without the measurement behind it"


def test_wiring_confluence_onto_the_server_lane_must_move_the_record_with_it():
    """THE BICONDITIONAL. A confluence row in `SERVER_DEFS` and a spec that still
    says "not wired" cannot both be true — that is precisely the half-wired state
    this project has hit eight times, plus a record that lies about it.

    Derived from the lane's own table, never from a typed id list: whatever a
    confluence definition ends up being called, it will carry the `dpc` rules key
    that `rules.VERSIONS` already declares.
    """
    assert "dpc" in rules.VERSIONS, "the dpc rule set vanished; this rail's premise is gone"
    on_lane = [d["id"] for d in registry_defs.SERVER_DEFS
               if d.get("rules_key") == "dpc" or "confluence" in d["id"]]
    recorded_as_prototype = RECORD_ANCHOR in _spec_text()
    assert bool(on_lane) != recorded_as_prototype, (
        f"confluence definitions on the server lane: {on_lane}; spec still records it "
        f"as a deliberate prototype: {recorded_as_prototype}. Exactly one of those "
        f"must be true. Wiring it means deleting the spec row (and this test) in the "
        f"SAME change."
    )


def test_the_router_points_a_reader_at_the_record_rather_than_at_nothing():
    """A test nobody runs is not where a reader looks; the endpoint is. Asserted
    by AST over the router's own source so a comment reflow cannot break it and a
    deleted docstring cannot pass it.
    """
    src = (REPO / "api/routers/signature.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    doc = None
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "confluence_scan":
            doc = ast.get_docstring(node)
    assert doc, "confluence_scan lost its docstring"
    assert "D-A8" in doc, (
        "the scan endpoint does not point at the decision record, so the next "
        "reader arrives exactly where the last two performance commits did"
    )
