"""READ-ONLY probe: fetch the latest page of every in-scope Wisdom Discord channel and
report what the parser WOULD keep. Ids and counts only — never message text.

Runs the same fetch_page + clean_message the listener runs, writes nothing.
Needs DISCORD_BOT_TOKEN; run it through the linked Railway directory:

  cd C:/Users/Patrick/uct-worktrees/wisdom-loop
  railway run --service web python <repo>/tools/wisdom/sources_discord_probe.py [--limit 100]
"""
from __future__ import annotations

import argparse
import json
import sys

from sources_bootstrap import bootstrap


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=100)
    args = ap.parse_args(argv)
    bootstrap()
    from api.services.wisdom.core import authors
    from api.services.wisdom.sources import discord

    if not discord.token():
        print(json.dumps({"error": "DISCORD_BOT_TOKEN is not set"}))
        return 2
    report = []
    for ch in authors.in_scope_channels():
        cid = str(ch["channel_id"])
        res = discord.fetch_page(cid, limit=args.limit)
        row = {"key": ch.get("key"), "channel_id": cid, "http_status": res.status, "error": res.error,
               "rate_limit_remaining": res.remaining}
        if res.ok:
            kept = [discord.clean_message(m, cid) for m in res.messages]
            kept = [k for k in kept if k]
            ids = sorted((int(m["id"]) for m in res.messages if str(m.get("id") or "").isdigit()))
            by_author: dict = {}
            stripped = {"quote_lines": 0, "member_mentions": 0, "reply_reference": 0}
            for k in kept:
                by_author[k["author_id"]] = by_author.get(k["author_id"], 0) + 1
                for key in stripped:
                    stripped[key] += k["stripped"][key]
            row.update({
                "fetched": len(res.messages), "kept": len(kept), "dropped": len(res.messages) - len(kept),
                "kept_by_author": by_author, "stripped": stripped,
                "attachments_kept": sum(len(k["attachments"]) for k in kept),
                "empty_text_kept": sum(1 for k in kept if not k["text"]),
                "oldest_id": str(ids[0]) if ids else None, "newest_id": str(ids[-1]) if ids else None,
                "oldest_at": discord.snowflake_et_iso(ids[0]) if ids else None,
                "newest_at": discord.snowflake_et_iso(ids[-1]) if ids else None,
            })
        report.append(row)
    print(json.dumps({"channels": report}, indent=1))
    return 0 if all(r["http_status"] == 200 for r in report) else 1


if __name__ == "__main__":
    sys.exit(main())
