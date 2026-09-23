"""Create the small deterministic MarkItDown Studio shortcut icon."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("MarkItDownStudio.ico")
    destination.parent.mkdir(parents=True, exist_ok=True)

    size = 256
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((8, 8, 248, 248), radius=54, fill="#0b0d12", outline="#2f80ed", width=6)
    draw.rounded_rectangle((42, 42, 214, 214), radius=34, fill="#172033")

    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 142)
    except OSError:
        font = ImageFont.load_default()
    draw.text((128, 126), "M", font=font, anchor="mm", fill="#f7f9fc", stroke_width=1, stroke_fill="#f7f9fc")
    draw.ellipse((177, 55, 205, 83), fill="#65a7ff")

    image.save(destination, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(destination)


if __name__ == "__main__":
    main()
