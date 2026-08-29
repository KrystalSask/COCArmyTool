"""Generate the closed-set equipment-card classification dataset.

The first version is intentionally synthetic-first.  It renders the current
42 equipment icons as game-like cards, keeps common/epic card backgrounds,
and models the two currently expected image errors: lower resolution and a
candidate crop shifted inside the equipment slot.  It deliberately does not
apply rotation, mirroring, geometric stretching, or invalid/unknown samples.

Existing confirmed equipment crops are copied into ``real/`` as a separate
reference pool.  They are not mixed into the synthetic training split.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import random
import re
import shutil
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
GAME_DATA = ROOT / "src" / "data" / "gameData.generated.json"
ICON_ROOT = ROOT / "public" / "game-icons" / "equipment"
TEMPLATE_FILE = ROOT / "src" / "data" / "recognitionTemplates.generated.json"
DEFAULT_OUTPUT = ROOT / "artifacts" / "equipment-classification-v1"

MODEL_SIZE = 96
DEFAULT_SEED = 20260827
DEFAULT_SAMPLES_PER_CLASS = 100
PREPROCESSING_VERSION = "equipment-card-96-letterbox-v1"

PANEL_BACKGROUND = (48, 51, 61)

# These are deliberately close to the user-confirmed in-game appearance:
# ordinary equipment uses a blue card and epic equipment uses a purple card.
CARD_STYLES = {
    "Common": {
        "top": (89, 193, 255),
        "bottom": (16, 88, 190),
        "edge": (74, 159, 236),
        "highlight": (189, 239, 255),
    },
    "Epic": {
        "top": (247, 105, 238),
        "bottom": (111, 27, 177),
        "edge": (238, 112, 244),
        "highlight": (255, 188, 255),
    },
}
MAX_LEVEL_BY_RARITY = {"Common": 18, "Epic": 27}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--samples-per-class", type=int, default=DEFAULT_SAMPLES_PER_CLASS)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--preview-id", type=int, help="generate only a preview for one equipment ID")
    parser.add_argument("--preview-count", type=int, default=12)
    parser.add_argument("--force", action="store_true", help="replace an existing output directory")
    return parser.parse_args()


def slugify(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return value or "unnamed"


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/msyhbd.ttc"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


LABEL_FONT = font(16)
SMALL_FONT = font(12)
TINY_FONT = font(10)


def load_classes() -> list[dict]:
    data = json.loads(GAME_DATA.read_text(encoding="utf-8"))
    hero_ids = {hero["name"]: hero["id"] for hero in data["heroes"]}
    classes: list[dict] = []
    for item in sorted(data["equipment"], key=lambda value: value["id"]):
        icon = ICON_ROOT / f'{item["id"]}.png'
        if not icon.exists():
            raise FileNotFoundError(f"missing equipment icon: {icon}")
        with Image.open(icon) as image:
            image.load()
        rarity = item.get("rarity") or "Common"
        if rarity not in CARD_STYLES:
            raise ValueError(f'unsupported equipment rarity for {item["id"]}: {rarity}')
        owner_hero_id = hero_ids.get(item["hero"])
        if owner_hero_id is None:
            raise ValueError(f'unknown owner hero for equipment {item["id"]}: {item["hero"]}')
        classes.append({
            "index": len(classes),
            "id": item["id"],
            "equipmentId": item["id"],
            "class": f'equipment_{item["id"]}',
            "name": item["name"],
            "displayName": item["name"],
            "heroName": item["hero"],
            "ownerHeroId": owner_hero_id,
            "rarity": rarity,
            "townHall": item.get("townHall"),
            "icon": icon.relative_to(ROOT).as_posix(),
        })
    if len(classes) != 42:
        raise RuntimeError(f"expected 42 equipment classes, got {len(classes)}")
    if len({item["id"] for item in classes}) != len(classes):
        raise RuntimeError("equipment IDs must be unique")
    return classes


def load_icon(item: dict) -> Image.Image:
    with Image.open(ROOT / item["icon"]) as image:
        return image.convert("RGBA")


def stable_seed(global_seed: int, key: str, index: int) -> int:
    digest = hashlib.sha256(f"{global_seed}:{key}:{index}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def gradient_card(size: int, style: dict) -> Image.Image:
    card = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = card.load()
    top, bottom = style["top"], style["bottom"]
    for y in range(size):
        ratio = y / max(1, size - 1)
        color = tuple(round(top[channel] * (1 - ratio) + bottom[channel] * ratio) for channel in range(3)) + (255,)
        for x in range(size):
            pixels[x, y] = color
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=max(8, round(size * .16)), fill=255)
    card.putalpha(mask)
    return card


def draw_pencil(draw: ImageDraw.ImageDraw, size: int) -> None:
    """Draw a small edit pencil similar to the screenshot overlay."""
    scale = size / 96
    cx, cy = round(size - 14 * scale), round(size - 15 * scale)
    length, width = 17 * scale, 6 * scale
    points = [
        (cx - length * .52, cy + width * .52),
        (cx + length * .36, cy - width * .36),
        (cx + length * .52, cy - width * .08),
        (cx - length * .36, cy + width * .80),
    ]
    draw.line(points[:2], fill=(28, 26, 34), width=max(2, round(width + 3 * scale)), joint="curve")
    draw.line(points[:2], fill=(251, 251, 251), width=max(1, round(width)), joint="curve")
    draw.polygon(points[1:], fill=(246, 246, 246), outline=(28, 26, 34))


def draw_level(draw: ImageDraw.ImageDraw, size: int, level: int, max_level: int) -> None:
    scale = size / 96
    left = round(7 * scale)
    bottom = size - round(7 * scale)
    radius = max(3, round(5 * scale))
    width = max(21, round(27 * scale))
    height = max(17, round(20 * scale))
    draw.rounded_rectangle(
        (left, bottom - height, left + width, bottom),
        radius=radius,
        fill=(243, 197, 47) if level == max_level else (38, 40, 49),
        outline=(255, 245, 164) if level == max_level else (255, 255, 255),
        width=max(1, round(1.2 * scale)),
    )
    text = str(level)
    bbox = draw.textbbox((0, 0), text, font=SMALL_FONT)
    tx = left + (width - (bbox[2] - bbox[0])) // 2 - bbox[0]
    ty = bottom - height + (height - (bbox[3] - bbox[1])) // 2 - bbox[1]
    draw.text((tx, ty), text, font=SMALL_FONT, fill=(255, 255, 255))


def render_card(item: dict, icon: Image.Image, size: int, rng: random.Random, level: int) -> Image.Image:
    style = CARD_STYLES[item["rarity"]]
    card = gradient_card(size, style)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    radius = max(8, round(size * .16))
    draw.rounded_rectangle((1, 1, size - 2, size - 2), radius=radius, outline=style["edge"] + (255,), width=max(2, round(size * .032)))
    draw.rounded_rectangle((round(size * .07), round(size * .07), round(size * .93), round(size * .93)), radius=max(5, round(size * .11)), outline=style["highlight"] + (150,), width=max(1, round(size * .018)))
    card.alpha_composite(layer)

    inner_size = round(size * .78)
    art = ImageOps.contain(icon, (inner_size, inner_size), Image.Resampling.LANCZOS)
    art_x = (size - art.width) // 2 + rng.randint(-1, 1)
    art_y = (size - art.height) // 2 - round(size * .01) + rng.randint(-1, 1)
    card.alpha_composite(art, (art_x, art_y))

    draw = ImageDraw.Draw(card)
    draw_level(draw, size, level, MAX_LEVEL_BY_RARITY[item["rarity"]])
    draw_pencil(draw, size)
    return card.convert("RGB")


def resize_preserving_quality(image: Image.Image, size: int, factor: float) -> Image.Image:
    if factor >= .999:
        return image
    low_size = max(18, round(size * factor))
    low = image.resize((low_size, low_size), Image.Resampling.LANCZOS)
    return low.resize((size, size), Image.Resampling.BILINEAR)


def jpeg_roundtrip(image: Image.Image, rng: random.Random) -> tuple[Image.Image, dict]:
    if rng.random() >= .62:
        return image, {"codec": "none", "quality": None}
    quality = rng.randint(42, 88)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=quality, subsampling=2, optimize=True)
    buffer.seek(0)
    with Image.open(buffer) as decoded:
        return decoded.convert("RGB"), {"codec": "jpeg", "quality": quality}


def make_synthetic_sample(item: dict, icons: dict[str, Image.Image], classes: list[dict], index: int, seed: int) -> tuple[Image.Image, dict]:
    rng = random.Random(stable_seed(seed, item["class"], index))
    card_size = rng.randint(86, 104)
    margin = 18
    scene_size = card_size + MODEL_SIZE + margin * 2
    scene = Image.new("RGB", (scene_size, scene_size), PANEL_BACKGROUND)

    target_x = margin + 12
    target_y = margin + 12
    max_level = MAX_LEVEL_BY_RARITY[item["rarity"]]
    # Keep explicit max-level and low-level examples in every class.  This
    # guarantees that the gold max-level badge is represented in the training
    # data instead of relying on a random draw to hit the maximum.
    target_level = max_level if index == 0 else 1 if index == 1 else rng.randint(1, max_level)
    target = render_card(item, icons[item["class"]], card_size, rng, target_level)
    scene.paste(target, (target_x, target_y))

    neighbor = rng.choice(classes)
    neighbor_level = rng.randint(1, MAX_LEVEL_BY_RARITY[neighbor["rarity"]])
    neighbor_card = render_card(neighbor, icons[neighbor["class"]], card_size, rng, neighbor_level)
    # Keep the neighboring card next to, rather than on top of, the target.
    # It can enter the candidate crop from the right when the crop is shifted.
    scene.paste(neighbor_card, (target_x + card_size + rng.randint(2, 8), target_y))

    crop_dx = rng.randint(-12, 12)
    crop_dy = rng.randint(-10, 10)
    crop_left = target_x + crop_dx
    crop_top = target_y + crop_dy
    crop = scene.crop((crop_left, crop_top, crop_left + MODEL_SIZE, crop_top + MODEL_SIZE))

    resolution_factor = rng.choice([1.0, 1.0, 1.0, .875, .75, .625, .5])
    crop = resize_preserving_quality(crop, MODEL_SIZE, resolution_factor)
    crop, codec = jpeg_roundtrip(crop, rng)

    record = {
        "split": "train",
        "sourceType": "synthetic",
        "splitGroup": f"synthetic:{item['class']}:{index}",
        "classIndex": item["index"],
        "class": item["class"],
        "equipmentId": item["id"],
        "displayName": item["name"],
        "heroName": item["heroName"],
        "ownerHeroId": item["ownerHeroId"],
        "rarity": item["rarity"],
        "sampleIndex": index,
        "sampleSeed": stable_seed(seed, item["class"], index),
        "level": target_level,
        "isMaxLevel": target_level == max_level,
        "maxLevel": max_level,
        "cardSize": [card_size, card_size],
        "cropOffsetPx": [crop_dx, crop_dy],
        "neighborClass": neighbor["class"],
        "resolutionFactor": resolution_factor,
        "compression": codec,
        "preprocessingVersion": PREPROCESSING_VERSION,
    }
    return crop, record


def real_source_path(sample_id: str) -> tuple[Path, Path]:
    batch, sample = sample_id.split("/", 1)
    panel = ROOT / "recognition-samples" / batch / "reports" / "preprocessed" / "panels" / f"{sample}.png"
    screenshot = ROOT / "recognition-samples" / batch / "images" / f"{sample}.png"
    if not screenshot.exists():
        for extension in (".jpg", ".jpeg", ".webp"):
            candidate = screenshot.with_suffix(extension)
            if candidate.exists():
                screenshot = candidate
                break
    return panel, screenshot


def assign_real_split(sample_id: str) -> str:
    """Assign a whole source screenshot to validation or test."""
    bucket = int(hashlib.sha256(f"real:{sample_id}".encode()).hexdigest()[:8], 16) % 5
    return "val" if bucket < 3 else "test"


def normalize_real_crop(crop: Image.Image) -> Image.Image:
    crop = crop.convert("RGB")
    edge = crop.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    normalized = Image.new("RGB", (MODEL_SIZE, MODEL_SIZE), edge)
    contained = ImageOps.contain(crop, (MODEL_SIZE, MODEL_SIZE), Image.Resampling.LANCZOS)
    normalized.paste(contained, ((MODEL_SIZE - contained.width) // 2, (MODEL_SIZE - contained.height) // 2))
    return normalized


def import_real_crops(output: Path, classes: list[dict]) -> list[dict]:
    payload = json.loads(TEMPLATE_FILE.read_text(encoding="utf-8"))
    class_by_id = {item["id"]: item for item in classes}
    counters: Counter[int] = Counter()
    records: list[dict] = []
    for split in ("val", "test"):
        for item in classes:
            (output / split / item["class"]).mkdir(parents=True, exist_ok=True)
    for observation in payload.get("equipmentObservations", []):
        item = class_by_id.get(observation.get("id"))
        if item is None:
            continue
        panel, screenshot = real_source_path(observation["sampleId"])
        if not panel.exists():
            raise FileNotFoundError(f"missing preprocessed panel for {observation['sampleId']}: {panel}")
        x, y, width, height = observation["rect"]
        with Image.open(panel) as source:
            if x < 0 or y < 0 or x + width > source.width or y + height > source.height:
                raise ValueError(f"equipment crop out of bounds: {observation['sampleId']} {observation['rect']} {source.size}")
            crop = normalize_real_crop(source.crop((x, y, x + width, y + height)))
        ordinal = counters[item["id"]]
        counters[item["id"]] += 1
        filename = f"{observation['sampleId'].replace('/', '_')}_{ordinal:03d}.png"
        real_relative = Path("real") / item["class"] / filename
        real_target = output / real_relative
        real_target.parent.mkdir(parents=True, exist_ok=True)
        crop.save(real_target, "PNG", optimize=True)
        split = assign_real_split(observation["sampleId"])
        eval_relative = Path(split) / item["class"] / filename
        eval_target = output / eval_relative
        shutil.copy2(real_target, eval_target)
        records.append({
            "split": split,
            "sourceType": "real_confirmed_crop",
            "splitGroup": observation["sampleId"],
            "classIndex": item["index"],
            "class": item["class"],
            "equipmentId": item["id"],
            "displayName": item["name"],
            "heroName": item["heroName"],
            "ownerHeroId": item["ownerHeroId"],
            "rarity": item["rarity"],
            "path": eval_relative.as_posix(),
            "referencePath": real_relative.as_posix(),
            "sourceScreenshot": screenshot.relative_to(ROOT).as_posix() if screenshot.exists() else None,
            "sourcePanel": panel.relative_to(ROOT).as_posix(),
            "sourceRectPx": observation["rect"],
            "device": observation.get("device"),
            "layout": observation.get("layout"),
            "preprocessingVersion": PREPROCESSING_VERSION,
        })
    return records


def make_preview(output: Path, classes: list[dict], records: list[dict]) -> str:
    preview_dir = output / "preview"
    preview_dir.mkdir(parents=True, exist_ok=True)
    synthetic = [record for record in records if record.get("sourceType") == "synthetic"]
    by_class = {record["class"]: record for record in synthetic if record["sampleIndex"] == 0}
    columns, cell_w, cell_h = 6, 220, 170
    rows = math.ceil(len(classes) / columns)
    sheet = Image.new("RGB", (columns * cell_w, rows * cell_h), (242, 242, 246))
    draw = ImageDraw.Draw(sheet)
    for index, item in enumerate(classes):
        column, row = index % columns, index // columns
        x, y = column * cell_w, row * cell_h
        record = by_class[item["class"]]
        image = Image.open(output / record["path"]).convert("RGB")
        display = ImageOps.contain(image, (122, 122), Image.Resampling.NEAREST)
        card_x = x + (cell_w - display.width) // 2
        sheet.paste(display, (card_x, y + 7))
        draw.text((x + 8, y + 134), f"ID {item['id']}  {item['name']}", font=LABEL_FONT, fill=(20, 20, 20))
        draw.text((x + 8, y + 153), f"{item['rarity']} · {item['heroName']}", font=SMALL_FONT, fill=(96, 44, 150) if item["rarity"] == "Epic" else (24, 92, 160))
    path = preview_dir / "overview.jpg"
    sheet.save(path, "JPEG", quality=93, subsampling=2)
    return path.relative_to(output).as_posix()


def make_class_preview(output: Path, item: dict, icons: dict[str, Image.Image], classes: list[dict], count: int, seed: int) -> str:
    preview_dir = output / "preview"
    preview_dir.mkdir(parents=True, exist_ok=True)
    columns, cell_w, cell_h = 4, 250, 185
    rows = math.ceil(count / columns)
    sheet = Image.new("RGB", (columns * cell_w, rows * cell_h), (242, 242, 246))
    draw = ImageDraw.Draw(sheet)
    for index in range(count):
        image, record = make_synthetic_sample(item, icons, classes, index, seed)
        column, row = index % columns, index // columns
        x, y = column * cell_w, row * cell_h
        display = ImageOps.contain(image, (150, 150), Image.Resampling.NEAREST)
        sheet.paste(display, (x + (cell_w - display.width) // 2, y + 6))
        draw.text((x + 8, y + 159), f"样本 {index:02d} · 偏移 {record['cropOffsetPx']}", font=SMALL_FONT, fill=(20, 20, 20))
        compression = record["compression"]
        compression_text = compression["codec"] if compression["codec"] == "none" else f"{compression['codec']} q{compression['quality']}"
        draw.text((x + 8, y + 174), f"低分辨率 {record['resolutionFactor']} · {compression_text}", font=TINY_FONT, fill=(96, 44, 150))
    path = preview_dir / f"equipment-{item['id']}-samples.jpg"
    sheet.save(path, "JPEG", quality=93, subsampling=2)
    return path.relative_to(output).as_posix()


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
    if args.preview_id is not None:
        if args.preview_count < 1:
            raise ValueError("--preview-count must be positive")
        item = next((candidate for candidate in classes if candidate["id"] == args.preview_id), None)
        if item is None:
            raise ValueError(f"unknown equipment ID: {args.preview_id}")
        preview = make_class_preview(output, item, icons, classes, args.preview_count, args.seed)
        (output / "manifest.json").write_text(json.dumps({
            "dataset": "equipment-classification-preview",
            "equipment": item,
            "sampleCount": args.preview_count,
            "preview": preview,
            "seed": args.seed,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(output), "equipmentId": item["id"], "preview": str(output / preview)}, ensure_ascii=False, indent=2))
        return
    records: list[dict] = []
    synthetic_count = Counter()
    manifest_path = output / "samples.jsonl"
    with manifest_path.open("w", encoding="utf-8") as handle:
        for item in classes:
            class_dir = output / "train" / item["class"]
            class_dir.mkdir(parents=True, exist_ok=True)
            for sample_index in range(args.samples_per_class):
                image, record = make_synthetic_sample(item, icons, classes, sample_index, args.seed)
                relative = Path("train") / item["class"] / f"{sample_index:04d}.png"
                image.save(output / relative, "PNG", optimize=True)
                record["path"] = relative.as_posix()
                records.append(record)
                synthetic_count[item["id"]] += 1
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")

        real_records = import_real_crops(output, classes)
        records.extend(real_records)
        for record in real_records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    preview = make_preview(output, classes, records)
    (output / "classes.json").write_text(json.dumps(classes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    class_counts = Counter(item["rarity"] for item in classes)
    real_counts = Counter(record["equipmentId"] for record in records if record["sourceType"] == "real_confirmed_crop")
    summary = {
        "schemaVersion": 1,
        "dataset": "equipment-classification-v1",
        "scope": "current 42 equipment classes from the project catalog",
        "closedSet": True,
        "includesEmptySlot": False,
        "includesNegativeSamples": False,
        "seed": args.seed,
        "modelInputSize": [MODEL_SIZE, MODEL_SIZE],
        "preprocessingVersion": PREPROCESSING_VERSION,
        "normalization": "fixed 96x96 crop; no rotation, mirror, or geometric stretch",
        "classCount": len(classes),
        "classCountsByRarity": dict(class_counts),
        "samplesPerClass": args.samples_per_class,
        "syntheticTrainCount": sum(synthetic_count.values()),
        "realReferenceCropCount": len(real_records),
        "realReferenceClasses": len(real_counts),
        "realReferenceCountsByEquipmentId": {str(key): value for key, value in sorted(real_counts.items())},
        "trainSplit": "synthetic only",
        "realSplit": "real crops are assigned by whole source screenshot to val/test; no source screenshot crosses splits",
        "classesFile": "classes.json",
        "sampleManifest": "samples.jsonl",
        "preview": preview,
        "augmentation": {
            "resolutionFactors": [1.0, 0.875, 0.75, 0.625, 0.5],
            "jpegQualityRange": [42, 88],
            "cropOffsetPx": {"x": [-12, 12], "y": [-10, 10]},
            "rotation": False,
            "mirror": False,
            "geometricStretch": False,
        },
        "warnings": [
            "Synthetic samples are training data; real validation/test metrics are based on the repository reference crops.",
            "The real reference pool contains 40 of 42 classes; equipment IDs 16 and 60 currently have no real crop in the repository.",
            "No empty-slot, invalid-crop, or unknown-equipment negative samples are included by design.",
        ],
    }
    (output / "manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "README.md").write_text(
        "# 装备分类数据集 v1\n\n"
        f"- 当前装备目录的 {len(classes)} 类：普通 {class_counts['Common']} 类，史诗 {class_counts['Epic']} 类。\n"
        f"- 合成训练集：每类 {args.samples_per_class} 张，共 {sum(synthetic_count.values())} 张 `96×96` PNG。\n"
        f"- 真实参考裁片：{len(real_records)} 张，单独放在 `real/`，不混入训练集。\n"
        "- 合成卡片背景按稀有度区分：普通为蓝色，史诗为紫色。\n"
        "- 增强覆盖分辨率降低、JPEG 压缩和候选框横向/纵向偏移。\n"
        "- 不使用旋转、镜像、几何拉伸、空槽或负样本。\n\n"
        "## 文件\n\n"
        "- `train/`：合成训练图片，目录名为稳定类别 ID，例如 `equipment_52/`。\n"
        "- `real/`：从现有完整截图中提取的真实参考裁片，保留 `splitGroup` 和原始坐标信息。\n"
        "- `classes.json`：42 类 ID、名称、所属英雄和稀有度映射。\n"
        "- `samples.jsonl`：每个样本的生成参数和来源信息。\n"
        "- `preview/overview.jpg`：全部类别的简单预览图。\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "output": str(output),
        "classCount": len(classes),
        "syntheticTrainCount": sum(synthetic_count.values()),
        "realReferenceCropCount": len(real_records),
        "preview": str(output / preview),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
