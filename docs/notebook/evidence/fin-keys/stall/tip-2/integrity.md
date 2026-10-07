# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 13:12:43`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\stall-tip2; identity = a4145d0fdbcd89e293d69630b2864009
- `2026-10-07 13:13:22`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:15:18`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:19:41`  **shutdown** — C:\data, 62 db files — CLEAN
