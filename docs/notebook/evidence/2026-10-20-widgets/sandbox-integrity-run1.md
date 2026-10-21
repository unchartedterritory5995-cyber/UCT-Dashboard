# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-21 06:14:58`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-widgets-walk; identity = 7f86a2d54fdd2187f6fcb98a9f3ce1a8
- `2026-10-21 06:15:30`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-21 06:17:21`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-21 06:37:44`  **shutdown** — C:\data, 62 db files — CLEAN
