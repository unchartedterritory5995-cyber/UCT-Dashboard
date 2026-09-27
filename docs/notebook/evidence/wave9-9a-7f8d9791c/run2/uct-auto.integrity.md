# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 15:12:59`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w9bench; identity = 9cab4cd640406b821de4dd9e4282eefd
- `2026-09-26 15:13:33`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 15:13:39`  **shutdown** — C:\data, 62 db files — CLEAN
