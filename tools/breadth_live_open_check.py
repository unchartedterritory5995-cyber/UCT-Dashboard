#!/usr/bin/env python3
"""Verify live intraday breadth around the open — without needing a person there.

The feature shipped 2026-08-05 and its first real render is the following
morning's bell. The interactive checks scheduled alongside this live in a chat
session and die with it, so this is the durable half: it runs from Task
Scheduler, writes a report, and shouts on Discord only when something is
actually wrong.

Phases (what each one can uniquely catch):

  preopen  ~09:08 ET  did the 09:05 warm rebuild levels for the NEW session day?
                      If `levels_as_of` is still the day before yesterday, the
                      cache did not roll and the first user pays a ~5-10s build.
  open     ~09:38 ET  did the live read actually engage, and did the intraday
                      store write for the first time on this pod? An empty
                      `path` while the session is live is the silent failure —
                      record() swallows its own errors by design.
  session  ~10:34 ET  is it accumulating honestly: enough points, an `open`
                      that is the session's first reading, and numbers that
                      agree with the direction of the tape.

Exit code is the verdict: 0 clean, 1 problems found, 2 could not check.

    python tools/breadth_live_open_check.py --phase open
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
BASE = os.environ.get("DASHBOARD_URL", "https://uctintelligence.com")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
LOG = Path(__file__).resolve().parent.parent / "data" / "breadth_live_open_check.log"


def _env():
    """Credentials live in the dashboard's own .env; never hardcode them."""
    for p in (Path(r"C:\Users\Patrick\uct-dashboard\.env"),
              Path(__file__).resolve().parent.parent / ".env"):
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def _get(path: str, secret: str | None = None) -> dict:
    req = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": UA})
    if secret:
        req.add_header("Authorization", f"Bearer {secret}")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())


def _prior_session_iso(now: datetime) -> str:
    """The session the levels SHOULD be built from: the last weekday before today.

    Holidays are not modelled — a holiday would make this expect a date one day
    too recent, which reads as a warning rather than a silent pass. Erring
    toward a false alarm is the right direction for a check nobody is watching.
    """
    d = now.date()
    while True:
        d = d.fromordinal(d.toordinal() - 1)
        if d.weekday() < 5:
            return d.isoformat()


def check(phase: str) -> tuple[list[str], list[str]]:
    """(problems, notes)."""
    problems: list[str] = []
    notes: list[str] = []
    now = datetime.now(ET)
    secret = os.environ.get("PUSH_SECRET")

    live = _get("/api/breadth-monitor/live")
    if not live.get("ok"):
        problems.append(f"live endpoint not ok: {live.get('reason')}")
        return problems, notes

    notes.append(f"session={live.get('session_date')} live={live.get('session_live')} "
                 f"superseded={live.get('superseded')} degraded={live.get('degraded')}")
    notes.append(f"coverage={live.get('bars_coverage')} counts_anchored="
                 f"{live.get('counts_anchored')} measured={live.get('measured')}"
                 f"/{live.get('universe_size')}")

    if live.get("degraded"):
        problems.append("DEGRADED — bars measured a different population; every "
                        "surface is withholding its live value")

    want_levels = _prior_session_iso(now)
    if live.get("levels_as_of") != want_levels:
        problems.append(f"levels_as_of={live.get('levels_as_of')} but the prior "
                        f"session is {want_levels} — the daily cache did not roll, "
                        f"so the first user pays the levels build")

    if secret:
        try:
            st = _get("/api/breadth-monitor/live/store?selftest=1", secret)
            w = (st.get("self_test") or {}).get("writable")
            notes.append(f"store writable={w} db={st.get('db')}")
            if not w:
                problems.append(f"intraday store NOT writable: "
                                f"{(st.get('self_test') or {}).get('error')}")
        except Exception as e:
            notes.append(f"store endpoint unavailable: {e}")
    else:
        notes.append("PUSH_SECRET not found — skipped the store self-test")

    # ── dividend price basis (activated 2026-08-06) ──────────────────────────
    # The failure this exists to catch is SILENT: the correction lives behind an
    # env var, so a redeploy that loses `BREADTH_DIVIDEND_BASIS` reverts every
    # long-lookback level to the uncorrected split-only basis and nothing errors
    # — the numbers just quietly go back to being ~9 names wrong on 52w highs
    # and ~50 on stage2. Reconcile would catch it; nobody runs reconcile daily.
    try:
        div = _get("/api/breadth-monitor/live/dividends")
        notes.append(f"dividend basis={div.get('basis_enabled')} "
                     f"rows={div.get('stored_rows')} tickers={div.get('stored_tickers')} "
                     f"truncated={div.get('truncated')}")
        if not div.get("basis_enabled"):
            problems.append(
                "DIVIDEND BASIS IS OFF — live levels have reverted to the "
                "uncorrected split-only basis (52w highs ~9 names low, stage2 "
                "~50 off). Set BREADTH_DIVIDEND_BASIS=1 on the web service.")
        if div.get("truncated"):
            problems.append("dividend sweep TRUNCATED — it ran out of pages, not "
                            "data, so older 52-week windows are under-adjusted")
        rows = div.get("stored_rows") or 0
        if rows and rows < 100_000:
            problems.append(f"dividend store holds only {rows} rows — a full "
                            f"market sweep is ~440k; levels will under-adjust")
        # NOT checked: `refreshed_at`. It is in-process state that resets to
        # None on every container swap, so it reads "never swept" after any
        # deploy while the store on /data is perfectly fine. Row count is the
        # honest durable signal.
    except Exception as e:
        notes.append(f"dividend status unavailable: {e}")

    if phase == "preopen":
        if not live.get("superseded"):
            notes.append("already un-superseded before the bell — early session start?")
        return problems, notes

    # open / session: the live read must actually be engaged by now.
    if live.get("superseded"):
        problems.append("still superseded after the open — the live row is not "
                        "showing; expected session_date to advance past the last "
                        "stored row")
    if not live.get("session_live"):
        problems.append(f"session_live is false (traded_share="
                        f"{live.get('traded_share')}) — a holiday, or the tape "
                        f"has not opened")

    path = live.get("path") or {}
    pts = len(path.get("pct_above_50sma") or [])
    store = live.get("store") or {}
    notes.append(f"path metrics={len(path)} points={pts} store_ok={store.get('ok')} "
                 f"writes={store.get('writes')}")
    if store.get("last_error"):
        problems.append(f"store last_error: {store['last_error']}")

    if live.get("session_live") and not live.get("superseded"):
        if not path:
            problems.append("path is EMPTY while the session is live — the "
                            "intraday store is not persisting (record() swallows "
                            "its own errors, so this is the only tell)")
        elif phase == "session" and pts < 20:
            problems.append(f"only {pts} path points an hour in — expected ~50+ "
                            f"at one sample a minute")

    if phase == "session" and path:
        opened = (live.get("open") or {}).get("pct_above_50sma")
        current = (live.get("metrics") or {}).get("pct_above_50sma")
        notes.append(f"pct_above_50sma opened {opened} -> now {current}")
        adv = (live.get("metrics") or {}).get("adv_decline")
        up = (live.get("metrics") or {}).get("up_4pct_today")
        dn = (live.get("metrics") or {}).get("down_4pct_today")
        notes.append(f"adv_decline={adv} up4={up} dn4={dn}")
        # A breadth read that disagrees with its own internals is the thing to
        # catch — not a threshold, a contradiction.
        if adv is not None and up is not None and dn is not None:
            if adv > 0 and dn > up * 2:
                problems.append(f"contradiction: adv_decline {adv} positive but "
                                f"down-4% ({dn}) far exceeds up-4% ({up})")
            if adv < 0 and up > dn * 2:
                problems.append(f"contradiction: adv_decline {adv} negative but "
                                f"up-4% ({up}) far exceeds down-4% ({dn})")

    return problems, notes


def notify(phase: str, problems: list[str], notes: list[str]) -> None:
    """Discord, only when something is wrong. A check that pings on success
    gets muted, and a muted check is not a check."""
    url = os.environ.get("DISCORD_WEBHOOK_URL")
    if not url or not problems:
        return
    body = (f"🔴 **Breadth live — {phase} check found {len(problems)} problem(s)**\n"
            + "\n".join(f"• {p}" for p in problems)
            + "\n\n_context_\n" + "\n".join(f"· {n}" for n in notes)
            + "\n\nKill switch: `BREADTH_LIVE_ENABLED=0` on the Railway web service.")
    try:
        req = urllib.request.Request(
            url, data=json.dumps({"content": body[:1900]}).encode(),
            headers={"Content-Type": "application/json", "User-Agent": UA})
        urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:
        print(f"  (discord notify failed: {e})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=("preopen", "open", "session"), default="open")
    ap.add_argument("--no-notify", action="store_true")
    args = ap.parse_args()

    # Task Scheduler runs this on a cp1252 console. A tick mark there raises
    # UnicodeEncodeError and the whole check exits 1 with a traceback — a
    # verdict about nothing. Markers stay ASCII; the log is explicitly UTF-8.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    _env()
    stamp = datetime.now(ET).strftime("%Y-%m-%d %H:%M:%S ET")
    header = f"=== breadth live - {args.phase} - {stamp} ==="
    print(header)

    try:
        problems, notes = check(args.phase)
    except Exception as e:
        problems, notes = [f"check itself failed: {type(e).__name__}: {e}"], []
        code = 2
    else:
        code = 1 if problems else 0

    for n in notes:
        print(f"   - {n}")
    for p in problems:
        print(f"  FAIL {p}")
    if not problems:
        print("  ok - clean")

    if not args.no_notify:
        notify(args.phase, problems, notes)

    try:
        LOG.parent.mkdir(exist_ok=True)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(header + "\n")
            for n in notes:
                f.write(f"  · {n}\n")
            for p in problems:
                f.write(f"  ✗ {p}\n")
            if not problems:
                f.write("  ✓ clean\n")
    except Exception as e:
        print(f"  (log write failed: {e})")

    return code


if __name__ == "__main__":
    sys.exit(main())
