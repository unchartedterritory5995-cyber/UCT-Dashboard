# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 03:14:18`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-off-blocks-q1; identity = 6e579b5e1b35567496861a22056c0511
- `2026-10-15 03:14:56`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 03:15:19`  **shutdown** — C:\data, 62 db files — CLEAN
