# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 17:20:45`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 772230513f5d04a63e605acd3db9fc4e
- `2026-09-28 17:21:38`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:23:29`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:23:36`  **shutdown** — C:\data, 62 db files — CLEAN
