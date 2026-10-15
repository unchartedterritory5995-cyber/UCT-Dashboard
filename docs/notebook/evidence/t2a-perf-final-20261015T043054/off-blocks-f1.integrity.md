# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 04:49:12`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-off-blocks-f1; identity = 140505a05758d4f5b5f726c33a910a36
- `2026-10-15 04:49:52`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 04:50:34`  **shutdown** — C:\data, 62 db files — CLEAN
