# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 21:02:30`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 46d9b0127dad7f670a830e9595efe91e
- `2026-09-26 21:03:05`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:04:55`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:05:01`  **shutdown** — C:\data, 62 db files — CLEAN
