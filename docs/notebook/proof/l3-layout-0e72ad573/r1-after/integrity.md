# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 20:16:12`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10l3; identity = 8a81aa53a63a5db521ab217d495ab246
- `2026-09-28 20:17:22`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 20:19:13`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 20:22:42`  **shutdown** — C:\data, 62 db files — CLEAN
