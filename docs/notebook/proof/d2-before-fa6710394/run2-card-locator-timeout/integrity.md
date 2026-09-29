# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 12:25:33`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d2; identity = 0a00b01ebee13dbd85090e38aff6ce07
- `2026-09-28 12:27:01`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 12:29:08`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 12:33:28`  **shutdown** — C:\data, 62 db files — CLEAN
