# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 22:07:37`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\ai1; identity = 6dff1a2f291b7541568cac8ecde0f630
- `2026-10-07 22:08:42`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 22:09:08`  **shutdown** — C:\data, 62 db files — CLEAN
