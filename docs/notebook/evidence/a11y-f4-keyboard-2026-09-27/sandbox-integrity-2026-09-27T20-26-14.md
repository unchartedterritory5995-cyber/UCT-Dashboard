# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 20:26:20`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f4; identity = 3d6b7f32882f9e6a6c1630cba10509b5
- `2026-09-27 20:27:24`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 20:29:18`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 20:51:12`  **shutdown** — C:\data, 62 db files — CLEAN
