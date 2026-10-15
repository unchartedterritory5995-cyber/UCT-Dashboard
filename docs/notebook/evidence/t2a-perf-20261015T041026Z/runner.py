"""Runs tools/notebook_perf_harness.py UNCHANGED, with two additions that live here and not in the tool.

    python runner.py <the harness's own arguments>        # env T2A_FLAGCHECK, T2A_ALERT_CARET

1. FLAG CHECK. After the harness has signed its perf account in (`_provision`), this reads
   GET /api/auth/me for that same member and writes the smart chips key as the server serves it to
   `$T2A_FLAGCHECK` (JSON). The client latches that very payload, so `true` there is what makes the
   alert plugin act in the typing run. A typing run that "had the chip switch on" with no such
   record is a claim, not a measurement.
2. ALERT CARET (`T2A_ALERT_CARET=1`). The harness types at the END of the note, which is the seeded
   marker paragraph. This puts an alert sentence at the START of that paragraph, so the paragraph the
   caret sits in holds "alert me if NVDA closes below 120 <marker>" and every keystroke runs the
   alert plugin's parse of it. It changes ONLY the text of the last paragraph of the seeded notes
   (the marker the open waits for is untouched); sizes, counts and everything measured are the harness's.
   ⛔ This is a seed change, not a chosen typing position: the harness still cannot type into an
   arbitrary paragraph.
"""
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
assert (REPO / "tools" / "notebook_perf_harness.py").is_file(), REPO
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402

SENTENCE = "alert me if NVDA closes below 120 "

_provision = h._provision


def provision(admin_req, member_req, base, **kw):
    out = _provision(admin_req, member_req, base, **kw)
    path = os.environ.get("T2A_FLAGCHECK")
    if path:
        me = member_req.get(base + "/api/auth/me").json()
        Path(path).write_text(json.dumps({
            "notebook_smart_chips_enabled": me.get("notebook_smart_chips_enabled"),
            "notebook_journal_styles_enabled": me.get("notebook_journal_styles_enabled"),
            "env_NOTEBOOK_SMART_CHIPS_ENABLED": os.environ.get("NOTEBOOK_SMART_CHIPS_ENABLED"),
            "alert_caret": os.environ.get("T2A_ALERT_CARET") == "1",
        }, indent=1), encoding="utf-8")
    return out


h._provision = provision

if os.environ.get("T2A_ALERT_CARET") == "1":
    _paragraphs_doc = h.paragraphs_doc

    def paragraphs_doc(n, tag):
        doc, marker = _paragraphs_doc(n, tag)
        last = doc["content"][-1]["content"][0]
        assert last["text"] == marker, "the last paragraph is no longer just the marker"
        last["text"] = SENTENCE + marker
        return doc, marker

    h.paragraphs_doc = paragraphs_doc

if __name__ == "__main__":
    sys.exit(h.main(sys.argv[1:]))
