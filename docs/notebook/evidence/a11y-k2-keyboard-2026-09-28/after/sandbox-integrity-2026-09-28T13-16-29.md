# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 13:16:35`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10k2; identity = 0654d31ca70d8907d6bdc64cb5742953
- `2026-09-28 13:17:19`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 13:19:17`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 13:50:02`  **shutdown** — C:\data, 62 db files — CLEAN
