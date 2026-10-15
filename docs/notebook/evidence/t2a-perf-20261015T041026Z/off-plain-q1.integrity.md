# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 03:04:36`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-off-plain-q1; identity = 395955fba2e85d96a7e536072a6f8cef
- `2026-10-15 03:05:15`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 03:05:36`  **shutdown** — C:\data, 62 db files — CLEAN
