# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 04:41:01`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\w13f-data-on2; identity = d2d0d5bee217a40f8b64f37e3d2c47fc
- `2026-10-03 04:41:43`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 04:43:35`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 04:43:43`  **shutdown** — C:\data, 62 db files — CLEAN
