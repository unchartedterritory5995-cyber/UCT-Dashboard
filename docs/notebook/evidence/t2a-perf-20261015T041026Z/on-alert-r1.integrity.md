# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 23:33:43`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-alert-r1; identity = b9e1f81073451b85b1603ff25ebf41f3
- `2026-10-14 23:34:33`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:35:45`  **shutdown** — C:\data, 62 db files — CLEAN
