# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-13 15:55:38`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\nb-p2b-typing-blocks-r2; identity = 18e176b71cd4d2eead5ca81f4d1c38dc
- `2026-10-13 15:56:10`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-13 15:56:28`  **shutdown** — C:\data, 62 db files — CLEAN
