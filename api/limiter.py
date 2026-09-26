from slowapi import Limiter

from api.services.request_ip import client_ip

# Key rate-limits on the REAL client IP (request_ip.client_ip: CF-Connecting-IP only behind a
# Cloudflare edge, else the address Railway saw connecting),
# NOT request.client.host — behind Cloudflare→Railway that peer address is the same edge
# IP for every user, so get_remote_address would make the login/signup limits a single
# GLOBAL bucket (a self-inflicted launch-morning 429 lockout). See api/services/request_ip.
limiter = Limiter(key_func=client_ip)
