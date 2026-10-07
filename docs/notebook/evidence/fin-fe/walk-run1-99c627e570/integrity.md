# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-06 22:55:17`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe; identity = 2c65cf5ef17fb5c7ea459cfb55a06780
- `2026-10-06 22:56:35`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 22:58:28`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 22:59:47`  **shutdown** — C:\data, 62 db files — CLEAN
