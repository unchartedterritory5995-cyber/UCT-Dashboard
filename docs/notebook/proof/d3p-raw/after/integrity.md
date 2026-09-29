# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 23:59:24`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d3p; identity = 75c243886108542b44bec722439a85fb
- `2026-09-29 00:00:14`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 00:02:10`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 00:08:37`  **shutdown** — C:\data, 62 db files — CLEAN
