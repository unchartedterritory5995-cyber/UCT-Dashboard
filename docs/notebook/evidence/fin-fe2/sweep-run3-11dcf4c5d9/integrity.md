# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 14:03:21`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\sw3; identity = dd68737094349932f2526aba0df272d8
- `2026-10-07 14:03:55`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 14:04:28`  **shutdown** — C:\data, 62 db files — CLEAN
