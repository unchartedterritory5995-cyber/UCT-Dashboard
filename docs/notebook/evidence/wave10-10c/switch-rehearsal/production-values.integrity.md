# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 19:12:13`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 32d4bd6ccd783ee44b372e04c61eefc5
- `2026-09-26 19:13:01`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:14:53`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:15:01`  **shutdown** — C:\data, 62 db files — CLEAN
