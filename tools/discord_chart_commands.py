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

from api.services.discord_interactions import DISCORD_API, build_chart_command  # noqa: E402


def make_client(token: str, transport=None) -> httpx.Client:
    return httpx.Client(base_url=DISCORD_API, timeout=20.0, transport=transport,
                        headers={"Authorization": f"Bot {token}",
                                 "User-Agent": "UCT-Charts (uctintelligence.com, 1.0)"})


def show(client: httpx.Client) -> dict:
    r = client.get("/applications/@me")
    r.raise_for_status()
    return r.json()


def register(client: httpx.Client, app_id: str, guild_id: str, *, clear: bool = False) -> list:
    body = [] if clear else [build_chart_command()]
    r = client.put(f"/applications/{app_id}/guilds/{guild_id}/commands", json=body)
    r.raise_for_status()
    return r.json()


def set_endpoint(client: httpx.Client, url: str) -> dict:
    r = client.patch("/applications/@me", json={"interactions_endpoint_url": url})
    r.raise_for_status()
    return r.json()


def invite_url(app_id: str) -> str:
    return f"https://discord.com/oauth2/authorize?client_id={app_id}&scope=applications.commands"


def _load_env(path: str | None) -> None:
    from dotenv import load_dotenv
    p = pathlib.Path(path) if path else _ROOT / ".env"
    if p.exists():
        load_dotenv(p, override=False)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    reg = sub.add_parser("register")
    reg.add_argument("--guild", default=None)
    reg.add_argument("--clear", action="store_true")
    ep = sub.add_parser("endpoint")
    ep.add_argument("--url", required=True)
    sub.add_parser("invite")
    args = ap.parse_args(argv)

    _load_env(args.env_file)
    token = os.environ.get("DISCORD_CHART_BOT_TOKEN", "").strip()
    if not token:
        print("DISCORD_CHART_BOT_TOKEN is not set", file=sys.stderr)
        return 2
    client = make_client(token)
    app_id = os.environ.get("DISCORD_CHART_APP_ID", "").strip() or str(show(client)["id"])

    if args.cmd == "show":
        info = show(client)
        print(f"application_id={info['id']}\nname={info.get('name')}\npublic_key={info.get('verify_key')}")
        print(f"interactions_endpoint_url={info.get('interactions_endpoint_url')}")
    elif args.cmd == "register":
        guild = args.guild or os.environ.get("DISCORD_CHART_GUILD_ID", "").strip()
        if not guild:
            print("--guild or DISCORD_CHART_GUILD_ID required", file=sys.stderr)
            return 2
        out = register(client, app_id, guild, clear=args.clear)
        print(f"registered {len(out)} command(s) in guild {guild}: {[c.get('name') for c in out]}")
    elif args.cmd == "endpoint":
        info = set_endpoint(client, args.url)
        print(f"interactions_endpoint_url={info.get('interactions_endpoint_url')}")
    elif args.cmd == "invite":
        print(invite_url(app_id))
    return 0


if __name__ == "__main__":
    sys.exit(main())
