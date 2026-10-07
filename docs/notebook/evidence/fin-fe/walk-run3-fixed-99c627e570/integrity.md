# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-06 23:07:42`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\run3; identity = b3e99cd17bf5b4b8d8d968ec799100e5
- `2026-10-06 23:08:37`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 23:10:33`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 23:10:42`  **shutdown** — C:\data, 62 db files — CLEAN
