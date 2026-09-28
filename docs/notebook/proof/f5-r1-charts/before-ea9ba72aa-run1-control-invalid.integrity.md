# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 21:54:26`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f5; identity = 10dcc0243a8dfe721946a15f0bba491f
- `2026-09-27 21:55:17`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 21:56:00`  **shutdown** — C:\data, 62 db files — CLEAN
