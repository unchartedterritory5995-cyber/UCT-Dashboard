"""`RS_HISTORY_ENABLED` — one definition, in a module that costs nothing to import.

⛔⛔ **THIS EXISTS SO THAT READING A BOOLEAN DOES NOT BUILD THE WHOLE APP.**
The function lived in `api/main.py`, and `api/services/indicator_alert_evaluator.py`
read it with a lazy `from api.main import rs_history_enabled`. That one line put
`api/main.py` inside **flow-worker's** import closure, and the whole web app came
with it: flow-worker's reachable set measured **1,654 files against 24 watched**
(`tools/flow_worker_watch_coverage.py`), where the deploy-windows runbook still
says 154/133. Among the files it dragged in were the S7 `alert_taxonomy/price_level*`
modules, which is what turned
`tests/test_flow_worker_watch_coverage.py::test_price_level_is_STILL_OUTSIDE_flow_workers_closure`
red on master — and, under that gate's CP3 ruling, silently reclassified those
modules as behaviour-changing, so a change to one would need a deploy window and a
marker bump that nobody would know to give it.

⭐ `api/services/screener/filters.py::_rs_history_on` had already met this and
worked around it from the other side — it reads the function off `sys.modules`
and says why: *"importing `api.main` builds the whole app"*. That workaround
answers "off" to any caller that is not the web process. Moving the definition
here is the fix that version could not make: every caller gets the REAL value,
and nobody imports the app to get it.

⛔ **KEEP THIS MODULE A LEAF.** It imports `os` and nothing else, and it must not
grow an `api.` import — that is the whole point, and
`tests/test_flow_worker_closure.py` fails if `api.main` re-enters the closure.
`api.main` re-exports `rs_history_enabled`, so `api.main.rs_history_enabled`
keeps working for the readers that already spell it that way (the screener
router, and `filters.py`'s `sys.modules` read).
"""
from __future__ import annotations

import os


def rs_history_enabled() -> bool:
    """`RS_HISTORY_ENABLED` read per call: a flip needs no restart. Only "1" arms it
    (the `_wire_enabled` convention: "true", "yes" and typos all mean off). ONE
    definition, so the nightly job and every surface that reports the switch cannot
    disagree about it."""
    return os.environ.get("RS_HISTORY_ENABLED", "0") == "1"
