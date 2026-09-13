"""Fetch a Discord sample of TEAM-AUTHOR messages for golden-set labelling (W1 §2.4).

Reads docs/wisdom/discord-sources.json (channels with ``in_scope: true``) and
docs/wisdom/authors.json (the four §2.1 authors), pages back through the latest
``--limit`` messages of each channel with the bot token, and writes one JSONL
file per channel:

    <out>/<channel_key>.jsonl   {message_id, channel_id, author_id, created_at, content, attachments:[url...]}
    <out>/_status.json          per-channel HTTP status, fetched and kept counts (no message text)

Rules this script enforces in code, not in a flag (W1 §0.4e):
  * a message is kept ONLY when its author id is one of the four authors — every
    other message is dropped before anything is written, so member text never
    reaches disk;
  * bot and webhook messages are dropped even when they post in an author channel;
  * quoted member text is stripped: the replied-to message (``referenced_message``)
    and forwarded snapshots are never copied, and ``> `` / ``>>> `` quote lines
    are removed from the kept content;
  * the token is read from ``DISCORD_BOT_TOKEN`` and never printed, logged or
    written — errors are reported by HTTP status only.

Pacing: at most 5 requests per second; a 429 sleeps for the server's
``retry_after`` and retries. Any channel that did not return 200 is retried once
at the end of the run (``#manrav`` may still be pending its permission grant).

The output directory must be given explicitly (CONTRACTS row 18: tools/wisdom/**
never defaults to /data). The output is gitignored working data — it carries
paid Discord text and must never be committed.

    railway run --service web python tools/wisdom/golden_discord_sample.py --out <dir> --limit 400
    python tools/wisdom/golden_discord_sample.py --self-check
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
API = "https://discord.com/api/v10"
USER_AGENT = "DiscordBot (https://uctintelligence.com, 1.0)"
MIN_INTERVAL_S = 0.2          # <= 5 requests per second
PAGE_MAX = 100                # Discord's per-request ceiling
MAX_429_RETRIES = 6
MAX_NET_RETRIES = 3


def load_sources(repo: pathlib.Path) -> tuple[list[dict], dict[str, str]]:
    """In-scope channels and the author allowlist {discord_user_id: author_id}."""
    sources = json.loads((repo / "docs" / "wisdom" / "discord-sources.json").read_text(encoding="utf-8"))
    authors = json.loads((repo / "docs" / "wisdom" / "authors.json").read_text(encoding="utf-8"))
    channels = [c for c in sources["channels"] if c.get("in_scope") is True]
    allow = {a["discord_user_id"]: a["author_id"] for a in authors["authors"] if a.get("discord_user_id")}
    return channels, allow


def strip_quoted(content: str) -> str:
    """Remove quoted text: ``> `` lines and everything after a ``>>> `` block opener."""
    kept: list[str] = []
    for line in (content or "").split("\n"):
        stripped = line.lstrip()
        if stripped.startswith(">>> ") or stripped == ">>>":
            break                                   # a block quote runs to the end of the message
        if stripped.startswith("> ") or stripped == ">":
            continue
        kept.append(line)
    return "\n".join(kept).strip()


def keep_message(msg: dict, allow: dict[str, str]) -> dict | None:
    """The stored shape for an author message, or None when it must be dropped."""
    author = msg.get("author") or {}
    if author.get("bot") or msg.get("webhook_id"):
        return None
    if str(author.get("id")) not in allow:
        return None
    return {
        "message_id": str(msg["id"]),
        "channel_id": str(msg.get("channel_id") or ""),
        "author_id": str(author["id"]),
        "created_at": msg.get("timestamp"),
        "content": strip_quoted(msg.get("content") or ""),
        "attachments": [a.get("url") for a in (msg.get("attachments") or []) if a.get("url")],
    }


class DiscordClient:
    def __init__(self, token: str):
        self.__auth = f"Bot {token}"               # name-mangled; never formatted into output
        self._last = 0.0

    def get(self, path: str, params: dict) -> tuple[int, object]:
        url = f"{API}{path}?{urllib.parse.urlencode(params)}"
        rate_retries = net_retries = 0
        while True:
            wait = MIN_INTERVAL_S - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            req = urllib.request.Request(url, headers={
                "Authorization": self.__auth, "User-Agent": USER_AGENT, "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return resp.status, json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code == 429 and rate_retries < MAX_429_RETRIES:
                    rate_retries += 1
                    try:
                        retry_after = float(json.loads(exc.read().decode("utf-8")).get("retry_after", 1.0))
                    except Exception:
                        retry_after = float(exc.headers.get("Retry-After") or 1.0)
                    time.sleep(retry_after + 0.25)
                    continue
                return exc.code, None
            except (urllib.error.URLError, TimeoutError, OSError):
                if net_retries < MAX_NET_RETRIES:
                    net_retries += 1
                    time.sleep(1.0 * net_retries)
                    continue
                return 0, None


def fetch_channel(client, channel_id: str, limit: int) -> tuple[int, list[dict]]:
    messages: list[dict] = []
    before = None
    status = 0
    while len(messages) < limit:
        params = {"limit": min(PAGE_MAX, limit - len(messages))}
        if before:
            params["before"] = before
        status, body = client.get(f"/channels/{channel_id}/messages", params)
        if status != 200 or not isinstance(body, list) or not body:
            break
        for m in body:
            m.setdefault("channel_id", channel_id)
        messages.extend(body)
        before = body[-1]["id"]
        if len(body) < params["limit"]:
            break
    return status, messages


def write_jsonl(path: pathlib.Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def run(out: pathlib.Path, limit: int, client, repo: pathlib.Path = REPO) -> dict:
    channels, allow = load_sources(repo)
    status: dict = {"fetched_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "limit": limit,
                    "channels": {}}

    def one(ch: dict) -> None:
        code, msgs = fetch_channel(client, ch["channel_id"], limit)
        kept = [k for k in (keep_message(m, allow) for m in msgs) if k is not None]
        by_author: dict[str, int] = {}
        for k in kept:
            by_author[allow[k["author_id"]]] = by_author.get(allow[k["author_id"]], 0) + 1
        if code == 200:
            write_jsonl(out / f"{ch['key']}.jsonl", kept)
        status["channels"][ch["key"]] = {"channel_id": ch["channel_id"], "http_status": code,
                                         "fetched": len(msgs), "kept": len(kept), "kept_by_author": by_author}
        print(f"  {ch['key']:<12} http={code} fetched={len(msgs)} kept={len(kept)} {by_author}")

    for ch in channels:
        one(ch)
    failed = [ch for ch in channels if status["channels"][ch["key"]]["http_status"] != 200]
    for ch in failed:                                   # one retry at the end of the run
        print(f"  retry {ch['key']} (was {status['channels'][ch['key']]['http_status']})")
        first = status["channels"][ch["key"]]["http_status"]
        one(ch)
        status["channels"][ch["key"]]["first_attempt_status"] = first
    out.mkdir(parents=True, exist_ok=True)
    (out / "_status.json").write_text(json.dumps(status, indent=1) + "\n", encoding="utf-8")
    return status


def self_check() -> int:
    """No network: quoting, the author filter and the pager, each with a control that must fail."""
    allow = {"339816805805588480": "tsdr"}
    bad = 0

    def expect(name: str, got, want) -> None:
        nonlocal bad
        ok = got == want
        bad += not ok
        print(f"  {'ok ' if ok else 'BAD'} {name}: {got!r}")

    expect("quote lines are stripped", strip_quoted("> member said buy\nmy take: no"), "my take: no")
    expect("block quote runs to the end", strip_quoted("mine\n>>> theirs\nstill theirs"), "mine")
    expect("control: unquoted text survives", strip_quoted("AAPL > 200 today"), "AAPL > 200 today")
    author_msg = {"id": "1", "channel_id": "9", "timestamp": "t", "content": "> q\nhi",
                  "author": {"id": "339816805805588480"}, "attachments": [{"url": "u"}],
                  "referenced_message": {"content": "MEMBER TEXT", "author": {"id": "5"}}}
    kept = keep_message(author_msg, allow)
    expect("author kept, reply content never copied", "MEMBER TEXT" in json.dumps(kept), False)
    expect("control: author content is kept", kept and kept["content"], "hi")
    expect("member dropped", keep_message(dict(author_msg, author={"id": "5"}), allow), None)
    expect("webhook dropped", keep_message(dict(author_msg, webhook_id="7"), allow), None)
    expect("bot dropped", keep_message(dict(author_msg, author={"id": "339816805805588480", "bot": True}), allow), None)

    class FakeClient:
        def __init__(self, pages, code=200):
            self.pages, self.code, self.calls = list(pages), code, []

        def get(self, path, params):
            self.calls.append(dict(params))
            return (self.code, self.pages.pop(0) if self.pages else [])

    pages = [[{"id": str(300 - i)} for i in range(100)], [{"id": str(200 - i)} for i in range(50)]]
    fc = FakeClient(pages)
    code, msgs = fetch_channel(fc, "9", 400)
    expect("pager stops on a short page", (code, len(msgs), len(fc.calls)), (200, 150, 2))
    expect("pager sends before=<last id>", fc.calls[1].get("before"), "201")
    code, msgs = fetch_channel(FakeClient([], code=403), "9", 400)
    expect("403 is reported, not swallowed", (code, len(msgs)), (403, 0))
    print("SELF-CHECK", "PASS" if not bad else f"FAIL ({bad})")
    return 0 if not bad else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", help="output directory (required; never defaults to /data)")
    ap.add_argument("--limit", type=int, default=400, help="latest N messages per channel")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        return self_check()
    if not args.out:
        ap.error("--out is required")
    token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
    if not token:
        print("DISCORD_BOT_TOKEN is not set (run under `railway run --service web`)")
        return 2
    out = pathlib.Path(args.out)
    print(f"discord sample -> {out} (limit {args.limit}/channel)")
    status = run(out, args.limit, DiscordClient(token))
    non200 = [k for k, v in status["channels"].items() if v["http_status"] != 200]
    print("DONE", "all channels 200" if not non200 else f"non-200: {non200}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
