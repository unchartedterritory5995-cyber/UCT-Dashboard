# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-17 23:10:24`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t3typing-abB1; identity = 18655cc85f0f2b3c150b00ac00efa39c
- `2026-10-17 23:10:57`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 23:11:17`  **shutdown** — C:\data, 62 db files — CLEAN
