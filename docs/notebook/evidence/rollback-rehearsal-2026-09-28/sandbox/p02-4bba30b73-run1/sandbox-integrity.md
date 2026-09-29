# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 16:48:27`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 6acd6dcc056b0fa6b039a21c7846139c
- `2026-09-28 16:49:28`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 16:51:21`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 16:51:32`  **shutdown** — C:\data, 62 db files — CLEAN
