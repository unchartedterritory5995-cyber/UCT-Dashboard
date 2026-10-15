"""Wisdom archive: the TSDR Ledger backfill. Paid members and in-app tools read it since the
owner ruling of 2026-10-15 (never anonymous); admins keep their own routes.

Tables are NEW and owned here (``wisdom_archive_*``). ⛔ Nothing in this package
writes, or is read by, ``wisdom_records`` / ``wisdom_segments`` or any table that
publish/retrieval.py, dossier.py, askai.py or the modelbook adapters read — those
have their own reach. The archive is read by the require_paid / require_admin routes in
api/routers/wisdom_archive.py and by service.retrieval_hits (Ask AI, Compass), all behind
WISDOM_ARCHIVE_ENABLED.

The data itself lives only in wisdom.db on the Railway volume; the public repo
holds code, empty DDL and synthetic test data only (W1 §0.4f).
"""
