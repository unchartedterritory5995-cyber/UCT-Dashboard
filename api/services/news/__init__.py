"""Company News — central ingestion, normalization and the persistent store.

Read `ingest.py` first: it is the pipeline every story passes through.
Nothing here is called from a request path except `store.feed()`.
"""
