# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 01:41:33`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10r1b; identity = c9d20874961b25069b9481e72820196a
- `2026-09-29 01:42:18`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 01:44:12`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 01:44:20`  **shutdown** — C:\data, 62 db files — CLEAN
