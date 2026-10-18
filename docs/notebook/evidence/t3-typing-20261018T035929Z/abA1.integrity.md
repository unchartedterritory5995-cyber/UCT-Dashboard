# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-17 23:08:34`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t3typing-abA1; identity = 50e3c48df304ec991271761992b4efb8
- `2026-10-17 23:09:08`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 23:09:27`  **shutdown** — C:\data, 62 db files — CLEAN
