"""Cashtag-based ticker extraction. v1: regex only, no universe validation.
Source accounts are professional and rarely post fake cashtags; false
positives surface nothing (no join target in UI), so cost of a miss is zero.

The grammar and the forex exclusions are M5's cashtag vocabulary, declared ONCE
in A8's authority (TERM-075, api/services/a8_taxonomy.py); this module only
names the ingest's entry point."""
from api.services.a8_taxonomy import cashtags


def extract_tickers(text: str) -> set[str]:
    return cashtags(text)
