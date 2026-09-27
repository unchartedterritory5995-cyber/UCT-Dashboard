# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 20:48:51`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 1658e3dcaf2f5adb4194ae8ee2f67e2f
- `2026-09-26 20:49:30`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 20:51:21`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 20:51:28`  **shutdown** — C:\data, 62 db files — CLEAN
