"""Per-ticker stale-bar watchdog. Flags charts that have stopped updating during RTH."""
import time
from datetime import datetime
from zoneinfo import ZoneInfo


# Max acceptable seconds since last bar, per timeframe, during RTH
_STALE_THRESHOLD = {
    "1": 120,        # 2 minutes
    "5": 600,        # 10 minutes (allow 1 missed bar)
    "15": 1800,      # 30 minutes
    "30": 3600,      # 1 hour
    "60": 7200,      # 2 hours
    "D": 25 * 3600,  # 25 hours (handles overnight + weekends partially)
    "W": 7 * 24 * 3600,
    "M": 32 * 24 * 3600,
}


def is_market_open(now: datetime | None = None) -> bool:
    n = now or datetime.now(ZoneInfo("America/New_York"))
    if n.weekday() >= 5:
        return False
    hm = n.hour * 100 + n.minute
    return 930 <= hm < 1600


def is_stale(last_bar_time: int, tf: str, market_open: bool | None = None) -> bool:
    """Return True if last_bar_time is older than the stale threshold for tf.

    During market closed, intraday bars are never stale (no new bars expected).
    Daily/weekly/monthly remain stale-checked since today's bar evolves.
    """
    if market_open is None:
        market_open = is_market_open()
    threshold = _STALE_THRESHOLD.get(tf, 3600)

    if not market_open and tf in ("1", "5", "15", "30", "60"):
        return False

    age = int(time.time()) - int(last_bar_time)
    return age >= threshold
