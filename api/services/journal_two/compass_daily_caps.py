"""Per-member daily ceilings on the Compass doors that spend a model call
OUTSIDE the chat turn cap: regenerating a weekly review, an EOD recap or a
trade review, and the pre-trade verdict (its route and its chat tool).

Nothing new is invented here. Each door is one `daily_counters` scope (auth.db,
ruling D-H5b), charged one per call with the member's id as the subject, so:
  * the count survives a deploy and resets at ET midnight by construction;
  * the account purge already deletes it (it deletes by `subject`);
  * a counter store that cannot be read ADMITS -- `daily_counters.take` fails
    open, because a cost ceiling that fails closed is an outage.

The ceilings are generous on purpose: they exist to stop a runaway loop (a
stuck client, a retry storm, a script), not to ration a member. Each is read
PER CALL from its env var (the `note_ask.writing_help_peruser_cap()` pattern),
so an operator can move one with no restart. Unparseable or negative falls
back to the default; `0` closes the door (never "unlimited").
"""
from __future__ import annotations

import os
from typing import NamedTuple

from api.services import daily_counters
from api.services.journal_two.calendar import et_today


class Door(NamedTuple):
    scope: str       # the daily_counters scope -- renaming one orphans the day's rows
    env: str         # the env var that overrides the default, read per call
    default: int
    sentence: str    # what the member is told when the door refuses


# A weekly review or EOD recap covers ONE period; regenerating the same one 25
# times in a day is a loop, not a member.
WEEKLY_REVIEW_REGENERATE = Door(
    "compass_weekly_review_regenerate", "COMPASS_WEEKLY_REVIEW_REGEN_DAILY_CAP", 25,
    "You've hit today's limit for regenerating weekly reviews — it resets at midnight ET.")
EOD_RECAP_REGENERATE = Door(
    "compass_eod_recap_regenerate", "COMPASS_EOD_RECAP_REGEN_DAILY_CAP", 25,
    "You've hit today's limit for regenerating recaps — it resets at midnight ET.")
# Trade reviews are per trade: a member working back through a busy day's
# trades may regenerate several, so this one is wider.
TRADE_REVIEW_REGENERATE = Door(
    "compass_trade_review_regenerate", "COMPASS_TRADE_REVIEW_REGEN_DAILY_CAP", 60,
    "You've hit today's limit for regenerating trade reviews — it resets at midnight ET.")
# A verdict is asked per candidate trade; a very active trader checks tens a
# day. 150 is several times that, and hard-check refusals are never charged.
PRE_TRADE_VERDICT = Door(
    "compass_pre_trade_verdict", "COMPASS_PRE_TRADE_VERDICT_DAILY_CAP", 150,
    "You've hit today's pre-trade verdict limit — it resets at midnight ET.")


def cap(door: Door) -> int:
    """The door's ceiling, read now from its env var."""
    raw = os.environ.get(door.env)
    if raw is None:
        return door.default
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return door.default
    return value if value >= 0 else door.default


def take(door: Door, user_id) -> bool:
    """Charge one use of `door` to the member for today (ET). True = admitted
    and counted; False = past the ceiling, nothing counted. A counter that
    cannot be read admits (`daily_counters.take` fails open)."""
    charge = daily_counters.Charge(door.scope, str(user_id), 1, cap(door))
    return daily_counters.take(et_today(), [charge]) is None
