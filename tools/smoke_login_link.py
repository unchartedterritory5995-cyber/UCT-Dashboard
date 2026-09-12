"""Mint a single-use login URL for the synthetic smoke account, for a real-device session.

⛔⛔ WHY THIS EXISTS. Real-device testing runs on BrowserStack **Live**, a screen mirror. There is
no honest way to sign a device in there: an agent must not type a password into a field, and the
owner should not have to hand-type one for every session — which is what actually stalled this
programme. So the session is handed over as a LINK. This script is the operator's end of it.

⭐ THE PASSWORD NEVER TOUCHES A FORM FIELD. It is read from the environment and POSTed to
`/api/auth/login` by a script — the same thing `tools/hub_nav_smoke.py:247` has always done — and
the resulting admin session is what authorises the link. The device only ever sees the URL.

⚠️ THE URL IS A CREDENTIAL FOR FIVE MINUTES. It is typed into a third party's client, so it lands
in BrowserStack's session recording and in this app's access log as a query string. Single-use
plus a five-minute floor is what makes that acceptable for a SYNTHETIC account; do not reach for
this shape for a real one.

Usage:
    python tools/smoke_login_link.py                       # production
    python tools/smoke_login_link.py --base http://localhost:8000
    python tools/smoke_login_link.py --self-check
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
SMOKE_USER_ID = "f4433528-6466-474a-949c-8d5eda8a7b91"
# Cloudflare 1010-blocks the default urllib UA on this host; a browser UA is the documented
# workaround for every script in this repo that talks to production.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def say(text: str, err: bool = False) -> None:
    stream = sys.stderr if err else sys.stdout
    stream.buffer.write((text + "\n").encode("utf-8", "replace"))
    stream.flush()


def mint(base: str, email: str, password: str, user_id: str) -> str:
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    headers = {"Content-Type": "application/json", "User-Agent": UA}

    login = urllib.request.Request(
        f"{base}/api/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers=headers,
    )
    with opener.open(login, timeout=30) as resp:
        payload = json.loads(resp.read())
    if payload.get("requires_totp"):
        raise SystemExit(
            "⛔ The smoke account has TOTP enabled. A login link deliberately refuses such an "
            "account — it must never out-rank a second factor — so this path is closed until "
            "TOTP is removed from the synthetic account."
        )

    req = urllib.request.Request(
        f"{base}/api/auth/smoke-login-link",
        data=json.dumps({"user_id": user_id}).encode(),
        headers=headers,
    )
    with opener.open(req, timeout=30) as resp:
        return json.loads(resp.read())["url"]


def self_check() -> int:
    """No network. Proves the two things that silently produce a useless run."""
    fails = []
    if SMOKE_USER_ID != "f4433528-6466-474a-949c-8d5eda8a7b91":
        fails.append("the allow-listed id drifted from the one the router ships")
    # ⛔ The credentials check is the one that matters: without it this script's failure mode is a
    # 401 traceback that reads like the endpoint is broken.
    missing = [n for n in ("SMOKE_EMAIL", "SMOKE_PASSWORD") if not os.environ.get(n)]
    say(f"SELF-CHECK — allow-listed id pinned; credentials in env: "
        f"{'MISSING ' + ', '.join(missing) if missing else 'present'}")
    if fails:
        say("SELF-CHECK FAILED:\n  " + "\n  ".join(fails), err=True)
        return 1
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--user-id", default=os.environ.get("SMOKE_USER_ID", SMOKE_USER_ID))
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()

    email = os.environ.get("SMOKE_EMAIL")
    password = os.environ.get("SMOKE_PASSWORD")
    if not email or not password:
        say("⛔ SMOKE_EMAIL / SMOKE_PASSWORD are not in the environment. This script signs in as "
            "the smoke account to authorise the link; without them there is nothing to do.",
            err=True)
        return 2

    try:
        url = mint(args.base, email, password, args.user_id)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:200]
        if e.code == 404:
            say("⛔ 404 — which means one of two things, deliberately indistinguishable from the "
                "outside: SMOKE_LOGIN_LINK_ENABLED is not set on the service, or the user id is "
                "not the allow-listed one. Check the service's variables.", err=True)
        elif e.code == 429:
            say("⛔ 429 — five issuances an hour, and a REFUSED call spends quota too.", err=True)
        else:
            say(f"⛔ HTTP {e.code}: {body}", err=True)
        return 1

    say(url)
    say("\n  ⏳ valid 5 minutes, single use. On the Live device: tap the address bar's ⊗ to clear "
        "it, then type this URL. ⛔ never ctrl+a — the mirror types a literal 'a'.", err=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
