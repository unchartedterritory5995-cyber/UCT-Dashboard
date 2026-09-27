# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 21:08:57`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 48b05c045e1c930463a9e019a9ce0890
- `2026-09-26 21:09:54`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:11:45`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:11:53`  **shutdown** — C:\data, 62 db files — CLEAN
