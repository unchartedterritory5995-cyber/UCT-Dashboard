# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 13:54:37`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\off2; identity = f754971cdef9b305a3c0cb7266ab5f30
- `2026-10-07 13:55:13`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:55:55`  **shutdown** — C:\data, 62 db files — CLEAN
