# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 21:19:36`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f5; identity = daef2af465498f9cea860d2c2addca22
- `2026-09-27 21:20:39`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 21:22:29`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 21:26:06`  **shutdown** — C:\data, 62 db files — CLEAN
