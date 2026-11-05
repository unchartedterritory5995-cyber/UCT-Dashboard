import time, json
from playwright.sync_api import sync_playwright
ENV = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\sandbox_env.json"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
env = json.load(open(ENV))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1366, "height": 960})
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page()
    page.goto("http://127.0.0.1:5232/lab.html?piece=43", wait_until="load", timeout=30000); time.sleep(3); page.get_by_role("button", name="Start hard mode").click(timeout=5000); time.sleep(6)
    fb = page.locator("button", has_text="Check").first.bounding_box(); print("check button y", fb and round(fb["y"]), "viewport 960")
    page.screenshot(path=OUT + r"\p43b.png"); b.close()
