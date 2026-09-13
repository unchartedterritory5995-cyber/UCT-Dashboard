"""The canary tells "signed out" and "production could not answer" apart.

⚰️ **2026-09-13T14:00:01Z, the daily run, and it cost that day's evidence.**
Another session pushed to master at 13:58:43 and `web` was mid-swap, so
`/api/auth/me` could not answer. The canary treated **any** non-200 as a
signed-out rig: it wrote *"⛔ SIGN-IN REQUIRED — the rig profile is signed out"*
into the resume doc, fired a desktop balloon, and wrote **no check row at all**.

⛔ The rig was signed in the whole time. Runs at 15:05Z the same morning read
`/api/auth/me` **200** on the same profile, same account id.

⛔⛔ **AND THE ALARM IT RAISES IS THE EXPENSIVE KIND.** A SIGN-IN REQUIRED block
tells the owner to go and sign in — *a 30-day event dressed as a session event*,
which is precisely what the rig's standing rule says no session may ask for
while `/api/auth/me` returns 200. The next scheduled run would have said it
again, and the one after that.

⭐ Three answers now, kept apart: **200** signed in · **401** genuinely signed
out, self-heal then alarm · **anything else** production could not answer, so
retry and report the run as unreadable — which is a different fact, and must not
fire the sign-in alarm or claim a clean interval.
"""
from __future__ import annotations

import importlib.util
import pathlib
import re
import sys

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
SRC = (TOOLS / "window_check.py").read_text(encoding="utf-8")


def _load():
    spec = importlib.util.spec_from_file_location("window_check", TOOLS / "window_check.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["window_check"] = mod
    spec.loader.exec_module(mod)
    return mod


def _auth_block() -> str:
    """The region of `run_check` that decides what the auth answer means."""
    start = SRC.index('            healed = ""')
    end = SRC.index('chk.add("signed in", True', start)
    return SRC[start:end]


def test_only_a_401_or_a_wrong_account_raises_the_sign_in_alarm():
    """⛔ THE LOAD-BEARING ONE. `needs_signin` is what writes the SIGN-IN
    REQUIRED block and fires the balloon; it must be reachable only from a
    genuine 401 or a session belonging to some other account."""
    block = _auth_block()
    assert "chk.needs_signin = True" in block
    # the guard immediately above the alarm names 401 explicitly...
    alarm = block[:block.index("chk.needs_signin = True")]
    last_if = alarm.rindex("if ")
    condition = alarm[last_if:]
    assert 'me.get("status") == 401' in condition, condition
    assert "!= 200" not in condition, (
        "a `!= 200` guard is the defect: it makes 502, 503 and 0 all mean 'signed out'")


def test_a_non_answer_is_reported_as_INCONCLUSIVE_and_raises_no_alarm():
    """⛔ "Unreadable" and "signed out" are different facts. The first must not
    write a sign-in block, and must not write a check row either — a row
    assembled from nothing reads as evidence."""
    block = _auth_block()
    assert "INCONCLUSIVE" in block
    assert "NOT a signed-out rig" in block
    # ...and that branch is reached WITHOUT setting needs_signin
    tail = block[block.index('if me.get("status") != 200:'):]
    assert "needs_signin" not in tail, tail


def test_it_retries_before_deciding_anything():
    """A Tier-1 deploy blips `/api/*` for about a minute
    (`docs/runbooks/deploy-windows.md`), so the instrument must survive one
    rather than crash into it. One probe during a swap is not a verdict."""
    block = _auth_block()
    assert re.search(r"for _attempt in range\((\d+)\)", block), block
    tries = int(re.search(r"for _attempt in range\((\d+)\)", block).group(1))
    assert tries >= 3, f"{tries} attempt(s) is not a retry across a pod swap"
    assert 'me.get("status") in (200, 401)' in block, (
        "the retry must stop on a REAL answer — 200 or 401 — not on any response")


def test_the_self_heal_still_runs_for_a_real_sign_out():
    """⭐ THE PAIR. Narrowing the alarm must not delete the recovery: a genuinely
    signed-out rig is still re-authenticated before anything is reported, or this
    fix trades a false alarm for a broken unattended run."""
    block = _auth_block()
    heal = block.index("reauthenticate(page)")
    guard = block[:heal]
    assert 'me.get("status") == 401' in guard
    assert "self-healed" in block


def test_the_module_still_imports_and_keeps_its_contract():
    """⛔ NON-VACUITY. Every assertion above reads source text, and source text
    is satisfied by a file that no longer runs. Load it and check the names the
    canary's callers depend on are still there."""
    m = _load()
    for name in ("run_check", "AUTH_JS", "ACCOUNT_ID", "reauthenticate", "FLAG_KEY"):
        assert hasattr(m, name), name
    assert "notebook_" in m.AUTH_JS      # the Wave K keys still ride the payload
