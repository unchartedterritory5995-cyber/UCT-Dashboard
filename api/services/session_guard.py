"""One person per subscription: a device limit and a login-sharing alarm.

Owner ruling, 2026-10-08: an account may be signed in on at most 2 devices at
once, and an account that looks shared is signed out everywhere and reported to
the owner.

Two mechanisms, both run from ``auth_service.create_session`` so every door that
mints a session (signup, password login, the two-factor step, smoke-login) is
covered by ONE call site:

1. **Device limit.** After a new session is written, every session beyond the
   newest ``SESSION_DEVICE_LIMIT`` (default 2) is deleted, least recently used
   first. A shared login therefore keeps knocking its other users out; one
   person with a computer and a phone never notices.

2. **Sharing alarm.** A real member signs in rarely: a session lasts 30 days.
   A login shared between people signs in over and over, from different
   networks, because the device limit keeps evicting them. When one account
   records ``SESSION_SHARING_MIN_LOGINS`` logins (default 5) from at least
   ``SESSION_SHARING_MIN_NETWORKS`` distinct networks (default 3) inside 24
   hours, every OTHER session is signed out (the one signing in now is kept,
   so the request that tripped it still completes) and the owner gets a Discord
   message naming the account and the networks. One alarm per account per 24
   hours, stamped durably in ``activity_log`` so a redeploy cannot re-fire it.

3. **Cross-network kick alert** (owner ask 2026-10-12). When the device limit
   signs out a device whose network differs from the one signing in, the owner
   gets a Discord message with both addresses and browsers, at most once per
   account per hour. Skipped when the sharing alarm fires on the same sign-in
   (that message already covers it). Same kill switch as the alarm.

A "network" is the /24 (IPv4) or /48 (IPv6) the login came from, so a phone
hopping between addresses inside one carrier block counts once.

Exempt: synthetic ``@uctintelligence.internal`` accounts, which automation signs
in to from fresh browser contexts on every run.

Kill switches (read per call, no redeploy needed beyond the variable flip):
``SESSION_DEVICE_LIMIT=0`` turns the limit off; ``SESSION_SHARING_GUARD_ENABLED=0``
turns the alarm off.

Nothing here may break a sign-in: every entry point swallows its own errors.
"""

from __future__ import annotations

import ipaddress
import os
import threading

from api.services.auth_db import get_connection

EXEMPT_DOMAIN = "@uctintelligence.internal"
SHARING_FLAG_ACTION = "sharing_flagged"
WINDOW_SQL = "-1 day"
DEVICE_KICK_ACTION = "device_kick_flagged"
DEVICE_KICK_WINDOW_SQL = "-1 hour"


def _int_env(name: str, default: int) -> int:
    try:
        return int(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        return default


def device_limit() -> int:
    # Read by literal name so the flag-ledger scan sees it (docs/feature_flags.json knobs).
    try:
        return max(0, int(str(os.environ.get("SESSION_DEVICE_LIMIT", "2")).strip()))
    except (TypeError, ValueError):
        return 2


def sharing_guard_enabled() -> bool:
    return str(os.environ.get("SESSION_SHARING_GUARD_ENABLED", "1")).strip().lower() not in (
        "0", "false", "no", "off")


def network_of(ip: str | None) -> str | None:
    """The /24 (IPv4) or /48 (IPv6) an address belongs to, or None if unparseable."""
    if not ip:
        return None
    try:
        addr = ipaddress.ip_address(ip.strip())
    except ValueError:
        return None
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    prefix = 24 if addr.version == 4 else 48
    return str(ipaddress.ip_network(f"{addr}/{prefix}", strict=False))


def _email_of(conn, user_id: str) -> str:
    row = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
    return (row[0] or "").lower() if row else ""


def _surplus_sessions(conn, user_id: str, keep_token: str, limit: int) -> list:
    """(token, ip_address, user_agent) of every session beyond the newest ``limit``."""
    if limit <= 0:
        return []
    rows = conn.execute(
        "SELECT token, ip_address, user_agent FROM sessions WHERE user_id = ? AND token != ? "
        "ORDER BY COALESCE(last_seen_at, created_at) DESC, created_at DESC",
        (user_id, keep_token),
    ).fetchall()
    return [tuple(r) for r in rows[limit - 1:]]


def enforce_device_limit(conn, user_id: str, keep_token: str, limit: int) -> int:
    """Delete every session beyond the newest ``limit``. Returns how many went."""
    surplus = _surplus_sessions(conn, user_id, keep_token, limit)
    for tok, _ip, _ua in surplus:
        conn.execute("DELETE FROM sessions WHERE token = ?", (tok,))
    return len(surplus)


def _session_ip(conn, token: str) -> tuple:
    row = conn.execute("SELECT ip_address, user_agent FROM sessions WHERE token = ?",
                       (token,)).fetchone()
    return (row[0], row[1]) if row else (None, None)


def device_kick_alert(conn, user_id: str, email: str, keep_token: str, kicked: list) -> bool:
    """Tell the owner when the device limit signed out a device on ANOTHER network.

    Owner ask, 2026-10-12: a kick between two networks is how a shared login
    looks the moment it happens, before the 24 h sharing alarm has enough
    sign-ins to fire. One person's phone and computer on the same home network
    never trip it. One alert per account per hour (stamped in ``activity_log``,
    so a redeploy cannot re-fire it); the kick itself is never held back.
    Returns True if it alerted.
    """
    if not kicked or not sharing_guard_enabled():
        return False
    new_ip, new_ua = _session_ip(conn, keep_token)
    new_net = network_of(new_ip)
    if not new_net:
        return False
    other = [(ip, ua) for _tok, ip, ua in kicked
             if network_of(ip) and network_of(ip) != new_net]
    if not other:
        return False
    if conn.execute(
        "SELECT 1 FROM activity_log WHERE user_id = ? AND action = ? "
        "AND created_at >= datetime('now', ?) LIMIT 1",
        (user_id, DEVICE_KICK_ACTION, DEVICE_KICK_WINDOW_SQL),
    ).fetchone():
        return False
    import uuid
    conn.execute(
        "INSERT INTO activity_log (id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), user_id, DEVICE_KICK_ACTION,
         f"new {new_ip}; signed out {', '.join(str(ip) for ip, _ in other)}", new_ip),
    )
    lines = [
        f"Device limit kick across networks: **{email or user_id}**",
        f"New sign-in: {new_ip} ({(new_ua or 'unknown browser')[:80]})",
    ]
    for ip, ua in other[:5]:
        lines.append(f"Signed out: {ip} ({(ua or 'unknown browser')[:80]})")
    lines.append("Different networks can mean a shared login. Check the account in Admin.")
    threading.Thread(target=_post_owner_alert, args=("\n".join(lines),), daemon=True).start()
    return True


def recent_login_networks(conn, user_id: str) -> tuple[int, list[str]]:
    """(login count, distinct networks) for this account in the last 24 hours."""
    rows = conn.execute(
        "SELECT ip_address FROM activity_log WHERE user_id = ? AND action = 'login' "
        "AND created_at >= datetime('now', ?)",
        (user_id, WINDOW_SQL),
    ).fetchall()
    nets: list[str] = []
    for (ip,) in rows:
        net = network_of(ip)
        if net and net not in nets:
            nets.append(net)
    return len(rows), nets


def _flagged_recently(conn, user_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM activity_log WHERE user_id = ? AND action = ? "
        "AND created_at >= datetime('now', ?) LIMIT 1",
        (user_id, SHARING_FLAG_ACTION, WINDOW_SQL),
    ).fetchone()
    return row is not None


def _post_owner_alert(text: str) -> None:
    try:
        from api.services.alert_destination import ops_webhook
        url = ops_webhook()
        if not url:
            return
        import requests
        requests.post(url, json={"content": text[:1900]}, timeout=10)
    except Exception as e:  # never let an alert failure surface
        print(f"[session-guard] owner alert failed: {e}")


def check_sharing(conn, user_id: str, email: str, keep_token: str) -> bool:
    """Flag and sign out an account that looks shared. Returns True if it fired."""
    if not sharing_guard_enabled():
        return False
    min_logins = _int_env("SESSION_SHARING_MIN_LOGINS", 5)
    min_networks = _int_env("SESSION_SHARING_MIN_NETWORKS", 3)
    logins, nets = recent_login_networks(conn, user_id)
    if logins < min_logins or len(nets) < min_networks:
        return False
    if _flagged_recently(conn, user_id):
        return False
    cur = conn.execute(
        "DELETE FROM sessions WHERE user_id = ? AND token != ?", (user_id, keep_token))
    signed_out = cur.rowcount
    import uuid
    conn.execute(
        "INSERT INTO activity_log (id, user_id, action, details) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), user_id, SHARING_FLAG_ACTION,
         f"{logins} logins from {len(nets)} networks in 24h; signed out {signed_out}"),
    )
    text = (
        f"Possible shared login: **{email or user_id}**\n"
        f"{logins} sign-ins from {len(nets)} different networks in the last 24 hours.\n"
        f"Networks: {', '.join(nets[:10])}\n"
        f"Signed out {signed_out} other device(s). Review the account in Admin and "
        f"suspend it if it is being shared."
    )
    threading.Thread(target=_post_owner_alert, args=(text,), daemon=True).start()
    return True


def after_session_created(user_id: str, token: str) -> None:
    """Run both guards for a session that was just written. Never raises."""
    try:
        conn = get_connection()
    except Exception as e:
        print(f"[session-guard] no connection: {e}")
        return
    try:
        email = _email_of(conn, user_id)
        if email.endswith(EXEMPT_DOMAIN):
            return
        kicked = _surplus_sessions(conn, user_id, token, device_limit())
        enforce_device_limit(conn, user_id, token, device_limit())
        if not check_sharing(conn, user_id, email, token):
            device_kick_alert(conn, user_id, email, token, kicked)
        conn.commit()
    except Exception as e:
        print(f"[session-guard] skipped for {user_id}: {e}")
    finally:
        conn.close()
