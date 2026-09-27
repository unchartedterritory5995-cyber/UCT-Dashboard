# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 20:52:04`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 5ff99fa386b44129fbf54f728994a5f3
- `2026-09-26 20:52:39`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 20:54:30`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 20:54:37`  **shutdown** — C:\data, 62 db files — CLEAN
