# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 10:30:33`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\w13x-walk-data3; identity = 2f6dd25ad2c9d776625488ce314fe651
- `2026-10-03 10:32:01`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 10:33:57`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 10:35:17`  **shutdown** — C:\data, 62 db files — CLEAN
