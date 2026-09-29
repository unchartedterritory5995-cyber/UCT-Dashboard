# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 17:35:34`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 56bc20c288f359ee716f5e837f9cbb65
- `2026-09-28 17:36:37`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:38:31`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:38:38`  **shutdown** — C:\data, 62 db files — CLEAN
