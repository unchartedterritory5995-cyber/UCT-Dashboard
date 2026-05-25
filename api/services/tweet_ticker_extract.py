"""Cashtag-based ticker extraction. v1: regex only, no universe validation.
Source accounts are professional and rarely post fake cashtags; false
positives surface nothing (no join target in UI), so cost of a miss is zero."""
import re

_CASHTAG_RE = re.compile(r"\$([A-Z]{1,5})\b")

# Forex pairs traders post as cashtags but we don't trade
_FOREX_EXCLUDE = {"USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF",
                  "CNY", "HKD", "NZD"}


def extract_tickers(text: str) -> set[str]:
    if not text:
        return set()
    raw = set(_CASHTAG_RE.findall(text.upper()))
    return {t for t in raw if t not in _FOREX_EXCLUDE}
