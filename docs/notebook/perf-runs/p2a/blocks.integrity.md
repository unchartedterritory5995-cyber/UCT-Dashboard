# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-12 18:08:00`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\nb-p2a-typing-blocks; identity = d549ed19aa05d6e0c236ca1a3e907b47
- `2026-10-12 18:08:33`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-12 18:08:49`  **shutdown** — C:\data, 62 db files — CLEAN
