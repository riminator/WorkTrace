"""
Run this script once to generate a sample PNG with text that can be OCR'd.
Requires: pip install pillow
"""
from PIL import Image, ImageDraw, ImageFont
import pathlib

OUTPUT = pathlib.Path(__file__).parent / "sample_image.png"

WIDTH, HEIGHT = 800, 400
img = Image.new("RGB", (WIDTH, HEIGHT), color=(255, 255, 255))
draw = ImageDraw.Draw(img)

lines = [
    "KnowledgeBase Sample Image",
    "",
    "Product: UltraWidget Pro 3000",
    "Serial Number: UW-2024-XJ99",
    "Manufacture Date: March 15, 2024",
    "Warranty: 2 years from purchase date",
    "",
    "WARNING: Keep away from water.",
    "Operating temperature: -10°C to 60°C",
    "Support: support@ultrawidget.example.com",
]

y = 40
for line in lines:
    draw.text((50, y), line, fill=(20, 20, 20))
    y += 32

img.save(OUTPUT)
print(f"Saved to {OUTPUT}")
