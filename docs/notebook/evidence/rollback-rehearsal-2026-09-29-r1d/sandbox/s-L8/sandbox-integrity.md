# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 19:16:48`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10r1d-2; identity = b4d8a6fd4b0854d733b679b5654f09b3
- `2026-09-29 19:17:59`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 19:19:50`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 19:19:58`  **shutdown** — C:\data, 62 db files — CLEAN
