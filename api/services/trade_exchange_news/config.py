"""Every Trade Exchange News knob on web, read from the environment.

⛔ DARK BY DEFAULT. ``TXN_ENABLED`` must be exactly ``"1"``: the ingest route
does not match, the pipeline never starts and nothing touches /data.

⚠️ History bounds are the OWNER-APPROVED TARGET (7 days / 5,000 headlines,
whichever comes first) and are "subject to confirmed Trade Exchange retention
and redistribution permissions". Until that confirmation exists the flag stays
off; the numbers are here so the bound is enforced the moment it is on.
"""
from __future__ import annotations

import hashlib
import math
import os

FLAG = "TXN_ENABLED"
SLUG = "trade-exchange-news"


def enabled() -> bool:
    return os.environ.get(FLAG, "").strip() == "1"


def _int(key: str, default: int, lo: int = 0) -> int:
    try:
        return max(lo, int(os.environ.get(key, default)))
    except (TypeError, ValueError):
        return default


def _float(key: str, default: float) -> float:
    try:
        v = float(os.environ.get(key, default))
        return v if math.isfinite(v) and v >= 0 else default
    except (TypeError, ValueError):
        return default


def db_path() -> str:
    return os.environ.get("TXN_DB_PATH") or os.path.join(
        os.environ.get("DATA_DIR", "/data"), "trade_exchange_news.db")


def ingest_token_hashes() -> tuple[str, ...]:
    """SHA-256 digests of the receiver's bearer. Web never holds the token
    itself; two digests may be live at once (rotation)."""
    return tuple(h.strip().lower() for h in os.environ.get("TXN_INGEST_TOKEN_SHA256", "").split(",")
                 if len(h.strip()) == 64)


def sources() -> tuple[str, ...]:
    return tuple(s.strip() for s in os.environ.get("TXN_SOURCE_ALLOWLIST", "TXNews1").split(",")
                 if s.strip())


def dedupe_window_ms() -> int:
    """0 disables collapsing: every delivery becomes its own headline."""
    return int(_float("TXN_DEDUPE_WINDOW_S", 60.0) * 1000)


def history_max_age_ms() -> int:
    return _int("TXN_HISTORY_MAX_AGE_HOURS", 168, lo=1) * 3600 * 1000


def history_max_items() -> int:
    return _int("TXN_HISTORY_MAX_ITEMS", 5000, lo=1)


def max_content_chars() -> int:
    return _int("TXN_MAX_CONTENT_CHARS", 8000, lo=1)


def reconcile_interval_s() -> float:
    return _float("TXN_RECONCILE_INTERVAL_S", 30.0) or 30.0


def reconcile_overlap_ms() -> int:
    """How far behind the cursor each scan restarts. Covers clock skew between
    two receiver instances overlapping during a deploy, and late PUTs."""
    return int(_float("TXN_RECONCILE_OVERLAP_S", 600.0) * 1000)


def boot_ready_wait_s() -> float:
    return _float("TXN_BOOT_READY_WAIT_S", 5.0)


def subscriber_queue_max() -> int:
    return _int("TXN_SUBSCRIBER_QUEUE_MAX", 512, lo=8)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
