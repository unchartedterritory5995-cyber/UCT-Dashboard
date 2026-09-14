"""Arrival census — how many render commands ACTUALLY arrive, when, and from whom.

    # 1. pull the arrivals (needs the bot token: run it under `railway run --service web`)
    railway run --service web -- python docs/discord-render/instruments/arrival_census.py \
        --pull-discord --all-channels --since 2026-08-15T00:00:00Z \
        --out docs/discord-render/evidence/arrival-census-2026-09-14/arrivals.jsonl

    # 2. (optional, corroborating) renderer-side interactive render lines
    python tools/railway_env_logs.py --filter '"prio=interactive"' \
        --since 2026-09-13T00:00:00Z --until 2026-09-15T00:00:00Z --out renderer.jsonl

    # 3. derive the distribution and the sizing
    python docs/discord-render/instruments/arrival_census.py --analyze \
        --arrivals arrivals.jsonl --renderer renderer.jsonl \
        --out docs/discord-render/evidence/arrival-census-2026-09-14/census.txt

    python docs/discord-render/instruments/arrival_census.py --self-check

⭐ WHY THIS SOURCE AND NOT THE LOGS. The queue is sized from arrivals, and this pod logs none.
`web` writes NO access log for `/api/discord/interactions` (`01-failure-forensics.md`, finding #1:
0 rows for `"HTTP/1.1"`), the pre-V2 chart path logs only failures, and `/data/discord_render_jobs.db`
does not exist on the pod because V2 has never run there. The renderer's own per-render line
(`render cid=… prio=…`) was only ADDED on 2026-09-13 (a353596ce), so it reaches back about a day —
and the environment's log retention itself bottoms out around 16 days. None of that can answer
"how many commands arrived in the busiest ten seconds of the last month".

⭐ DISCORD ITSELF KEPT THE RECORD. Every non-ephemeral slash-command reply is a message carrying
`interaction_metadata`, and that object's `id` is the INTERACTION's own snowflake — Discord's
millisecond-precision clock stamp for the moment the interaction was created, i.e. the arrival.
Channel history has no retention limit. So the arrival times here are not reconstructed from a
log line that happened to survive; they are Discord's own record of when it called us.

⛔⛔ WHAT THIS CANNOT SEE, AND WHY EVERY NUMBER BELOW IS A FLOOR ON QUEUE ARRIVALS:
  * BUTTON CLICKS. A component interaction (`itype 3`) is answered with a deferred UPDATE and
    EDITS the existing message — it creates no new message, so it leaves no trace here. V2's
    runtime enqueues those exactly like a slash command (`commands.py` → `_enqueue` at itype 3),
    so they are real queue arrivals that this census misses.
  * EPHEMERAL replies — a throttle, a refusal, `/buzz`, the settings picks — are visible only to
    the member and are not in channel history.
  * Anything in a channel this bot cannot read, and `/chart` used outside the guild at all
    (the command is PUBLIC + USER_INSTALL, so a member may run it in a DM).
  * Deleted messages.
A census that quietly called itself complete would be the worse instrument, so `--analyze`
prints the floor caveat on its own line and the report repeats it.

⛔ NO SECRET AND NO MEMBER IDENTITY IS WRITTEN. The bot token is read from the environment and
never printed. Message content, embeds and attachment URLs are never written — a chart
attachment URL carries a signed CDN token and `/r/chart` URLs carry the render token (C-13).
User ids become `sha1(id)[:12]`, which is all a per-user concurrency count needs: the arithmetic
wants to know that two arrivals came from the SAME member, not WHICH member.

Read-only against Discord: every call is a GET.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

OK, FAIL, BLOCKED = 0, 1, 2

API = "https://discord.com/api/v10"
UA = "DiscordBot (https://uctintelligence.com, 1.0)"

#: Discord's epoch. A snowflake's top 42 bits are milliseconds since this instant.
DISCORD_EPOCH_MS = 1420070400000

#: Interaction types that V2's runtime turns into QUEUED jobs (api/services/discord_render/
#: commands.py: `_enqueue` is reached from itype 2 and itype 3). Type 4 (autocomplete) is
#: answered inline and never queued, so it is not an arrival for sizing purposes.
QUEUED_INTERACTION_TYPES = (2, 3)

#: The commands the queue serves, in the order the report lists them.
COMMANDS = ("chart", "c", "charts", "flow", "buzz")

#: A message edited more than this long after its interaction arrived was almost certainly
#: edited AGAIN by a later button click or a stand-in heal, so its span is no longer one job's
#: service time. Spans over the cap are counted and excluded, never silently kept.
EDIT_SPAN_CAP_S = 60.0


# ── snowflakes ──────────────────────────────────────────────────────────────

def snowflake_ms(value: str | int) -> float | None:
    """Milliseconds since the UNIX epoch encoded in a Discord snowflake, or None.

    ⛔ A snowflake is not a timestamp field we are trusting a producer to set — Discord mints it
    when it creates the interaction, so it is the arrival clock itself."""
    try:
        n = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return float((n >> 22) + DISCORD_EPOCH_MS)


def iso(ms: float) -> str:
    return dt.datetime.fromtimestamp(ms / 1000.0, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def parse_iso(text: str) -> float:
    """ISO-8601 -> epoch milliseconds. Accepts the trailing Z Discord and Railway both use."""
    raw = str(text).strip().replace("Z", "+00:00")
    return dt.datetime.fromisoformat(raw).timestamp() * 1000.0


def hash_user(user_id: str | None) -> str:
    raw = str(user_id or "").strip()
    if not raw:
        return "-"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


# ── the Discord pull ────────────────────────────────────────────────────────

def _get(path: str, *, token: str, timeout: float = 30.0) -> tuple[int, object]:
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bot {token}", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:  # noqa: BLE001 — the body is diagnostic only and may be anything
            body = {}
        return e.code, body


def readable_text_channels(token: str, log=print) -> list[str]:
    """Every text-ish channel in every guild the bot is in. A 403 on one guild is reported,
    not swallowed: a guild we cannot enumerate is a hole in the census, and the caller has to
    know it exists."""
    status, guilds = _get("/users/@me/guilds", token=token)
    if status != 200 or not isinstance(guilds, list):
        log(f"  guild list: http={status} — cannot enumerate channels")
        return []
    out: list[str] = []
    for g in guilds:
        gid = str(g.get("id"))
        st, chans = _get(f"/guilds/{gid}/channels", token=token)
        if st != 200 or not isinstance(chans, list):
            log(f"  guild {gid}: channels http={st} — NOT enumerated, this guild is a hole")
            continue
        names = 0
        for c in chans:
            # 0 text · 5 announcement · 11/12 threads. Voice and categories cannot hold a reply.
            if int(c.get("type", -1)) in (0, 5, 11, 12):
                out.append(str(c.get("id")))
                names += 1
        log(f"  guild {g.get('name', gid)}: {names} readable text channel(s)")
    return out


def pull_channel(channel_id: str, *, token: str, since_ms: float, until_ms: float,
                 max_pages: int = 400, sleep_s: float = 0.35, log=print) -> tuple[list[dict], bool, float | None]:
    """(arrivals, exact, oldest_message_ms) for one channel, newest-first paging.

    `exact` is True only when the pager proved it reached past `since`: either it saw a message
    strictly older than `since`, or Discord returned an UNDER-FULL page (nothing older exists).
    Anything else — a page cap, an HTTP error mid-walk — is a FLOOR and says so.

    ⛔ THE UNDER-FULL PAGE IS THE SAME DISCRIMINATOR `tools/railway_env_logs.py` LEARNED. A walk
    that simply stops cannot be told from a walk that finished unless the last page is short."""
    arrivals: list[dict] = []
    before: str | None = None
    exact = False
    oldest_seen: float | None = None
    pages = 0
    while pages < max_pages:
        q = {"limit": "100"}
        if before:
            q["before"] = before
        status, msgs = _get(f"/channels/{channel_id}/messages?{urllib.parse.urlencode(q)}", token=token)
        pages += 1
        if status == 429:
            time.sleep(2.0)
            pages -= 1
            continue
        if status != 200 or not isinstance(msgs, list):
            code = msgs.get("code") if isinstance(msgs, dict) else None
            log(f"  channel {channel_id}: http={status} code={code} after {pages - 1} page(s) — FLOOR")
            return arrivals, False, oldest_seen
        if not msgs:
            exact = True           # the start of the channel: there is nothing older to miss
            break
        page_oldest = None
        for m in msgs:
            try:
                created = snowflake_ms(m.get("id"))
            except Exception:  # noqa: BLE001
                created = None
            if created is not None:
                page_oldest = created if page_oldest is None else min(page_oldest, created)
            im = m.get("interaction_metadata") or m.get("interaction") or {}
            if not isinstance(im, dict) or not im.get("id"):
                continue
            itype = int(im.get("type") or 0)
            if itype not in QUEUED_INTERACTION_TYPES:
                continue
            at = snowflake_ms(im.get("id"))
            if at is None or at < since_ms or at > until_ms:
                continue
            edited = None
            if m.get("edited_timestamp"):
                try:
                    edited = parse_iso(m["edited_timestamp"])
                except (TypeError, ValueError):
                    edited = None
            arrivals.append({
                "ts_ms": at,
                "ts": iso(at),
                "command": str(im.get("name") or "?").lower(),
                "itype": itype,
                "user": hash_user((im.get("user") or {}).get("id")),
                "channel": str(channel_id),
                "interaction_id": str(im.get("id")),
                "edited_ms": edited,
                "attachments": len(m.get("attachments") or []),
            })
        if page_oldest is not None:
            oldest_seen = page_oldest if oldest_seen is None else min(oldest_seen, page_oldest)
        if page_oldest is not None and page_oldest < since_ms:
            exact = True           # we walked past the window's floor
            break
        if len(msgs) < 100:
            exact = True           # under-full page: Discord had nothing older
            break
        before = min(str(m.get("id")) for m in msgs if m.get("id"))
        if sleep_s:
            time.sleep(sleep_s)
    else:
        log(f"  channel {channel_id}: hit the {max_pages}-page cap — FLOOR")
    return arrivals, exact, oldest_seen


def cmd_pull(args) -> int:
    token = os.environ.get("DISCORD_BOT_TOKEN") or ""
    if not token:
        print("DISCORD_BOT_TOKEN is not set — run this under `railway run --service web`", file=sys.stderr)
        return BLOCKED
    since_ms = parse_iso(args.since)
    until_ms = parse_iso(args.until) if args.until else time.time() * 1000.0
    channels = list(args.channel or [])
    if args.all_channels:
        print("enumerating channels…", file=sys.stderr)
        channels += [c for c in readable_text_channels(token, log=lambda m: print(m, file=sys.stderr))
                     if c not in channels]
    if not channels:
        env = os.environ.get("CHART_FLOW_CHANNEL_ID") or os.environ.get("FLOW_CMD_CHANNEL_ID") or ""
        channels = [c.strip() for c in env.split(",") if c.strip()]
    if not channels:
        print("no channels to scan (pass --channel or --all-channels)", file=sys.stderr)
        return BLOCKED
    all_arrivals: list[dict] = []
    exact_all = True
    per_channel: dict[str, int] = {}
    coverage_floor: float | None = None
    for ch in channels:
        rows, exact, oldest = pull_channel(ch, token=token, since_ms=since_ms, until_ms=until_ms,
                                           max_pages=args.max_pages,
                                           log=lambda m: print(m, file=sys.stderr))
        # ⛔ PER CHANNEL, NOT JUST IN TOTAL. One channel that hit the page cap makes the whole
        # census a floor, and a reader has to be able to see WHICH — a deep feed channel with no
        # interactions in it is a very different hole from the command channel stopping short.
        per_channel[ch] = {"arrivals": len(rows), "exact": exact,
                           "oldest_message": iso(oldest) if oldest else None}
        all_arrivals += rows
        exact_all = exact_all and exact
        if rows:
            # How far back this channel's own history actually reaches, for the coverage line.
            first = min(r["ts_ms"] for r in rows)
            if oldest is not None:
                first = min(first, oldest)
            coverage_floor = first if coverage_floor is None else max(coverage_floor, first)
        if rows:
            print(f"  channel {ch}: {len(rows)} arrival(s), {'EXACT' if exact else 'FLOOR'}", file=sys.stderr)
    all_arrivals.sort(key=lambda r: r["ts_ms"])
    covered_from = max(since_ms, min((r["ts_ms"] for r in all_arrivals), default=since_ms))
    meta = {"_meta": {"source": "discord-channel-history", "exact": exact_all,
                      "count": len(all_arrivals), "since": args.since, "until": iso(until_ms),
                      "channels": per_channel, "first_arrival": iso(covered_from) if all_arrivals else None,
                      "pulled_at": iso(time.time() * 1000.0)}}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(meta) + "\n")
        for r in all_arrivals:
            fh.write(json.dumps(r) + "\n")
    os.replace(tmp, args.out)
    print(f"TOTALS pull arrivals={len(all_arrivals)} channels={len(channels)} "
          f"exact={'yes' if exact_all else 'NO (floor)'} out={args.out}")
    if not all_arrivals:
        print("FAIL: zero arrivals parsed — a census that finds nothing has not measured a quiet "
              "month, it has failed to read", file=sys.stderr)
        return FAIL
    return OK


# ── loading ─────────────────────────────────────────────────────────────────

def load_arrivals(paths: list[str]) -> tuple[list[dict], dict]:
    rows: list[dict] = []
    meta: dict = {"exact": True, "files": []}
    for p in paths:
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if "_meta" in obj:
                    m = obj["_meta"]
                    meta["files"].append({"path": os.path.basename(p), **m})
                    meta["exact"] = meta["exact"] and bool(m.get("exact", True))
                    continue
                if "ts_ms" in obj:
                    rows.append(obj)
    rows.sort(key=lambda r: r["ts_ms"])
    return rows, meta


def load_renderer(path: str) -> tuple[list[dict], bool]:
    """`render cid=… path=… status=… ms=… prio=interactive …` lines from railway_env_logs."""
    out: list[dict] = []
    exact = True
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if "_meta" in obj:
                exact = bool(obj["_meta"].get("exact", True))
                continue
            msg = obj.get("message") or ""
            if "prio=interactive" not in msg or "render cid=" not in msg:
                continue
            ms = None
            for tok in msg.split():
                if tok.startswith("ms="):
                    try:
                        ms = float(tok[3:])
                    except ValueError:
                        ms = None
            try:
                at = parse_iso(obj["timestamp"])
            except (KeyError, TypeError, ValueError):
                continue
            out.append({"ts_ms": at, "render_ms": ms, "message_tail": msg.split("path=")[-1][:40]})
    out.sort(key=lambda r: r["ts_ms"])
    return out, exact


# ── distribution ────────────────────────────────────────────────────────────

def busiest_window(rows: list[dict], width_s: float) -> dict:
    """The most arrivals in any window of `width_s`, anchored at an arrival.

    Anchoring at each arrival is exhaustive for the maximum: any window holding k arrivals can
    be slid forward until its left edge sits on the first of them without losing any. A fixed
    grid of buckets CANNOT say this — it splits a burst across two buckets and reports half."""
    if not rows:
        return {"count": 0, "start": None, "commands": {}}
    width_ms = width_s * 1000.0
    best = {"count": 0, "start": None, "commands": {}}
    j = 0
    for i, r in enumerate(rows):
        edge = r["ts_ms"] + width_ms
        if j < i:
            j = i
        while j < len(rows) and rows[j]["ts_ms"] < edge:
            j += 1
        n = j - i
        if n > best["count"]:
            mix = collections.Counter(x["command"] for x in rows[i:j])
            users = collections.Counter(x["user"] for x in rows[i:j])
            best = {"count": n, "start": r["ts"], "commands": dict(mix),
                    "distinct_users": len(users), "max_per_user": max(users.values())}
    return best


def per_bucket(rows: list[dict], width_s: float, start_ms: float, end_ms: float) -> list[int]:
    width_ms = width_s * 1000.0
    n = max(1, int(math.ceil((end_ms - start_ms) / width_ms)))
    buckets = [0] * n
    for r in rows:
        k = int((r["ts_ms"] - start_ms) // width_ms)
        if 0 <= k < n:
            buckets[k] += 1
    return buckets


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(math.ceil(p / 100.0 * len(s))) - 1))
    return s[k]


def max_overlap(spans: list[tuple[float, float]]) -> int:
    """Greatest number of spans open at one instant."""
    events: list[tuple[float, int]] = []
    for a, b in spans:
        events.append((a, 1))
        events.append((b, -1))
    # ⛔ THE TIE ORDER IS THE WHOLE ANSWER. At one instant a close must be applied BEFORE an open,
    # or a span that ends exactly when the next begins reads as two jobs in flight at once and
    # every concurrency number comes back one too high. -1 sorts before +1.
    events.sort(key=lambda e: (e[0], e[1]))
    cur = best = 0
    for _, delta in events:
        cur += delta
        best = max(best, cur)
    return best


def concurrency_proxies(rows: list[dict], service_ms: float) -> dict:
    """Two proxies for "how many were in flight at once". Neither is a measurement of
    concurrency, because nothing in production recorded a job's start and end together.

      P1 — ASSUMED-SERVICE OVERLAP. Every arrival is assumed to occupy one worker for exactly
           `service_ms`. Arrivals are measured; the span is a constant we chose. So P1 measures
           the ARRIVAL PATTERN, and says what concurrency that pattern would produce IF each job
           took `service_ms`.
      P2 — DELIVERY-LAG OVERLAP. For a reply that Discord recorded an `edited_timestamp` for, the
           interval [arrival, edit] is when that job was genuinely outstanding in production: the
           edit is the moment the answer landed. That span is MEASURED. Its weaknesses are stated
           with the number: a message re-edited later by a button click or a stand-in heal has an
           inflated span (capped and counted), and a reply that was never edited — most `/flow`
           answers — contributes nothing, so P2 covers a subset.
    """
    p1 = max_overlap([(r["ts_ms"], r["ts_ms"] + service_ms) for r in rows])
    spans, trimmed, missing = [], 0, 0
    lags: list[float] = []
    for r in rows:
        e = r.get("edited_ms")
        if not e:
            missing += 1
            continue
        span = e - r["ts_ms"]
        if span <= 0:
            missing += 1
            continue
        if span > EDIT_SPAN_CAP_S * 1000.0:
            trimmed += 1
            continue
        spans.append((r["ts_ms"], e))
        lags.append(span)
    return {"p1_assumed_service": p1, "p1_service_ms": service_ms,
            "p2_delivery_lag": max_overlap(spans) if spans else 0,
            "p2_n": len(spans), "p2_trimmed_over_cap": trimmed, "p2_no_edit": missing,
            "p2_lag_p50_ms": pct(lags, 50), "p2_lag_p95_ms": pct(lags, 95),
            "p2_lag_max_ms": max(lags) if lags else 0.0}


# ── the sizing arithmetic ───────────────────────────────────────────────────

def erlang_c(c: int, a: float) -> float:
    """P(an arrival waits) for M/M/c with offered load `a` = lambda * S erlangs.

    Returns 1.0 when the system is not stable (a >= c): every arrival waits, forever."""
    if c <= 0:
        return 1.0
    if a >= c:
        return 1.0
    # Erlang B by the numerically safe recurrence, then B -> C.
    b = 1.0
    for n in range(1, c + 1):
        b = (a * b) / (n + a * b)
    rho = a / c
    return b / (1.0 - rho * (1.0 - b))


def wait_pct(c: int, lam_per_s: float, service_s: float, p: float) -> float:
    """The p-th percentile QUEUE WAIT (seconds) for M/M/c. inf when unstable.

    For M/M/c the waiting time has an atom at zero of size 1 - C and an exponential tail with
    rate (c*mu - lambda), so P(W > t) = C * exp(-(c*mu - lambda) t). Inverting at the tail:
        w_p = ln(C / (1 - p)) / (c*mu - lambda),  and 0 when C <= 1 - p."""
    if service_s <= 0 or c <= 0:
        return 0.0
    mu = 1.0 / service_s
    a = lam_per_s * service_s
    if a >= c:
        return float("inf")
    cvar = erlang_c(c, a)
    tail = 1.0 - p
    if cvar <= tail:
        return 0.0
    return math.log(cvar / tail) / (c * mu - lam_per_s)


def derive_sizing(*, burst_10s: int, burst_60s: int, multiple: float, service_p50_s: float,
                  service_p95_s: float, s2_budget_s: float, max_per_user_10s: int,
                  distinct_users_10s: int) -> dict:
    """Every term is named and returned, so the report can print the arithmetic rather than
    a conclusion. NOTHING here is measured — the measured inputs arrive as arguments."""
    lam = multiple * burst_10s / 10.0                     # arrivals/second at the design burst
    offered = lam * service_p50_s                         # Little's Law: L = lambda * W (erlangs)
    wait_budget_s = max(0.0, s2_budget_s - service_p95_s)  # what is left of S2 for QUEUE WAIT
    chosen_c = None
    table = []
    for c in range(1, 33):
        w95 = wait_pct(c, lam, service_p50_s, 0.95)
        stable = lam * service_p50_s < c
        table.append({"c": c, "rho": (lam * service_p50_s / c) if c else float("inf"),
                      "wait_p95_s": w95, "stable": stable})
        if chosen_c is None and stable and w95 <= wait_budget_s:
            chosen_c = c
    # Queue depth: the design burst is 3x the busiest ten seconds arriving inside ten seconds,
    # while `c` workers drain at c/service. Nothing may be refused, so the queue must hold the
    # arrivals the workers have not yet taken — plus the same test over the busiest MINUTE,
    # because a minute-long swell can outlast a ten-second one.
    burst_arrivals_10s = multiple * burst_10s
    drained_10s = (chosen_c or 1) * (10.0 / service_p50_s) if service_p50_s > 0 else 0.0
    backlog_10s = max(0.0, burst_arrivals_10s - drained_10s)
    burst_arrivals_60s = multiple * burst_60s
    drained_60s = (chosen_c or 1) * (60.0 / service_p50_s) if service_p50_s > 0 else 0.0
    backlog_60s = max(0.0, burst_arrivals_60s - drained_60s)
    need = max(backlog_10s, backlog_60s)
    return {"lambda_per_s": lam, "offered_erlangs": offered, "wait_budget_s": wait_budget_s,
            "chosen_c": chosen_c, "table": table,
            "burst_arrivals_10s": burst_arrivals_10s, "drained_10s": drained_10s,
            "backlog_10s": backlog_10s, "burst_arrivals_60s": burst_arrivals_60s,
            "drained_60s": drained_60s, "backlog_60s": backlog_60s, "queue_need": need,
            "max_per_user_10s": max_per_user_10s, "distinct_users_10s": distinct_users_10s}


# ── the report ──────────────────────────────────────────────────────────────

def analyse(rows: list[dict], meta: dict, *, renderer: list[dict] | None, renderer_exact: bool,
            service_p50_ms: float, service_p95_ms: float, s2_budget_s: float,
            multiple: float, current: dict) -> tuple[list[str], dict]:
    out: list[str] = []
    w = out.append
    start_ms = min(r["ts_ms"] for r in rows)
    end_ms = max(r["ts_ms"] for r in rows)
    days = max(1e-9, (end_ms - start_ms) / 86400000.0)

    w(f"WINDOW ACTUALLY COVERED: {iso(start_ms)} -> {iso(end_ms)}  ({days:.2f} days) "
      f"— pull is {'EXACT' if meta.get('exact') else 'A FLOOR'}")
    w("SOURCE: Discord channel history (interaction_metadata.id snowflakes). "
      "FLOOR ON QUEUE ARRIVALS: button clicks, ephemeral replies, DMs and unreadable channels "
      "leave no message and are not counted.")
    w("")

    # ── per command ──────────────────────────────────────────────────────
    by_cmd = collections.Counter(r["command"] for r in rows)
    w("## Arrivals by command")
    w(f"{'command':<12}{'count':>8}{'share':>9}{'per day':>10}{'busiest 60s':>13}{'busiest 10s':>13}")
    for cmd in list(COMMANDS) + sorted(set(by_cmd) - set(COMMANDS)):
        n = by_cmd.get(cmd, 0)
        sub = [r for r in rows if r["command"] == cmd]
        b60 = busiest_window(sub, 60)["count"]
        b10 = busiest_window(sub, 10)["count"]
        w(f"{'/' + cmd:<12}{n:>8}{(100.0 * n / len(rows)):>8.1f}%{(n / days):>10.1f}{b60:>13}{b10:>13}")
    w(f"{'ALL':<12}{len(rows):>8}{100.0:>8.1f}%{(len(rows) / days):>10.1f}"
      f"{busiest_window(rows, 60)['count']:>13}{busiest_window(rows, 10)['count']:>13}")
    w("")

    # ── per minute / per second ──────────────────────────────────────────
    minutes = per_bucket(rows, 60, start_ms, end_ms)
    seconds_nonzero = collections.Counter(int(r["ts_ms"] // 1000) for r in rows)
    w("## Arrival rate distribution")
    w(f"minutes in window              : {len(minutes)}")
    w(f"minutes with >= 1 arrival      : {sum(1 for m in minutes if m)} "
      f"({100.0 * sum(1 for m in minutes if m) / max(1, len(minutes)):.2f}%)")
    w(f"arrivals/minute mean (all)     : {len(rows) / max(1, len(minutes)):.4f}")
    w(f"arrivals/minute p95 (all)      : {pct([float(m) for m in minutes], 95):.0f}")
    w(f"arrivals/minute p99 (all)      : {pct([float(m) for m in minutes], 99):.0f}")
    w(f"arrivals/minute MAX            : {max(minutes) if minutes else 0}")
    w(f"arrivals/minute mean (busy min): "
      f"{(len(rows) / max(1, sum(1 for m in minutes if m))):.2f}")
    w(f"seconds with >= 1 arrival      : {len(seconds_nonzero)}")
    w(f"arrivals/second MAX            : {max(seconds_nonzero.values()) if seconds_nonzero else 0}")
    w("")

    # ── busiest windows ──────────────────────────────────────────────────
    b60 = busiest_window(rows, 60)
    b10 = busiest_window(rows, 10)
    w("## Busiest windows (sliding, anchored at each arrival — not a fixed grid)")
    w(f"busiest 60 s : {b60['count']} arrivals starting {b60['start']}  mix={b60['commands']}  "
      f"distinct members={b60.get('distinct_users')}  most from one member={b60.get('max_per_user')}")
    w(f"busiest 10 s : {b10['count']} arrivals starting {b10['start']}  mix={b10['commands']}  "
      f"distinct members={b10.get('distinct_users')}  most from one member={b10.get('max_per_user')}")
    w("")

    # ── concurrency ──────────────────────────────────────────────────────
    conc = concurrency_proxies(rows, service_p50_ms)
    w("## Concurrency — PROXIES, not a measurement")
    w("Nothing in production recorded a job's start and end together, so in-flight count is "
      "estimated two ways and both are labelled.")
    w(f"P1 assumed-service overlap     : {conc['p1_assumed_service']} "
      f"(every arrival held a worker for exactly {conc['p1_service_ms']:.0f} ms — the ARRIVALS are "
      f"measured, the span is assumed)")
    w(f"P2 delivery-lag overlap        : {conc['p2_delivery_lag']} over {conc['p2_n']} replies whose "
      f"edit Discord recorded (span = arrival -> edit, MEASURED)")
    w(f"   P2 replies with no edit     : {conc['p2_no_edit']} (not counted — most /flow answers are "
      f"never edited)")
    w(f"   P2 spans over the {EDIT_SPAN_CAP_S:.0f}s cap : {conc['p2_trimmed_over_cap']} "
      f"(excluded: a later button click or stand-in heal re-edits the same message)")
    w(f"   P2 delivery lag p50/p95/max : {conc['p2_lag_p50_ms']:.0f} / {conc['p2_lag_p95_ms']:.0f} / "
      f"{conc['p2_lag_max_ms']:.0f} ms")
    w("")

    # ── renderer corroboration ───────────────────────────────────────────
    if renderer:
        r_start, r_end = renderer[0]["ts_ms"], renderer[-1]["ts_ms"]
        r_days = max(1e-9, (r_end - r_start) / 86400000.0)
        overlap = [r for r in rows if r_start <= r["ts_ms"] <= r_end]
        rb10 = busiest_window([{"ts_ms": x["ts_ms"], "ts": iso(x["ts_ms"]), "command": "render",
                                "user": "-"} for x in renderer], 10)
        w("## Corroborating source — chart-renderer interactive renders")
        w(f"window: {iso(r_start)} -> {iso(r_end)} ({r_days:.2f} days), "
          f"{'EXACT' if renderer_exact else 'A FLOOR'}")
        w(f"interactive renders          : {len(renderer)}  ({len(renderer) / r_days:.0f}/day)")
        w(f"arrivals seen by this census in the SAME window: {len(overlap)}")
        if overlap:
            w(f"renders per counted arrival  : {len(renderer) / len(overlap):.2f}  "
              f"— the excess is button clicks, /charts fan-out, fast-preview second renders and "
              f"scheduled posts, which is why the arrival count above is a floor")
        w(f"busiest 10 s of renders      : {rb10['count']} starting {rb10['start']}")
        rms = [x["render_ms"] for x in renderer if x.get("render_ms")]
        if rms:
            w(f"renderer service ms p50/p95  : {pct(rms, 50):.0f} / {pct(rms, 95):.0f} "
              f"(the renderer leg only, not the whole job)")
        w("")
    else:
        w("## Corroborating source — chart-renderer interactive renders")
        w("NOT AVAILABLE for this window: the renderer's per-render line only gained `prio=` on "
          "2026-09-13 (a353596ce), and environment log retention bottoms out around 16 days.")
        w("")

    # ── sizing ───────────────────────────────────────────────────────────
    sizing = derive_sizing(burst_10s=b10["count"], burst_60s=b60["count"], multiple=multiple,
                           service_p50_s=service_p50_ms / 1000.0, service_p95_s=service_p95_ms / 1000.0,
                           s2_budget_s=s2_budget_s,
                           max_per_user_10s=int(b10.get("max_per_user") or 0),
                           distinct_users_10s=int(b10.get("distinct_users") or 0))
    w("## Sizing arithmetic")
    w(f"design burst  = {multiple:g}x the busiest 10 s = {multiple:g} x {b10['count']} = "
      f"{sizing['burst_arrivals_10s']:.0f} arrivals inside 10 s  -> lambda = "
      f"{sizing['lambda_per_s']:.3f} arrivals/s   [DERIVED from a MEASURED burst]")
    w(f"service time  = p50 {service_p50_ms:.0f} ms, p95 {service_p95_ms:.0f} ms   "
      f"[MEASURED, unsaturated load run only]")
    w(f"Little's Law  : L = lambda x W = {sizing['lambda_per_s']:.3f}/s x "
      f"{service_p50_ms / 1000.0:.3f} s = {sizing['offered_erlangs']:.3f} jobs in service on average "
      f"(offered load, erlangs)")
    w(f"S2 budget     : p95 end-to-end <= {s2_budget_s:.1f} s, of which service p95 is "
      f"{service_p95_ms / 1000.0:.3f} s, leaving {sizing['wait_budget_s']:.3f} s for QUEUE WAIT")
    w("M/M/c queue-wait p95 by worker count (rho = offered/c):")
    w(f"   {'c':>3}{'rho':>9}{'wait p95 (s)':>15}")
    for row in sizing["table"][:10]:
        ws = "unstable" if row["wait_p95_s"] == float("inf") else f"{row['wait_p95_s']:.3f}"
        w(f"   {row['c']:>3}{row['rho']:>9.3f}{ws:>15}")
    w(f"smallest c meeting the wait budget: {sizing['chosen_c']}")
    w(f"queue depth   : 10 s test  {multiple:g}x{b10['count']} = {sizing['burst_arrivals_10s']:.0f} "
      f"arrive, c x (10 s / {service_p50_ms / 1000.0:.3f} s) = {sizing['drained_10s']:.1f} drain "
      f"-> backlog {sizing['backlog_10s']:.1f}")
    w(f"                60 s test  {multiple:g}x{b60['count']} = {sizing['burst_arrivals_60s']:.0f} "
      f"arrive, c x (60 s / {service_p50_ms / 1000.0:.3f} s) = {sizing['drained_60s']:.1f} drain "
      f"-> backlog {sizing['backlog_60s']:.1f}")
    w(f"                depth needed = max of the two = {sizing['queue_need']:.1f}")
    w(f"per-user      : most arrivals from ONE member inside the busiest 10 s = "
      f"{sizing['max_per_user_10s']} (measured); distinct members in that window = "
      f"{sizing['distinct_users_10s']}")
    w("")
    w("## Against the constants in the tree today")
    for k, v in current.items():
        w(f"   {k:<34}= {v}")
    w("")
    totals = {"arrivals": len(rows), "days": days, "busiest60": b60["count"], "busiest10": b10["count"],
              "lambda": sizing["lambda_per_s"], "chosen_c": sizing["chosen_c"],
              "queue_need": sizing["queue_need"], "exact": bool(meta.get("exact")),
              "p1": conc["p1_assumed_service"], "p2": conc["p2_delivery_lag"],
              "max_per_user_10s": sizing["max_per_user_10s"]}
    return out, totals


CURRENT_CONSTANTS = {
    "DISCORD_RENDER_WORKERS": "6 (runtime.py:185 default; UNSET in prod)",
    "DISCORD_RENDER_QUEUE_MAX": "48 (runtime.py:186 default; UNSET in prod)",
    "DISCORD_RENDER_PER_USER_MAX": "2 (runtime.py:188 default; UNSET in prod)",
    "DISCORD_RENDER_BG_MAX": "2 (runtime.py:187 default; UNSET in prod)",
    "DISCORD_CHART_MAX_CONCURRENT": "8 (pre-V2 render slots, discord_interactions.py:52; SET in prod)",
}


def cmd_analyze(args) -> int:
    rows, meta = load_arrivals(args.arrivals)
    renderer: list[dict] = []
    renderer_exact = True
    if args.renderer:
        renderer, renderer_exact = load_renderer(args.renderer)
    if not rows:
        print("TOTALS analyze arrivals=0 VERDICT=FAIL")
        print("FAIL: zero arrivals parsed. A sizing derived from no arrivals is a guess wearing a "
              "table; this exits non-zero rather than reporting a happy zero.", file=sys.stderr)
        return FAIL
    lines, totals = analyse(rows, meta, renderer=renderer, renderer_exact=renderer_exact,
                            service_p50_ms=args.service_p50_ms, service_p95_ms=args.service_p95_ms,
                            s2_budget_s=args.s2_budget_s, multiple=args.multiple,
                            current=CURRENT_CONSTANTS)
    text = "\n".join(lines) + "\n"
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
        tmp = args.out + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, args.out)
    print(text)
    print(f"TOTALS analyze arrivals={totals['arrivals']} days={totals['days']:.2f} "
          f"busiest60={totals['busiest60']} busiest10={totals['busiest10']} "
          f"lambda={totals['lambda']:.3f}/s workers={totals['chosen_c']} "
          f"queue_need={totals['queue_need']:.1f} per_user_max_seen={totals['max_per_user_10s']} "
          f"conc_p1={totals['p1']} conc_p2={totals['p2']} "
          f"exact={'yes' if totals['exact'] else 'NO'}")
    return OK


# ── self-check ──────────────────────────────────────────────────────────────

def _row(ts_ms: float, command: str = "chart", user: str = "u1", edited_ms: float | None = None) -> dict:
    return {"ts_ms": ts_ms, "ts": iso(ts_ms), "command": command, "itype": 2, "user": user,
            "channel": "c", "interaction_id": "0", "edited_ms": edited_ms, "attachments": 1}


def self_check() -> int:
    checks: list[tuple[str, bool, str]] = []

    def check(name: str, cond: bool, detail: str = "") -> None:
        checks.append((name, bool(cond), detail))

    # 1. Snowflake decode against a value whose time is known independently.
    #    175928847299117063 is Discord's own documented example: 2016-04-30T11:18:25.796Z.
    ms = snowflake_ms(175928847299117063)
    check("snowflake decodes Discord's documented example", ms is not None and iso(ms) == "2016-04-30T11:18:25.796Z",
          f"got {iso(ms) if ms else None}")
    check("snowflake rejects rubbish", snowflake_ms("not-a-snowflake") is None and snowflake_ms(0) is None)

    # 2. Busiest-window is exhaustive where a fixed grid is not: five arrivals straddling a
    #    minute boundary must read as 5-in-10s, not as 2 and 3.
    base = parse_iso("2026-09-01T00:00:58.000Z")
    straddle = [_row(base + i * 1000.0) for i in range(5)]
    b = busiest_window(straddle, 10)
    grid = per_bucket(straddle, 10, parse_iso("2026-09-01T00:00:00.000Z"), base + 10000.0)
    check("sliding 10 s window finds the straddling burst", b["count"] == 5, f"got {b['count']}")
    check("a fixed grid would have SPLIT it (control for the line above)", max(grid) < 5,
          f"grid max {max(grid)}")

    # 3. Busiest window reports the member mix the per-user rule needs.
    mixed = [_row(base, user="a"), _row(base + 500, user="a"), _row(base + 900, user="b")]
    bm = busiest_window(mixed, 10)
    check("busiest window reports distinct members and the per-member max",
          bm["distinct_users"] == 2 and bm["max_per_user"] == 2, str(bm))

    # 4. Overlap arithmetic.
    check("max_overlap counts simultaneous spans", max_overlap([(0, 10), (5, 15), (20, 30)]) == 2)
    check("max_overlap treats a touching pair as sequential", max_overlap([(0, 10), (10, 20)]) == 1)

    # 5. Erlang-C / wait percentile behave at the edges that matter.
    check("erlang_c saturates to 1.0 when offered load reaches the servers", erlang_c(2, 2.0) == 1.0)
    check("wait p95 is infinite when the system is unstable", wait_pct(1, 10.0, 1.0, 0.95) == float("inf"))
    check("wait p95 falls as workers are added",
          wait_pct(2, 1.0, 1.0, 0.95) > wait_pct(6, 1.0, 1.0, 0.95))
    check("wait p95 is zero when the queue is almost never entered",
          wait_pct(20, 0.2, 1.0, 0.95) == 0.0)

    # 6. ⛔ NON-VACUITY. The whole instrument must FAIL on an empty parse, not report a calm zero.
    empty_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_selfcheck_empty.jsonl")
    with open(empty_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"_meta": {"exact": True, "count": 0}}) + "\n")
    try:
        args = argparse.Namespace(arrivals=[empty_path], renderer=None, out=None,
                                  service_p50_ms=1000.0, service_p95_ms=1748.0, s2_budget_s=5.0,
                                  multiple=3.0)
        rc_empty = cmd_analyze(args)
    finally:
        os.remove(empty_path)
    check("EMPTY ARRIVALS EXIT NON-ZERO (non-vacuity control)", rc_empty == FAIL, f"rc={rc_empty}")

    # 7. …and the same call on real-shaped rows exits 0, so check 6 is not passing because the
    #    analyzer is simply broken.
    good_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_selfcheck_rows.jsonl")
    with open(good_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"_meta": {"exact": True, "count": 3}}) + "\n")
        for i in range(3):
            fh.write(json.dumps(_row(base + i * 2000.0, edited_ms=base + i * 2000.0 + 1500.0)) + "\n")
    try:
        args = argparse.Namespace(arrivals=[good_path], renderer=None, out=None,
                                  service_p50_ms=1000.0, service_p95_ms=1748.0, s2_budget_s=5.0,
                                  multiple=3.0)
        rc_good = cmd_analyze(args)
    finally:
        os.remove(good_path)
    check("POPULATED ARRIVALS EXIT ZERO (control for the control)", rc_good == OK, f"rc={rc_good}")

    # 8. A FLOOR pull must stay flagged through the loader.
    floor_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_selfcheck_floor.jsonl")
    with open(floor_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"_meta": {"exact": False, "count": 1}}) + "\n")
        fh.write(json.dumps(_row(base)) + "\n")
    try:
        _, m = load_arrivals([floor_path])
    finally:
        os.remove(floor_path)
    check("a FLOOR pull stays a floor after loading", m["exact"] is False)

    # 9. The sizing must actually respond to the burst it is given.
    small = derive_sizing(burst_10s=2, burst_60s=5, multiple=3.0, service_p50_s=1.0,
                          service_p95_s=1.748, s2_budget_s=5.0, max_per_user_10s=1,
                          distinct_users_10s=2)
    big = derive_sizing(burst_10s=200, burst_60s=600, multiple=3.0, service_p50_s=1.0,
                        service_p95_s=1.748, s2_budget_s=5.0, max_per_user_10s=9,
                        distinct_users_10s=40)
    check("a larger burst demands more workers", (big["chosen_c"] or 99) > (small["chosen_c"] or 0),
          f"small c={small['chosen_c']} big c={big['chosen_c']}")

    # 9b. ⛔⛔ THE HEADROOM MULTIPLE IS APPLIED, NOT DECORATIVE.
    # ⚰️ Added 2026-09-14 after a mutation caught this file out: replacing `multiple` with 1.0 in
    # the arrival-rate line left the self-check at 17/17 PASS. The checks above test monotonicity
    # in the BURST, which still holds when the multiple is inert — so the one term the owner's
    # ruling actually specifies ("3x the observed busiest 10 s window never hits queue_full") was
    # unguarded. A rail that cannot see the requirement it exists for is not a rail.
    same = dict(burst_10s=40, burst_60s=120, service_p50_s=1.0, service_p95_s=1.748,
                s2_budget_s=5.0, max_per_user_10s=3, distinct_users_10s=20)
    at1 = derive_sizing(multiple=1.0, **same)
    at3 = derive_sizing(multiple=3.0, **same)
    check("3x headroom raises the arrival rate it sizes for",
          abs(at3["lambda_per_s"] - 3.0 * at1["lambda_per_s"]) < 1e-9,
          f"lam 1x={at1['lambda_per_s']} 3x={at3['lambda_per_s']}")
    check("3x headroom demands strictly more workers OR a deeper queue",
          (at3["chosen_c"] or 0) > (at1["chosen_c"] or 0) or at3["queue_need"] > at1["queue_need"],
          f"c {at1['chosen_c']}->{at3['chosen_c']}  queue {at1['queue_need']}->{at3['queue_need']}")
    # ⛔ control for the control: equal multiples must size IDENTICALLY, or the two rows above
    # would pass for any function whose output merely varies between calls.
    check("the same multiple sizes identically (control for the two above)",
          derive_sizing(multiple=2.0, **same) == derive_sizing(multiple=2.0, **same))
    check("a larger burst demands a deeper queue", big["queue_need"] > small["queue_need"],
          f"small {small['queue_need']:.1f} big {big['queue_need']:.1f}")
    check("user ids are hashed, never carried through", hash_user("427798118935953410") !=
          "427798118935953410" and len(hash_user("427798118935953410")) == 12)

    passed = sum(1 for _, ok, _ in checks if ok)
    for name, ok, detail in checks:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail and not ok else ''}")
    print(f"TOTALS self-check checks={len(checks)} passed={passed} failed={len(checks) - passed} "
          f"VERDICT={'PASS' if passed == len(checks) else 'FAIL'}")
    return OK if passed == len(checks) else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Arrival census for the Discord render queue.")
    ap.add_argument("--pull-discord", action="store_true")
    ap.add_argument("--analyze", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--channel", action="append", default=[])
    ap.add_argument("--all-channels", action="store_true")
    ap.add_argument("--since", default="2026-08-15T00:00:00Z")
    ap.add_argument("--until", default=None)
    ap.add_argument("--max-pages", type=int, default=400)
    ap.add_argument("--arrivals", action="append", default=[])
    ap.add_argument("--renderer", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--service-p50-ms", type=float, default=1000.0,
                    help="measured p50 job service time, UNSATURATED run only")
    ap.add_argument("--service-p95-ms", type=float, default=1748.0,
                    help="measured p95 job service time, UNSATURATED run only")
    ap.add_argument("--s2-budget-s", type=float, default=5.0, help="the S2 p95 end-to-end SLO")
    ap.add_argument("--multiple", type=float, default=3.0, help="owner's design headroom over the busiest 10 s")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    if args.pull_discord:
        if not args.out:
            ap.error("--pull-discord needs --out")
        return cmd_pull(args)
    if args.analyze:
        if not args.arrivals:
            ap.error("--analyze needs --arrivals")
        return cmd_analyze(args)
    ap.error("choose one of --pull-discord / --analyze / --self-check")
    return FAIL


if __name__ == "__main__":
    raise SystemExit(main())
