# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-13 15:57:22`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\nb-p2b-typing-blocks-r3; identity = 9844d0774ea9b249d1f7767064f2de1a
- `2026-10-13 15:57:55`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-13 15:58:12`  **shutdown** — C:\data, 62 db files — CLEAN
