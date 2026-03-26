"""
Email service — Resend integration for transactional emails.
Dark-themed HTML templates matching UCT dashboard branding.
"""

import os
import logging

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "UCT Intelligence <noreply@uctintelligence.com>")

_resend = None

if RESEND_API_KEY:
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        _resend = resend
        logger.info("[email] Resend configured")
    except ImportError:
        logger.warning("[email] resend package not installed — emails disabled")
else:
    logger.warning("[email] RESEND_API_KEY not set — emails disabled")


# ── Core send ────────────────────────────────────────────────────────────────

def send_email(to: str, subject: str, html: str) -> bool:
    """Send an email via Resend. Returns True on success, False on failure."""
    if not _resend:
        logger.warning(f"[email] Skipping email to {to} (Resend not configured)")
        return False
    try:
        _resend.Emails.send({
            "from": FROM_EMAIL,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        logger.info(f"[email] Sent '{subject}' to {to}")
        return True
    except Exception as e:
        logger.error(f"[email] Failed to send '{subject}' to {to}: {e}")
        return False


# ── HTML wrapper ─────────────────────────────────────────────────────────────

def _wrap_html(content: str) -> str:
    """Wrap content in the standard UCT email template."""
    return f"""\
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0e0f0d;font-family:'Instrument Sans',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0e0f0d;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#161716;border:1px solid #2a2b28;border-radius:10px;padding:36px 32px;">
        <tr><td align="center" style="padding-bottom:28px;">
          <span style="font-size:18px;font-weight:800;color:#c9a84c;letter-spacing:4px;text-decoration:none;">UCT</span>
        </td></tr>
        <tr><td>
          {content}
        </td></tr>
        <tr><td align="center" style="padding-top:32px;border-top:1px solid #2a2b28;margin-top:24px;">
          <p style="font-size:11px;color:#6b6a60;margin:24px 0 0 0;">UCT Intelligence &mdash; uctintelligence.com</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _button_html(url: str, text: str) -> str:
    """Gold CTA button."""
    return f"""\
<table cellpadding="0" cellspacing="0" style="margin:24px auto;">
  <tr><td align="center" style="background-color:#c9a84c;border-radius:6px;padding:12px 32px;">
    <a href="{url}" style="color:#0e0f0d;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;">{text}</a>
  </td></tr>
</table>"""


# ── Template functions ───────────────────────────────────────────────────────

def send_verification_email(email: str, token: str, base_url: str) -> bool:
    url = f"{base_url}/verify-email?token={token}"
    html = _wrap_html(f"""\
<h1 style="font-size:20px;font-weight:600;color:#e8e6df;text-align:center;margin:0 0 4px 0;">Verify your email</h1>
<p style="font-size:13px;color:#a8a290;text-align:center;margin:0 0 24px 0;">Click the button below to confirm your email address.</p>
{_button_html(url, "Verify Email")}
<p style="font-size:12px;color:#6b6a60;text-align:center;margin:16px 0 0 0;">This link expires in 24 hours. If you didn't create an account, ignore this email.</p>""")
    return send_email(email, "Verify your email — UCT Intelligence", html)


def send_password_reset_email(email: str, token: str, base_url: str) -> bool:
    url = f"{base_url}/reset-password?token={token}"
    html = _wrap_html(f"""\
<h1 style="font-size:20px;font-weight:600;color:#e8e6df;text-align:center;margin:0 0 4px 0;">Reset your password</h1>
<p style="font-size:13px;color:#a8a290;text-align:center;margin:0 0 24px 0;">We received a request to reset your password.</p>
{_button_html(url, "Reset Password")}
<p style="font-size:12px;color:#6b6a60;text-align:center;margin:16px 0 0 0;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>""")
    return send_email(email, "Reset your password — UCT Intelligence", html)


def send_welcome_email(email: str, display_name: str) -> bool:
    greeting = display_name or "there"
    html = _wrap_html(f"""\
<h1 style="font-size:20px;font-weight:600;color:#e8e6df;text-align:center;margin:0 0 4px 0;">Welcome to UCT Intelligence</h1>
<p style="font-size:14px;color:#a8a290;text-align:center;margin:0 0 24px 0;">Hey {greeting}, your email has been verified.</p>
<p style="font-size:13px;color:#a8a290;line-height:1.6;margin:0 0 8px 0;">You now have full access to:</p>
<ul style="font-size:13px;color:#a8a290;line-height:1.8;padding-left:20px;margin:0 0 16px 0;">
  <li>Daily Morning Wire &amp; market analysis</li>
  <li>UCT 20 Leadership Portfolio</li>
  <li>Real-time breadth monitoring</li>
  <li>Scanner &amp; screener tools</li>
</ul>
<p style="font-size:13px;color:#c9a84c;text-align:center;font-weight:500;margin:8px 0 0 0;">Good trading.</p>""")
    return send_email(email, "Welcome to UCT Intelligence", html)


def send_subscription_confirmation(email: str, display_name: str) -> bool:
    greeting = display_name or "there"
    html = _wrap_html(f"""\
<h1 style="font-size:20px;font-weight:600;color:#e8e6df;text-align:center;margin:0 0 4px 0;">Subscription confirmed</h1>
<p style="font-size:14px;color:#a8a290;text-align:center;margin:0 0 24px 0;">Hey {greeting}, your Pro subscription is now active.</p>
<p style="font-size:13px;color:#a8a290;line-height:1.6;margin:0 0 16px 0;">You have unlimited access to every tool in the dashboard. Manage your billing anytime from Settings.</p>
<p style="font-size:13px;color:#c9a84c;text-align:center;font-weight:500;margin:8px 0 0 0;">Welcome to the team.</p>""")
    return send_email(email, "Pro subscription confirmed — UCT Intelligence", html)
