# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-12 18:06:20`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\nb-p2a-typing-plain; identity = 3b6fcd8d986b7c75dc824bdf320e65ad
- `2026-10-12 18:06:54`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-12 18:07:05`  **shutdown** — C:\data, 62 db files — CLEAN
