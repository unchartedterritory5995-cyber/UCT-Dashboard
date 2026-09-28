# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 22:54:07`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f5; identity = 244339a7666fa96c162e86f1688c04fe
- `2026-09-27 22:54:49`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 22:56:41`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 22:59:06`  **shutdown** — C:\data, 62 db files — CLEAN
