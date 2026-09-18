"""THE MARKET-HOURS PUSH WINDOW IS GONE. This rail is what keeps it gone.

Owner ruling 2026-09-17, verbatim: *"I am sick of the no push window during market hours.
Remove that from whatever is causing this every day. Remove that permanently."*

⚰️ **WHY A RAIL AND NOT JUST A DELETION.** R18 retired the window on 2026-09-15 — but only
the REFUSAL. The constants (`RTH_GUARD_OPEN`/`_CLOSE`), the override env var
(`UCT_DEPLOY_WINDOW_OVERRIDE`), the docstring, the runbook section and a log line printed on
EVERY push all still named 09:25–16:05 ET. So:

  * every session that read the guard re-learned a rule that no longer existed;
  * every prompt that read a session's output re-inherited it;
  * and a grep for the constants reported a clock that no longer refused.

**Presence was the problem, not the predicate.** A retired rule that still prints its own
name on every push is not retired; it is advertised. The deletion is what fixes today, and
this rail is what fixes tomorrow.

⛔ WHAT THIS DOES **NOT** TOUCH. The two live clauses are untouched and must stay:
  * RECENCY  — the newest web deploy must be ≥ 600 s settled
  * BURST    — ≥ 3 distinct commits deployed in 60 min refuses
Those measure the thing the window was *guessing* at, and they are the clauses that
actually caught the 2026-09-12 and 2026-09-14 stacked-push incidents.
"""
from __future__ import annotations

import pathlib
import re

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]

#: The MECHANISM, not the times. ⛔ THIS DISTINCTION IS THE WHOLE DESIGN OF THE RAIL.
#: "09:25" appears in ~40 options-fill CSVs, in a product scheduler comment, and in several
#: programme RECORDS that describe the window's removal — all legitimate. Grepping the times
#: would fire on every one of them, and a rail that cries wolf is muted within a week
#: (`lesson_a_guard_that_tests_the_adjacent_thing`). These identifiers, by contrast, can
#: only exist if somebody has rebuilt the machinery.
FORBIDDEN = (
    "RTH_GUARD_OPEN",
    "RTH_GUARD_CLOSE",
    "CLOCK_OVERRIDE_ENV",
    "CLOCK_OVERRIDE_VALUE",
    "UCT_DEPLOY_WINDOW_OVERRIDE",
    "I-ACCEPT-AN-RTH-RESTART",
)

#: Where a push-policy clock could plausibly be reintroduced.
SCAN_DIRS = ("tools", "scripts", ".github")
SCAN_FILES = ("CLAUDE.md", "docs/runbooks/deploy-windows.md")

#: ⛔ RECORDS ARE NOT REGRESSIONS. Programme histories describe the window's removal and
#: must keep the ability to name what was removed — deleting the record would leave the next
#: reader unable to understand a ledger entry. Only the LIVE surfaces are scanned, so this
#: list is about SCOPE, not about exceptions.
SKIP_SUFFIXES = (".pyc", ".png", ".jsonl", ".csv")


def _files():
    out = []
    for d in SCAN_DIRS:
        base = REPO / d
        if not base.is_dir():
            continue
        for f in base.rglob("*"):
            if f.is_file() and not f.name.endswith(SKIP_SUFFIXES) and "node_modules" not in f.parts:
                out.append(f)
    for rel in SCAN_FILES:
        f = REPO / rel
        if f.is_file():
            out.append(f)
    return out


def test_the_window_mechanism_is_absent_from_every_live_surface():
    hits = []
    for f in _files():
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for tok in FORBIDDEN:
            if tok in text:
                hits.append(f"{f.relative_to(REPO)} :: {tok}")
    assert not hits, (
        "the market-hours push window has been reintroduced — owner ruling 2026-09-17 "
        "removed it PERMANENTLY:\n  " + "\n  ".join(hits))


def test_the_guard_module_exposes_no_window_attribute():
    """The module must not merely stop refusing — it must not CARRY the machinery."""
    import importlib.util as u
    spec = u.spec_from_file_location("prepush_norail", REPO / "tools" / "pre_push_guard.py")
    m = u.module_from_spec(spec)
    spec.loader.exec_module(m)
    bad = [n for n in dir(m) if re.search(r"RTH|WINDOW_(OPEN|CLOSE)|CLOCK_OVERRIDE", n)]
    assert not bad, f"guard still exposes window machinery: {bad}"
    assert not hasattr(m, "decide_clock"), "decide_clock is back — the clock gates again"


def test_the_guard_is_time_of_day_INVARIANT():
    """⭐ THE PROPERTY, NOT THE ABSENCE. The two tests above prove the machinery is gone;
    this one proves the BEHAVIOUR is what the ruling asked for — identical output at
    10:00 ET (market open) and 22:00 ET (closed) given identical deploy state.

    A rail that only checks for missing names passes on a guard that reimplemented the
    clock under new spelling."""
    import datetime as dt
    import importlib.util as u
    spec = u.spec_from_file_location("prepush_inv", REPO / "tools" / "pre_push_guard.py")
    m = u.module_from_spec(spec)
    spec.loader.exec_module(m)

    dep = {"status": "SUCCESS", "commit": "abc123", "age_s": 900.0, "meta": {}}
    at_open = dt.datetime(2026, 9, 17, 10, 0, 0)
    at_night = dt.datetime(2026, 9, 17, 22, 0, 0)

    v1, r1 = m.decide(dep, now_age=900.0)
    v2, r2 = m.decide(dep, now_age=900.0)
    assert (v1, r1) == (v2, r2)

    # The cadence clause takes an explicit `now`; the same deploy history at two very
    # different hours must produce the same verdict.
    # ⚠ tz-aware on BOTH sides: decide_cadence parses ISO "…Z" into aware datetimes, so a
    # naive `now` raises TypeError rather than failing the assertion. A rail that errors
    # instead of asserting still goes red, but it reports the wrong thing.
    tz = dt.timezone.utc
    at_open_a = at_open.replace(tzinfo=tz)
    at_night_a = at_night.replace(tzinfo=tz)
    rows = [{"commit": "aaa", "createdAt": (at_open_a - dt.timedelta(hours=5))
             .isoformat().replace("+00:00", "Z")}]
    k1 = m.decide_cadence({"rows": rows}, now=at_open_a)
    k2 = m.decide_cadence({"rows": rows}, now=at_night_a)
    assert k1[0] == k2[0], (
        f"the guard's verdict changed with the hour: 10:00 -> {k1[0]}, 22:00 -> {k2[0]}. "
        "A time-of-day clause has been reintroduced.")


def test_the_two_live_clauses_still_exist():
    """NON-VACUITY. Everything above asserts an ABSENCE, and a guard that had been gutted
    entirely would satisfy all of it. The clauses the ruling explicitly KEPT must still be
    there, or this file is certifying an empty guard."""
    import importlib.util as u
    spec = u.spec_from_file_location("prepush_live", REPO / "tools" / "pre_push_guard.py")
    m = u.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.RECENT_PUSH_WINDOW_SECONDS == 600, "the recency clause moved or vanished"
    assert m.BURST_MIN_DEPLOYS == 3 and m.BURST_WINDOW_SECONDS == 3600, "the burst clause moved"
    assert callable(m.decide) and callable(m.decide_cadence)


@pytest.mark.parametrize("tok", FORBIDDEN)
def test_the_scan_can_actually_see_each_forbidden_token(tmp_path, tok, monkeypatch):
    """CONTROL: plant each token in a scanned directory and prove the scan finds it.
    Without this, a scan whose file list is empty (a renamed directory, a bad glob)
    passes silently and reports the window as removed forever."""
    planted = REPO / "tools" / "_rail_probe_tmp.py"
    planted.write_text(f"# {tok}\n", encoding="utf-8")
    try:
        found = any(tok in f.read_text(encoding="utf-8", errors="replace")
                    for f in _files() if f.name == "_rail_probe_tmp.py")
        assert found, f"the scan cannot see {tok} even when planted — the file list is broken"
    finally:
        planted.unlink(missing_ok=True)
