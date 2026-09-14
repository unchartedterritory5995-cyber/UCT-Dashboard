"""The adapter layer's kill switch (§3.11, P2.1).

`DISCORD_RENDER_V2_ADAPTERS_ENABLED` — a kill switch UNDER the V2 master, so **unset means ON**.

⛔ POLARITY IS NOT A STYLE CHOICE. A kill switch that defaults OFF makes "nobody set it" and
"somebody deliberately shut it down" indistinguishable from outside the repo — the ambiguity
`project_feature_flag_ledger` exists to prevent, and the same reasoning `HUB_PREVIEW_ENABLED`
already carries in CLAUDE.md. There is nothing to kill while `DISCORD_RENDER_V2_ENABLED` is unset,
because the V2 handlers are the only callers.

⛔ AND IT IS A SWITCH, NEVER A DELETE (`feedback_kill_switch_never_a_delete`). Setting it to `0`
makes the V2 chart handlers bind the raw upstream functions again — the pre-adapter timeouts, no
breakers — which is a rollback of P2.1 with no deploy. The adapter modules stay in place and keep
their rails; nothing is removed and no member data is touched.

⛔ READ PER CALL, NEVER CAPTURED AT IMPORT. A module-level capture passes every test and makes the
no-redeploy rollback a fiction: the pod would keep whatever the variable said when it booted. This
is the load-bearing property, and it has its own rail.
"""
from __future__ import annotations

import os

ENV = "DISCORD_RENDER_V2_ADAPTERS_ENABLED"

#: Accepted off values, case- and whitespace-insensitive. Everything else, including unset, is ON.
OFF_VALUES = frozenset({"0", "false", "no", "off"})


def adapters_enabled() -> bool:
    """True unless the switch is explicitly set to an off value."""
    return str(os.environ.get(ENV, "")).strip().lower() not in OFF_VALUES
