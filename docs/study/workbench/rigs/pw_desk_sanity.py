import time, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1366, "height": 960})
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:160]))
    for n in (32, 34, 35, 37, 41):
        errs.clear(); page.goto(f"http://127.0.0.1:5232/lab.html?piece={n}", wait_until="load", timeout=30000); time.sleep(5)
        if n == 34: page.get_by_role("button", name="Continue").click(); time.sleep(2.5)
        page.screenshot(path=OUT + fr"\q{n}.png"); print(n, "errs", errs[:2])
    b.close()
