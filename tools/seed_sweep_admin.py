"""
Seed a throwaway verified admin user for the local UI consistency sweep.

Run from the repo root:  python tools/seed_sweep_admin.py
Credentials: sweep-admin@uct.local / sweep-admin-pw-123

Idempotent — resets the password + admin role + verified flag each run.
Local-only: writes to ./data/auth.db (never the Railway volume).
"""
import os
import sys

# Pin to the local auth DB so we never touch a real volume.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("AUTH_DB_PATH", os.path.join(REPO_ROOT, "data", "auth.db"))
sys.path.insert(0, REPO_ROOT)

from api.services import auth_db, auth_service  # noqa: E402

EMAIL = "sweep-admin@uctsweep.com"
PASSWORD = "sweep-admin-pw-123"
DISPLAY = "Sweep Admin"


def main():
    os.makedirs(os.path.join(REPO_ROOT, "data"), exist_ok=True)
    auth_db.init_db()

    existing = auth_service.get_user_by_email(EMAIL)
    if not existing:
        auth_service.create_user(EMAIL, PASSWORD, DISPLAY)
        print(f"[seed] created {EMAIL}")
    else:
        print(f"[seed] {EMAIL} already exists — updating")

    # Force admin + verified + a known password hash directly.
    import bcrypt
    pw_hash = bcrypt.hashpw(PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "UPDATE users SET role='admin', email_verified=1, password_hash=? WHERE email=?",
            (pw_hash, EMAIL),
        )
        conn.commit()
    finally:
        conn.close()
    print(f"[seed] {EMAIL} is now admin + verified. Password: {PASSWORD}")
    print(f"[seed] DB: {os.environ['AUTH_DB_PATH']}")


if __name__ == "__main__":
    main()
