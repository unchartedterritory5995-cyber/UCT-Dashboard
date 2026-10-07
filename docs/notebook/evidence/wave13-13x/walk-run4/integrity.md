# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 20:53:27`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w13x-run4; identity = 872936dae6271e00beef6f256184f988
- `2026-10-03 20:55:29`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 20:57:25`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 20:57:37`  **shutdown** — C:\data, 62 db files — CLEAN
