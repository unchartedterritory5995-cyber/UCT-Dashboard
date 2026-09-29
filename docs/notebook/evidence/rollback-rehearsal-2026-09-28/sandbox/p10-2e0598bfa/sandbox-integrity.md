# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 17:12:59`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 28d56b5e9e97704bece00f5415bc161e
- `2026-09-28 17:13:53`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:15:44`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:15:51`  **shutdown** — C:\data, 62 db files — CLEAN
