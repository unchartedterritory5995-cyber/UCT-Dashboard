# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 07:10:36`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\touch1; identity = 620543982aaade714aecab42b127b88a
- `2026-10-07 07:11:32`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:12:37`  **shutdown** — C:\data, 62 db files — CLEAN
