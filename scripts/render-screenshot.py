#!/usr/bin/env python3
"""Draw a 16:9 store-cover schematic of the TREK waterway planner surface."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1600, 900
OUT = Path(__file__).resolve().parents[1] / "docs" / "screenshot.png"

BG = (15, 23, 36)
SIDEBAR = (22, 32, 48)
MAP_BG = (28, 48, 62)
WATER = (56, 168, 214)
WATER_GLOW = (36, 110, 148)
LAND = (42, 68, 58)
ACCENT = (94, 234, 212)
TEXT = (236, 242, 248)
MUTED = (148, 163, 184)
WARN = (245, 158, 11)
CARD = (30, 41, 59)
BORDER = (51, 65, 85)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/{name}", size)


def rounded(draw: ImageDraw.ImageDraw, box, fill, radius=16):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def main() -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)

    sidebar = 420
    rounded(d, (24, 24, sidebar - 8, HEIGHT - 24), SIDEBAR, 22)
    rounded(d, (sidebar + 8, 24, WIDTH - 24, HEIGHT - 24), MAP_BG, 22)

    # Header
    d.text((48, 48), "TREK", font=font(22, True), fill=ACCENT)
    d.text((48, 84), "Mosel rowing  ·  Day 3", font=font(28, True), fill=TEXT)
    d.text((48, 126), "Trittenheim → Bernkastel-Kues", font=font(16), fill=MUTED)

    # Route profile pills
    pills = [("Driving", False), ("Walking", False), ("Rowing", True)]
    x = 48
    for label, on in pills:
        w = 108 if label != "Walking" else 118
        fill = (14, 116, 144) if on else CARD
        rounded(d, (x, 168, x + w, 204), fill, 14)
        d.text((x + 18, 176), label, font=font(14, True), fill=TEXT if on else MUTED)
        x += w + 10

    # Day-plan cards + connectors
    stops = [
        ("1", "Trittenheim slipway", "put-in"),
        ("2", "Neumagen landing", None),
        ("3", "Bernkastel-Kues", "take-out"),
    ]
    connectors = ["1 h 42 min  ·  13.7 km  ·  1 lock", "1 h 55 min  ·  15.4 km"]
    y = 240
    for i, (num, name, tag) in enumerate(stops):
        rounded(d, (48, y, sidebar - 40, y + 78), CARD, 14)
        d.ellipse((64, y + 22, 96, y + 54), fill=WATER)
        d.text((74, y + 28), num, font=font(16, True), fill=BG)
        d.text((112, y + 18), name, font=font(16, True), fill=TEXT)
        d.text((112, y + 44), tag or "rowing stop", font=font(13), fill=MUTED)
        y += 78
        if i < len(connectors):
            d.text((118, y + 8), f"⚡  {connectors[i]}", font=font(13), fill=ACCENT)
            y += 36

    d.text((48, HEIGHT - 72), "Total  29.1 km  ·  3 h 37 min including locks", font=font(14, True), fill=MUTED)

    # Map land blobs
    d.polygon([(920, 120), (1280, 160), (1500, 420), (1420, 760), (980, 800), (760, 520)], fill=LAND)
    d.polygon([(540, 280), (700, 240), (780, 480), (620, 700), (500, 520)], fill=(38, 62, 54))

    # Waterway polyline (meandering Mosel-like)
    river = [
        (560, 720), (620, 640), (700, 600), (760, 520), (840, 480),
        (900, 430), (980, 400), (1060, 360), (1140, 340), (1240, 300),
        (1340, 280), (1460, 240),
    ]
    d.line(river, fill=WATER_GLOW, width=18)
    d.line(river, fill=WATER, width=8)

    # Stop markers
    for i, pt in enumerate([river[0], river[5], river[-1]]):
        d.ellipse((pt[0] - 12, pt[1] - 12, pt[0] + 12, pt[1] + 12), fill=TEXT, outline=WATER, width=3)
        d.text((pt[0] - 4, pt[1] - 8), str(i + 1), font=font(12, True), fill=BG)

    # Duration via (green) and lock (amber) dots — the map times
    time_via = river[3]
    lock = river[7]
    d.ellipse((time_via[0] - 8, time_via[1] - 8, time_via[0] + 8, time_via[1] + 8), fill=ACCENT)
    d.ellipse((lock[0] - 8, lock[1] - 8, lock[0] + 8, lock[1] + 8), fill=WARN)

    rounded(d, (time_via[0] + 14, time_via[1] - 36, time_via[0] + 210, time_via[1] - 6), CARD, 10)
    d.text((time_via[0] + 24, time_via[1] - 32), "1 h 42 min · 13.7 km", font=font(13, True), fill=ACCENT)

    rounded(d, (lock[0] + 14, lock[1] - 36, lock[0] + 232, lock[1] - 6), CARD, 10)
    d.text((lock[0] + 24, lock[1] - 32), "Zeltingen lock · 15 min", font=font(13, True), fill=WARN)

    d.text((sidebar + 36, 48), "Rowing route on the waterway", font=font(18, True), fill=TEXT)
    d.text((sidebar + 36, 78), "Times on the map line  ·  TREK 4.2 route provider", font=font(14), fill=MUTED)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} {img.size}")


if __name__ == "__main__":
    main()
