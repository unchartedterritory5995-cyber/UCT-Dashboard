# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 03:08:18`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-alert-q1; identity = ccd1f198de93793752b581ad36850066
- `2026-10-15 03:08:57`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 03:09:18`  **shutdown** — C:\data, 62 db files — CLEAN
