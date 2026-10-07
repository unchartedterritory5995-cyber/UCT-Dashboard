# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-06 22:12:13`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-nav; identity = a896521d91002b4d45dbc88127f42936
- `2026-10-06 22:12:59`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 22:13:31`  **shutdown** — C:\data, 62 db files — CLEAN
