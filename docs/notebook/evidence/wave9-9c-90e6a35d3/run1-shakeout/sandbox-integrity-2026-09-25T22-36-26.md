# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-25 22:36:36`  **pre-boot (baseline)** — C:\data, 61 db files — CLEAN
    - sandbox = C:\data-9c; identity = be7d4529096f969d22836fcd258df00f
- `2026-09-25 22:37:47`  **post-boot (+15s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 22:39:40`  **post-prewarm (+120s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 22:44:32`  **shutdown** — C:\data, 61 db files — CLEAN
