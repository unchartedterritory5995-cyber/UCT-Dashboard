# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 23:37:01`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-off-plain-r2; identity = 16ee5ec58f279270c5f67813a5922f6d
- `2026-10-14 23:37:52`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:38:11`  **shutdown** — C:\data, 62 db files — CLEAN
