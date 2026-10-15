# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 04:31:18`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-plain-f1; identity = 6785d93e169e9a5fd055c4e69d10a837
- `2026-10-15 04:31:58`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 04:32:33`  **shutdown** — C:\data, 62 db files — CLEAN
