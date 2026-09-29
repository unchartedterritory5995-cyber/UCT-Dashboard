# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 19:09:22`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10l3; identity = c8a079d8f37741f131328df354c0141b
- `2026-09-28 19:10:27`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 19:12:23`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 19:19:24`  **shutdown** — C:\data, 62 db files — CLEAN
