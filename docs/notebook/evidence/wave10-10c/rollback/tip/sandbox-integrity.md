# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 19:44:21`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 9d0cc4000cf8033b852e677db4be2135
- `2026-09-26 19:45:00`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:46:50`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:46:56`  **shutdown** — C:\data, 62 db files — CLEAN
