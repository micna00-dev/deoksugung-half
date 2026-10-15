"""guide/mission-guide.html → mission-guide.png (1080x1920)
guide/route-map.html → route-map.png (2016x1356, 원본 지도 map-source.png 위에 동선)
사용: py guide/build.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
    page.goto((HERE / "mission-guide.html").as_uri())
    page.wait_for_load_state("networkidle")
    page.evaluate("document.fonts.ready")
    room = page.evaluate("""() => {
        const j = document.querySelector('.footer').getBoundingClientRect();
        const d = document.querySelector('.duo').getBoundingClientRect();
        return Math.round(j.top - d.bottom);
    }""")
    print(f"여백(시상·채점 ~ 접속 카드): {room}px")
    if room < 16:
        print("경고: 내용이 빡빡하거나 넘칩니다")
    page.screenshot(path=str(HERE / "mission-guide.png"), clip={"x": 0, "y": 0, "width": 1080, "height": 1920})

    page = browser.new_page(viewport={"width": 2016, "height": 1356}, device_scale_factor=1)
    page.goto((HERE / "route-map.html").as_uri())
    page.wait_for_load_state("networkidle")
    page.evaluate("document.fonts.ready")
    page.screenshot(path=str(HERE / "route-map.png"))

    a4 = HERE / "mission-guide-a4.html"
    if a4.exists():
        page = browser.new_page()
        page.goto(a4.as_uri())
        page.wait_for_load_state("networkidle")
        page.evaluate("document.fonts.ready")
        page.pdf(path=str(HERE / "mission-guide-a4.pdf"), format="A4", print_background=True,
                 margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
    browser.close()
print("완료")
