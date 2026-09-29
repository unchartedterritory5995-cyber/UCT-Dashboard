# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 16:44:15`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = fecea77799764f1f37a7c63d19cc77f7
- `2026-09-28 16:45:16`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 16:47:08`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 16:47:16`  **shutdown** — C:\data, 62 db files — CLEAN
