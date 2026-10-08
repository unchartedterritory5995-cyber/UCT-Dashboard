"""The wave-14 switch, server side (W14-C1 controller ruling, 2026-10-05).

Moved here from `api/services/notebook_flags.py` at the waves 12-15 landing, unchanged in
behaviour. WHY ITS OWN MODULE: `wave14_switch_on` reads its defaults from the one table,
`api.routers.auth.NOTEBOOK_FLAGS`, so it imports the auth router (late). Living inside
`notebook_flags` -- the one parse, which `journal_two.note_tasks` imports for its kill
switch -- that import put `api.routers.auth`, and through it `api.main`, on flow-worker's
static import closure (flow_worker_main -> oi_snapshots -> schwab_router ->
narrative_cost_guard -> auth_db -> journal_two.db -> note_tasks -> notebook_flags ->
routers.auth -> api.main), which the flow-worker closure rails
(`tests/test_flow_worker_watch_coverage.py`, `tests/test_alert_taxonomy_price_level_projection.py`)
refuse. Only the web's sample-notebook seed asks this question, so the edge now starts there.
"""
from __future__ import annotations

from api.services.notebook_flags import flag_on


#: THE WAVE-14 SWITCH, server side (W14-C1 controller ruling, 2026-10-05). The client's ONE
#: rule is `checklistEnabled()` in
#: app/src/pages/journal-2-0/components/notebook/onboarding/gettingStartedPref.js
#: (onboarding AND getting-started); this is its mirror, and it is never restated by hand:
#: tests/test_sample_notebook_switch.py reads the flag keys out of that JS function and fails
#: unless they are exactly these variables' payload keys. Defaults come from the one table,
#: `auth.NOTEBOOK_FLAGS`, so the server reads the switch exactly as the payload reports it.
WAVE14_SWITCH = ("NOTEBOOK_ONBOARDING_ENABLED", "NOTEBOOK_GETTING_STARTED_ENABLED")


def wave14_switch_on() -> bool:
    """Is wave 14 armed for members, read NOW (per call, like every flag here)?"""
    from api.routers.auth import NOTEBOOK_FLAGS  # the one table; imported late (a router, kept off import time)
    return all(flag_on(name, NOTEBOOK_FLAGS[name]) for name in WAVE14_SWITCH)
