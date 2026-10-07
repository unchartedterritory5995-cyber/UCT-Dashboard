tip under test: af0b7ffeea (configuration c3)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 18:00:35`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-walk\c3; identity = 0a716290aab4239771ae46861fa64c8f
- `2026-10-07 18:01:23`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 18:03:16`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 18:03:40`  **shutdown** — C:\data, 62 db files — CLEAN
