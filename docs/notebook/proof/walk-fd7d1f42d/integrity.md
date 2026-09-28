# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 18:59:41`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10e1; identity = 8250c178e1fd53c6eb23276908d8df12
- `2026-09-27 19:00:25`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 19:02:18`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 19:47:46`  **shutdown** — C:\data, 62 db files — CLEAN
