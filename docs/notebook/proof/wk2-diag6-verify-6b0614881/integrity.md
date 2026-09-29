# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 16:59:14`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10wk3c; identity = 02f04634fbc1dbd1cf02ef7f5ad80156
- `2026-09-29 17:00:24`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 17:02:19`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 17:03:46`  **shutdown** — C:\data, 62 db files — CLEAN
