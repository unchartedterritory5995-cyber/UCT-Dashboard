"""Return the synthetic smoke account to its CONTROL state.

⛔ Owner ruling, 2026-09-13. A smoke account that accumulates state stops being a
control: the next run cannot tell a product change from its own leftovers. This is the
standing reset, and it runs as **step 0 AND the final step** of every device run.

The control state is:

  * `joystick_hub` **unset** — so the UNSET-DEFAULT path is what the account exercises
  * `coachMarkSeen` unset · `handedness` right · `traceGestures` false
    (all three follow from the line above: they are the defaults)
  * no notes, no flags, no positions

⛔ **"Unset" is written as `{}`, and that is deliberate, not a shortcut.**
There is **no product path to delete a preference key**: `POST /api/auth/preferences`
is an UPSERT, and `delete_user_preference` exists in `api/services/auth_service.py` but
is imported into `api/routers/auth.py` and bound to **no route and no caller** — a dead
export (recorded 2026-09-13). `{}` is the reachable equivalent, and it is equivalent for
the only consumer that matters:

    useHubSettings.js:  stored && typeof stored === 'object' ? stored.enabled : undefined

`{}` is an object whose `.enabled` is `undefined`, so `storedEnabled` is `undefined`,
`everChose` (`typeof storedEnabled === 'boolean'`) is false, and `unsetDefault()` decides.
That is the same answer the resolver gives for an absent key.

⭐ **At stage 1 the hub is then visible ONLY because the account is admin.** That is the
whole point of the reset: with no stored `enabled:true` to explain it, the admin
explanation and the stored-true explanation can never again be conflated.

⛔ This writes to PRODUCTION, to the smoke account's own data, through the product's own
endpoint. No raw SQL, no other account, no other key.

    python tools/smoke_reset.py                 # reset + verify by read-back
    python tools/smoke_reset.py --check         # report only, write nothing
    python tools/smoke_reset.py --self-check    # prove the verifier can FAIL

Credentials: SMOKE_EMAIL / SMOKE_PASSWORD. ⚠️ On the operator box these live at **User**
scope and are absent from the process environment; read them with
`[Environment]::GetEnvironmentVariable(name,'User')` and set them on the process first.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_BASE = "https://uctintelligence.com"
PREF_KEY = "joystick_hub"
CONTROL_VALUE = "{}"

# Cloudflare 1010-blocks the default urllib UA on this host.
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Surfaces that must hold nothing. Each is (label, path, extractor).
STATE_SURFACES = [
    ("watchlists", "/api/watchlists", lambda d: d if isinstance(d, list) else d.get("watchlists", [])),
    ("flagged", "/api/watchlists/flagged", lambda d: (d or {}).get("items", []) if isinstance(d, dict) else (d or [])),
    ("j2 positions", "/api/j2/positions", lambda d: d if isinstance(d, list) else (d or {}).get("positions", [])),
]


def _opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )


def _req(url: str, data: dict | None = None) -> urllib.request.Request:
    body = json.dumps(data).encode() if data is not None else None
    headers = {"User-Agent": UA}
    if body is not None:
        headers["Content-Type"] = "application/json"
    return urllib.request.Request(url, data=body, headers=headers)


def login(op, base: str) -> None:
    email = os.environ.get("SMOKE_EMAIL")
    password = os.environ.get("SMOKE_PASSWORD")
    if not email or not password:
        sys.exit(
            "⛔ SMOKE_EMAIL / SMOKE_PASSWORD are not in the environment. On the operator "
            "box they are at User scope — set them on the process first."
        )
    with op.open(_req(f"{base}/api/auth/login", {"email": email, "password": password}), timeout=30) as r:
        if r.status != 200:
            sys.exit(f"⛔ login returned HTTP {r.status}")


def get_prefs(op, base: str) -> dict:
    with op.open(_req(f"{base}/api/auth/preferences"), timeout=30) as r:
        return json.loads(r.read().decode())


def set_pref(op, base: str, key: str, value: str) -> None:
    with op.open(_req(f"{base}/api/auth/preferences", {"key": key, "value": value}), timeout=30) as r:
        if r.status != 200:
            sys.exit(f"⛔ preference write returned HTTP {r.status}")


def parsed_hub(prefs: dict):
    """The stored joystick_hub blob, parsed. The column is TEXT holding JSON."""
    raw = prefs.get(PREF_KEY)
    if raw is None:
        return None, "ABSENT"
    if isinstance(raw, str):
        try:
            return json.loads(raw), "string"
        except json.JSONDecodeError:
            return None, "UNPARSEABLE"
    return raw, type(raw).__name__


def verify(prefs_before: dict, prefs_after: dict) -> list[str]:
    """Return a list of failures. Empty list == the account is a clean control.

    ⛔ This is the half that must be able to FAIL — see --self-check.
    """
    failures: list[str] = []

    hub, _kind = parsed_hub(prefs_after)
    if hub is None:
        hub = {}
    if not isinstance(hub, dict):
        failures.append(f"joystick_hub is not an object: {hub!r}")
    else:
        if "enabled" in hub:
            failures.append(f"joystick_hub.enabled is still SET ({hub['enabled']!r}) — not a control")
        if "coachMarkSeen" in hub:
            failures.append(f"joystick_hub.coachMarkSeen is still SET ({hub['coachMarkSeen']!r})")
        if hub.get("handedness") not in (None, "right"):
            failures.append(f"handedness is {hub.get('handedness')!r}, expected unset or 'right'")
        if hub.get("traceGestures") not in (None, False):
            failures.append(f"traceGestures is {hub.get('traceGestures')!r}, expected unset or False")

    # Every OTHER preference key must survive the write untouched.
    before_others = {k: v for k, v in prefs_before.items() if k != PREF_KEY}
    after_others = {k: v for k, v in prefs_after.items() if k != PREF_KEY}
    lost = sorted(set(before_others) - set(after_others))
    changed = sorted(k for k in before_others if k in after_others and before_others[k] != after_others[k])
    if lost:
        failures.append(f"other preference keys LOST: {lost}")
    if changed:
        failures.append(f"other preference keys CHANGED: {changed}")

    return failures


def check_surfaces(op, base: str) -> list[str]:
    """no notes / flags / positions. A surface that cannot be read is INCONCLUSIVE,
    never a pass — it is reported as such rather than counted clean."""
    notes = []
    for label, path, extract in STATE_SURFACES:
        try:
            with op.open(_req(f"{base}{path}"), timeout=30) as r:
                data = json.loads(r.read().decode())
            items = extract(data) or []
            n = len(items) if isinstance(items, list) else 0
            notes.append(f"  {label:<14} {n} item(s)" + ("" if n == 0 else "   ⚠️ NOT A CONTROL"))
        except urllib.error.HTTPError as e:
            notes.append(f"  {label:<14} INCONCLUSIVE (HTTP {e.code}) — not counted clean")
        except Exception as e:  # noqa: BLE001
            notes.append(f"  {label:<14} INCONCLUSIVE ({type(e).__name__}) — not counted clean")
    return notes


def self_check() -> int:
    """Prove the verifier can fail. A gate nobody has seen fail is not a gate."""
    ok = verify({"charts": "x"}, {"charts": "x", PREF_KEY: "{}"})
    dirty = verify({"charts": "x"}, {"charts": "x", PREF_KEY: '{"enabled":true,"coachMarkSeen":true}'})
    lost = verify({"charts": "x", "other": "y"}, {"charts": "x", PREF_KEY: "{}"})
    print("self-check:")
    print(f"  clean control      -> {len(ok)} failure(s)      (expect 0)")
    print(f"  stored enabled:true-> {len(dirty)} failure(s)   (expect 2)")
    print(f"  a sibling key lost -> {len(lost)} failure(s)    (expect 1)")
    for f in dirty:
        print(f"     would report: {f}")
    good = (len(ok) == 0) and (len(dirty) == 2) and (len(lost) == 1)
    print("  RESULT:", "PASS — the verifier discriminates" if good else "⛔ FAIL — it cannot tell the cases apart")
    return 0 if good else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--check", action="store_true", help="report only; write nothing")
    ap.add_argument("--self-check", action="store_true", help="prove the verifier can fail")
    args = ap.parse_args()

    if args.self_check:
        return self_check()

    op = _opener()
    login(op, args.base)

    before = get_prefs(op, args.base)
    hub_before, kind = parsed_hub(before)
    print(f"BEFORE  joystick_hub ({kind}): {json.dumps(hub_before)}")
    print(f"        other preference keys: {sorted(k for k in before if k != PREF_KEY)}")

    if args.check:
        print("\n--check: nothing written.")
    else:
        set_pref(op, args.base, PREF_KEY, CONTROL_VALUE)
        print(f"\nWROTE   {PREF_KEY} = {CONTROL_VALUE}")

    after = get_prefs(op, args.base)
    hub_after, kind_after = parsed_hub(after)
    print(f"AFTER   joystick_hub ({kind_after}): {json.dumps(hub_after)}")

    print("\nstate surfaces:")
    for line in check_surfaces(op, args.base):
        print(line)

    failures = verify(before, after)
    print()
    if failures:
        for f in failures:
            print(f"⛔ {f}")
        print("RESULT: NOT A CONTROL")
        return 1
    print("RESULT: the smoke account is a clean control "
          "(joystick_hub unset; every other preference key preserved)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
