# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 11:57:49`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w8walk-w2; identity = cb42af8aada807c27eb850c985c01bab
- `2026-09-26 11:58:36`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 11:59:02`  **shutdown** — C:\data, 62 db files — CLEAN
