# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 04:33:47`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-alert-f1; identity = 887bac775339d8d7685d9e4529df20af
- `2026-10-15 04:34:26`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 04:34:52`  **shutdown** — C:\data, 62 db files — CLEAN
