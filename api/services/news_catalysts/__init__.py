"""News & Catalysts widget backend — per-stock high-impact catalyst/news feed.

`store`   — SQLite cache of AI-generated significant catalysts per (symbol, period).
`service` — merges the cached catalysts + earnings + breaking wire tweets into one
            newest-first event feed; owns the generate-once background flow.
"""
