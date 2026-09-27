# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-25 23:30:44`  **pre-boot (baseline)** — C:\data, 61 db files — CLEAN
    - sandbox = C:\data-9c; identity = 5fdaa78e20108101c1b2ba48491ea7e0
- `2026-09-25 23:31:46`  **post-boot (+15s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 23:33:39`  **post-prewarm (+120s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 23:35:38`  **shutdown** — C:\data, 61 db files — CLEAN
