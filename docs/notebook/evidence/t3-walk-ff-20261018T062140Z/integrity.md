# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 01:21:54`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t3walk-ff; identity = bd4bf001372a6e37d948d930f5153150
- `2026-10-18 01:23:58`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 01:25:53`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 01:28:11`  **shutdown** — C:\data, 62 db files — CLEAN
