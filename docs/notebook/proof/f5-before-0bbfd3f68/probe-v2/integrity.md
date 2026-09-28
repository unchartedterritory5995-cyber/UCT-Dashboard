# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 20:31:05`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f5; identity = 46d81adf0a11c2dbbeb119ec0f79677d
- `2026-09-27 20:32:18`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 20:34:14`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 20:38:14`  **shutdown** — C:\data, 62 db files — CLEAN
