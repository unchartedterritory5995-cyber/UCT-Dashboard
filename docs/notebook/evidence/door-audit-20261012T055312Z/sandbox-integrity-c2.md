tip under test: 9ef039da76 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-12 00:52:04`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\nb-p1-audit\c2; identity = adb24d1c309e53f8b4f0c25a081a8857
- `2026-10-12 00:52:40`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-12 00:54:32`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-12 01:16:41`  **shutdown** — C:\data, 62 db files — CLEAN
