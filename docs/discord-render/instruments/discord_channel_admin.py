"""The bot's own permissions, and the private smoke channel — read-back, never assumed.

    railway run -p <proj> -e production -s web python <this> --whoami
    railway run ... python <this> --create-smoke --guild <id> --category <id>
    railway run ... python <this> --read-channel <id>
    python <this> --self-check

⛔⛔ EVERY CLAIM HERE IS A READ-BACK. "The channel is private" is not something to infer from the
request that created it — Discord can accept a create and apply overwrites differently from what was
asked (a role id that does not exist, a permission the bot cannot grant). So creation is followed by
a `GET` and the overwrites are printed as Discord holds them. That is what makes "not blind"
satisfiable without a browser.

⛔ 403 `50001 Missing Access` IS MEMBERSHIP, NOT PERMISSION LEVEL. The bot can hold Administrator
and still get 50001 on a channel it cannot see. So this reports the two facts separately — what the
token's roles GRANT, and what a given channel ANSWERS — because collapsing them is how "grant the
bot Manage Channels" became the wrong ask for three days.

⛔ THE TOKEN IS NEVER PRINTED, and neither is any response body that could carry one.
⛔ `--create-smoke` is the ONLY call here that writes. Everything else is a read.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

OK, ERROR, BLOCKED = 0, 1, 2
API = "https://discord.com/api/v10"
UA = "DiscordBot (https://uctintelligence.com, 1.0)"

#: Discord permission bits this tool reasons about. Named, so a number never appears bare.
ADMINISTRATOR = 1 << 3
MANAGE_CHANNELS = 1 << 4
VIEW_CHANNEL = 1 << 10
SEND_MESSAGES = 1 << 11
MANAGE_MESSAGES = 1 << 13
ATTACH_FILES = 1 << 15
READ_HISTORY = 1 << 16

#: Overwrite types, per Discord's schema.
TYPE_ROLE, TYPE_MEMBER = 0, 1


def _req(method: str, path: str, body: dict | None = None):
    token = os.environ.get("DISCORD_BOT_TOKEN") or ""
    if not token:
        raise SystemExit("DISCORD_BOT_TOKEN is not set (run under `railway run --service web`)")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers={
        "Authorization": f"Bot {token}", "User-Agent": UA, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        code = None
        try:
            code = json.loads(e.read().decode("utf-8")).get("code")
        except Exception:  # noqa: BLE001
            pass
        # ⛔ status + numeric code only. A body can echo back what we sent.
        return e.code, {"code": code}
    except Exception as e:  # noqa: BLE001
        return None, {"error": type(e).__name__}


def describe(perms: int) -> list[str]:
    names = []
    for bit, name in ((ADMINISTRATOR, "ADMINISTRATOR"), (MANAGE_CHANNELS, "MANAGE_CHANNELS"),
                      (VIEW_CHANNEL, "VIEW_CHANNEL"), (SEND_MESSAGES, "SEND_MESSAGES"),
                      (MANAGE_MESSAGES, "MANAGE_MESSAGES"), (ATTACH_FILES, "ATTACH_FILES"),
                      (READ_HISTORY, "READ_MESSAGE_HISTORY")):
        if perms & bit:
            names.append(name)
    return names


def can_manage_channels(perms: int) -> bool:
    """⛔ ADMINISTRATOR IMPLIES EVERYTHING. A check that only looked for the MANAGE_CHANNELS bit
    would report "cannot" for a bot that is a server admin, which is the opposite of the truth and
    would send the owner to grant a permission it already has."""
    return bool(perms & ADMINISTRATOR or perms & MANAGE_CHANNELS)


def whoami() -> int:
    status, me = _req("GET", "/users/@me")
    if status != 200:
        print(f"WHOAMI ERROR http={status} code={me.get('code')}")
        return ERROR
    print(f"bot: {me.get('username')}#{me.get('discriminator')} id={me.get('id')}")

    status, guilds = _req("GET", "/users/@me/guilds")
    if status != 200 or not isinstance(guilds, list):
        print(f"GUILDS ERROR http={status} code={guilds if not isinstance(guilds, list) else ''}")
        return ERROR
    worst = OK
    for g in guilds:
        # ⭐ `permissions` on this row is the bot's EFFECTIVE guild-level permission set, which is
        # exactly the question "can it create a channel" asks — no role walk needed.
        perms = int(g.get("permissions") or 0)
        ok = can_manage_channels(perms)
        print(f"  guild {g.get('id')} {g.get('name')!r}: "
              f"{'CAN' if ok else 'CANNOT'} create channels · {', '.join(describe(perms)) or 'none'}")
        if not ok:
            worst = BLOCKED
    return worst


def read_channel(channel_id: str) -> int:
    status, ch = _req("GET", f"/channels/{channel_id}")
    if status != 200:
        code = ch.get("code")
        print(f"CHANNEL {channel_id}: http={status} code={code}"
              + ("  (50001 Missing Access = the bot is NOT IN this channel; that is membership, "
                 "not permission level)" if code == 50001 else ""))
        return BLOCKED if code == 50001 else ERROR
    print(f"CHANNEL {channel_id}: #{ch.get('name')} type={ch.get('type')} parent={ch.get('parent_id')}")
    print("  overwrites, as DISCORD holds them:")
    for ow in ch.get("permission_overwrites") or []:
        allow, deny = int(ow.get("allow") or 0), int(ow.get("deny") or 0)
        kind = "role" if int(ow.get("type", 0)) == TYPE_ROLE else "member"
        print(f"    {kind} {ow.get('id')}: allow=[{', '.join(describe(allow)) or '-'}] "
              f"deny=[{', '.join(describe(deny)) or '-'}]")
    return OK


def list_channels(guild_id: str) -> int:
    """Every channel the bot can enumerate, with whether `@everyone` is denied VIEW_CHANNEL.

    ⛔⛔ THIS IS HOW "NOT BLIND" IS SATISFIED WITHOUT A BROWSER, and it is a READ. The question it
    answers is the only one that matters before posting: **can members see this channel?** A
    channel with an `@everyone` deny on VIEW_CHANNEL and no role re-allowing it is private; one
    without that deny is not, whatever its name suggests.

    ⚠️ `PRIVATE?` here is a first pass, not a verdict. A role overwrite could re-allow view to a
    broad role, and this prints those roles rather than resolving them — resolving would need the
    member list. Read the roles it prints before treating any channel as admin-only."""
    status, chans = _req("GET", f"/guilds/{guild_id}/channels")
    if status != 200 or not isinstance(chans, list):
        print(f"CHANNELS ERROR http={status} code={chans if not isinstance(chans, list) else ''}")
        return ERROR
    private = 0
    for ch in sorted(chans, key=lambda c: (c.get("parent_id") or "", c.get("position") or 0)):
        if int(ch.get("type", 0)) != 0:          # text channels only
            continue
        ows = ch.get("permission_overwrites") or []
        everyone_denied = any(str(o.get("id")) == guild_id and int(o.get("deny") or 0) & VIEW_CHANNEL
                              for o in ows)
        allowed_roles = [str(o.get("id")) for o in ows
                         if int(o.get("type", 0)) == TYPE_ROLE and int(o.get("allow") or 0) & VIEW_CHANNEL]
        private += bool(everyone_denied)
        print(f"  {'PRIVATE?' if everyone_denied else 'public  '} {ch.get('id')} "
              f"#{ch.get('name')}"
              + (f"  view re-allowed to roles: {', '.join(allowed_roles)}" if allowed_roles else ""))
    print(f"  ({private} of the text channels the bot can enumerate deny @everyone VIEW_CHANNEL)")
    return OK


def create_smoke(guild_id: str, *, name: str, category_id: str | None,
                 admin_role_id: str | None, contributor_role_id: str | None) -> int:
    """Create the channel with its overwrites AT CREATION, then read them back.

    ⛔ OVERWRITES AT CREATION, NEVER AS A SECOND CALL. A channel that exists for even a second with
    the default @everyone view is a channel members could have seen — and the window is exactly the
    kind of thing nobody checks afterwards."""
    status, me = _req("GET", "/users/@me")
    if status != 200:
        print(f"WHOAMI ERROR http={status}")
        return ERROR
    bot_id = me.get("id")

    overwrites = [
        # @everyone is the guild id, by Discord's own convention
        {"id": guild_id, "type": TYPE_ROLE, "allow": "0", "deny": str(VIEW_CHANNEL)},
        {"id": bot_id, "type": TYPE_MEMBER, "allow": str(
            VIEW_CHANNEL | SEND_MESSAGES | ATTACH_FILES | MANAGE_MESSAGES | READ_HISTORY),
         "deny": "0"},
    ]
    if admin_role_id:
        overwrites.append({"id": admin_role_id, "type": TYPE_ROLE, "allow": str(
            VIEW_CHANNEL | SEND_MESSAGES | READ_HISTORY), "deny": "0"})
    if contributor_role_id:
        # ⛔ EXPLICITLY DENIED, not merely "not allowed". An absent overwrite inherits, and what it
        # inherits can change the day somebody edits the category.
        overwrites.append({"id": contributor_role_id, "type": TYPE_ROLE,
                           "allow": "0", "deny": str(VIEW_CHANNEL)})

    body = {"name": name, "type": 0, "permission_overwrites": overwrites,
            "topic": "Private smoke channel for the Discord render programme. Bot + admins only."}
    if category_id:
        body["parent_id"] = category_id
    status, ch = _req("POST", f"/guilds/{guild_id}/channels", body)
    if status not in (200, 201):
        print(f"CREATE FAILED http={status} code={ch.get('code')}")
        return BLOCKED if ch.get("code") in (50001, 50013) else ERROR
    print(f"CREATED #{ch.get('name')} id={ch.get('id')}")
    print("  now reading it back — the request is not the evidence:")
    return read_channel(str(ch.get("id")))


def self_check() -> int:
    cases = [
        ("ADMINISTRATOR implies manage-channels", can_manage_channels(ADMINISTRATOR) is True),
        ("the MANAGE_CHANNELS bit alone is enough", can_manage_channels(MANAGE_CHANNELS) is True),
        ("a bot with neither cannot", can_manage_channels(VIEW_CHANNEL | SEND_MESSAGES) is False),
        ("no permissions at all cannot", can_manage_channels(0) is False),
        ("describe names the bits it was given",
         describe(VIEW_CHANNEL | SEND_MESSAGES) == ["VIEW_CHANNEL", "SEND_MESSAGES"]),
        ("describe names nothing for zero", describe(0) == []),
        # ⛔ the discriminator: a check that always said CAN would pass rows 1-2 and fail this
        ("the check can answer CANNOT", can_manage_channels(READ_HISTORY) is False),
    ]
    failed = sum(not ok for _, ok in cases)
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    print(f"TOTALS discord_channel_admin --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={failed}")
    return OK if not failed else ERROR


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--whoami", action="store_true")
    ap.add_argument("--read-channel", default="")
    ap.add_argument("--create-smoke", action="store_true")
    ap.add_argument("--guild", default="")
    ap.add_argument("--category", default="")
    ap.add_argument("--name", default="render-smoke")
    ap.add_argument("--admin-role", default="")
    ap.add_argument("--contributor-role", default="")
    ap.add_argument("--list-roles", action="store_true")
    ap.add_argument("--list-channels", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()
    if args.whoami:
        return whoami()
    if args.list_roles:
        if not args.guild:
            ap.error("--list-roles needs --guild")
        status, roles = _req("GET", f"/guilds/{args.guild}/roles")
        if status != 200 or not isinstance(roles, list):
            print(f"ROLES ERROR http={status}")
            return ERROR
        for r in roles:
            print(f"  role {r.get('id')} {r.get('name')!r} "
                  f"perms=[{', '.join(describe(int(r.get('permissions') or 0))) or '-'}]")
        return OK
    if args.list_channels:
        if not args.guild:
            ap.error("--list-channels needs --guild")
        return list_channels(args.guild)
    if args.read_channel:
        return read_channel(args.read_channel)
    if args.create_smoke:
        if not args.guild:
            ap.error("--create-smoke needs --guild")
        return create_smoke(args.guild, name=args.name, category_id=args.category or None,
                            admin_role_id=args.admin_role or None,
                            contributor_role_id=args.contributor_role or None)
    ap.error("nothing to do: pass --whoami, --list-roles, --read-channel, --create-smoke or --self-check")
    return ERROR


if __name__ == "__main__":
    raise SystemExit(main())
