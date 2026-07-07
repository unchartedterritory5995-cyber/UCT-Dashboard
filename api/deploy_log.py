"""deploy_log.py — records every WEB boot (= a deploy) so we can MEASURE how
often web actually redeploys during market hours, and (offline) whether those
deploys touched flow-ingest code.

This is the evidence that decides whether the P5 zero-gap cutover is worth its
cost. The direction analysis (2026-07-07) found P5 would have prevented 0 of the
day's feed gaps (all were consumer-code edits, which restart the flow worker
too). P5's ONLY unique win is "a NON-flow emergency web deploy that can't wait
until 4:20 PM ET." If the log shows that class never recurs, batching deploys to
after-close already suffices and the cutover isn't justified — so we instrument
before we pay.

Best-effort: a bad record never affects boot. Read via GET /api/admin/deploy-log.
"""
import os
import json
import time
from datetime import datetime
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
_LOG_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "deploy_log.jsonl")

# Files that, when changed, mean a deploy WOULD gap the feed even under P5 (the
# consumer/flow-ingest code runs on the flow worker too). A market-hours deploy
# NOT touching these is the class P5 uniquely prevents.
FLOW_INGEST_FILES = (
    "massive_ws_worker", "massive_processor", "flow_db", "bs_iv",
    "live_massive_router", "massive_flatfiles_worker",
)


def _commit() -> str:
    for k in ("RAILWAY_GIT_COMMIT_SHA", "RAILWAY_GIT_COMMIT", "GIT_COMMIT_SHA"):
        v = (os.environ.get(k) or "").strip()
        if v:
            return v[:12]
    return "unknown"


def _in_market_hours(now_et: datetime) -> bool:
    """True inside the window where a web deploy gaps the live tape (weekday
    9:15a–4:20p ET; the options tape runs 9:30–4:15)."""
    if now_et.weekday() >= 5:
        return False
    hhmm = now_et.hour * 100 + now_et.minute
    return 915 <= hhmm <= 1620


def record_boot() -> None:
    """Append one deploy record on web boot. Never raises."""
    try:
        now = datetime.now(ET)
        rec = {
            "boot_ts": int(time.time()),
            "boot_et": now.strftime("%Y-%m-%d %H:%M:%S %Z"),
            "commit": _commit(),
            "in_market_hours": _in_market_hours(now),
            "weekday": now.weekday(),
            "service": "web",
        }
        with open(_LOG_PATH, "a") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        pass


def get_log(limit: int = 500) -> list:
    try:
        with open(_LOG_PATH) as f:
            lines = f.readlines()[-limit:]
        return [json.loads(x) for x in lines if x.strip()]
    except FileNotFoundError:
        return []
    except Exception:
        return []


def summarize() -> dict:
    """Aggregate for the P5 decision. Dedupes multi-boot-per-deploy by commit."""
    recs = get_log(limit=20000)
    mkt = [r for r in recs if r.get("in_market_hours")]
    mkt_commits = sorted({r.get("commit") for r in mkt if r.get("commit")})
    return {
        "total_boots": len(recs),
        "market_hours_boots": len(mkt),
        "market_hours_distinct_commits": len(mkt_commits),
        "market_hours_commits": mkt_commits,
        "first_record": recs[0]["boot_et"] if recs else None,
        "last_record": recs[-1]["boot_et"] if recs else None,
        "how_to_decide_p5": (
            "For each market-hours commit, diff it vs its predecessor. If it "
            "touched none of " + ", ".join(FLOW_INGEST_FILES) + " AND it "
            "couldn't have waited to 4:20 PM ET, that is a deploy P5 would have "
            "saved. P5's cutover is justified only if that class RECURS."
        ),
    }
