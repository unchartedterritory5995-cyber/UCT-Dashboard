# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-17 23:54:59`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t3walk-red; identity = 099fc370d859862bff9d99aa2b4cc674
- `2026-10-17 23:55:56`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 23:57:49`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 23:58:11`  **shutdown** — C:\data, 62 db files — CLEAN
