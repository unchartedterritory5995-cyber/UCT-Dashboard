# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-25 23:45:12`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-8b; identity = 7a5662607e253d55b1c6193d1fb6c43d
- `2026-09-25 23:45:59`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-25 23:47:51`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
