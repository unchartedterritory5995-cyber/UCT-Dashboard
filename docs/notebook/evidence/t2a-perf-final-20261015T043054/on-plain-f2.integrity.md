# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 04:37:53`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-plain-f2; identity = 0ffafdcc5f402f4b62d720db12979b5a
- `2026-10-15 04:38:34`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 04:39:10`  **shutdown** — C:\data, 62 db files — CLEAN
