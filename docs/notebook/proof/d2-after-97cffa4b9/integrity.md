# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 12:53:46`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d2; identity = 119e6a2640324dbd94a580078ec343d4
- `2026-09-28 12:54:29`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 12:56:19`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 12:56:25`  **shutdown** — C:\data, 62 db files — CLEAN
