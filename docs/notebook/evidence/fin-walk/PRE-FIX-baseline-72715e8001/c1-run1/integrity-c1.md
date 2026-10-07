# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-06 22:00:45`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-walk\c1; identity = 6d8cf59f5f0853c472a11788a0e2f080
- `2026-10-06 22:01:32`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 22:03:28`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 22:12:31`  **shutdown** — C:\data, 62 db files — CLEAN
