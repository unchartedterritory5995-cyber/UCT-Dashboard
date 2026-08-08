"""Arm a DESIGNED matrix of indicator alerts so the closed-bar shadow lane has
something to observe — and guarantee, structurally, that it cannot spam anybody.

⭐ WHY THIS EXISTS. Task 8's cutover is gated on three live sessions of shadow
data. `alert_shadow_log.run_shadow_cycle` calls
`indicator_alert_service.list_active()`, so it can only observe alerts that are
ARMED — and production's `indicator_alerts` table has **zero rows**. Left alone,
the soak would run for three sessions, observe nothing, and the gate would pass
VACUOUSLY: a green light produced by an instrument pointed at an empty room.

This arms one alert for every **plot address** in `alert_catalog()` — the same
set Task 6's `--diff` enumerates — read at runtime so the matrix cannot drift
from the catalog it is supposed to cover.

⚠️ THE ADDRESS COUNT IS NOT THE FUNCTION COUNT, and this docstring used to say
it was ("the 30 catalog addresses (28 `INDICATOR_FUNCS` + 2 `EVENT_FUNCS`)").
An address is a `plots[i]["value"]`, and an indicator that publishes more than
one plot contributes more than one address, so the catalog yields MORE addresses
than it has functions. No number is written here on purpose: `catalog_addresses()`
is the answer and `tests/test_indicator_alert_service.py` is where it is pinned.

🔒 THE SPAM GUARANTEE, AND IT IS STRUCTURAL RATHER THAN HOPEFUL.
Every soak alert is created and then **snoozed** for `--snooze-days` (default
30). A snoozed alert is:

  * still `active=1`, so `list_active()` returns it and the shadow lane sees
    every catalog address — the observation is exactly what the soak needs;
  * still evaluated by the live lane, so its `last_value` stays current and the
    matrix is not a special case anywhere;
  * **never delivered.** `record_trigger` returns False for a snoozed alert
    BEFORE the fired log is touched, so no undelivered fire row exists, so
    `alert_fired_log.claim_delivery` finds nothing to claim, so
    `watchlist_alert_service.deliver_alert_payload` returns before the first
    channel. Three independent statements, one code path, all of them shipped
    and mutation-tested in this same task: the guarantee the soak rests on is
    the very fix the task exists to make.

  ⛔ THE OBVIOUS ALTERNATIVE IS WRONG. Creating them with `active=0` would also
  stop the spam — and it would stop `list_active()` returning them, which is
  precisely what the shadow lane reads. The soak would then observe nothing and
  the gate would pass vacuously anyway, which is the failure this tool exists to
  prevent. `--verify` asserts the difference: the WHOLE catalog visible to
  `list_active()` and 0 of them deliverable.

USAGE — arm (safe against production):

    python tools/alert_soak_matrix.py --arm --email you@example.com

    # optional: --sym SPY --tf 5 --snooze-days 30
    # then, to make the soak actually observe anything:
    #   railway variables --set ALERT_SHADOW_ENABLED=1 --service web
    #   (⚠️ `railway variables --set` AUTO-REDEPLOYS)

USAGE — check what is armed, and that it is muzzled:

    python tools/alert_soak_matrix.py --verify

USAGE — tear the whole thing down, one call, nothing else touched:

    python tools/alert_soak_matrix.py --disarm

⚠️ IT WRITES TO `AUTH_DB_PATH` (default `/data/auth.db`). Run it where that
resolves to the real store — on Railway, `railway ssh` on the **web** service
with `/opt/venv/bin/python` (bare `python3` is the Nix system python and has no
app deps).
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import indicator_alert_evaluator as ev  # noqa: E402
from api.services import indicator_alert_service as ias  # noqa: E402

# The marker every soak row carries, inside `params_json`. One string, one
# meaning: teardown selects on exactly this and can therefore never take a
# member's alert with it.
SOAK_TAG = "phase-c-shadow-matrix"
SOAK_KEY = "_soak"

DEFAULT_SYM = "SPY"
DEFAULT_TF = "5"
DEFAULT_SNOOZE_DAYS = 30


def catalog_addresses() -> list[dict]:
    """Every alertable address, read from the catalog rather than listed here.

    ⚠️ `plots[i]["value"]` IS THE ADDRESS, never the group `indicator` — for
    `adx`/`donchian`/`ichimoku` that is a group name with no value function
    behind it, and an alert stored on one would silently never fire.

    ⚠️ AND `conditions[i]` IS A DICT, not a string — `{value, label,
    needs_threshold}`. `needs_threshold` is what decides the fallback: an
    address with no catalog default gets 0.0 so the trigger path is actually
    exercised (a `None` threshold makes `check_condition` return False forever,
    and a soak of thirty alerts that can never trigger is a soak of nothing),
    while an address whose condition declares its OWN operand — `bb`'s band
    touch, the two `sar` events — keeps `None`, because `THRESHOLD_OPERAND`
    supplies its right-hand side and a typed number there would be ignored at
    best and misleading at worst.
    """
    out: list[dict] = []
    for entry in ev.alert_catalog():
        for plot in entry["plots"]:
            cond = plot["conditions"][0]
            threshold = plot["default_threshold"]
            if threshold is None and cond.get("needs_threshold"):
                threshold = 0.0
            out.append({
                "address": plot["value"],
                "condition": cond["value"],
                "threshold": threshold,
            })
    return out


def _is_soak(alert: dict) -> bool:
    raw = alert.get("params_json")
    if not raw:
        return False
    try:
        return json.loads(raw).get(SOAK_KEY) == SOAK_TAG
    except Exception:  # noqa: BLE001
        return False


def soak_rows() -> list[dict]:
    return [a for a in _all_rows() if _is_soak(a)]


def _all_rows() -> list[dict]:
    with sqlite3.connect(ias.db_path(), timeout=10.0) as db:
        rows = db.execute(
            f"SELECT {ias._COLS} FROM indicator_alerts ORDER BY id").fetchall()
    return [ias._row_to_dict(r) for r in rows]


def resolve_user(email: str | None, user_id: str | None) -> str:
    if user_id:
        return str(user_id)
    if not email:
        raise SystemExit("give --email or --user-id: the matrix has to be owned "
                         "by a real account or nothing can read it back")
    with sqlite3.connect(ias.db_path(), timeout=10.0) as db:
        row = db.execute(
            "SELECT id FROM users WHERE lower(email)=lower(?)", (email,)
        ).fetchone()
    if not row:
        raise SystemExit(f"no user with email {email!r} in {ias.db_path()}")
    return str(row[0])


def arm(user_id: str, sym: str, tf: str, snooze_days: int) -> dict:
    """Idempotent. Re-running adds only the addresses that are missing."""
    ias.init_schema()
    existing = {(a["indicator"], a["sym"], a["tf"]): a for a in soak_rows()}
    created, kept = [], []
    minutes = min(snooze_days * 24 * 60, ias.SNOOZE_MAX_MINUTES)

    for spec in catalog_addresses():
        key = (spec["address"], sym.upper(), tf)
        if key in existing:
            kept.append(spec["address"])
            # Re-muzzle: an armed soak row is the one state this must never be
            # left in, and a re-run is exactly when a half-finished previous run
            # gets repaired.
            ias.snooze(existing[key]["id"], minutes)
            continue
        alert_id = ias.create(
            user_id=user_id, sym=sym.upper(), indicator=spec["address"],
            condition=spec["condition"], threshold=spec["threshold"], tf=tf,
            params_json={SOAK_KEY: SOAK_TAG},
        )
        # ⭐ SNOOZED IMMEDIATELY — see the module docstring. Armed-then-snoozed
        # rather than never-armed, because `list_active()` is what the shadow
        # lane reads and a row it cannot see is a soak that observes nothing.
        ias.snooze(alert_id, minutes)
        created.append(spec["address"])
    return {"created": created, "kept": kept, "user_id": user_id,
            "sym": sym.upper(), "tf": tf, "snooze_minutes": minutes}


def disarm() -> dict:
    rows = soak_rows()
    for a in rows:
        ias.delete(a["id"])
    return {"deleted": [a["indicator"] for a in rows]}


#: How close to losing its muzzle a soak row may get before `--verify` refuses.
#: `--arm` is idempotent and re-snoozes every row, so the remedy is one command
#: — but only if something says the clock is running.
EXPIRY_WARN_DAYS = 7


def verify() -> dict:
    """Two numbers, and the second one is the guarantee — plus the CLOCK.

    `visible_to_shadow` must be the full matrix — a soak that observes nothing
    passes its gate vacuously. `deliverable_now` must be ZERO — that is the
    promise that arming 31 instruments on the owner's account cannot mail him.

    🔴 IT USED TO BE A HEALTH CHECK THAT COULD NOT WARN, AND THAT IS WORSE THAN
    NONE. `deliverable_now` was `state != snoozed` and nothing here ever read
    `snooze_until`, so it reported **0** right up to the cycle that sends the
    email. `ias.SNOOZE_MAX_MINUTES` is a hard 30-day ceiling `--snooze-days`
    cannot exceed, so the muzzle on the rows armed 2026-08-06 expires
    **2026-09-05 — the product's launch date** — and on the first cycle past it
    `record_trigger` re-arms, records a fire, returns True and delivers.
    Measured against the real `catalog_addresses()`: **27 of the 31 fire on that
    first cycle** (only `macd`, `bb` and the two `sar` events stay quiet), each
    one an AlertBell + a Resend email + a post to the ADMIN Discord.

    ⛔ SO BOTH NUMBERS NOW COME FROM `ias.snooze_active`, THE SAME PREDICATE THE
    SERVICE ENFORCES WITH. A tool that decided "muzzled" its own way is two
    answers to one question, which is how this got missed in the first place.
    """
    rows = soak_rows()
    active = {a["id"] for a in ias.list_active()}
    visible = [a for a in rows if a["id"] in active]
    # ⚠️ NOT `state != snoozed`. A row whose window has CLOSED is deliverable on
    # the next cycle no matter what its state column still says.
    deliverable = [a for a in rows if not ias.snooze_active(a)]
    addresses = {a["indicator"] for a in rows}
    expected = {s["address"] for s in catalog_addresses()}
    horizon = time.time() + EXPIRY_WARN_DAYS * 86400
    expiring = [a for a in rows
                if ias.snooze_active(a) and not ias.snooze_active(a, horizon)]
    untils = [int(a["snooze_until"]) for a in rows if a["snooze_until"] is not None]
    return {
        "armed": len(rows),
        "visible_to_shadow": len(visible),
        "deliverable_now": len(deliverable),
        "expiring_within_days": EXPIRY_WARN_DAYS,
        "expiring_soon": len(expiring),
        "muzzle_expires_at": min(untils) if untils else None,
        "muzzle_expires_in_days": (
            round((min(untils) - time.time()) / 86400, 2) if untils else None),
        "addresses_covered": len(addresses & expected),
        "addresses_expected": len(expected),
        "missing": sorted(expected - addresses),
        "shadow_enabled": os.environ.get("ALERT_SHADOW_ENABLED", "0") == "1",
        "db": ias.db_path(),
    }


def verify_refusals(report: dict) -> list[str]:
    """Every reason the soak is NOT healthy, as lines. Empty list = healthy.

    ⛔ EXIT CODES ARE A CHECK. A soak that observes nothing, or one that can mail
    the owner, must not read as success in a runbook.

    🔴 THE FLOOR IS FIRST BECAUSE ITS ABSENCE MADE EVERY OTHER REFUSAL
    UNREACHABLE. Each of the four checks below was written `if report["armed"]
    and …`, so `armed == 0` short-circuited ALL FOUR and `--verify` returned 0
    with the entire catalog sitting in `missing`. That is not a corner case: it
    is the state after `--disarm`, after a `--verify` whose `AUTH_DB_PATH`
    resolved somewhere else (`indicator_alert_service` defaults it to
    `/data/auth.db`, and this box has a real `C:\\data`), after a run against the
    wrong service, and after a rebuilt volume. **An empty room is the exact
    failure this tool exists to detect, and it was the one reading it as
    success.** `cutover_watch.verdict` already carried a `no-armed-alerts`
    floor for the same reason; the soak's own exit code is the one an operator
    reads after running the runbook's remedy, and it did not.

    Returning EARLY on the floor is deliberate, and the shape of the bug is why.
    On an empty room three of the four numbers below are GENUINELY fine —
    nothing is deliverable, nothing is invisible, nothing is expiring — so they
    could never have fired here whatever prefix they carried. The fourth,
    `missing`, was screaming the whole catalog and was gagged by its own
    `armed and`. Falling through would report it as "31 addresses unarmed",
    which is true and is the WRONG EMERGENCY: an operator needs to know the
    store is empty, not that it is 31 short.
    """
    if not report["armed"]:
        return ["REFUSED: ZERO soak rows are armed — the shadow lane observes "
                f"NOTHING and its gate would pass vacuously. db={report['db']} "
                f"(all {report['addresses_expected']} catalog addresses are "
                "missing). Run --arm, or check that AUTH_DB_PATH resolves to the "
                "store you meant."]
    bad: list[str] = []
    if report["deliverable_now"]:
        bad.append("REFUSED: a soak alert is DELIVERABLE")
    if report["visible_to_shadow"] != report["armed"]:
        bad.append("REFUSED: armed rows the shadow lane cannot see")
    if report["missing"]:
        bad.append(f"REFUSED: {len(report['missing'])} catalog addresses unarmed")
    # ⛔ THE COUNTDOWN IS ITSELF A FAILURE, AND IT HAS TO BE LOUD BEFORE THE
    # EMAILS, NOT AFTER. Re-running `--arm` re-snoozes every row and is
    # idempotent, so this is one command to clear — but only if it is said.
    if report["expiring_soon"]:
        bad.append(f"REFUSED: {report['expiring_soon']} soak rows lose their "
                   f"muzzle in {report['muzzle_expires_in_days']} days — re-run "
                   "--arm (it is idempotent) or --disarm")
    return bad


def _report_and_verdict(report: dict) -> int:
    print(json.dumps(report, indent=2))
    bad = verify_refusals(report)
    for line in bad:
        print(line, file=sys.stderr)
    return 1 if bad else 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--arm", action="store_true")
    p.add_argument("--disarm", action="store_true")
    p.add_argument("--verify", action="store_true")
    p.add_argument("--email")
    p.add_argument("--user-id")
    p.add_argument("--sym", default=DEFAULT_SYM)
    p.add_argument("--tf", default=DEFAULT_TF)
    p.add_argument("--snooze-days", type=int, default=DEFAULT_SNOOZE_DAYS)
    args = p.parse_args(argv)

    if args.arm:
        out = arm(resolve_user(args.email, args.user_id), args.sym, args.tf,
                  args.snooze_days)
        print(json.dumps(out, indent=2))
        # ⛔ `--arm` USED TO PRINT `verify()` AND `return 0` — its own verdict
        # was rendered to stdout and DISCARDED, so a half-finished arm (an
        # `ias.snooze` that raised, an address that failed to create) exited
        # SUCCESS with the JSON of its own failure on screen. The runbook's
        # one-command remedy now stands or falls on the same predicate `--verify`
        # uses; a tool whose fix cannot report that it did not work is a fix
        # nobody can trust.
        return _report_and_verdict(verify())
    if args.disarm:
        print(json.dumps(disarm(), indent=2))
        return 0
    if args.verify:
        return _report_and_verdict(verify())
    p.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
