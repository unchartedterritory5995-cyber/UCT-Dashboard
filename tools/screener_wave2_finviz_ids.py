"""One-shot Finviz export column census — Wave 2 id pinning.

Prints {id: header} for c=0..149 so the module pins MEASURED ids for:
Shares Outstanding, Shares Float (and/or Float %), Short Float, Short
Ratio, Insider Ownership, Institutional Ownership — plus a sample row so
the UNITS of each are recorded (suffixed 1.5B vs raw-millions vs '3.45%').
Token comes from the same env/config industry_map's fetch uses.

Mirrors (does not import — see api/services/screener/finviz_universe.py's
module docstring for why) api.services.industry_map._fetch_finviz_universe's
exact token/URL/User-Agent/timeout/redirect handling; that helper hardcodes
c=1,2,3,4 (Ticker/Company/Sector/Industry), so it cannot itself request the
150-column census this script needs — the plumbing is copied, the column
list is parametrized.

Run: python tools/screener_wave2_finviz_ids.py
"""
from __future__ import annotations

import csv
import io
import os

import httpx

# Column names we're hunting for in the census — printed with a marker so
# they're easy to spot in a 150-row dump.
_CANDIDATES = (
    "Shares Outstanding", "Shares Float", "Float %", "Short Float",
    "Short Ratio", "Insider Ownership", "Institutional Ownership",
)


def _fetch_census_csv() -> str:
    """Same token/URL/UA/timeout/redirect handling as
    industry_map._fetch_finviz_universe, requesting c=0..149 (the full
    census) instead of the hardcoded c=1,2,3,4. Returns "" on a missing
    token or any fetch error — never raises."""
    token = os.environ.get("FINVIZ_API_KEY", "")
    if not token:
        print("FINVIZ_API_KEY not set — cannot run the id probe locally.")
        return ""
    c = ",".join(str(i) for i in range(150))
    url = f"https://elite.finviz.com/export.ashx?v=152&c={c}&auth={token}"
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "text/csv"}
    try:
        r = httpx.get(url, headers=headers, timeout=90.0, follow_redirects=True)
        r.raise_for_status()
        return r.text
    except Exception as e:  # noqa: BLE001 — a probe script reports, never raises
        print(f"Finviz census fetch failed: {e}")
        return ""


def main() -> None:
    text = _fetch_census_csv()
    if not text:
        return

    reader = csv.reader(io.StringIO(text))
    try:
        headers = next(reader)
    except StopIteration:
        print("empty response (no header row)")
        return
    try:
        first_row = next(reader)
    except StopIteration:
        first_row = []

    print(f"{len(headers)} columns returned for c=0..149\n")
    for i, h in enumerate(headers):
        val = first_row[i] if i < len(first_row) else ""
        marker = "  <-- CANDIDATE" if h in _CANDIDATES else ""
        print(f"{i:3d}  {h!r:34s} sample={val!r}{marker}")

    print("\nCandidate columns (id -> sample value):")
    for name in _CANDIDATES:
        if name in headers:
            idx = headers.index(name)
            val = first_row[idx] if idx < len(first_row) else ""
            print(f"  {name!r:26s} -> id {idx:3d}  sample={val!r}")
        else:
            print(f"  {name!r:26s} -> NOT FOUND in this census")


if __name__ == "__main__":
    main()
