# tools/buzz_perms.py
"""Can the bot actually read the channels we intend to count? Read-only.

Run this BEFORE concluding that an empty ingest is a code bug.
Usage: python tools/buzz_perms.py
"""
from __future__ import annotations

import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()
TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
GUILD = os.environ.get("DISCORD_GUILD_ID", "882293203485720596").strip()
H = {"Authorization": f"Bot {TOKEN}"}
B = "https://discord.com/api/v10"
VIEW, HIST, ADMIN = 1 << 10, 1 << 16, 1 << 3


def main() -> int:
    if not TOKEN:
        print("DISCORD_BOT_TOKEN not set")
        return 2
    me = requests.get(f"{B}/users/@me", headers=H).json()
    member = requests.get(f"{B}/guilds/{GUILD}/members/{me['id']}", headers=H).json()
    my_roles = set(member.get("roles") or [])
    roles = {r["id"]: r for r in requests.get(f"{B}/guilds/{GUILD}/roles", headers=H).json()}

    base = int(roles.get(GUILD, {}).get("permissions", 0))
    for rid in my_roles:
        base |= int(roles[rid]["permissions"]) if rid in roles else 0
    is_admin = bool(base & ADMIN)

    chans = requests.get(f"{B}/guilds/{GUILD}/channels", headers=H).json()
    from api.services import buzz_ingest
    wanted = set(buzz_ingest.channels())

    bad = 0
    for ch in chans:
        if ch["id"] not in wanted:
            continue
        perms = VIEW | HIST if is_admin else base
        if not is_admin:
            ows = {o["id"]: o for o in ch.get("permission_overwrites") or []}
            ev = ows.get(GUILD)
            if ev:
                perms &= ~int(ev["deny"]); perms |= int(ev["allow"])
            d = a = 0
            for rid in my_roles:
                if rid in ows:
                    d |= int(ows[rid]["deny"]); a |= int(ows[rid]["allow"])
            perms &= ~d; perms |= a
        ok = bool(perms & VIEW) and bool(perms & HIST)
        print(f"  [{'READ' if ok else 'BLIND'}] #{ch['name']}  id={ch['id']}")
        if not ok:
            bad += 1
    if bad:
        print(f"\n{bad} wanted channel(s) NOT readable.")
        print("FIX (owner only -- the bot holds no MANAGE_ROLES):")
        print("  Channel Settings -> Permissions -> Add members or roles -> 'UCT Intelligence'")
        print("  Do NOT click 'Sync Now' -- it overwrites the channel's own overwrites.")
        return 1
    print("\nAll wanted channels readable.")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.getcwd())
    raise SystemExit(main())
