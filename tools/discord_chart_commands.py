"""One-shot Discord setup for the /chart command. Runs LOCALLY with the app's
bot token; nothing here ever runs on Railway.

  python tools/discord_chart_commands.py show
  python tools/discord_chart_commands.py register --guild <GUILD_ID> [--clear]
  python tools/discord_chart_commands.py endpoint --url https://uctintelligence.com/api/discord/interactions
  python tools/discord_chart_commands.py invite

Env (or --env-file, default .env at the repo root): DISCORD_CHART_BOT_TOKEN
(required), DISCORD_CHART_APP_ID (optional: `show` reports it),
DISCORD_CHART_GUILD_ID (default for --guild).

`endpoint` must run AFTER the API is deployed: Discord validates the URL by
sending a PING and a bad-signature request during the PATCH.
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys

import httpx

_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from api.services.discord_interactions import DISCORD_API, build_commands  # noqa: E402


def make_client(token: str, transport=None) -> httpx.Client:
    return httpx.Client(base_url=DISCORD_API, timeout=20.0, transport=transport,
                        headers={"Authorization": f"Bot {token}",
                                 "User-Agent": "UCT-Charts (uctintelligence.com, 1.0)"})


def show(client: httpx.Client) -> dict:
    r = client.get("/applications/@me")
    r.raise_for_status()
    return r.json()


def register(client: httpx.Client, app_id: str, guild_id: str | None, *, clear: bool = False, activity: bool = False) -> list:
    """PUT the command set. `guild_id=None` registers GLOBALLY (every server the
    app is installed in — the right choice when it lives in more than one);
    a guild id registers for that server only (instant, useful for testing)."""
    body = [] if clear else build_commands(activity=activity)
    path = (f"/applications/{app_id}/commands" if guild_id is None
            else f"/applications/{app_id}/guilds/{guild_id}/commands")
    r = client.put(path, json=body)
    r.raise_for_status()
    return r.json()


def set_endpoint(client: httpx.Client, url: str) -> dict:
    r = client.patch("/applications/@me", json={"interactions_endpoint_url": url})
    r.raise_for_status()
    return r.json()


# What a chart bot actually needs, and nothing else. Measured 2026-08-26: the
# app was installed in Uncharted Territory with `scope=applications.commands`
# and NO permissions, so it inherited whatever the pre-existing role happened to
# have - Send Messages but NOT Attach Files. A chart IS a file attachment, so
# every /chart there accepted the command, rendered fine, and then Discord
# refused the upload: 0 of 71 channels could post one.
INVITE_PERMISSIONS = (
    0x400          # View Channel      - see the channel it is answering in
    | 0x800        # Send Messages     - post the reply
    | 0x8000       # Attach Files      - THE CHART ITSELF
    | 0x80000000   # Use Application Commands
)


def invite_url(app_id: str, permissions: int = INVITE_PERMISSIONS) -> str:
    """Re-authorising an app the server already has UPDATES its permissions, so
    this link is also the fix when a chart cannot be attached."""
    return ("https://discord.com/oauth2/authorize"
            f"?client_id={app_id}&scope=bot+applications.commands&permissions={permissions}")


def _load_env(path: str | None) -> None:
    from dotenv import load_dotenv
    p = pathlib.Path(path) if path else _ROOT / ".env"
    if p.exists():
        load_dotenv(p, override=False)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file", default=None)
    ap.add_argument("--token-var", default="DISCORD_CHART_BOT_TOKEN",
                    help="env var holding the bot token (e.g. DISCORD_BOT_TOKEN when reusing another app's .env)")
    ap.add_argument("--app-id", default=None, help="override DISCORD_CHART_APP_ID")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    reg = sub.add_parser("register")
    reg.add_argument("--guild", default=None, help="register for ONE server (instant)")
    reg.add_argument("--activity", action="store_true", help="also register the Entry Point (Activity launch) command - only once Activities are enabled on the app")
    reg.add_argument("--global", dest="global_", action="store_true",
                     help="register globally: every server the app is installed in")
    reg.add_argument("--clear", action="store_true")
    ep = sub.add_parser("endpoint")
    ep.add_argument("--url", required=True)
    sub.add_parser("invite")
    args = ap.parse_args(argv)

    _load_env(args.env_file)
    token = os.environ.get(args.token_var, "").strip()
    if not token:
        print(f"{args.token_var} is not set", file=sys.stderr)
        return 2
    client = make_client(token)
    app_id = (args.app_id or os.environ.get("DISCORD_CHART_APP_ID", "")).strip() or str(show(client)["id"])

    if args.cmd == "show":
        info = show(client)
        print(f"application_id={info['id']}\nname={info.get('name')}\npublic_key={info.get('verify_key')}")
        print(f"interactions_endpoint_url={info.get('interactions_endpoint_url')}")
    elif args.cmd == "register":
        if args.global_:
            out = register(client, app_id, None, clear=args.clear, activity=args.activity)
            print(f"registered {len(out)} GLOBAL command(s): {[c.get('name') for c in out]}")
        else:
            guild = args.guild or os.environ.get("DISCORD_CHART_GUILD_ID", "").strip()
            if not guild:
                print("--guild, DISCORD_CHART_GUILD_ID, or --global required", file=sys.stderr)
                return 2
            out = register(client, app_id, guild, clear=args.clear, activity=args.activity)
            print(f"registered {len(out)} command(s) in guild {guild}: {[c.get('name') for c in out]}")
    elif args.cmd == "endpoint":
        info = set_endpoint(client, args.url)
        print(f"interactions_endpoint_url={info.get('interactions_endpoint_url')}")
    elif args.cmd == "invite":
        print(invite_url(app_id))
    return 0


if __name__ == "__main__":
    sys.exit(main())
