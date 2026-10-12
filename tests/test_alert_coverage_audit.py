"""⭐ ALERT COVERAGE — the SERVER half (opt-in: UIE_ALERT_COVERAGE_IN=<shapes.json from
app/src/components/chart/engine/__tests__/alertCoverage.measure.test.js>, optional UIE_ALERT_COVERAGE_REPORT).

For every saved-indicator shape the browser measured: save it through the REAL save path, admit it ONCE on
the real 579-bar parity tape (`admit_user_definition` — every whole-definition gate in its declared
order), and derive each plot's verdict exactly as `arm_for_alert` does (a raised admission refuses every
plot under its gate; a plot in `withheld` is refused under its own; anything else arms). Then compare with
the browser's verdict for the SAME document and plot, and flag the defect class UIE Phase 6 fixed: a plot
the browser calls alertable that the server refuses because of a SIBLING (or the reverse).
"""
from __future__ import annotations

import json
import os

import pytest

from api.services import alert_user_series as aus
from api.services import user_definitions
from tests.test_alert_user_admission import USER_A, defs_db, real_bars  # noqa: F401

IN = os.environ.get("UIE_ALERT_COVERAGE_IN")
REPORT = os.environ.get("UIE_ALERT_COVERAGE_REPORT")


def _server_verdicts(user: str, def_id: str, definition: dict, bars: list) -> tuple[str, dict]:
    keys = [str(p.get("key") if isinstance(p, dict) else p) for p in definition.get("plots") or []]
    try:
        admitted = aus.admit_user_definition(user, def_id, None, bars=bars)
    except aus.AdmissionRefused as exc:
        return "admission-refused", {k: {"status": "refused", "gate": exc.gate, "whole": True} for k in keys}
    withheld = admitted.get("withheld") or {}
    out = {}
    for k in keys:
        r = withheld.get(f"{def_id}.{k}")
        out[k] = {"status": "refused", "gate": r.gate, "whole": False} if r is not None else {"status": "supported", "gate": None, "whole": False}
    return "admitted", out


@pytest.mark.skipif(not IN, reason="opt-in: UIE_ALERT_COVERAGE_IN")
def test_alert_coverage_server_half_and_parity(defs_db, real_bars):
    shapes = json.load(open(IN, encoding="utf-8"))
    rows, mismatches, sibling_blocked, save_refused, invariant_broken = [], [], [], [], []
    for i, s in enumerate(shapes):
        # what the save hook POSTS (an oversized document as its shared graph), falling back to the document
        d = json.loads(json.dumps(s.get("saveForm") or s["definition"]))
        def_id = "u_%012x" % (0xC0FE00000000 + i)
        d["id"] = def_id                       # compute.fn is the formula's astHash — never touched
        user = f"cov-user-{i}"                 # one account per shape: the per-account cap (50) is not under test
        try:
            # ⛔ THE MEMBER'S DOOR, not `save_legacy`: `user_definitions.save` runs the save-time admission
            # (a `repaints` plot is never stored; `preview-repaints` only with the acknowledgement a member
            # gives on the badge), so only shapes that can EXIST in production are measured.
            user_definitions.save(user, def_id, d, repaint_acknowledged=True)
        except Exception as exc:  # noqa: BLE001 — a document the save path refuses is not a stored shape
            save_refused.append({"source": s["source"], "name": s["name"], "why": f"{type(exc).__name__}: {str(exc)[:160]}"})
            continue
        outcome, server = _server_verdicts(user, def_id, d, real_bars)
        # ⛔ THE INVARIANT THE PER-PLOT GATES MUST KEEP: a plot the server ADMITS never has, in its OWN
        # tree, a requirement the alert lane refuses, nor an unclean verdict nobody acknowledged.
        row = user_definitions.get(user, def_id)
        stored_def = aus._gate_lane(aus._gate_definition(user, def_id, None))
        for k, sv in server.items():
            if sv["status"] != "supported":
                continue
            tree = aus._plot_tree(stored_def, k)
            tags = user_definitions.requirement_tags({"compute": {"kind": "ast", "ast": tree}}) if tree is not None else []
            mode = (row.get("repaint") or {}).get(k, aus.REPAINT_CLEAN)
            if user_definitions.consumer_refusal("alert", tags) or (
                    mode != aus.REPAINT_CLEAN and not (mode == aus.REPAINT_PREVIEW and aus._ack_for(stored_def, k))):
                invariant_broken.append({"source": s["source"], "name": s["name"], "plot": k, "tags": tags, "repaint": mode})
        for k, sv in server.items():
            bv = s["browser"].get(k) or {}
            row = {"source": s["source"], "name": s["name"], "plot": k, "style": bv.get("style"),
                   "browser": bv.get("status"), "browser_gate": bv.get("gate"),
                   "server": sv["status"], "server_gate": sv["gate"], "whole": sv["whole"], "outcome": outcome}
            rows.append(row)
            if (bv.get("status") == "supported") != (sv["status"] == "supported"):
                mismatches.append(row)
        # the Phase 6 class: a whole-definition refusal while some plot would otherwise be answerable
        if outcome == "admission-refused":
            if any((s["browser"].get(k) or {}).get("status") == "supported" for k in server):
                sibling_blocked.append({"source": s["source"], "name": s["name"],
                                        "gate": next(iter(server.values()))["gate"]})
    summary = {"shapes": len(shapes), "saved": len(shapes) - len(save_refused), "plots": len(rows),
               "mismatches": len(mismatches), "sibling_blocked": len(sibling_blocked),
               "save_refused": len(save_refused)}
    summary["invariant_broken"] = len(invariant_broken)
    print("ALERT-COVERAGE-SERVER", json.dumps(summary))
    for x in invariant_broken[:20]:
        print("INVARIANT-BROKEN", json.dumps(x))
    assert not invariant_broken, f"{len(invariant_broken)} admitted plot(s) carry their own refused requirement or unclean verdict"
    for m in mismatches[:40]:
        print("MISMATCH", json.dumps(m))
    for b in sibling_blocked[:40]:
        print("SIBLING-BLOCKED", json.dumps(b))
    for r in save_refused[:40]:
        print("SAVE-REFUSED", json.dumps(r))
    if REPORT:
        json.dump({"summary": summary, "rows": rows, "mismatches": mismatches,
                   "sibling_blocked": sibling_blocked, "save_refused": save_refused},
                  open(REPORT, "w", encoding="utf-8"), indent=1)
