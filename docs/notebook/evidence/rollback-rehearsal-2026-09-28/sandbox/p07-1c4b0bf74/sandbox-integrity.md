# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 17:00:53`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 2d66b9802c166d586e693ed651fa280d
- `2026-09-28 17:01:46`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:03:37`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:03:44`  **shutdown** — C:\data, 62 db files — CLEAN
