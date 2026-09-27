# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 20:45:28`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 0a56d0799bf1759fdbccfdf720f6d6c6
- `2026-09-26 20:46:06`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 20:48:01`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 20:48:13`  **shutdown** — C:\data, 62 db files — CLEAN
