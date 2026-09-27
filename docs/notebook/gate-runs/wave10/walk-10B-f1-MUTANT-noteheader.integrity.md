# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 21:28:56`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10b; identity = 1d7dcea2ff7f8a9b2553eddb9b3a2c83
- `2026-09-26 21:29:33`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:30:45`  **shutdown** — C:\data, 62 db files — CLEAN
