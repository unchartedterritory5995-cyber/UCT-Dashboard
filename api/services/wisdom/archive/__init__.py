"""Wisdom archive (ADMIN-ONLY): the TSDR Ledger backfill, browsable by the owner.

Tables are NEW and owned here (``wisdom_archive_*``). ⛔ Nothing in this package
writes, or is read by, ``wisdom_records`` / ``wisdom_segments`` or any table that
publish/retrieval.py, dossier.py, askai.py or the modelbook adapters read — those
reach paid members. The archive is read only by the require_admin routes in
api/routers/wisdom_archive.py, behind WISDOM_ARCHIVE_ADMIN_ENABLED.

The data itself lives only in wisdom.db on the Railway volume; the public repo
holds code, empty DDL and synthetic test data only (W1 §0.4f).
"""
