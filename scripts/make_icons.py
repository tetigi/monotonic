"""Generate PWA icons (dark square + green up-arrow). Run: uv run --with pillow scripts/make_icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw

BG = (11, 11, 12, 255)
FG = (52, 199, 89, 255)
OUT = Path(__file__).resolve().parent.parent / "icons"
SIZES = [180, 192, 512]


def up_arrow(d: ImageDraw.ImageDraw, s: int) -> None:
    cx = s / 2
    # Arrowhead (triangle) + shaft (rectangle), kept within the central safe zone.
    head_top = s * 0.24
    head_bottom = s * 0.52
    head_half = s * 0.26
    shaft_half = s * 0.085
    shaft_bottom = s * 0.78
    d.polygon(
        [(cx, head_top), (cx - head_half, head_bottom), (cx + head_half, head_bottom)],
        fill=FG,
    )
    d.rectangle(
        [cx - shaft_half, head_bottom - s * 0.02, cx + shaft_half, shaft_bottom],
        fill=FG,
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for s in SIZES:
        radius = int(s * 0.22)
        # rounded-rect background mask
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
        bg = Image.new("RGBA", (s, s), BG)
        img = Image.composite(bg, Image.new("RGBA", (s, s), (0, 0, 0, 0)), mask)
        up_arrow(ImageDraw.Draw(img), s)
        img.save(OUT / f"icon-{s}.png")
        print(f"wrote icons/icon-{s}.png")


if __name__ == "__main__":
    main()
