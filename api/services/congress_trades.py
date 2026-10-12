"""COV-12 / FT-067 -- congressional trades (STOCK Act periodic transaction
reports), sourced ONLY from our existing paid FMP plan. Owner approval
2026-10-12: FMP's four endpoints, no scraping, no other source.

  per symbol : FMP /stable/senate-trades?symbol=  +  /stable/house-trades?symbol=
  latest     : FMP /stable/senate-latest           +  /stable/house-latest

Every call goes through `fmp_client` (the one FMP adapter: shared token
bucket, typed errors, 24h cached-forbidden state). Nothing here builds an FMP
URL.

Honesty rules, railed in tests/test_congress_trades.py:
  * both chambers are read and merged, newest DISCLOSURE first, each row
    labelled with its chamber;
  * "no congressional trades disclosed for X" (both chambers answered, with
    nothing) is a different fact from a failed read. One chamber failing is
    `partial` and says WHICH chamber is missing; both failing is
    `unavailable` -- never an empty list that reads as "none";
  * the amount is the disclosed RANGE (the law requires ranges, not values)
    and is never turned into a single dollar figure;
  * disclosures can lag the trade by up to 45 days (STOCK Act), so every
    payload carries that sentence, and each row carries its own lag in days.

Caching: congressional disclosures change at most daily, so a complete read
is kept `_OK_TTL` (12h per symbol, 3h for the latest feed); a partial or
failed read is kept only `_FAIL_TTL` (10 min) so a hiccup is retried soon but
a dead vendor is not hammered (cache_policy.set_by_completeness, the C18
idiom insider.py uses).

DARK behind CONGRESS_TRADES_ENABLED: unset, both routes 404 before identity is
read and the auth payload carries no key, so the panels are absent.
"""
from __future__ import annotations

import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any, Callable, Optional

from api.services.cache import cache
from api.services.cache_policy import set_by_completeness

_logger = logging.getLogger(__name__)

ENABLED_ENV = "CONGRESS_TRADES_ENABLED"

SOURCE = ("STOCK Act periodic transaction reports filed with the Senate and the House, "
          "as served by Financial Modeling Prep (FMP)")
BASIS = ("Members of Congress must disclose a trade within 45 days of making it, so a "
         "disclosure can arrive weeks after the trade. Amounts are the disclosed ranges, "
         "not exact values.")

CHAMBERS = ("senate", "house")
CHAMBER_LABEL = {"senate": "Senate", "house": "House"}

_OK_TTL = 12 * 3600          # per symbol, a complete read
_LATEST_OK_TTL = 3 * 3600    # latest feed, a complete read
_FAIL_TTL = 600              # a partial or failed read, either kind
_TIMEOUT = 12                # seconds, each FMP call
_LATEST_LIMIT = 100          # rows asked of each chamber's latest feed
PER_CHAMBER_CAP = 100        # FMP answers up to 100 rows per chamber; at the cap, older may exist

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_MONEY_RE = re.compile(r"\$?\s*([\d,]+(?:\.\d+)?)")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


# ── FMP seams (late-bound: a test patches fmp_client's functions by name) ────

def _fetchers_for_symbol() -> dict[str, Callable[..., Any]]:
    from api.services import fmp_client
    return {"senate": fmp_client.get_senate_trades, "house": fmp_client.get_house_trades}


def _fetchers_latest() -> dict[str, Callable[..., Any]]:
    from api.services import fmp_client
    return {"senate": fmp_client.get_senate_latest, "house": fmp_client.get_house_latest}


def _read_chamber(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> tuple[str, list, Optional[str]]:
    """(state, raw_rows, reason). state: ok | none | unavailable. Never raises."""
    from api.services.fmp_client import FMPNotFound
    try:
        result = fn(*args, timeout=_TIMEOUT, **kwargs)
    except FMPNotFound:
        return "none", [], None
    except Exception as exc:  # noqa: BLE001 -- every other failure is an honest "could not read"
        _logger.warning("congress trades: %s failed: %s", getattr(fn, "__name__", fn), exc)
        return "unavailable", [], _reason_for(exc)
    if getattr(result, "degraded", None) is not None:
        return "unavailable", [], "FMP refused this request for our plan in the last 24 hours"
    rows = getattr(result, "value", None)
    if not isinstance(rows, list):
        return "unavailable", [], "FMP answered with an unexpected shape"
    if not rows:
        return "none", [], None
    return "ok", rows, None


def _reason_for(exc: Exception) -> str:
    name = type(exc).__name__
    if "RateLimited" in name:
        return "FMP's request budget was used up just now"
    if "NotConfigured" in name:
        return "the FMP key is not configured on this server"
    if "Auth" in name:
        return "FMP refused this request for our plan"
    return "FMP could not be read just now"


# ── Normalising one row ──────────────────────────────────────────────────────

def _iso(v: Any) -> Optional[str]:
    s = str(v or "").strip()[:10]
    return s if _DATE_RE.match(s) else None


def _side(type_text: str) -> str:
    t = type_text.lower()
    if "purchase" in t or t == "buy":
        return "buy"
    if t.startswith("sale") or t == "sell":
        return "sell"
    if "exchange" in t:
        return "exchange"
    return "other"


def _amount_range(text: str) -> tuple[Optional[float], Optional[float]]:
    """("$1,001 - $15,000") -> (1001, 15000); ("Over $50,000,000") -> (50000000, None).
    The bounds sort and filter; the TEXT is what is shown. Never a point value."""
    nums = []
    for m in _MONEY_RE.finditer(text or ""):
        try:
            nums.append(float(m.group(1).replace(",", "")))
        except ValueError:
            continue
    if not nums:
        return None, None
    if len(nums) == 1:
        low = text.lower()
        if "over" in low or "more" in low or "+" in low:
            return nums[0], None
        return nums[0], nums[0]
    return nums[0], nums[1]


def _canon(sym: str) -> str:
    return str(sym or "").strip().upper().replace(".", "-")


def normalize_row(r: Any, chamber: str) -> Optional[dict]:
    """One FMP row -> the clean trade, or None when it is not a row at all."""
    if not isinstance(r, dict):
        return None
    first = str(r.get("firstName") or "").strip()
    last = str(r.get("lastName") or "").strip()
    office = str(r.get("office") or "").strip()
    member = " ".join(p for p in (first, last) if p) or office or "Member not named"
    disclosed = _iso(r.get("disclosureDate"))
    traded = _iso(r.get("transactionDate"))
    lag = None
    if disclosed and traded:
        d = (date.fromisoformat(disclosed) - date.fromisoformat(traded)).days
        lag = d if d >= 0 else None
    type_text = str(r.get("type") or "").strip()
    amount = str(r.get("amount") or "").strip()
    low, high = _amount_range(amount)
    link = str(r.get("link") or "").strip()
    sym = str(r.get("symbol") or "").strip().upper()
    return {
        "chamber": chamber,
        "chamber_label": CHAMBER_LABEL[chamber],
        "symbol": sym or None,
        "member": member,
        "office": office or None,
        "district": str(r.get("district") or "").strip() or None,
        "owner": str(r.get("owner") or "").strip() or None,
        "type": type_text or None,
        "side": _side(type_text),
        "amount": amount or None,
        "amount_low": low,
        "amount_high": high,
        "asset": str(r.get("assetDescription") or "").strip() or None,
        "asset_type": str(r.get("assetType") or "").strip() or None,
        "transaction_date": traded,
        "disclosure_date": disclosed,
        "lag_days": lag,
        "link": link if link.startswith(("https://", "http://")) else None,
    }


def _newest_first(rows: list[dict]) -> list[dict]:
    # Newest DISCLOSURE first (what is new to a reader), then newest trade.
    return sorted(rows, key=lambda t: (t["disclosure_date"] or "", t["transaction_date"] or ""), reverse=True)


def _summary_state(chambers: dict, n_rows: int) -> str:
    states = [c["state"] for c in chambers.values()]
    if all(s == "unavailable" for s in states):
        return "unavailable"
    if any(s == "unavailable" for s in states):
        return "partial"
    return "ok" if n_rows else "none_disclosed"


def _missing_sentence(chambers: dict) -> Optional[str]:
    missing = [CHAMBER_LABEL[k] for k, c in chambers.items() if c["state"] == "unavailable"]
    if not missing:
        return None
    if len(missing) == len(chambers):
        return "Neither the Senate nor the House records could be read just now."
    return f"The {missing[0]} records could not be read just now, so this shows the other chamber only."


# ── Per symbol ───────────────────────────────────────────────────────────────

def for_symbol(sym: str) -> dict:
    """Both chambers' disclosures for one symbol, merged, newest disclosure first."""
    sym = (sym or "").upper().strip()
    key = f"congress_trades::{sym}"
    hit = cache.get(key)
    if hit is not None:
        return hit

    fetchers = _fetchers_for_symbol()
    with ThreadPoolExecutor(max_workers=2) as ex:
        futures = {ch: ex.submit(_read_chamber, fetchers[ch], sym) for ch in CHAMBERS}
        reads = {ch: f.result() for ch, f in futures.items()}

    want = _canon(sym)
    chambers: dict[str, dict] = {}
    trades: list[dict] = []
    for ch in CHAMBERS:
        state, raw, reason = reads[ch]
        kept = []
        for r in raw:
            t = normalize_row(r, ch)
            if t is None:
                continue
            # FMP is asked for one symbol; a row naming a DIFFERENT symbol is not this one's.
            if t["symbol"] and _canon(t["symbol"]) != want:
                continue
            kept.append(t)
        if state == "ok" and not kept:
            state = "none"
        chambers[ch] = {"state": state, "rows": len(kept), "reason": reason,
                        "at_cap": len(raw) >= PER_CHAMBER_CAP}
        trades.extend(kept)

    trades = _newest_first(trades)
    state = _summary_state(chambers, len(trades))
    payload = {
        "ticker": sym, "state": state, "source": SOURCE, "basis": BASIS,
        "chambers": chambers, "trades": trades,
        "counts": {
            "buys": sum(1 for t in trades if t["side"] == "buy"),
            "sells": sum(1 for t in trades if t["side"] == "sell"),
            "other": sum(1 for t in trades if t["side"] not in ("buy", "sell")),
            "members": len({(t["chamber"], t["member"]) for t in trades}),
        },
        "newest_disclosure": trades[0]["disclosure_date"] if trades else None,
        "fetched_at": int(time.time()),
    }
    if state == "none_disclosed":
        payload["reason"] = f"No congressional trades disclosed for {sym} in the Senate or House records FMP holds."
    elif state in ("partial", "unavailable"):
        payload["reason"] = _missing_sentence(chambers)
    set_by_completeness(key, payload, complete=state in ("ok", "none_disclosed"),
                        ttl_ok=_OK_TTL, ttl_partial=_FAIL_TTL)
    return payload


# ── Latest filings (market-wide) ─────────────────────────────────────────────

def latest() -> dict:
    """The newest disclosures across every symbol, both chambers, newest first.
    Rows with no ticker (bonds, funds, private holdings) are counted, not listed."""
    key = "congress_trades_latest"
    hit = cache.get(key)
    if hit is not None:
        return hit

    fetchers = _fetchers_latest()
    with ThreadPoolExecutor(max_workers=2) as ex:
        futures = {ch: ex.submit(_read_chamber, fetchers[ch], 0, _LATEST_LIMIT) for ch in CHAMBERS}
        reads = {ch: f.result() for ch, f in futures.items()}

    chambers: dict[str, dict] = {}
    trades: list[dict] = []
    without_symbol = 0
    for ch in CHAMBERS:
        state, raw, reason = reads[ch]
        kept = []
        for r in raw:
            t = normalize_row(r, ch)
            if t is None:
                continue
            if not t["symbol"] or not _SYMBOL_RE.match(t["symbol"]):
                without_symbol += 1
                continue
            kept.append(t)
        chambers[ch] = {"state": state, "rows": len(kept), "reason": reason}
        trades.extend(kept)

    trades = _newest_first(trades)
    state = _summary_state(chambers, len(trades))
    payload = {
        "state": state, "source": SOURCE, "basis": BASIS, "chambers": chambers,
        "trades": trades, "without_symbol": without_symbol,
        "newest_disclosure": trades[0]["disclosure_date"] if trades else None,
        "fetched_at": int(time.time()),
    }
    if state == "none_disclosed":
        payload["reason"] = "Neither chamber's latest-filings feed holds a disclosure with a ticker right now."
    elif state in ("partial", "unavailable"):
        payload["reason"] = _missing_sentence(chambers)
    set_by_completeness(key, payload, complete=state in ("ok", "none_disclosed"),
                        ttl_ok=_LATEST_OK_TTL, ttl_partial=_FAIL_TTL)
    return payload
