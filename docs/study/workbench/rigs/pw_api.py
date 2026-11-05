"""Log the sandbox account in and GET a path: pw_api.py </api/...>"""
import sys, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
BASE = "http://127.0.0.1:8077"
env = json.load(open(ENV))
with sync_playwright() as p:
    ctx = p.request.new_context(base_url=BASE)
    r = ctx.post("/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    print("login", r.status)
    r = ctx.get(sys.argv[1])
    body = r.text()
    print("status", r.status, "len", len(body))
    print(body[:400])
