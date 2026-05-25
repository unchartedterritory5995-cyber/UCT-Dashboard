"""tools/twitterapi_io_smoke_test.py

Manual pre-flight check. Run once locally with your TwitterAPI.io API
key in TWITTERAPI_IO_API_KEY to confirm endpoint URL, auth header,
response shape, and whether @WallStEngine resolves (vs @WallStreetEngine).

Usage:
  $env:TWITTERAPI_IO_API_KEY="..."
  python tools/twitterapi_io_smoke_test.py

Exits 0 on full success, 1 on any failure. Prints what came back for
each account so we know the JSON keys we'll parse later.
"""
import json
import os
import sys

import requests

BASE_URL = "https://api.twitterapi.io"
HANDLES = ["DeItaone", "FinancialJuice", "Benzinga", "WallStEngine", "WallStreetEngine"]


def call(path: str, params: dict, key: str) -> tuple[int, dict]:
    r = requests.get(
        f"{BASE_URL}{path}",
        params=params,
        headers={"x-api-key": key},
        timeout=10,
    )
    try:
        body = r.json()
    except ValueError:
        body = {"_raw_text": r.text}
    return r.status_code, body


def main() -> int:
    key = os.environ.get("TWITTERAPI_IO_API_KEY")
    if not key:
        print("ERROR: set TWITTERAPI_IO_API_KEY first")
        return 1

    failed = False
    for handle in HANDLES:
        status, body = call("/twitter/user/last_tweets", {"userName": handle}, key)
        n_tweets = len(body.get("tweets") or body.get("data") or [])
        print(f"@{handle:18s} HTTP {status}  tweets={n_tweets}")
        if status == 200 and n_tweets > 0:
            sample = (body.get("tweets") or body.get("data") or [{}])[0]
            print(f"  sample keys: {sorted(list(sample.keys()))}")
            text = sample.get("text") or sample.get("fullText") or ""
            print(f"  first tweet text (truncated): {text[:120]!r}")
        elif status == 200:
            print(f"  empty result body keys: {sorted(body.keys())}")
        else:
            print(f"  body: {json.dumps(body, indent=2)[:500]}")
            failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
