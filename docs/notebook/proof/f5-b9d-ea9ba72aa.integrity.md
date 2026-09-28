# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 21:26:59`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f5; identity = afea68a3d4d96d3c8294c71b7bac0556
- `2026-09-27 21:27:55`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 21:29:17`  **shutdown** — C:\data, 62 db files — CLEAN
