"""Boot the app on port 8129 with every data path pinned into the scratchpad.

⛔ NOT PORT 8077. That port has held a stale backend on the owner's LIVE
`C:\data`, and `C:\data` exists on this box — a rig that reaches it is writing
to production files for the length of a screenshot.
"""
import os, pathlib, sys

SB = pathlib.Path(__file__).parent / "rig-data"
SB.mkdir(parents=True, exist_ok=True)
REPO = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\indicator-r0r1")

os.environ["DATA_DIR"] = str(SB)
os.environ["AUTH_DB_PATH"] = str(SB / "auth.db")
os.environ["ADMIN_EMAILS"] = "panetest@local.dev"
for k in ("WORKER_ENABLED", "CATALYST_ENGINE_ENABLED", "TWITTERAPI_IO_ENABLED",
          "SCAN_SWEEP_ENABLED", "NOTE_SYNC_ENABLED", "BROKER_SYNC_ENABLED",
          "COMPASS_AUTOMATION_ENABLED", "AWARENESS_ENGINE_ENABLED",
          "DESK_DAILY_SESSION_ENABLED", "BUZZ_DIGEST_ENABLED",
          "RECONCILE_ENABLED", "FUNDAMENTALS_MONITOR_ENABLED",
          "MASSIVE_WS_ENABLED", "BRAIN_PACK_ENABLED"):
    os.environ[k] = "0"
os.environ["BARS_PREWARM_DISABLED"] = "1"
os.environ["TICKER_NAMES_PREWARM_DISABLED"] = "1"
os.environ["THEME_ENGINE_ENABLED"] = "0"

sys.path.insert(0, str(REPO))
os.chdir(REPO)
import uvicorn
uvicorn.run("api.main:app", host="127.0.0.1", port=8129, log_level="warning")
