"""Trade Exchange News — synthetic end-to-end run against the D2 STAGING stack.

    python tools/txn_staging_e2e.py --config <file outside the repo> --count 200 --rate 1 --out run.json

The config file is JSON: ``{"hook_url": ..., "web_url": ..., "read_token": ...}``
(hook_url carries the webhook credential; read_token is the staging web's
bearer). Nothing from it is ever printed.

What it measures, on ONE clock (this machine), for each synthetic headline:
  * ack_ms   -- POST sent -> receiver's 2xx;
  * e2e_ms   -- POST sent -> the headline arrives on the staging web's SSE
                stream (receiver -> R2 + private-network push -> pipeline ->
                hub -> SSE -> back here).
Both include this machine's two internet legs to Railway; real Trade Exchange
delivery latency is NOT measured here (their send time is not visible to us).

Then, after the run, it reads the staging web's history and checks every
ACKNOWLEDGED headline is there exactly once, in send order, with contiguous seq.
Headlines the receiver refused (non-2xx / transport error) are reported as
reception gaps: the system never accepted them, so only a sender retry could
recover them.

Each run tags its headlines ``SYNTHETIC e2e <run>-<n>`` so concurrent or
repeated runs never collide. ⛔ STAGING ONLY: refuses uctintelligence.com URLs
and needs --i-confirm-staging.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import pathlib
import secrets
import statistics
import time
from urllib.parse import urlsplit

import httpx

STREAM = "/api/trade-exchange-news/stream"
RECENT = "/api/trade-exchange-news/recent"


def pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    v = sorted(values)
    return round(v[min(len(v) - 1, max(0, int(round(p * (len(v) - 1)))))], 1)


def latency_summary(values: list[float]) -> dict:
    return {"n": len(values), "p50": pct(values, 0.5), "p95": pct(values, 0.95),
            "p99": pct(values, 0.99), "max": round(max(values), 1) if values else None,
            "mean": round(statistics.fmean(values), 1) if values else None}


def check_history(tag: str, sent: list[dict], items: list[dict]) -> dict:
    """Every acknowledged headline once, in send order, seq strictly increasing."""
    acked = [s["content"] for s in sent if s.get("acked")]
    mine = [i for i in items if i.get("content", "").startswith(tag + "-")]
    contents = [i["content"] for i in mine]
    seqs = [i["seq"] for i in mine]
    missing = [c for c in acked if c not in contents]
    dupes = sorted({c for c in contents if contents.count(c) > 1})
    return {"acked": len(acked), "in_history": len(contents), "missing": len(missing),
            "duplicates": len(dupes), "order_matches_send": contents == [c for c in acked if c in contents],
            "seq_strictly_increasing": all(b > a for a, b in zip(seqs, seqs[1:])),
            "unacked_but_present": len([c for c in contents if c not in acked])}


def gaps(sent: list[dict]) -> dict:
    longest = run = 0
    span = None
    start = None
    by_status: dict[str, int] = {}
    for s in sent:
        if s.get("acked"):
            run = 0
            continue
        by_status[str(s.get("status") or s.get("error"))] = by_status.get(str(s.get("status") or s.get("error")), 0) + 1
        if run == 0:
            start = s["t_rel"]
        run += 1
        if run > longest:
            longest, span = run, (start, s["t_rel"])
    return {"refused": sum(by_status.values()), "by_status": by_status, "longest_run": longest,
            "longest_seconds": round(span[1] - span[0], 2) if span else 0.0}


async def listen(client: httpx.AsyncClient, web: str, token: str, arrivals: dict, ready: asyncio.Event,
                 stop: asyncio.Event) -> None:
    headers = {"Authorization": f"Bearer {token}", "Accept": "text/event-stream"}
    after = ""
    while not stop.is_set():
        try:
            async with client.stream("GET", web + STREAM + after, headers=headers, timeout=None) as r:
                r.raise_for_status()
                event = None
                async for line in r.aiter_lines():
                    if line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:") and event:
                        data = json.loads(line[5:])
                        if event == "hello":
                            ready.set()
                        elif event == "headline":
                            arrivals.setdefault(data["content"], (time.perf_counter(), data["seq"]))
                            after = f"?after={data['seq']}&epoch={data['epoch']}"
                    if stop.is_set():
                        return
        except (httpx.HTTPError, json.JSONDecodeError):
            await asyncio.sleep(0.5)


async def run(cfg: dict, count: int, rate: float, settle_s: float) -> dict:
    tag = f"SYNTHETIC e2e {time.strftime('%H%M%S')}{secrets.token_hex(2)}"
    arrivals: dict[str, tuple[float, int]] = {}
    ready, stop = asyncio.Event(), asyncio.Event()
    sent: list[dict] = []
    async with httpx.AsyncClient(http2=False) as listen_client, httpx.AsyncClient(timeout=15) as post:
        task = asyncio.create_task(listen(listen_client, cfg["web_url"], cfg["read_token"], arrivals, ready, stop))
        await asyncio.wait_for(ready.wait(), 30)
        t0 = time.perf_counter()
        for n in range(count):
            due = t0 + n / rate
            await asyncio.sleep(max(0.0, due - time.perf_counter()))
            content = f"{tag}-{n:05d}"
            s = {"content": content, "t_sent": time.perf_counter()}
            s["t_rel"] = round(s["t_sent"] - t0, 3)
            try:
                r = await post.post(cfg["hook_url"], json={"source": "TXNews1", "content": content})
                s["status"] = r.status_code
                s["acked"] = 200 <= r.status_code < 300
            except httpx.HTTPError as e:
                s["error"] = type(e).__name__
                s["acked"] = False
            s["ack_ms"] = (time.perf_counter() - s["t_sent"]) * 1000
            sent.append(s)
        deadline = time.perf_counter() + settle_s
        while time.perf_counter() < deadline and any(s["acked"] and s["content"] not in arrivals for s in sent):
            await asyncio.sleep(0.25)
        stop.set()
        task.cancel()
        hist = await post.get(cfg["web_url"] + RECENT, params={"limit": 200},
                              headers={"Authorization": f"Bearer {cfg['read_token']}"})
        items = hist.json().get("items", []) if hist.status_code == 200 else []
        # page back until this run's first headline is covered
        while items and count > 200 and not any(i["content"].endswith("-00000") and i["content"].startswith(tag) for i in items):
            older = await post.get(cfg["web_url"] + RECENT, params={"limit": 200, "before": items[0]["seq"]},
                                   headers={"Authorization": f"Bearer {cfg['read_token']}"})
            more = older.json().get("items", []) if older.status_code == 200 else []
            if not more:
                break
            items = more + items
    e2e = [(arrivals[s["content"]][0] - s["t_sent"]) * 1000 for s in sent if s["content"] in arrivals]
    live_seqs = [arrivals[s["content"]][1] for s in sent if s["content"] in arrivals]
    return {"tag_prefix": "SYNTHETIC e2e", "count": count, "rate_per_s": rate,
            "ack_ms": latency_summary([s["ack_ms"] for s in sent if s["acked"]]),
            "e2e_ms": latency_summary(e2e),
            "live_received": len(e2e), "live_seq_in_send_order": all(b > a for a, b in zip(live_seqs, live_seqs[1:])),
            "reception_gaps": gaps(sent), "history": check_history(tag, sent, items)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--count", type=int, default=100)
    ap.add_argument("--rate", type=float, default=1.0, help="headlines per second (receiver allows 2/s sustained)")
    ap.add_argument("--settle", type=float, default=60.0, help="seconds to wait for stragglers")
    ap.add_argument("--out")
    ap.add_argument("--i-confirm-staging", action="store_true")
    a = ap.parse_args(argv)
    cfg = json.loads(pathlib.Path(a.config).read_text(encoding="utf-8"))
    for key in ("hook_url", "web_url", "read_token"):
        if not cfg.get(key):
            raise SystemExit(f"config is missing {key}")
    for key in ("hook_url", "web_url"):
        host = (urlsplit(cfg[key]).hostname or "").lower()
        if host == "uctintelligence.com" or host.endswith(".uctintelligence.com"):
            raise SystemExit("refusing a production URL")
    if not a.i_confirm_staging:
        raise SystemExit("staging only: pass --i-confirm-staging")
    cfg["web_url"] = cfg["web_url"].rstrip("/")
    out = asyncio.run(run(cfg, a.count, a.rate, a.settle))
    text = json.dumps(out, indent=2)
    if a.out:
        pathlib.Path(a.out).write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
