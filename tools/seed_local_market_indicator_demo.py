"""LOCAL DEV ONLY — stand up enough data to see the Market Indicators library render.

    set BREADTH_OHLC_DB=C:\\mi\\data\\breadth_daily_ohlc.db
    set NAAIM_DB=C:\\mi\\data\\naaim_series.db
    set CBOE_INDICES_DB=C:\\mi\\data\\cboe_indices.db
    python tools/seed_local_market_indicator_demo.py

⛔⛔ IT REFUSES TO RUN AGAINST THE SHARED VOLUME. `/data` (which is `C:\\data` on the
dev box) holds the owner's LIVE breadth history; a script that can write there by
forgetting an environment variable is one typo away from corrupting nineteen years of
it. `BREADTH_OHLC_DB` must be set AND must resolve outside every shared root, or this
exits without opening anything — the same posture `breadth_combined_pass.open_artifact`
takes, and for the same reason.

⛔ AND IT IS NOT A DATA SOURCE. The advances/declines written here are McClellan
Financial's published NYSE COMPOSITE numbers from the validation fixture, stored under
the `us` universe id purely so the local chart has a real, recognisable series to draw.
They are NOT UCT's US universe and must never be mistaken for it: production's `us`
history comes from the point-in-time sweep and this script cannot reach it.
"""
from __future__ import annotations

import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

#: Everything a shared-volume path can look like on either OS.
_SHARED = ("/data", "c:\\data", "c:/data")


def _refuse_shared_root(path: str) -> None:
    p = os.path.abspath(path).replace("\\", "/").lower()
    for root in _SHARED:
        r = root.replace("\\", "/").lower().rstrip("/")
        if p == r or p.startswith(r + "/"):
            raise SystemExit(
                f"REFUSED: {path} is inside the shared data volume. This is a local\n"
                f"demo seeder; it must never touch the live breadth history. Point\n"
                f"BREADTH_OHLC_DB somewhere disposable and run it again.")


def main() -> int:
    db = os.environ.get("BREADTH_OHLC_DB")
    if not db:
        raise SystemExit(
            "REFUSED: BREADTH_OHLC_DB is not set. There is deliberately no default —\n"
            "a seeder with one is a seeder that can open the production store by\n"
            "forgetting an argument.")
    _refuse_shared_root(db)

    from api.services.market_indicators import validation as val
    rows = val.load_reference_fixture()

    os.makedirs(os.path.dirname(os.path.abspath(db)), exist_ok=True)
    c = sqlite3.connect(db)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("""CREATE TABLE IF NOT EXISTS breadth_daily_ohlc (
        universe TEXT NOT NULL DEFAULT 'uct',
        date TEXT NOT NULL, metric TEXT NOT NULL,
        o REAL, h REAL, l REAL, c REAL,
        source TEXT DEFAULT 'live', updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (universe, date, metric))""")

    payload = []
    for r in rows:
        adv, dec = r["advances"], r["declines"]
        for metric, v in (("advancing", adv), ("declining", dec),
                          ("adv_decline", adv - dec),
                          ("universe_count", adv + dec)):
            payload.append(("us", r["date"], metric, v, v, v, v, "close_recon"))
    c.executemany(
        "INSERT OR REPLACE INTO breadth_daily_ohlc"
        "(universe,date,metric,o,h,l,c,source) VALUES(?,?,?,?,?,?,?,?)", payload)
    c.commit()
    n = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc WHERE universe='us'").fetchone()[0]
    span = c.execute("SELECT MIN(date), MAX(date) FROM breadth_daily_ohlc "
                     "WHERE universe='us'").fetchone()
    c.close()
    print(f"seeded {n} rows into {db}")
    print(f"  universe=us  {span[0]} .. {span[1]}  ({len(rows)} sessions x 4 metrics)")
    print("  NOTE: these are McClellan's published NYSE COMPOSITE A/D numbers, stored")
    print("        under the `us` id for a LOCAL RENDER ONLY. NOT UCT's US universe.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
