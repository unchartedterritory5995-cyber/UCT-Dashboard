"""Every Trade Exchange News knob on web, read from the environment.

⛔ DARK BY DEFAULT. ``TXN_ENABLED`` must be exactly ``"1"``: the ingest route
does not match, the pipeline never starts and nothing touches /data.

⛔⛔ PERMANENT RETENTION (owner, 2026-10-31; Trade Exchange authorized indefinite
storage). There is NO history bound any more: no age, no count. The former
``TXN_HISTORY_MAX_AGE_HOURS`` / ``TXN_HISTORY_MAX_ITEMS`` /
``TXN_JOURNAL_RETENTION_HOURS`` are read by nothing -- setting them changes
nothing, so a typo or a negative value can never shorten retention again.
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


def release_links_enabled() -> bool:
    """Run the press-release link resolver (release_links.py). Off: stored links
    still display; nothing new is resolved."""
    return os.environ.get("TXN_RELEASE_LINKS_ENABLED", "").strip() == "1"


def release_links_sec_enabled() -> bool:
    """The SEC EDGAR stage of the resolver (free; the repo's fair-access client)."""
    return os.environ.get("TXN_RELEASE_LINKS_SEC", "").strip() == "1"


def release_links_interval_s() -> float:
    return max(15.0, _float("TXN_RELEASE_LINKS_INTERVAL_S", 60.0))


def release_links_start_delay_s() -> float:
    return _float("TXN_RELEASE_LINKS_START_DELAY_S", 90.0)


def release_links_fmp_batch() -> int:
    return min(1000, _int("TXN_RELEASE_LINKS_FMP_BATCH", 300, lo=1))


def release_links_sec_budget() -> int:
    """SEC requests per pass (one pass a minute): far under fair access."""
    return min(120, _int("TXN_RELEASE_LINKS_SEC_BUDGET", 40, lo=0))


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


#: Settings retired by permanent retention. Nothing reads them; the admin status
#: names any still set so they can be removed from the environment.
RETIRED_ENV = ("TXN_HISTORY_MAX_AGE_HOURS", "TXN_HISTORY_MAX_ITEMS", "TXN_JOURNAL_RETENTION_HOURS")


def retired_env_set() -> list[str]:
    return [k for k in RETIRED_ENV if os.environ.get(k) is not None]


def boot_recovery_window_ms() -> int:
    """How far back recovery reaches when the database is EMPTY (a fresh or lost
    volume): the recent days, so live News is whole again within minutes. Older
    history comes back from a snapshot or ``tools/txn_rebuild_from_r2.py``
    (docs/runbooks/trade-exchange-news-retention.md), never from this loop.
    A database that holds anything recovers from its own cursor, however old."""
    return _int("TXN_BOOT_RECOVERY_WINDOW_HOURS", 192, lo=1) * 3600 * 1000


def storage_permitted() -> bool:
    """⛔ Owner rule: real Trade Exchange headlines are stored only once their
    retention + redistribution permission is confirmed in writing. Without this
    the pipeline does not start even with TXN_ENABLED=1."""
    return os.environ.get("TXN_STORAGE_PERMISSION_CONFIRMED", "").strip() == "1"


#: Every headline a staging (synthetic-only) deployment will accept starts with this.
SYNTHETIC_PREFIX = "SYNTHETIC"


def synthetic_only() -> bool:
    """Staging mode (D2): stores ONLY records whose content starts with
    ``SYNTHETIC_PREFIX`` and refuses everything else, so a staging stack cannot
    hold a real Trade Exchange headline even if one were sent to it. It is what
    lets staging run without TXN_STORAGE_PERMISSION_CONFIRMED, which stays the
    real-content permission."""
    return os.environ.get("TXN_SYNTHETIC_ONLY", "").strip() == "1"


def storage_allowed() -> bool:
    return storage_permitted() or synthetic_only()


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
