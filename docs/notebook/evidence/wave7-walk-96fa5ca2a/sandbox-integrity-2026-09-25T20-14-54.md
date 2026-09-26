# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-25 20:14:59`  **pre-boot (baseline)** — C:\data, 61 db files — CLEAN
    - sandbox = C:\data-w7walk; identity = e8c306811d8fb4e5025205a78a75d4dd
- `2026-09-25 20:15:42`  **post-boot (+15s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 20:17:33`  **post-prewarm (+120s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 20:20:37`  **shutdown** — C:\data, 61 db files — CLEAN
