"""The ONE parse for every Notebook capability flag (wave 8, seam S8-1).

⚰️ WHY THIS MODULE EXISTS. Until wave 8 the server answered "is this Notebook
gate on?" three different ways for the same kind of variable:

  * the auth payload (`api/routers/auth._notebook_flags`) accepted
    `1/true/yes/on`, and an unrecognised value took the default;
  * `note_shares.enabled()` accepted the exact string `"1"` and nothing else;
  * writing help (`writing_help.writing_help_enabled`) kept a third copy of the
    truthy set.

The moment `J2_SHARE_LINKS_ENABLED` rides the payload, those two answers meet in
front of a member: a value of `true` would make the payload say ON (a Share
button renders) while every share route answered 404. One variable, two parses,
one process. So there is one parse, here, and `tests/test_notebook_flag_parse.py`
fails on any `os.environ.get` of a NOTEBOOK_FLAGS name anywhere else.

THE RULES, each a decision rather than a style:

  * READ PER CALL, never at import. A module-level capture turns every
    "flip it without a redeploy" sentence into a fiction
    (`tests/test_hub_preview_flag.py`).
  * UNSET takes the DEFAULT, and the default is per capability: a KILL switch
    over a shipped wave defaults ON (a forgotten variable must never read as a
    deliberate shutdown); an ENABLEMENT gate over a dark feature defaults OFF (a
    forgotten variable must never release a surface nobody decided to ship).
  * AN UNRECOGNISED VALUE takes the DEFAULT, never its opposite. A typo'd
    `flase` must neither kill a shipped wave nor release a dark one.
  * Case and surrounding whitespace do not matter.

⛔ `flag_on` IS FOR THE PAYLOAD'S FLAGS ONLY. Every literal `flag_on("NAME", …)`
call must name a row of `auth.NOTEBOOK_FLAGS` (rail (c) in
`tests/test_notebook_flag_parse.py`): the feature-flag index finds these gates
through that table, so a name read here and missing there would be a gate the
ledger cannot see.
"""
from __future__ import annotations

import os

#: The spellings that mean ON / OFF. Moved here from `api/routers/auth.py`, which
#: imports them for its breadth flags, so there is exactly one copy of each set.
TRUTHY = ("1", "true", "yes", "on")
FALSY = ("0", "false", "no", "off")


def flag_on(env_name: str, default: bool) -> bool:
    """Is the Notebook capability `env_name` on, read from the environment NOW.

    Unset, or a value that is neither a TRUTHY nor a FALSY spelling, answers
    `default`. The caller passes the default from the one table
    (`auth.NOTEBOOK_FLAGS`) or, for a route's gate, the literal that table holds.
    """
    raw = os.environ.get(env_name)
    if raw is None:
        return bool(default)
    v = raw.strip().lower()
    if v in FALSY:
        return False
    if v in TRUTHY:
        return True
    return bool(default)
