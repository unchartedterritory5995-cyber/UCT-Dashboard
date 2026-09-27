# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 19:25:34`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = a74f2f9ed8894a6c4720ca90bd0c8b57
- `2026-09-26 19:26:10`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:28:00`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:28:07`  **shutdown** — C:\data, 62 db files — CLEAN
