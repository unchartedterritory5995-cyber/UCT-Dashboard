# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 20:19:33`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10b; identity = 315f7aae041763546187073c3e4fe029
- `2026-09-26 20:20:11`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 20:21:10`  **shutdown** — C:\data, 62 db files — CLEAN
