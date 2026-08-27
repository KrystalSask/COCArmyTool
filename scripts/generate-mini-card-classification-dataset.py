"""Generate a review-only one-shot card classification dataset.

The generator deliberately models only variations that can occur in the army
panel: changing numeric overlays, right-side occlusion, small crop jitter,
resampling, blur, and compression. It does not rotate or mirror game art.
"""

from __future__ import annotations

import io
import json
import random
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "card-classification-mini-v1"
SIZE = 160
SEED = 20260825

CLASSES = [
    {"kind": "troop", "id": 17, "name": "Lava Hound", "slug": "troop_017_lava_hound"},
    {"kind": "troop", "id": 57, "name": "Rocket Balloon", "slug": "troop_057_rocket_balloon"},
    {"kind": "troop", "id": 53, "name": "Yeti", "slug": "troop_053_yeti"},
    {"kind": "troop", "id": 7, "name": "Healer", "slug": "troop_007_healer"},
    {"kind": "spell", "id": 53, "name": "Recall Spell", "slug": "spell_053_recall"},
    {"kind": "spell", "id": 11, "name": "Haste Spell", "slug": "spell_011_haste"},
    {"kind": "spell", "id": 2, "name": "Rage Spell", "slug": "spell_002_rage"},
    {"kind": "spell", "id": 120, "name": "Totem Spell", "slug": "spell_120_totem"},
]

VARIANTS = [
    {"name": "00_full_original_digits", "visible": 1.00, "count": "original", "level": "original"},
    {"name": "01_full_random_digits", "visible": 1.00, "count": "random", "level": "random"},
    {"name": "02_full_count_masked", "visible": 1.00, "count": "masked", "level": "original"},
    {"name": "03_right_occluded_10", "visible": 0.90, "count": "random", "level": "random"},
    {"name": "04_right_occluded_20", "visible": 0.80, "count": "random", "level": "original"},
    {"name": "05_right_occluded_30", "visible": 0.70, "count": "original", "level": "random"},
    {"name": "06_right_occluded_40", "visible": 0.60, "count": "masked", "level": "original"},
    {"name": "07_right_occluded_50", "visible": 0.50, "count": "random", "level": "masked"},
    {"name": "08_occluded_count_masked", "visible": 0.68, "count": "masked", "level": "random"},
    {"name": "09_video_compression", "visible": 0.82, "count": "random", "level": "random", "jpeg": 48},
    {"name": "10_rescale_blur", "visible": 0.74, "count": "original", "level": "random", "blur": 0.75},
    {"name": "11_crop_jitter", "visible": 0.64, "count": "random", "level": "original", "jitter": True},
]


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/msyhbd.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


LABEL_FONT = font(19)
SMALL_FONT = font(13)


def load_source(item: dict) -> Image.Image:
    path = ROOT / "public" / "game-icons" / item["kind"] / f'{item["id"]}.png'
    with Image.open(path) as image:
        return image.convert("RGBA")


def render_card(item: dict, artwork: Image.Image, rng: random.Random) -> Image.Image:
    frame = "#42c8ed" if item["kind"] == "troop" else "#b353e3"
    inner = "#398dab" if item["kind"] == "troop" else "#65408e"
    card = Image.new("RGBA", (SIZE, SIZE), "#171b22")
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle((1, 1, SIZE - 2, SIZE - 2), radius=15, fill=frame, outline="#e3f8ff", width=2)
    draw.rounded_rectangle((6, 6, SIZE - 7, SIZE - 7), radius=11, fill=inner)

    # Preserve source aspect ratio. Transparent artwork is placed over a stable
    # card field, while opaque square artwork fills the inner card.
    target = (148, 148)
    if artwork.getbbox() and artwork.getbbox() != (0, 0, artwork.width, artwork.height):
        art = ImageOps.contain(artwork, target, Image.Resampling.LANCZOS)
        x = (SIZE - art.width) // 2 + rng.randint(-2, 2)
        y = (SIZE - art.height) // 2 + rng.randint(-2, 2)
        card.alpha_composite(art, (x, y))
    else:
        art = ImageOps.fit(artwork, target, Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        mask = Image.new("L", target, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, target[0] - 1, target[1] - 1), radius=9, fill=255)
        card.paste(art, (6, 6), ImageChops_multiply(art.getchannel("A"), mask))
    return card.convert("RGB")


def ImageChops_multiply(left: Image.Image, right: Image.Image) -> Image.Image:
    # Kept local to avoid importing a module for a single mask operation.
    return Image.frombytes("L", left.size, bytes((a * b) // 255 for a, b in zip(left.tobytes(), right.tobytes())))


def overlay_digits(image: Image.Image, count_mode: str, level_mode: str, rng: random.Random) -> None:
    draw = ImageDraw.Draw(image)
    if count_mode == "masked":
        draw.rounded_rectangle((3, 3, 53, 31), radius=5, fill="#53616a")
    else:
        count = 5 if count_mode == "original" else rng.choice([1, 2, 3, 4, 5, 7, 10, 11, 12])
        draw.text((5, 1), f"x{count}", font=LABEL_FONT, fill="white", stroke_width=3, stroke_fill="#202229")

    if level_mode == "masked":
        draw.rounded_rectangle((4, 126, 38, 156), radius=7, fill="#52616a")
    else:
        level = 14 if level_mode == "original" else rng.choice([4, 5, 6, 8, 9, 10, 11, 12, 13, 14])
        draw.rounded_rectangle((5, 127, 37, 156), radius=7, fill="#f3c52f", outline="#fff5a4", width=2)
        text = str(level)
        bbox = draw.textbbox((0, 0), text, font=SMALL_FONT, stroke_width=2)
        x = 21 - (bbox[2] - bbox[0]) // 2
        draw.text((x, 132), text, font=SMALL_FONT, fill="white", stroke_width=2, stroke_fill="#31343c")


def apply_variant(base: Image.Image, variant: dict, rng: random.Random) -> Image.Image:
    image = base.copy()
    overlay_digits(image, variant["count"], variant["level"], rng)

    visible_width = round(SIZE * variant["visible"])
    if visible_width < SIZE:
        draw = ImageDraw.Draw(image)
        draw.rectangle((visible_width, 0, SIZE, SIZE), fill="#394047")
        draw.line((visible_width, 2, visible_width, SIZE - 3), fill="#9deaff", width=2)

    if variant.get("jitter"):
        offset = rng.choice([-3, -2, 2, 3])
        shifted = Image.new("RGB", image.size, "#394047")
        shifted.paste(image, (offset, rng.choice([-2, 2])))
        image = shifted
    image = ImageEnhance.Brightness(image).enhance(rng.uniform(0.94, 1.06))
    image = ImageEnhance.Contrast(image).enhance(rng.uniform(0.94, 1.08))

    if variant.get("blur"):
        image = image.resize((112, 112), Image.Resampling.BILINEAR).resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        image = image.filter(ImageFilter.GaussianBlur(variant["blur"]))
    if variant.get("jpeg"):
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=variant["jpeg"], subsampling=2)
        buffer.seek(0)
        image = Image.open(buffer).convert("RGB")
    return image


def make_contact_sheet(records: list[dict]) -> None:
    selected_names = {
        "00_full_original_digits", "02_full_count_masked", "04_right_occluded_20",
        "06_right_occluded_40", "07_right_occluded_50", "09_video_compression",
    }
    selected = [record for record in records if record["variant"] in selected_names]
    columns = len(selected_names)
    cell_w, cell_h = 180, 205
    sheet = Image.new("RGB", (columns * cell_w, len(CLASSES) * cell_h), "#211b18")
    draw = ImageDraw.Draw(sheet)
    for index, record in enumerate(selected):
        row = index // columns
        column = index % columns
        image = Image.open(OUTPUT / record["path"]).convert("RGB")
        x, y = column * cell_w + 10, row * cell_h + 32
        sheet.paste(image, (x, y))
        draw.text((column * cell_w + 8, row * cell_h + 7), record["class"], font=SMALL_FONT, fill="#f4dfc4")
        draw.text((x, y + 164), record["variant"].replace("_", " "), font=font(10), fill="#b9c7ce")
    preview = OUTPUT / "preview"
    preview.mkdir(parents=True, exist_ok=True)
    sheet.save(preview / "contact-sheet.png", optimize=True)


def main() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    (OUTPUT / "source").mkdir(parents=True)
    records: list[dict] = []
    rng = random.Random(SEED)

    for item in CLASSES:
        artwork = load_source(item)
        artwork.save(OUTPUT / "source" / f'{item["slug"]}.png', optimize=True)
        base = render_card(item, artwork, rng)
        class_dir = OUTPUT / "train" / item["slug"]
        class_dir.mkdir(parents=True)
        for variant in VARIANTS:
            generated = apply_variant(base, variant, rng)
            relative = Path("train") / item["slug"] / f'{variant["name"]}.png'
            generated.save(OUTPUT / relative, optimize=True)
            records.append({
                "class": item["slug"], "kind": item["kind"], "id": item["id"],
                "name": item["name"], "variant": variant["name"],
                "visibleRatio": variant["visible"], "countMode": variant["count"],
                "levelMode": variant["level"], "path": relative.as_posix(),
            })

    manifest = {
        "schemaVersion": 1, "purpose": "review-only one-shot augmentation preview",
        "seed": SEED, "imageSize": [SIZE, SIZE], "classes": CLASSES,
        "samplesPerClass": len(VARIANTS), "sampleCount": len(records), "samples": records,
        "warnings": [
            "This is not an independent train/validation/test benchmark.",
            "The frames and numeric overlays are synthetic approximations and must be checked against real panel crops.",
        ],
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUTPUT / "README.md").write_text(
        "# 小型卡片分类数据集（审核版）\n\n"
        "- 8 个易混淆类别，每类 1 张本地图标种子。\n"
        "- 每类生成 12 张定向增强，共 96 张 160×160 PNG。\n"
        "- 包含数量保留/随机/遮挡、等级保留/随机/遮挡、右侧 10%–50% 遮挡、压缩、模糊和轻微裁切偏移。\n"
        "- 不包含旋转、镜像和不符合游戏界面的透视增强。\n"
        "- 当前只用于检查增强标准，不应把生成图拆分成验证集或测试集。\n\n"
        "先查看 `preview/contact-sheet.png`，确认卡片构图和右侧遮挡方式后再扩展完整类别。\n",
        encoding="utf-8",
    )
    make_contact_sheet(records)
    print(f"Generated {len(records)} samples in {OUTPUT}")


if __name__ == "__main__":
    main()
