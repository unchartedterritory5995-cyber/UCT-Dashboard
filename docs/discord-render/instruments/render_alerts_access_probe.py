"""Owner-hand item: is the bot able to see `#render-alerts` yet? (LEDGER step 1.3)

    python docs/discord-render/instruments/render_alerts_access_probe.py --self-check
    railway run --service web python docs/discord-render/instruments/render_alerts_access_probe.py

Step 1.3 — making `#render-alerts` invisible to the Contributor role — is blocked on a permission
only a human can grant. `DISCORD_BOT_TOKEN` is the same app that serves `/chart`, and it answers
**403 `Missing Access` (50001)** on `GET /channels/<id>`: it is not a member of that private
channel, so it cannot read or edit its permission overwrites. Granting it access needs the very
permission that is missing.

This polls for the moment that changes. It **only reads**, it changes nothing, and it is safe to
run on a schedule.

⛔⛔ THREE EXIT CODES, AND THE THIRD ONE IS THE POINT.
    0  ACCESS       the bot can see the channel — the fix is unblocked, go do it
    1  ERROR        something else went wrong (no token, no network, an unexpected status)
    2  STILL BLOCKED  403/50001, exactly as before — nothing to report
"Still blocked" and "the probe could not run" are different facts, and a poller that collapses them
reports silence as evidence of an unchanged world. ⚠️ A missing `DISCORD_BOT_TOKEN` is ERROR, never
STILL BLOCKED: an unauthenticated request is refused for a reason that has nothing to do with the
channel's overwrites, and reading that as "still blocked" would keep the poll running forever
against a question it is not asking (`lesson_a_public_repo_cannot_prove_authentication`).

⛔ THE TOKEN IS NEVER PRINTED, and neither is any response body. A bot token is a standing
credential — unlike the 15-minute interaction token, it does not expire on its own.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ACCESS, ERROR, BLOCKED = 0, 1, 2

#: `#render-alerts`, recorded in LEDGER step 1.3. A channel id is not a secret.
CHANNEL_ID = os.environ.get("DISCORD_RENDER_ALERT_CHANNEL_ID", "1548783155354403046")
API = "https://discord.com/api/v10"
MISSING_ACCESS = 50001

#: ⛔⛔ DISCORD REQUIRES THIS HEADER AND CLOUDFLARE ENFORCES IT. Without it the request is refused
#: at the edge with a **403 carrying an HTML body and no Discord error code** — which looks exactly
#: like a permissions refusal and is not one. Measured 2026-09-14 on this very probe: it answered
#: `HTTP 403 code None` on the first real run, and only the three-way classification stopped that
#: being filed as "still blocked" forever against a question it was never asking.
UA = "DiscordBot (https://uctintelligence.com, 1.0)"


def classify(status: int | None, code: int | None) -> int:
    """`(HTTP status, Discord error code)` → an exit code.

    ⛔ 403/50001 IS THE ONE SHAPE THAT MEANS "STILL BLOCKED". A 401 is a dead or absent token, a
    404 means the channel id is wrong, and a 5xx is Discord having a bad minute — none of those is
    evidence about the overwrites, and calling any of them BLOCKED would make the poll answer a
    question it never asked."""
    if status is None:
        return ERROR
    if 200 <= status < 300:
        return ACCESS
    if status == 403 and code == MISSING_ACCESS:
        return BLOCKED
    return ERROR


#: The guild `#render-alerts` lives in, and the role whose presence is the defect.
GUILD_ID = os.environ.get("DISCORD_RENDER_GUILD_ID", "882293203485720596")
CONTRIBUTOR_ROLE_ID = "1112808703389872188"
VIEW_CHANNEL = 1 << 10

ACL_OK, ACL_CONTRIBUTOR_ALLOWED, ACL_UNREADABLE = "acl_ok", "contributor_allowed", "acl_unreadable"


def acl(guild_id: str = GUILD_ID, channel_id: str = CHANNEL_ID, *,
        token: str | None = None, opener=urllib.request.urlopen) -> tuple[str, str]:
    """What `#render-alerts`'s overwrites actually say — via the GUILD listing, not the channel.

    ⛔⛔ THE BOT CANNOT `GET /channels/{id}` (50001) AND CAN STILL READ THAT CHANNEL'S OVERWRITES,
    because `GET /guilds/{id}/channels` returns them for every channel in the guild. The probe spent
    a day reporting `403 code 50001` — a true statement about the wrong endpoint — while the answer
    it was actually after was one call away.

    ⭐ That turns this from "we cannot tell" into a MEASUREMENT: the defect is a `Contributor` role
    overwrite ALLOWING `VIEW_CHANNEL`, and its presence or absence is now a fact the hourly poll
    reports rather than a permission error it reports instead."""
    token = token or os.environ.get("DISCORD_BOT_TOKEN") or ""
    if not token:
        return ACL_UNREADABLE, "DISCORD_BOT_TOKEN is not set"
    req = urllib.request.Request(f"{API}/guilds/{guild_id}/channels",
                                 headers={"Authorization": f"Bot {token}", "User-Agent": UA})
    try:
        with opener(req, timeout=20) as resp:
            chans = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        return ACL_UNREADABLE, f"guild listing unreadable ({type(e).__name__})"
    for ch in chans if isinstance(chans, list) else []:
        if str(ch.get("id")) != str(channel_id):
            continue
        for ow in ch.get("permission_overwrites") or []:
            if str(ow.get("id")) == CONTRIBUTOR_ROLE_ID and int(ow.get("allow") or 0) & VIEW_CHANNEL:
                return ACL_CONTRIBUTOR_ALLOWED, (
                    "Contributor is ALLOWED VIEW_CHANNEL on #render-alerts — step 1.3's exact "
                    "defect, and it is the channel's ONLY allow overwrite")
        return ACL_OK, "no Contributor allow overwrite remains"
    # ⛔ ABSENT IS NOT CLEAN. A channel missing from the listing is one this token cannot enumerate,
    # which says nothing about its overwrites.
    return ACL_UNREADABLE, "the channel is not in the guild listing this token can see"


def probe(channel_id: str = CHANNEL_ID, *, token: str | None = None,
          opener=urllib.request.urlopen) -> tuple[int, str]:
    token = token or os.environ.get("DISCORD_BOT_TOKEN") or ""
    if not token:
        return ERROR, "DISCORD_BOT_TOKEN is not set (run under `railway run --service web`)"
    req = urllib.request.Request(f"{API}/channels/{channel_id}",
                                 headers={"Authorization": f"Bot {token}", "User-Agent": UA})
    try:
        with opener(req, timeout=15) as resp:
            return classify(resp.status, None), f"HTTP {resp.status} — the bot can see the channel"
    except urllib.error.HTTPError as e:
        code = None
        try:
            code = json.loads(e.read().decode("utf-8")).get("code")
        except Exception:  # noqa: BLE001 — an unreadable body is not an answer
            pass
        # ⛔ The status and the numeric code only. Never the body.
        return classify(e.code, code), f"HTTP {e.code} code {code}"
    except Exception as e:  # noqa: BLE001
        return ERROR, f"unreachable ({type(e).__name__})"


def self_check() -> int:
    cases = [
        ("a 200 means the fix is unblocked", 200, None, ACCESS),
        ("403/50001 is STILL BLOCKED", 403, MISSING_ACCESS, BLOCKED),
        ("403 with another code is ERROR, not blocked", 403, 50013, ERROR),
        # ⚰️ MEASURED 2026-09-14, on this probe's first real run: Cloudflare refuses a request with
        # no `User-Agent` at the edge, with an HTML body and no Discord error code. It looks
        # identical to a permissions refusal.
        ("403 with NO code is the edge, not the overwrites", 403, None, ERROR),
        ("401 is a token problem, never 'still blocked'", 401, 0, ERROR),
        ("404 is a wrong channel id, never 'still blocked'", 404, 10003, ERROR),
        ("a 500 is Discord, not the overwrites", 500, None, ERROR),
        ("no response at all is ERROR", None, None, ERROR),
    ]
    failed = 0
    for name, status, code, expect in cases:
        got = classify(status, code)
        failed += got != expect
        print(f"  {'ok  ' if got == expect else 'FAIL'} {name}"
              + ("" if got == expect else f"   (expected {expect}, got {got})"))
    cases += [("an ACL state is one of the three named words",
               ACL_OK != ACL_CONTRIBUTOR_ALLOWED != ACL_UNREADABLE)]
    _blank, _why = acl(token="")
    cases += [("no token makes the ACL UNREADABLE, never OK", _blank == ACL_UNREADABLE)]
    missing, _ = probe(token="")
    ok = missing == ERROR
    failed += not ok
    print(f"  {'ok  ' if ok else 'FAIL'} a missing token is ERROR, never STILL BLOCKED")
    print(f"TOTALS render_alerts_access_probe --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases) + 1} failed={failed}")
    return ACCESS if not failed else ERROR


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--channel", default=CHANNEL_ID)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    code, detail = probe(args.channel)
    print(f"RENDER_ALERTS_ACCESS {['ACCESS', 'ERROR', 'STILL_BLOCKED'][code]} {detail}")
    # ⭐ The membership question and the ACL question are different, and the second one is the one
    # step 1.3 is actually about — so it is reported whatever the first one answered.
    state, why = acl()
    print(f"RENDER_ALERTS_ACL {state.upper()} {why}")
    if state == ACL_OK:
        print("  → the Contributor overwrite is gone; step 1.3's product half is DONE.")
    if code == ACCESS:
        print("  → step 1.3 is unblocked: edit the channel's permission overwrites so the "
              "Contributor role cannot view it (LEDGER step 1.3).")
    return code


if __name__ == "__main__":
    sys.exit(main())
