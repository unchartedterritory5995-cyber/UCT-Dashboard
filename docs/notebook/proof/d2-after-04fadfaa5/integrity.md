# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 13:03:10`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d2; identity = 8bf5e910ced76ab3f9e8ac3ac6cf6e3d
- `2026-09-28 13:03:56`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 13:05:47`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 13:05:53`  **shutdown** — C:\data, 62 db files — CLEAN
