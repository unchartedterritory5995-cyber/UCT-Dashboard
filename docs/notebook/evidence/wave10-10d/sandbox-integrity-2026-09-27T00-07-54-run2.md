# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 00:08:01`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d; identity = 3f3f7ee70b5e5961ba7a084eda2f6746
- `2026-09-27 00:09:01`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 00:10:55`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 00:11:08`  **shutdown** — C:\data, 62 db files — CLEAN
