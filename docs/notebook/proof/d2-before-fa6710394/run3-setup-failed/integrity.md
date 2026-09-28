# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 12:34:20`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d2; identity = 52330b6fe9c0294745f212a4a03b4cc5
- `2026-09-28 12:35:49`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 12:36:43`  **shutdown** — C:\data, 62 db files — CLEAN
