"""One-shot header census of the FMP bulk CSVs — Wave 2 field pinning.

A TOOL, not a test: it loads FMP_API_KEY from the key's real home
(C:/Users/Patrick/uct-intelligence/.env) explicitly, because the dashboard
repo's env deliberately does not carry it and the tests must never need it.
Streams ONE data row per endpoint and prints the headers matching our
candidate keywords, so Task 2 pins measured names, never documented ones.
"""
import io
import sys

sys.path.insert(0, ".")


def _load_key():
    import os
    if os.environ.get("FMP_API_KEY"):
        return
    try:
        for line in open(r"C:\Users\Patrick\uct-intelligence\.env",
                         encoding="utf-8"):
            if line.strip().startswith("FMP_API_KEY="):
                os.environ["FMP_API_KEY"] = line.split("=", 1)[1].strip()
                return
    except OSError:
        pass


KEYWORDS = ("quick", "cashflow", "cash", "payout", "invested", "longterm",
            "ipo", "country", "shares")


def _census(path, params):
    from api.services.screener.fundamentals_bulk import _open_bulk_csv
    with _open_bulk_csv(path, params) as (rows, status, body):
        if status != 200:
            print(f"{path}: HTTP {status} {body}")
            return
        first = next(iter(rows), None)
        headers = sorted((first or {}).keys())
        hits = [h for h in headers
                if any(k in h.lower() for k in KEYWORDS)]
        print(f"{path}: {len(headers)} headers; candidates:")
        for h in hits:
            print(f"   {h} = {first.get(h)!r}")


_load_key()
_census("/stable/ratios-ttm-bulk", {})
_census("/stable/key-metrics-ttm-bulk", {})
_census("/stable/profile-bulk", {"part": "0"})
