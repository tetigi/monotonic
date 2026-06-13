"""Generate PWA icons: "M/T" wordmark (coral slash) on dark.
Run: uv run --with pillow scripts/make_icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG = (21, 19, 28, 255)        # #15131c
FG = (240, 236, 229, 255)     # #f0ece5
CORAL = (251, 93, 69, 255)    # #fb5d45
OUT = Path(__file__).resolve().parent.parent / "icons"
SIZES = [180, 192, 512]

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def draw_mark(img: Image.Image, s: int) -> None:
    d = ImageDraw.Draw(img)
    parts = [("M", FG), ("/", CORAL), ("T", FG)]
    # Fit the wordmark to ~76% of the icon width.
    size = int(s * 0.5)
    font = load_font(size)
    widths = [d.textlength(t, font=font) for t, _ in parts]
    while sum(widths) > s * 0.76 and size > 8:
        size -= 4
        font = load_font(size)
        widths = [d.textlength(t, font=font) for t, _ in parts]
    x = (s - sum(widths)) / 2
    cy = s / 2
    for (text, color), w in zip(parts, widths):
        d.text((x, cy), text, font=font, fill=color, anchor="lm")
        x += w


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for s in SIZES:
        radius = int(s * 0.22)
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
        img = Image.composite(Image.new("RGBA", (s, s), BG),
                              Image.new("RGBA", (s, s), (0, 0, 0, 0)), mask)
        # subtle coral frame to echo the blueprint motif
        inset = int(s * 0.08)
        ImageDraw.Draw(img).rounded_rectangle(
            [inset, inset, s - 1 - inset, s - 1 - inset],
            radius=int(radius * 0.6), outline=(251, 93, 69, 90), width=max(1, s // 90))
        draw_mark(img, s)
        img.save(OUT / f"icon-{s}.png")
        print(f"wrote icons/icon-{s}.png")


if __name__ == "__main__":
    main()
