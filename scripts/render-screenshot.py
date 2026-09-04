#!/usr/bin/env python3
"""Render the TREK Waterway registry cover from the Merzig–Koblenz test route."""

from __future__ import annotations

import math
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

WIDTH, HEIGHT = 1600, 900
OUT = Path(__file__).resolve().parents[1] / "docs" / "screenshot.png"
CACHE = Path("/tmp/trek-waterway-osm-tiles")
ZOOM = 9
TILE = 256

BG = (7, 16, 27)
PANEL = (13, 28, 43)
CARD = (20, 39, 57)
BORDER = (39, 63, 78)
TEXT = (242, 248, 252)
MUTED = (145, 164, 179)
CYAN = (62, 218, 220)
CYAN_LIGHT = (113, 244, 230)
BLUE = (43, 174, 229)
AMBER = (251, 181, 49)

MAP_BOX = (462, 32, 1568, 868)
MAP_BOUNDS = {
    "west": 5.95,
    "south": 49.33,
    "east": 8.25,
    "north": 50.46,
}

# Ordered coordinates from tests/fixtures/merzig-koblenz-trip.js. The selected
# intermediate clubs make the overlay bend with the Saar and Mosel rather than
# drawing one straight marketing line from start to finish.
ROUTE = [
    ("Kanuclub Merzig", 49.4447229, 6.633815, "start"),
    ("Ruderbund Saar", 49.4874888, 6.5643083, "club"),
    ("Saarburg", 49.6083211, 6.5468165, "club"),
    ("Konz", 49.7050189, 6.5786134, "club"),
    ("Trier", 49.7446084, 6.6244256, "club"),
    ("Mehring", 49.7964244, 6.8081962, "landing"),
    ("Piesport", 49.8728715, 6.9271802, "landing"),
    ("Bernkastel", 49.9247869, 7.0660393, "club"),
    ("Zeltingen", 49.9555384, 7.0077741, "club"),
    ("Traben-Trarbach", 49.951553, 7.1293168, "club"),
    ("Enkirch", 49.9778715, 7.1235916, "landing"),
    ("Zell", 50.0150544, 7.1726753, "club"),
    ("Neef", 50.0891892, 7.1346866, "landing"),
    ("Cochem", 50.1382873, 7.1777225, "club"),
    ("Treis-Karden", 50.1740455, 7.2990163, "club"),
    ("Hatzenport", 50.2279913, 7.4176346, "landing"),
    ("Koblenz", 50.3612821, 7.5671051, "club"),
]

# Day endpoints in ROUTE. The stage chainage totals 241.3 km.
DAY_ENDPOINTS = [2, 4, 5, 6, 8, 10, 12, 13, 15, 16]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/{name}", size)


def rounded(draw: ImageDraw.ImageDraw, box, fill, radius=16, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def world_pixel(lat: float, lng: float, zoom: int = ZOOM) -> tuple[float, float]:
    scale = TILE * (2**zoom)
    x = (lng + 180.0) / 360.0 * scale
    lat_r = math.radians(max(-85.05112878, min(85.05112878, lat)))
    y = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * scale
    return x, y


def tile_image(x: int, y: int) -> Image.Image:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{ZOOM}-{x}-{y}.png"
    if not path.exists():
        url = f"https://tile.openstreetmap.org/{ZOOM}/{x}/{y}.png"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "trek-waterway-marketing/1.1 (+https://github.com/thiesmoeller/trek-plugin-waterway)"},
        )
        with urllib.request.urlopen(req, timeout=20) as response:
            path.write_bytes(response.read())
        time.sleep(0.08)
    return Image.open(path).convert("RGB")


def map_image() -> tuple[Image.Image, tuple[float, float, float, float]]:
    left, top = world_pixel(MAP_BOUNDS["north"], MAP_BOUNDS["west"])
    right, bottom = world_pixel(MAP_BOUNDS["south"], MAP_BOUNDS["east"])
    tx0, ty0 = int(left // TILE), int(top // TILE)
    tx1, ty1 = int(right // TILE), int(bottom // TILE)
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * TILE, (ty1 - ty0 + 1) * TILE))

    try:
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                mosaic.paste(tile_image(tx, ty), ((tx - tx0) * TILE, (ty - ty0) * TILE))
        crop = (
            round(left - tx0 * TILE),
            round(top - ty0 * TILE),
            round(right - tx0 * TILE),
            round(bottom - ty0 * TILE),
        )
        rendered = mosaic.crop(crop)
    except Exception as error:
        print(f"warning: OSM tiles unavailable ({error}); using fallback map")
        rendered = Image.new("RGB", (1100, 830), (28, 55, 59))
        fallback = ImageDraw.Draw(rendered)
        for i in range(14):
            x = 30 + i * 93
            fallback.line((x, 0, x - 260, 830), fill=(36, 66, 66), width=2)
    map_size = (MAP_BOX[2] - MAP_BOX[0], MAP_BOX[3] - MAP_BOX[1])
    rendered = rendered.resize(map_size, Image.Resampling.LANCZOS)
    rendered = ImageEnhance.Color(rendered).enhance(0.42)
    rendered = ImageEnhance.Contrast(rendered).enhance(0.88)
    shade = Image.new("RGBA", map_size, (2, 20, 29, 158))
    rendered = Image.alpha_composite(rendered.convert("RGBA"), shade)
    return rendered, (left, top, right, bottom)


def map_point(lat: float, lng: float, source_bounds) -> tuple[int, int]:
    left, top, right, bottom = source_bounds
    px, py = world_pixel(lat, lng)
    x = MAP_BOX[0] + (px - left) / (right - left) * (MAP_BOX[2] - MAP_BOX[0])
    y = MAP_BOX[1] + (py - top) / (bottom - top) * (MAP_BOX[3] - MAP_BOX[1])
    return round(x), round(y)


def label(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, accent=TEXT, anchor="la"):
    box = draw.textbbox((x, y), text, font=font(14, True), anchor=anchor)
    pad_x, pad_y = 10, 7
    bg = (10, 28, 43, 235)
    rounded(draw, (box[0] - pad_x, box[1] - pad_y, box[2] + pad_x, box[3] + pad_y), bg, 9)
    draw.text((x, y), text, font=font(14, True), fill=accent, anchor=anchor)


def draw_lock(draw: ImageDraw.ImageDraw, x: int, y: int):
    draw.arc((x - 7, y - 12, x + 7, y + 2), 180, 360, fill=AMBER, width=3)
    rounded(draw, (x - 9, y - 3, x + 9, y + 12), AMBER, 4)
    draw.ellipse((x - 2, y + 2, x + 2, y + 6), fill=BG)


def draw_background(img: Image.Image):
    px = img.load()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            glow = max(0.0, 1.0 - math.hypot(x - 1260, y - 120) / 900)
            px[x, y] = (
                round(BG[0] + glow * 3),
                round(BG[1] + glow * 17),
                round(BG[2] + glow * 19),
            )


def draw_sidebar(draw: ImageDraw.ImageDraw):
    rounded(draw, (24, 32, 438, 868), PANEL, 24, outline=BORDER)
    draw.text((54, 58), "TREK", font=font(24, True), fill=CYAN_LIGHT)
    draw.text((124, 62), "WATERWAY", font=font(15, True), fill=MUTED)

    draw.text((54, 120), "Plan the river.", font=font(39, True), fill=TEXT)
    draw.text((54, 170), "Not the road.", font=font(39, True), fill=TEXT)
    draw.text((54, 229), "Merzig  →  Koblenz", font=font(18), fill=(208, 222, 231))
    draw.text((54, 260), "A real multi-day rowing plan on Saar + Mosel", font=font(13), fill=MUTED)

    stat_y = 306
    for value, unit, x in [("241", "km", 54), ("10", "days", 185), ("11", "clubs", 307)]:
        draw.text((x, stat_y), value, font=font(31, True), fill=CYAN_LIGHT)
        draw.text((x, stat_y + 39), unit, font=font(13, True), fill=MUTED)

    draw.text((54, 399), "ROUTE PROFILE", font=font(11, True), fill=MUTED)
    x = 54
    for text, active, w in [("Driving", False, 93), ("Walking", False, 93), ("Rowing", True, 104)]:
        rounded(draw, (x, 423, x + w, 463), CYAN if active else CARD, 12, outline=None if active else BORDER)
        draw.text((x + w / 2, 443), text, font=font(13, True), fill=BG if active else MUTED, anchor="mm")
        x += w + 9

    rounded(draw, (48, 501, 414, 627), CARD, 16, outline=BORDER)
    draw.text((68, 522), "DAY 5", font=font(12, True), fill=CYAN_LIGHT)
    draw.text((68, 551), "Piesport → Zeltingen", font=font(18, True), fill=TEXT)
    draw.text((68, 585), "3 h 02 min", font=font(16, True), fill=CYAN_LIGHT)
    draw.text((183, 585), "·  24.2 km", font=font(16, True), fill=(202, 218, 227))
    draw.text((68, 608), "via Bernkasteler Ruderverein", font=font(12), fill=MUTED)

    rounded(draw, (48, 648, 414, 714), (40, 38, 32), 14, outline=(90, 72, 42))
    draw_lock(draw, 75, 680)
    draw.text((99, 663), "LOCK DELAYS INCLUDED", font=font(11, True), fill=AMBER)
    draw.text((99, 686), "Visible as timed stops on the route", font=font(12), fill=(206, 193, 166))

    draw.text((54, 793), "Water navigation + time estimates", font=font(15, True), fill=TEXT)
    draw.text((54, 822), "Rendered natively in the TREK planner", font=font(12), fill=MUTED)


def main() -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw_background(img)
    draw = ImageDraw.Draw(img, "RGBA")
    draw_sidebar(draw)

    rendered_map, source_bounds = map_image()
    map_mask = Image.new("L", rendered_map.size, 0)
    ImageDraw.Draw(map_mask).rounded_rectangle((0, 0, *rendered_map.size), radius=24, fill=255)
    img.paste(rendered_map.convert("RGB"), (MAP_BOX[0], MAP_BOX[1]), map_mask)
    draw = ImageDraw.Draw(img, "RGBA")
    rounded(draw, MAP_BOX, None, 24, outline=BORDER, width=1)

    draw.text((492, 58), "MERZIG → KOBLENZ", font=font(13, True), fill=CYAN_LIGHT)
    draw.text((492, 84), "10-day waterway route overview", font=font(25, True), fill=TEXT)
    draw.text((492, 118), "Rowing profile · navigation geometry · per-leg times · locks", font=font(13), fill=MUTED)

    points = [map_point(lat, lng, source_bounds) for _, lat, lng, _ in ROUTE]

    # Route casing and luminous overlay.
    draw.line(points, fill=(4, 18, 28, 220), width=18, joint="curve")
    draw.line(points, fill=(26, 126, 174, 220), width=12, joint="curve")
    draw.line(points, fill=CYAN + (255,), width=6, joint="curve")
    draw.line(points, fill=(191, 255, 245, 230), width=2, joint="curve")

    # Rowing-club calls along the waterway.
    for _, lat, lng, kind in ROUTE:
        if kind != "club":
            continue
        x, y = map_point(lat, lng, source_bounds)
        draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=AMBER, outline=(255, 239, 177), width=2)

    # One numbered endpoint per rowing day.
    for day, route_index in enumerate(DAY_ENDPOINTS, start=1):
        x, y = points[route_index]
        draw.ellipse((x - 12, y - 12, x + 12, y + 12), fill=TEXT, outline=CYAN, width=3)
        draw.text((x, y + 1), str(day), font=font(11, True), fill=BG, anchor="mm")

    sx, sy = points[0]
    draw.ellipse((sx - 9, sy - 9, sx + 9, sy + 9), fill=CYAN_LIGHT, outline=TEXT, width=2)

    # Exact place labels, deliberately kept to the major anchors.
    offsets = {
        0: (14, 22, "la"),
        2: (-15, -22, "ra"),
        4: (-15, -25, "ra"),
        7: (-15, 27, "ra"),
        11: (15, -24, "la"),
        13: (16, 24, "la"),
        16: (-16, -26, "ra"),
    }
    for index, (dx, dy, anchor) in offsets.items():
        x, y = points[index]
        label(draw, x + dx, y + dy, ROUTE[index][0], anchor=anchor)

    # TREK route-provider time and lock overlays.
    bx, by = points[7]
    label(draw, bx + 24, by - 48, "3 h 02 min · 24.2 km", accent=CYAN_LIGHT)
    lx = round((points[1][0] + points[2][0]) / 2)
    ly = round((points[1][1] + points[2][1]) / 2)
    draw_lock(draw, lx, ly)
    label(draw, lx + 22, ly + 4, "Lock delay included", accent=AMBER)

    draw.text((MAP_BOX[2] - 18, MAP_BOX[3] - 18), "Map data © OpenStreetMap contributors", font=font(10), fill=(181, 199, 207), anchor="rs")

    # Soft vignette keeps the route central after store-card cropping.
    vignette = Image.new("L", (WIDTH, HEIGHT), 255)
    vd = ImageDraw.Draw(vignette)
    for i in range(28):
        alpha = round(255 * (i / 28) ** 2)
        vd.rounded_rectangle((i, i, WIDTH - i, HEIGHT - i), radius=28, outline=255 - alpha, width=2)
    img = Image.composite(img, Image.new("RGB", img.size, BG), vignette.filter(ImageFilter.GaussianBlur(5)))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} {img.size}")


if __name__ == "__main__":
    main()
