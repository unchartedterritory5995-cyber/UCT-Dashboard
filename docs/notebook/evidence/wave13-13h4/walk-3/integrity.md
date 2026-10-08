# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 10:41:50`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w13h4walk3; identity = f95504ccbb6ecb11671a0cd2fab3c5c3
- `2026-10-03 10:43:29`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 10:45:00`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-03 10:45:24`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
