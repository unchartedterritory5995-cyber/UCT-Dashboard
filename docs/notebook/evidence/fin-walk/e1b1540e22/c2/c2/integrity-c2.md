tip under test: e1b1540e22 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-13 14:49:12`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\nb-p2b-walk\c2; identity = e28490288b0f9a7fe4db3e6ef52394e4
- `2026-10-13 14:49:47`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-13 14:51:39`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-13 15:16:44`  **shutdown** — C:\data, 62 db files — CLEAN
