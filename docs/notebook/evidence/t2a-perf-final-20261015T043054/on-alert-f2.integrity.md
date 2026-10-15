# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 04:40:08`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-alert-f2; identity = f5e055efd6996333dc2b447b00364c2f
- `2026-10-15 04:40:48`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 04:41:18`  **shutdown** — C:\data, 62 db files — CLEAN
