"""tools/seed_twitter_accounts.py

One-shot script to insert the initial curated account list. Idempotent.
Run once locally (or on Railway via shell) after the schema exists:
  python tools/seed_twitter_accounts.py

The script uses tweet_store's default DB path (/data/tweets.db on
Railway, override with TWEET_DB_PATH for local testing).
"""
import os
import sys

# Make sure the project root is importable when run as a script
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import tweet_store

INITIAL_ACCOUNTS = [
    ("DeItaone", "Walter Bloomberg / breaking single-stock news"),
    ("FinancialJuice", "Newswire-style econ + single-stock"),
    ("Benzinga", "Financial newswire, ticker-tagged"),
    # NOTE: Confirm WallStEngine vs WallStreetEngine via the smoke test
    # (tools/twitterapi_io_smoke_test.py). Replace the line below with
    # whichever returned non-zero tweets — and remove this comment.
    ("WallStEngine", "Single-stock catalyst aggregator"),
]


def main() -> int:
    tweet_store._init_db()
    for handle, notes in INITIAL_ACCOUNTS:
        tweet_store.add_account(handle, display_name=handle, notes=notes)
        print(f"  + {handle} (or already present)")
    enabled = tweet_store.list_accounts(enabled_only=True)
    print(f"Total enabled accounts: {len(enabled)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
