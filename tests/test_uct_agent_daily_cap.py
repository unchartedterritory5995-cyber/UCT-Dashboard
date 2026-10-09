"""UCT Agent daily cap — what it counts and when it resets (Batch 6, Gate A).

Investigated 2026-10-08: a benchmark believed to run at "00:02 ET" was refused (429). The server
was right: the operator's clock check used Git Bash `TZ=America/New_York date`, which on that
machine has no tzdata and silently printed UTC — the run was at 00:02 UTC = 20:02 EDT, still the
same, already-exhausted ET day. These tests pin the server's contract so the boundary is never
re-litigated from a shell clock:
  * the day key is the America/New_York calendar date, whatever the process timezone;
  * the unit is one POST /api/agent/turn (not a model call), per user per ET day;
  * a refused request is never counted; a failed turn gives its charge back.
"""
from datetime import datetime, timezone

import pytest

from api.routers import uct_agent as rx
from api.services import daily_counters


class _Frozen(datetime):
    at = None

    @classmethod
    def now(cls, tz=None):
        return cls.at.astimezone(tz) if tz else cls.at


@pytest.mark.parametrize("utc, et_day", [
    ("2026-10-09T00:02:00+00:00", "2026-10-08"),   # the 'midnight' run: 20:02 EDT, same ET day
    ("2026-10-09T03:59:00+00:00", "2026-10-08"),   # 23:59 EDT
    ("2026-10-09T04:00:00+00:00", "2026-10-09"),   # 00:00 EDT — the real reset
    ("2026-12-01T04:59:00+00:00", "2026-11-30"),   # 23:59 EST (winter: UTC-5)
    ("2026-12-01T05:00:00+00:00", "2026-12-01"),
])
def test_the_day_key_is_the_new_york_date_whatever_the_process_timezone(monkeypatch, utc, et_day):
    _Frozen.at = datetime.fromisoformat(utc).astimezone(timezone.utc)
    monkeypatch.setattr(rx, "datetime", _Frozen)
    assert rx._et_day() == et_day


def test_one_charge_per_turn_per_user_refusals_never_counted_failures_given_back(monkeypatch):
    daily_counters.clear()
    monkeypatch.setenv("UCT_AGENT_DAILY_CAP", "2")
    monkeypatch.setattr(rx, "_et_day", lambda: "2026-10-09")
    a, b = "user-a", "user-b"
    assert rx._take(a) and rx._take(a)
    assert not rx._take(a)                                   # the 3rd is refused …
    assert daily_counters.value("2026-10-09", rx.SCOPE, a) == 2   # … and NOT counted
    assert rx._take(b)                                       # per user
    rx._give_back(a)                                         # a failed turn returns its charge
    assert rx._take(a)
    assert not rx._take(a)
    monkeypatch.setattr(rx, "_et_day", lambda: "2026-10-10")
    assert rx._take(a)                                       # a new ET day starts at zero
    daily_counters.clear()


def test_the_cap_defaults_to_300_turns_and_ignores_garbage(monkeypatch):
    monkeypatch.delenv("UCT_AGENT_DAILY_CAP", raising=False)
    assert rx.daily_cap() == 300
    monkeypatch.setenv("UCT_AGENT_DAILY_CAP", "abc")
    assert rx.daily_cap() == 300
    monkeypatch.setenv("UCT_AGENT_DAILY_CAP", "0")
    assert rx.daily_cap() == 1
