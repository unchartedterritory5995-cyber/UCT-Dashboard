# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 04:44:34`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-blocks-f1; identity = 749a38787b2a07ee3e74460799fc714c
- `2026-10-15 04:45:14`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 04:45:46`  **shutdown** — C:\data, 62 db files — CLEAN
