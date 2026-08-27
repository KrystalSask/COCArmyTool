"""Generate the first synthetic army-card classification dataset.

The dataset is intentionally closed-set: every generated crop belongs to one
of the 76 mainland-China army-panel classes (troop, spell, or siege).  Card
resolution and visible crop width are modeled independently.  Narrow crops
keep their aspect ratio and are right-padded instead of being stretched.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import random
import re
import shutil
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
GAME_DATA = ROOT / "src" / "data" / "gameData.generated.json"
ICON_ROOT = ROOT / "public" / "game-icons"
DEFAULT_OUTPUT = ROOT / "artifacts" / "army-card-classification-cn-v1"

MODEL_SIZE = 160
CANONICAL_SIZE = 192
DEFAULT_SEED = 20260825
DEFAULT_SAMPLES_PER_CLASS = 100
KIND_ORDER = ("troop", "spell", "siege")
DATA_KEYS = {"troop": "troops", "spell": "spells", "siege": "siegeMachines"}
MAIN_REGION = {"troop": "mainTroops", "spell": "mainSpells", "siege": "mainSiege"}

FRAME_COLORS = {
    "troop": (66, 200, 237),
    "spell": (179, 83, 227),
    "siege": (232, 145, 52),
}
INNER_COLORS = {
    "troop": (57, 141, 171),
    "spell": (101, 64, 142),
    "siege": (138, 91, 54),
}
# All mainland-China super-troop cards use the gold/red treatment. Several
# catalog assets contain only transparent character art, so the generator must
# supply this game-accurate distinction instead of the normal blue troop card.
SUPER_TROOP_IDS = {
    26, 27, 28, 29, 55, 56, 57, 63, 64, 66, 76, 80, 81, 83, 84, 98, 147,
}
SUPER_FRAME_COLOR = (224, 177, 47)
SUPER_INNER_COLOR = (170, 35, 42)
PANEL_COLORS = {
    "mainTroops": (57, 64, 71),
    "mainSpells": (58, 62, 70),
    "mainSiege": (63, 62, 66),
    "castleArmy": (54, 61, 68),
}
SOURCE_OVERRIDES = {
    # User-confirmed mainland-China Ruin Witch card screenshot. Keep the whole
    # card exactly as supplied; only resize it for the model input.
    "troop_109_ruin_witch": {
        "path": "recognition-samples/card-classification-sources/troop/109-ruin-witch-reference.jpg",
        "type": "user_confirmed_full_card",
    },
    "troop_028_super_wall_breaker": {
        "path": "recognition-samples/card-classification-sources/troop/028-super-wall-breaker-full-card.png",
        "type": "user_confirmed_full_card",
    },
    "troop_147_super_yeti": {
        "path": "recognition-samples/card-classification-sources/troop/147-super-yeti-full-card.png",
        "type": "user_confirmed_full_card",
    },
    **{
        class_name: {
            "path": f"recognition-samples/card-classification-sources/siege/{class_name}.png",
            "type": "user_confirmed_full_card",
        }
        for class_name in (
            "siege_051_wall_wrecker", "siege_052_battle_blimp",
            "siege_062_stone_slammer", "siege_075_siege_barracks",
            "siege_087_log_launcher", "siege_091_flame_flinger",
            "siege_092_battle_drill", "siege_135_troop_launcher",
            "siege_188_sky_wagon",
        )
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--samples-per-class", type=int, default=DEFAULT_SAMPLES_PER_CLASS)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--force", action="store_true", help="replace an existing output directory")
    return parser.parse_args()


def slugify(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return value or "unnamed"


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


COUNT_FONT = font(23)
LEVEL_FONT = font(16)
CAPTION_FONT = font(13)
SMALL_FONT = font(11)


def load_classes() -> list[dict]:
    data = json.loads(GAME_DATA.read_text(encoding="utf-8"))
    classes: list[dict] = []
    for kind in KIND_ORDER:
        for item in data[DATA_KEYS[kind]]:
            icon = ICON_ROOT / kind / f'{item["id"]}.png'
            if not icon.exists():
                raise FileNotFoundError(f"missing icon: {icon}")
            # Pillow sniffs the real format, including WebP files stored with a
            # .png extension in the current asset catalog.
            with Image.open(icon) as image:
                image.load()
            class_name = f'{kind}_{item["id"]:03d}_{slugify(item["name"])}'
            source_override = SOURCE_OVERRIDES.get(class_name)
            if source_override and not (ROOT / source_override["path"]).exists():
                raise FileNotFoundError(f'missing source override: {source_override["path"]}')
            classes.append({
                "index": len(classes),
                "kind": kind,
                "id": item["id"],
                "name": item["name"],
                "class": class_name,
                "icon": icon.relative_to(ROOT).as_posix(),
                **({"sourceOverride": source_override} if source_override else {}),
            })
    expected = {"troop": 49, "spell": 18, "siege": 9}
    actual = Counter(item["kind"] for item in classes)
    if dict(actual) != expected:
        raise RuntimeError(f"unexpected class catalog: expected {expected}, got {dict(actual)}")
    return classes


def load_icon(item: dict) -> Image.Image:
    source_override = item.get("sourceOverride")
    path = ROOT / (source_override["path"] if source_override else item["icon"])
    with Image.open(path) as image:
        image = image.convert("RGBA")
        return image


def multiply_masks(left: Image.Image, right: Image.Image) -> Image.Image:
    return Image.frombytes(
        "L", left.size,
        bytes((a * b) // 255 for a, b in zip(left.tobytes(), right.tobytes())),
    )


def render_card(item: dict, icon: Image.Image, rng: random.Random) -> Image.Image:
    if item.get("sourceOverride", {}).get("type") == "user_confirmed_full_card":
        # Preserve every supplied pixel; full-card references are only resized.
        return icon.convert("RGB").resize(
            (CANONICAL_SIZE, CANONICAL_SIZE), Image.Resampling.LANCZOS,
        )
    is_super_troop = item["kind"] == "troop" and item["id"] in SUPER_TROOP_IDS
    frame = SUPER_FRAME_COLOR if is_super_troop else FRAME_COLORS[item["kind"]]
    inner = SUPER_INNER_COLOR if is_super_troop else INNER_COLORS[item["kind"]]
    card = Image.new("RGBA", (CANONICAL_SIZE, CANONICAL_SIZE), (23, 27, 34, 255))
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle(
        (1, 1, CANONICAL_SIZE - 2, CANONICAL_SIZE - 2), radius=18,
        fill=frame + (255,), outline=(227, 248, 255, 255), width=3,
    )
    draw.rounded_rectangle(
        (7, 7, CANONICAL_SIZE - 8, CANONICAL_SIZE - 8), radius=14,
        fill=inner + (255,),
    )

    target = (CANONICAL_SIZE - 14, CANONICAL_SIZE - 14)
    bbox = icon.getbbox()
    transparent = bbox is not None and bbox != (0, 0, icon.width, icon.height)
    if transparent:
        art = ImageOps.contain(icon, target, Image.Resampling.LANCZOS)
        x = (CANONICAL_SIZE - art.width) // 2 + rng.randint(-2, 2)
        y = (CANONICAL_SIZE - art.height) // 2 + rng.randint(-2, 2)
        card.alpha_composite(art, (x, y))
    else:
        art = ImageOps.fit(icon, target, Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        mask = Image.new("L", target, 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, target[0] - 1, target[1] - 1), radius=11, fill=255,
        )
        card.paste(art, (7, 7), multiply_masks(art.getchannel("A"), mask))
    return card.convert("RGB")


def overlay_card_ui(card: Image.Image, rng: random.Random) -> dict:
    draw = ImageDraw.Draw(card)
    count = rng.choice([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30])
    level = rng.choice([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    show_count = rng.random() >= 0.06
    show_level = rng.random() >= 0.08

    if show_count:
        draw.text(
            (6, 0), f"x{count}", font=COUNT_FONT, fill="white",
            stroke_width=3, stroke_fill=(28, 31, 37),
        )
    if show_level:
        draw.rounded_rectangle(
            (6, 151, 45, 188), radius=8,
            fill=(243, 197, 47), outline=(255, 245, 164), width=2,
        )
        text = str(level)
        bbox = draw.textbbox((0, 0), text, font=LEVEL_FONT, stroke_width=2)
        x = 25 - (bbox[2] - bbox[0]) // 2
        draw.text(
            (x, 157), text, font=LEVEL_FONT, fill="white",
            stroke_width=2, stroke_fill=(49, 52, 60),
        )
    return {"count": count if show_count else None, "level": level if show_level else None}


def choose_native_size(rng: random.Random) -> int:
    value = rng.random()
    if value < 0.05:
        return rng.randint(88, 99)
    if value < 0.35:
        return rng.randint(100, 119)
    if value < 0.70:
        return rng.randint(120, 143)
    return rng.randint(144, 180)


def choose_region(item: dict, rng: random.Random) -> str:
    return "castleArmy" if rng.random() < 0.30 else MAIN_REGION[item["kind"]]


def choose_visible_width(full_size: int, rng: random.Random) -> int:
    # This is an augmentation distribution, not a validity threshold.  Every
    # crop remains labeled with its real class and the model is closed-set.
    value = rng.random()
    if value < 0.28:
        ratio = rng.uniform(0.90, 1.00)
    elif value < 0.68:
        ratio = rng.uniform(0.72, 0.90)
    elif value < 0.92:
        ratio = rng.uniform(0.56, 0.72)
    else:
        ratio = rng.uniform(0.46, 0.56)
    return max(1, round(full_size * ratio))


def resize_card(card: Image.Image, size: int) -> Image.Image:
    return card.resize((size, size), Image.Resampling.LANCZOS)


def encode_roundtrip(image: Image.Image, rng: random.Random) -> tuple[Image.Image, dict]:
    roll = rng.random()
    if roll < 0.36:
        quality = rng.randint(60, 95)
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=quality, subsampling=2)
        buffer.seek(0)
        with Image.open(buffer) as decoded:
            return decoded.convert("RGB"), {"codec": "jpeg", "quality": quality}
    if roll < 0.50:
        quality = rng.randint(55, 94)
        buffer = io.BytesIO()
        image.save(buffer, "WEBP", quality=quality, method=4)
        buffer.seek(0)
        with Image.open(buffer) as decoded:
            return decoded.convert("RGB"), {"codec": "webp", "quality": quality}
    return image, {"codec": "none", "quality": None}


def degrade_row(image: Image.Image, rng: random.Random) -> tuple[Image.Image, dict]:
    brightness = rng.uniform(0.93, 1.07)
    contrast = rng.uniform(0.92, 1.09)
    image = ImageEnhance.Brightness(image).enhance(brightness)
    image = ImageEnhance.Contrast(image).enhance(contrast)

    blur = 0.0
    if rng.random() < 0.30:
        blur = rng.uniform(0.15, 0.75)
        image = image.filter(ImageFilter.GaussianBlur(blur))

    image, codec = encode_roundtrip(image, rng)
    return image, {
        "brightness": round(brightness, 4),
        "contrast": round(contrast, 4),
        "blurRadius": round(blur, 4),
        **codec,
    }


def normalize_crop(crop: Image.Image, padding: tuple[int, int, int]) -> tuple[Image.Image, dict]:
    scale = MODEL_SIZE / max(1, crop.height)
    scaled_width = max(1, round(crop.width * scale))
    resized = crop.resize((scaled_width, MODEL_SIZE), Image.Resampling.LANCZOS)
    if resized.width > MODEL_SIZE:
        resized = resized.crop((0, 0, MODEL_SIZE, MODEL_SIZE))
    canvas = Image.new("RGB", (MODEL_SIZE, MODEL_SIZE), padding)
    canvas.paste(resized, (0, 0))
    return canvas, {
        "normalizedContentWidth": resized.width,
        "rightPadding": MODEL_SIZE - resized.width,
    }


def stable_sample_seed(global_seed: int, class_name: str, sample_index: int) -> int:
    digest = hashlib.sha256(f"{global_seed}:{class_name}:{sample_index}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def make_sample(
    item: dict,
    icons: dict[str, Image.Image],
    classes: list[dict],
    class_by_kind: dict[str, list[dict]],
    sample_index: int,
    global_seed: int,
) -> tuple[Image.Image, dict]:
    sample_seed = stable_sample_seed(global_seed, item["class"], sample_index)
    rng = random.Random(sample_seed)
    region = choose_region(item, rng)
    exact_user_reference = (
        sample_index == 0
        and item.get("sourceOverride", {}).get("type") == "user_confirmed_full_card"
    )
    if exact_user_reference:
        source = icons[item["class"]].convert("RGB")
        image = source.resize((MODEL_SIZE, MODEL_SIZE), Image.Resampling.LANCZOS)
        return image, {
            "classIndex": item["index"],
            "class": item["class"],
            "kind": item["kind"],
            "id": item["id"],
            "name": item["name"],
            "sampleIndex": sample_index,
            "sampleSeed": sample_seed,
            "region": region,
            "sourceIcon": item["sourceOverride"]["path"],
            "sourceType": item["sourceOverride"]["type"],
            "neighborClass": None,
            "nativeFullCardSize": [source.width, source.height],
            "nominalVisibleWidth": source.width,
            "nominalVisibleRatio": 1.0,
            "cropSize": [source.width, source.height],
            "cropJitter": {"x": 0, "y": 0, "width": 0},
            "targetUi": {"count": "original", "level": "original"},
            "neighborUi": None,
            "degradation": {
                "brightness": 1.0, "contrast": 1.0, "blurRadius": 0.0,
                "codec": "none", "quality": None,
            },
            "normalization": {"normalizedContentWidth": MODEL_SIZE, "rightPadding": 0},
        }
    native_size = MODEL_SIZE if exact_user_reference else choose_native_size(rng)
    visible_width = native_size if exact_user_reference else choose_visible_width(native_size, rng)

    target = render_card(item, icons[item["class"]], rng)
    target_ui = ({"count": "original", "level": "original"}
                 if item.get("sourceOverride", {}).get("type") == "user_confirmed_full_card"
                 else overlay_card_ui(target, rng))
    target = resize_card(target, native_size)

    neighbor_pool = classes if region == "castleArmy" else class_by_kind[item["kind"]]
    neighbor_item = rng.choice(neighbor_pool)
    neighbor = render_card(neighbor_item, icons[neighbor_item["class"]], rng)
    neighbor_ui = ({"count": "original", "level": "original"}
                   if neighbor_item.get("sourceOverride", {}).get("type") == "user_confirmed_full_card"
                   else overlay_card_ui(neighbor, rng))
    neighbor = resize_card(neighbor, native_size)

    pad_left = max(6, round(native_size * 0.08))
    pad_y = max(5, round(native_size * 0.06))
    background = PANEL_COLORS[region]
    row_width = pad_left + visible_width + native_size + pad_left
    row_height = native_size + pad_y * 2
    row = Image.new("RGB", (row_width, row_height), background)
    row.paste(target, (pad_left, pad_y))
    # The next card is composited after the target, matching actual right-side
    # overlap in a horizontal army row.
    row.paste(neighbor, (pad_left + visible_width, pad_y))
    if exact_user_reference:
        degradation = {
            "brightness": 1.0, "contrast": 1.0, "blurRadius": 0.0,
            "codec": "none", "quality": None,
        }
    else:
        row, degradation = degrade_row(row, rng)

    horizontal_jitter = 0 if exact_user_reference else rng.randint(-max(2, round(native_size * 0.035)), max(2, round(native_size * 0.055)))
    vertical_jitter = 0 if exact_user_reference else rng.randint(-max(1, round(native_size * 0.025)), max(1, round(native_size * 0.025)))
    width_jitter = 0 if exact_user_reference else rng.randint(-max(2, round(native_size * 0.04)), max(2, round(native_size * 0.06)))
    crop_left = max(0, pad_left + horizontal_jitter)
    crop_top = max(0, pad_y + vertical_jitter)
    crop_width = max(12, visible_width + width_jitter - horizontal_jitter)
    crop_right = min(row.width, crop_left + crop_width)
    crop_bottom = min(row.height, crop_top + native_size)
    crop = row.crop((crop_left, crop_top, crop_right, crop_bottom))
    normalized, normalization = normalize_crop(crop, background)

    record = {
        "classIndex": item["index"],
        "class": item["class"],
        "kind": item["kind"],
        "id": item["id"],
        "name": item["name"],
        "sampleIndex": sample_index,
        "sampleSeed": sample_seed,
        "region": region,
        "sourceIcon": item.get("sourceOverride", {}).get("path", item["icon"]),
        "sourceType": item.get("sourceOverride", {}).get("type", "catalog_icon"),
        "neighborClass": neighbor_item["class"],
        "nativeFullCardSize": [native_size, native_size],
        "nominalVisibleWidth": visible_width,
        "nominalVisibleRatio": round(visible_width / native_size, 4),
        "cropSize": [crop.width, crop.height],
        "cropJitter": {
            "x": horizontal_jitter,
            "y": vertical_jitter,
            "width": width_jitter,
        },
        "targetUi": target_ui,
        "neighborUi": neighbor_ui,
        "degradation": degradation,
        "normalization": normalization,
    }
    return normalized, record


def make_contact_sheets(output: Path, classes: list[dict], records: list[dict]) -> list[str]:
    preview_dir = output / "preview"
    preview_dir.mkdir(parents=True, exist_ok=True)
    records_by_class: dict[str, list[dict]] = {}
    for record in records:
        records_by_class.setdefault(record["class"], []).append(record)

    outputs: list[str] = []
    for kind in KIND_ORDER:
        kind_classes = [item for item in classes if item["kind"] == kind]
        columns = 7 if kind == "troop" else 6
        rows = math.ceil(len(kind_classes) / columns)
        cell_w, cell_h = 184, 205
        sheet = Image.new("RGB", (columns * cell_w, rows * cell_h), (31, 27, 25))
        draw = ImageDraw.Draw(sheet)
        for index, item in enumerate(kind_classes):
            candidates = records_by_class[item["class"]]
            record = candidates[min(2, len(candidates) - 1)]
            image = Image.open(output / record["path"]).convert("RGB")
            column, row = index % columns, index // columns
            x, y = column * cell_w + 12, row * cell_h + 31
            sheet.paste(image, (x, y))
            draw.text((column * cell_w + 8, row * cell_h + 7), item["class"], font=SMALL_FONT, fill=(244, 223, 196))
            draw.text((x, y + 163), record["region"], font=SMALL_FONT, fill=(185, 199, 206))
        path = preview_dir / f"classes-{kind}.jpg"
        sheet.save(path, "JPEG", quality=92, subsampling=2)
        outputs.append(path.relative_to(output).as_posix())

    focus_names = {
        "troop_017_lava_hound", "troop_057_rocket_balloon",
        "troop_053_yeti", "troop_007_healer",
        "spell_053_recall", "spell_011_haste",
        "spell_002_rage", "spell_120_totem",
    }
    focus_classes = [item for item in classes if item["class"] in focus_names]
    columns, examples = 6, 6
    cell_w, cell_h = 184, 205
    sheet = Image.new("RGB", (columns * cell_w, len(focus_classes) * cell_h), (31, 27, 25))
    draw = ImageDraw.Draw(sheet)
    for row, item in enumerate(focus_classes):
        candidates = records_by_class[item["class"]]
        selected = [candidates[round(index * (len(candidates) - 1) / (examples - 1))] for index in range(examples)]
        for column, record in enumerate(selected):
            image = Image.open(output / record["path"]).convert("RGB")
            x, y = column * cell_w + 12, row * cell_h + 31
            sheet.paste(image, (x, y))
            draw.text((column * cell_w + 8, row * cell_h + 7), item["class"], font=SMALL_FONT, fill=(244, 223, 196))
            draw.text(
                (x, y + 163),
                f'{record["cropSize"][0]}x{record["cropSize"][1]} -> {record["normalization"]["normalizedContentWidth"]}x160',
                font=SMALL_FONT, fill=(185, 199, 206),
            )
    focus_path = preview_dir / "confusable-class-variants.jpg"
    sheet.save(focus_path, "JPEG", quality=92, subsampling=2)
    outputs.append(focus_path.relative_to(output).as_posix())
    return outputs


def write_review_csv(output: Path, records: list[dict]) -> None:
    records_by_class: dict[str, list[dict]] = {}
    for record in records:
        records_by_class.setdefault(record["class"], []).append(record)
    with (output / "review.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=[
            "path", "expected_class", "kind", "id", "region",
            "approved", "correct_class", "notes",
        ])
        writer.writeheader()
        for class_name in sorted(records_by_class):
            candidates = records_by_class[class_name]
            for index in [0, len(candidates) // 3, len(candidates) * 2 // 3, len(candidates) - 1]:
                record = candidates[index]
                writer.writerow({
                    "path": record["path"],
                    "expected_class": record["class"],
                    "kind": record["kind"],
                    "id": record["id"],
                    "region": record["region"],
                    "approved": "",
                    "correct_class": "",
                    "notes": "",
                })


def review_records(records: list[dict]) -> list[dict]:
    records_by_class: dict[str, list[dict]] = {}
    for record in records:
        records_by_class.setdefault(record["class"], []).append(record)
    selected: list[dict] = []
    for class_name in sorted(records_by_class):
        candidates = records_by_class[class_name]
        for index in [0, len(candidates) // 3, len(candidates) * 2 // 3, len(candidates) - 1]:
            selected.append(candidates[index])
    return selected


def write_review_html(output: Path, records: list[dict]) -> None:
    selected = [{
        "path": record["path"],
        "class": record["class"],
        "kind": record["kind"],
        "id": record["id"],
        "name": record["name"],
        "region": record["region"],
        "native": record["nativeFullCardSize"],
        "crop": record["cropSize"],
        "contentWidth": record["normalization"]["normalizedContentWidth"],
    } for record in review_records(records)]
    payload = json.dumps(selected, ensure_ascii=False).replace("</", "<\\/")
    html = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>国服军队卡片数据集审核</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, "Microsoft YaHei", sans-serif; }
    body { margin: 0; background: #17191d; color: #eef2f5; }
    header { position: sticky; top: 0; z-index: 2; padding: 14px 20px; background: #20242acc; backdrop-filter: blur(10px); border-bottom: 1px solid #39414b; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    .help { color: #bcc5cf; font-size: 13px; margin-bottom: 10px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button, select { border: 1px solid #596573; border-radius: 7px; padding: 7px 10px; background: #303741; color: white; }
    button { cursor: pointer; }
    #progress { margin-left: auto; color: #b9c6d3; }
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 12px; padding: 16px; }
    article { background: #242930; border: 2px solid transparent; border-radius: 10px; padding: 10px; }
    article.approved { border-color: #48be78; }
    article.rejected { border-color: #ef6b73; }
    img { display: block; width: 160px; height: 160px; margin: auto; image-rendering: auto; background: #394047; }
    .name { margin-top: 8px; font-size: 12px; word-break: break-all; }
    .meta { color: #aeb8c2; font-size: 11px; line-height: 1.5; }
    .actions { display: flex; gap: 7px; margin-top: 8px; }
    .actions button { flex: 1; }
    .yes { background: #216b43; }
    .no { background: #7b3037; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <header>
    <h1>国服军队卡片数据集审核</h1>
    <div class="help">只判断图片是否像真实游戏卡片，以及裁窄后是否仍保持正常比例。类别文字用于核对标准图标，不需要判断识别结果。</div>
    <div class="toolbar">
      <select id="kind"><option value="all">全部类型</option><option value="troop">兵种</option><option value="spell">法术</option><option value="siege">攻城机器</option></select>
      <select id="status"><option value="all">全部状态</option><option value="pending">未审核</option><option value="approved">可接受</option><option value="rejected">需调整</option></select>
      <button id="export">导出审核结果 JSON</button>
      <button id="clear">清空本页结果</button>
      <span id="progress"></span>
    </div>
  </header>
  <main id="grid"></main>
  <script>
    const samples = __PAYLOAD__;
    const storageKey = 'army-card-classification-cn-v1-review';
    let decisions = JSON.parse(localStorage.getItem(storageKey) || '{}');
    const grid = document.querySelector('#grid');
    const kindFilter = document.querySelector('#kind');
    const statusFilter = document.querySelector('#status');
    const save = () => localStorage.setItem(storageKey, JSON.stringify(decisions));
    const statusOf = path => decisions[path] || 'pending';
    function render() {
      const kind = kindFilter.value;
      const status = statusFilter.value;
      const visible = samples.filter(sample => (kind === 'all' || sample.kind === kind) && (status === 'all' || statusOf(sample.path) === status));
      grid.replaceChildren(...visible.map(sample => {
        const article = document.createElement('article');
        article.className = statusOf(sample.path);
        article.innerHTML = `<img loading="lazy" src="${sample.path}" alt="${sample.class}"><div class="name">${sample.class}</div><div class="meta">${sample.region} · 原始 ${sample.native[0]}×${sample.native[1]} · 裁片 ${sample.crop[0]}×${sample.crop[1]} · 内容宽 ${sample.contentWidth}/160</div><div class="actions"><button class="yes">可接受</button><button class="no">需调整</button></div>`;
        article.querySelector('.yes').onclick = () => { decisions[sample.path] = 'approved'; save(); render(); };
        article.querySelector('.no').onclick = () => { decisions[sample.path] = 'rejected'; save(); render(); };
        return article;
      }));
      const approved = samples.filter(sample => statusOf(sample.path) === 'approved').length;
      const rejected = samples.filter(sample => statusOf(sample.path) === 'rejected').length;
      document.querySelector('#progress').textContent = `已审核 ${approved + rejected}/${samples.length} · 可接受 ${approved} · 需调整 ${rejected}`;
    }
    kindFilter.onchange = render;
    statusFilter.onchange = render;
    document.querySelector('#export').onclick = () => {
      const result = samples.map(sample => ({...sample, decision: statusOf(sample.path)}));
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'}));
      link.download = 'army-card-review-results.json';
      link.click();
      URL.revokeObjectURL(link.href);
    };
    document.querySelector('#clear').onclick = () => { if (confirm('确定清空本页保存的审核结果？')) { decisions = {}; save(); render(); } };
    render();
  </script>
</body>
</html>
""".replace("__PAYLOAD__", payload)
    (output / "review.html").write_text(html, encoding="utf-8")


def prepare_output(output: Path, force: bool) -> None:
    output = output.resolve()
    artifacts = (ROOT / "artifacts").resolve()
    if output == artifacts or artifacts not in output.parents:
        raise RuntimeError(f"output must be a child of {artifacts}")
    if output.exists():
        if not force:
            raise FileExistsError(f"output already exists; pass --force to replace it: {output}")
        shutil.rmtree(output)
    output.mkdir(parents=True)


def main() -> None:
    args = parse_args()
    if args.samples_per_class < 1:
        raise ValueError("--samples-per-class must be positive")
    output = args.output.resolve()
    prepare_output(output, args.force)
    classes = load_classes()
    icons = {item["class"]: load_icon(item) for item in classes}
    class_by_kind = {kind: [item for item in classes if item["kind"] == kind] for kind in KIND_ORDER}

    records: list[dict] = []
    manifest_jsonl = output / "samples.jsonl"
    with manifest_jsonl.open("w", encoding="utf-8") as manifest_handle:
        for item in classes:
            class_dir = output / "train" / item["class"]
            class_dir.mkdir(parents=True)
            for sample_index in range(args.samples_per_class):
                image, record = make_sample(
                    item, icons, classes, class_by_kind, sample_index, args.seed,
                )
                relative = Path("train") / item["class"] / f"{sample_index:04d}.png"
                image.save(output / relative, "PNG", optimize=True)
                record["path"] = relative.as_posix()
                records.append(record)
                manifest_handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    previews = make_contact_sheets(output, classes, records)
    write_review_csv(output, records)
    write_review_html(output, records)
    kind_counts = Counter(item["kind"] for item in classes)
    region_counts = Counter(record["region"] for record in records)
    summary = {
        "schemaVersion": 1,
        "dataset": "army-card-classification-cn-v1",
        "scope": "mainland China client, current game icon catalog",
        "closedSet": True,
        "invalidClass": False,
        "seed": args.seed,
        "modelInputSize": [MODEL_SIZE, MODEL_SIZE],
        "normalization": "scale by crop height, preserve aspect ratio, left align, right pad",
        "classCount": len(classes),
        "classCountsByKind": dict(kind_counts),
        "samplesPerClass": args.samples_per_class,
        "sampleCount": len(records),
        "regionCounts": dict(region_counts),
        "classes": classes,
        "sourceOverrides": SOURCE_OVERRIDES,
        "humanReview": {
            "status": "approved",
            "approvedClassCount": len(classes),
            "decisionDate": "2026-08-25",
            "note": "Ruin Witch, supplied Super Wall Breaker and Super Yeti cards, and all nine siege machines use user-confirmed mainland-China full-card sources; remaining super troops use the game-accurate gold/red card treatment.",
        },
        "sampleManifest": "samples.jsonl",
        "reviewFile": "review.csv",
        "visualReviewFile": "review.html",
        "previews": previews,
        "warnings": [
            "Synthetic images are training data only and must not be used as validation or test truth.",
            "The first version uses approximate card frames and numeric overlays; compare previews with real mainland-China panel crops.",
            "All samples are closed-set labels. No invalid-card class or rejection threshold is included.",
        ],
    }
    (output / "manifest.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    (output / "README.md").write_text(
        "# 国服军队卡片分类数据集 v1\n\n"
        f"- 76 类：{kind_counts['troop']} 个兵种、{kind_counts['spell']} 个法术、{kind_counts['siege']} 个攻城机器。\n"
        f"- 第一版每类 {args.samples_per_class} 张，共 {len(records)} 张 160×160 PNG。\n"
        "- 覆盖主兵种、主法术、攻城机器和援军区域。\n"
        "- 完整卡片分辨率与裁剪后可见宽度独立生成。\n"
        "- 窄卡片保持比例、左对齐并在右侧填充，不做横向拉伸。\n"
        "- 所有样本均属于合法类别，不包含无效类别。\n"
        "- 合成图只进入训练集；真实验证集和测试集必须按原始截图/视频分组。\n\n"
        "## 人工审核\n\n"
        "1. 直接打开 `review.html` 进行图形化审核，结果保存在浏览器本地。\n"
        "2. 审核后点击“导出审核结果 JSON”发回结果文件。\n"
        "3. `review.csv` 仅作为表格备用，不要求使用。\n"
        "4. `samples.jsonl` 保存每张图的完整可复现参数。\n\n"
        "## 训练边界\n\n"
        "本目录当前只有合成训练集，不应从 `train/` 随机拆出验证集。"
        "验证集应由人工确认的真实截图卡片组成。\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "output": str(output),
        "classes": len(classes),
        "samples": len(records),
        "previews": previews,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
