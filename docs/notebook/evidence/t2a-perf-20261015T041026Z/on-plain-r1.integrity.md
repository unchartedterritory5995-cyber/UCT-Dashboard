# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 23:27:25`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-plain-r1; identity = 375ba1dff02fb3ba05a87d563f505b88
- `2026-10-14 23:28:14`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:29:48`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:30:06`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
