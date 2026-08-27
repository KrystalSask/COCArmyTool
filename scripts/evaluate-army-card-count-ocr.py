#!/usr/bin/env python3
"""Evaluate an off-the-shelf OCR engine on real Clash of Clans count badges."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np
from rapidocr import RapidOCR


SECTION_PATTERN = re.compile(r"([hidus])([^hidus]+)")
CLASS_PATTERN = re.compile(r"^(troop|spell|siege)_(\d+)_")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("artifacts/army-card-classification-cn-v1/validation-manifest.jsonl"),
    )
    parser.add_argument("--samples", type=Path, default=Path("recognition-samples"))
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("artifacts/army-card-classification-cn-v1"),
    )
    parser.add_argument("--input", choices=("source", "normalized"), default="source")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("artifacts/army-card-count-ocr-baseline"),
    )
    return parser.parse_args()


def load_links(samples: Path) -> dict[str, str]:
    links: dict[str, str] = {}
    for labels_path in samples.glob("*/labels.txt"):
        batch = labels_path.parent.name
        with labels_path.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle, delimiter="\t"):
                links[f"{batch}:{row['id']}"] = row["link"]
    return links


def parse_army_link(link: str) -> dict[str, dict[int, int]]:
    payload = parse_qs(urlparse(link).query)["army"][0]
    result: dict[str, dict[int, int]] = {key: {} for key in "idus"}
    for section, value in SECTION_PATTERN.findall(payload):
        if section == "h":
            continue
        result[section] = {
            int(item_id): int(count)
            for count, item_id in (entry.split("x", 1) for entry in value.split("-") if entry)
        }
    return result


def expected_count(entry: dict, link: str) -> int | None:
    class_match = CLASS_PATTERN.match(entry["class"])
    if not class_match:
        return None
    kind, item_id_text = class_match.groups()
    item_id = int(item_id_text)
    if entry["region"] == "castleArmy":
        section = "d" if kind == "spell" else "i"
    elif entry["region"] == "mainSpells":
        section = "s"
    else:
        section = "u"
    return parse_army_link(link).get(section, {}).get(item_id)


def source_image(samples: Path, entry: dict) -> Path | None:
    image_dir = samples / entry["batch"] / "images"
    matches = sorted(image_dir.glob(f"{entry['sampleId']}.*"))
    return matches[0] if matches else None


def crop_badge(image: np.ndarray, rect: list[float]) -> np.ndarray:
    image_height, image_width = image.shape[:2]
    x = round(rect[0] * image_width)
    y = round(rect[1] * image_height)
    card_height = max(1, round(rect[3] * image_height))
    # The fixed ROI includes `x` plus up to two digits but excludes the level badge.
    width = max(12, round(card_height * 0.38))
    height = max(10, round(card_height * 0.25))
    return image[max(0, y):min(image_height, y + height), max(0, x):min(image_width, x + width)]


def crop_normalized_badge(image: np.ndarray) -> np.ndarray:
    # Locate the white `xN` glyph line first. Some narrow detected cards retain
    # a strip of the previous card, so the badge is not always at pixel zero.
    scale = image.shape[0] / 160
    top = image[:max(1, round(image.shape[0] * 0.30))]
    maximum = top.max(axis=2)
    minimum = top.min(axis=2)
    mask = ((maximum >= 195) & ((maximum - minimum) <= 95)).astype(np.uint8)
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(mask, connectivity=4)
    components = []
    for index in range(1, count):
        x, y, width, height, area = (int(value) for value in stats[index])
        if 4 * scale <= width <= 25 * scale and 11 * scale <= height <= 29 * scale and area >= 35 * scale * scale:
            components.append((x, y, width, height, area))
    x_glyphs = [component for component in components
                if 13 * scale <= component[2] <= 22 * scale
                and 13 * scale <= component[3] <= 25 * scale
                and component[4] >= 125 * scale * scale
                and any(component[0] + 12 * scale < other[0] < component[0] + 45 * scale
                        and abs(other[1] - component[1]) < 10 * scale for other in components)]
    if x_glyphs:
        marker = min(x_glyphs, key=lambda item: item[0])
        digits = sorted((component for component in components
                         if marker[0] + 12 * scale < component[0] < marker[0] + 65 * scale
                         and abs(component[1] - marker[1]) < 10 * scale), key=lambda item: item[0])
        selected = []
        for component in digits:
            if not selected or component[0] - (selected[-1][0] + selected[-1][2]) <= 6 * scale:
                selected.append(component)
            else:
                break
        right = (selected[-1][0] + selected[-1][2]) if selected else marker[0] + 48 * scale
        left = max(0, round(marker[0] - 3 * scale))
        y = max(0, round(min([marker[1], *(item[1] for item in selected)]) - 3 * scale))
        bottom = min(top.shape[0], round(max([marker[1] + marker[3], *(item[1] + item[3] for item in selected)]) + 4 * scale))
        return top[y:bottom, left:min(top.shape[1], round(right + 4 * scale))]
    height = max(1, round(image.shape[0] * 0.25))
    width = max(1, round(image.shape[0] * 0.30))
    return image[:height, :width]


def variants(crop: np.ndarray) -> dict[str, np.ndarray]:
    if crop.size == 0:
        return {}
    target_height = 128
    target_width = max(48, round(crop.shape[1] * target_height / crop.shape[0]))
    resized = cv2.resize(crop, (target_width, target_height), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    contrast = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(4, 4)).apply(gray)
    return {
        "raw": resized,
        "gray": cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR),
        "contrast": cv2.cvtColor(contrast, cv2.COLOR_GRAY2BGR),
    }


def number_from_text(text: str) -> int | None:
    digits = "".join(re.findall(r"\d", text))
    if not 1 <= len(digits) <= 2:
        return None
    value = int(digits)
    return value if 1 <= value <= 99 else None


def recognize(engine: RapidOCR, crop: np.ndarray) -> tuple[int | None, float, list[dict]]:
    observations: list[dict] = []
    for variant, image in variants(crop).items():
        output = engine(image, use_det=False, use_cls=False, use_rec=True)
        texts = list(output.txts or ())
        scores = list(output.scores or ())
        text = texts[0] if texts else ""
        score = float(scores[0]) if scores else 0.0
        observations.append({
            "variant": variant,
            "text": text,
            "value": number_from_text(text),
            "score": score,
        })
    usable = [item for item in observations if item["value"] is not None]
    if not usable:
        return None, 0.0, observations
    agreement = Counter(item["value"] for item in usable)
    selected = max(usable, key=lambda item: (agreement[item["value"]], item["score"]))
    return selected["value"], selected["score"], observations


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    links = load_links(args.samples)
    entries = [json.loads(line) for line in args.manifest.read_text(encoding="utf-8").splitlines() if line]
    engine = RapidOCR()
    rows: list[dict] = []
    skipped = Counter()

    for index, entry in enumerate(entries, start=1):
        link = links.get(entry["sourceGroup"])
        path = source_image(args.samples, entry)
        expected = expected_count(entry, link) if link else None
        if not link or path is None or expected is None:
            skipped["missing_truth_or_source"] += 1
            continue
        input_path = path if args.input == "source" else args.dataset / entry["validationPath"]
        image = cv2.imread(str(input_path), cv2.IMREAD_COLOR)
        if image is None:
            skipped["unreadable_source"] += 1
            continue
        crop = crop_badge(image, entry["rect"]) if args.input == "source" else crop_normalized_badge(image)
        value, score, observations = recognize(engine, crop)
        rows.append({
            "sourceGroup": entry["sourceGroup"],
            "region": entry["region"],
            "class": entry["class"],
            "validationPath": entry["validationPath"],
            "expected": expected,
            "predicted": value,
            "correct": value == expected,
            "score": round(score, 6),
            "observations": observations,
        })
        if index % 50 == 0:
            print(f"processed {index}/{len(entries)}", flush=True)

    correct = sum(row["correct"] for row in rows)
    by_region = {}
    for region, region_rows in defaultdict(list, {
        region: [row for row in rows if row["region"] == region]
        for region in sorted({row["region"] for row in rows})
    }).items():
        region_correct = sum(row["correct"] for row in region_rows)
        by_region[region] = {
            "correct": region_correct,
            "total": len(region_rows),
            "accuracy": region_correct / len(region_rows) if region_rows else 0,
        }
    summary = {
        "engine": "RapidOCR 3.9.2 / PP-OCRv6 recognition model",
        "trainedForProject": False,
        "capacityConstraintsUsed": False,
        "input": args.input,
        "evaluated": len(rows),
        "correct": correct,
        "accuracy": correct / len(rows) if rows else 0,
        "unreadable": sum(row["predicted"] is None for row in rows),
        "byRegion": by_region,
        "expectedDistribution": dict(sorted(Counter(str(row["expected"]) for row in rows).items(), key=lambda item: int(item[0]))),
        "skipped": dict(skipped),
    }
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output / "predictions.jsonl").write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
