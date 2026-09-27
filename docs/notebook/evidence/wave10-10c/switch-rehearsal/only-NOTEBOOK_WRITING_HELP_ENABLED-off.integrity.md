# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 19:35:23`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 2e13dd168f301e7ccc40a7af22411e80
- `2026-09-26 19:35:59`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:37:50`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:37:57`  **shutdown** — C:\data, 62 db files — CLEAN
