# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 17:09:04`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = cf11d0cf52fc451a18c7af747da5bb58
- `2026-09-28 17:09:58`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:11:49`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:11:56`  **shutdown** — C:\data, 62 db files — CLEAN
