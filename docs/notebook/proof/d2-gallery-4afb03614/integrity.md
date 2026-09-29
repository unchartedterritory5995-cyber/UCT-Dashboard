# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 13:13:54`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d2; identity = 6afed4c16e513c8f635b9b6f2e45db0c
- `2026-09-28 13:14:39`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 13:16:30`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 13:16:37`  **shutdown** — C:\data, 62 db files — CLEAN
