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


def main() -> int:
    tweet_store._init_db()
    # Single source of truth: tweet_store.DEFAULT_ACCOUNTS (idempotent seed).
    n = tweet_store.ensure_default_accounts()
    for handle, _display in tweet_store.DEFAULT_ACCOUNTS:
        print(f"  + {handle} (or already present)")
    enabled = tweet_store.list_accounts(enabled_only=True)
    print(f"Seeded/attempted: {n}. Total enabled accounts: {len(enabled)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
