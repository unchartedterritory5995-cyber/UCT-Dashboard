# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 23:45:30`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-off-plain-r3; identity = fb0d67b220f69b916d1c08b9f3cae74f
- `2026-10-14 23:46:24`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:46:41`  **shutdown** — C:\data, 62 db files — CLEAN
