"""Generate seamless volcanic magma crack texture — no UI chrome."""
import math
import random
from PIL import Image, ImageDraw, ImageFilter

SIZE = 512
random.seed(42)

# --- Base dark rock with subtle noise ---
img = Image.new("RGB", (SIZE, SIZE))
px = img.load()
for y in range(SIZE):
    for x in range(SIZE):
        nx = math.sin(2 * math.pi * x / SIZE) * 0.5 + 0.5
        ny = math.sin(2 * math.pi * y / SIZE) * 0.5 + 0.5
        n = (
            math.sin(x * 0.07 + y * 0.05)
            + math.sin(x * 0.13 - y * 0.11)
            + math.sin((x + y) * 0.09)
        ) / 3
        base = int(18 + n * 8 + nx * 3 + ny * 2)
        px[x, y] = (base, base // 2 + 2, base // 3)


def wrap(p: float) -> float:
    return p % SIZE


cracks: list[list[tuple[float, float]]] = []
for _ in range(28):
    x, y = random.randint(0, SIZE - 1), random.randint(0, SIZE - 1)
    pts = [(x, y)]
    for _ in range(random.randint(8, 18)):
        angle = random.uniform(0, 2 * math.pi)
        step = random.uniform(12, 35)
        x = wrap(x + math.cos(angle) * step)
        y = wrap(y + math.sin(angle) * step)
        pts.append((x, y))
    cracks.append(pts)

for _ in range(14):
    parent = random.choice(cracks)
    idx = random.randint(1, len(parent) - 1)
    x, y = parent[idx]
    pts = [(x, y)]
    for _ in range(random.randint(3, 8)):
        angle = random.uniform(0, 2 * math.pi)
        step = random.uniform(8, 22)
        x = wrap(x + math.cos(angle) * step)
        y = wrap(y + math.sin(angle) * step)
        pts.append((x, y))
    cracks.append(pts)

overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)


def draw_crack_segment(p1, p2, width, color):
    x1, y1 = p1
    x2, y2 = p2
    draw.line([p1, p2], fill=color, width=width)
    for ox in (-SIZE, 0, SIZE):
        for oy in (-SIZE, 0, SIZE):
            if ox == 0 and oy == 0:
                continue
            draw.line([(x1 + ox, y1 + oy), (x2 + ox, y2 + oy)], fill=color, width=width)


for pts in cracks:
    for i in range(len(pts) - 1):
        p1, p2 = pts[i], pts[i + 1]
        draw_crack_segment(p1, p2, 9, (180, 40, 8, 90))
        draw_crack_segment(p1, p2, 5, (220, 70, 12, 140))
        draw_crack_segment(p1, p2, 2, (255, 120, 20, 220))
        draw_crack_segment(p1, p2, 1, (255, 200, 60, 255))

overlay = overlay.filter(ImageFilter.GaussianBlur(radius=1.2))
result = Image.alpha_composite(img.convert("RGBA"), overlay)

darken = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
dd = ImageDraw.Draw(darken)
for pts in cracks:
    for i in range(len(pts) - 1):
        p1, p2 = pts[i], pts[i + 1]
        x1, y1 = p1
        x2, y2 = p2
        for ox in (-SIZE, 0, SIZE):
            for oy in (-SIZE, 0, SIZE):
                dd.line([(x1 + ox, y1 + oy), (x2 + ox, y2 + oy)], fill=(0, 0, 0, 60), width=4)
darken = darken.filter(ImageFilter.GaussianBlur(radius=0.8))
result = Image.alpha_composite(result, darken)

cores = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
cd = ImageDraw.Draw(cores)
for pts in cracks:
    for i in range(len(pts) - 1):
        p1, p2 = pts[i], pts[i + 1]
        x1, y1 = p1
        x2, y2 = p2
        for ox in (-SIZE, 0, SIZE):
            for oy in (-SIZE, 0, SIZE):
                cd.line([(x1 + ox, y1 + oy), (x2 + ox, y2 + oy)], fill=(255, 160, 30, 200), width=1)
result = Image.alpha_composite(result, cores)

out = result.convert("RGB")
out_path = r"C:\Users\keash\Projects\CommandWarfare\play\client\public\terrain\volcanic-magma.png"
out.save(out_path, "PNG")
print(f"Saved {out_path} ({SIZE}x{SIZE})")

white_count = sum(
    1
    for y in range(SIZE)
    for x in range(SIZE)
    if out.getpixel((x, y))[0] > 240 and out.getpixel((x, y))[1] > 240 and out.getpixel((x, y))[2] > 240
)
print(f"White pixels (>240): {white_count}")
tl = out.crop((0, 0, 64, 64))
tl_bright = sum(
    1 for y in range(64) for x in range(64) if tl.getpixel((x, y))[0] > 200 and tl.getpixel((x, y))[1] > 200
)
print(f"Top-left 64x64 bright pixels: {tl_bright}")
