# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 19:19:01`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 932f316d88c6a51dafd5801c9183ebe4
- `2026-09-26 19:19:45`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:21:36`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:21:42`  **shutdown** — C:\data, 62 db files — CLEAN
