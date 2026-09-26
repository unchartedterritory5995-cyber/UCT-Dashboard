# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 02:11:52`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-8c; identity = f2c3449ffa72fc030130754bfe98df4f
- `2026-09-26 02:12:30`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 02:14:22`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 02:22:02`  **shutdown** — C:\data, 62 db files — CLEAN
