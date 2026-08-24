#!/usr/bin/env python3
"""Extract label-guided, screenshot-native card features from normalized panels."""

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


SIEGE_IDS = {51, 52, 62, 75, 87, 91, 92, 135, 188}
REGIONS = {
    "mainTroops": (.432, .235, .55, .16),
    "mainSpells": (.432, .516, .34, .15),
    "mainSiege": (.79, .516, .19, .15),
    "castleArmy": (.432, .803, .55, .15),
}
SECTION_PATTERN = re.compile(r"([hidus])([^hidus]+)")
ENTRY_PATTERN = re.compile(r"(\d+)x(\d+)")
HERO_PATTERN = re.compile(r"^(\d+)(?:m(\d+))?(?:p(\d+))?(?:e(\d+)(?:_(\d+))?)?$")


def parse_entries(value: str) -> list[dict[str, int]]:
    return [{"count": int(count), "id": int(item_id)} for count, item_id in ENTRY_PATTERN.findall(value)]


def expected_cards(link: str) -> dict[str, list[dict[str, int | str]]]:
    payload = parse_qs(urlparse(link).query)["army"][0]
    sections = dict(SECTION_PATTERN.findall(payload))
    troops = parse_entries(sections.get("u", ""))
    main_troops = [{**entry, "kind": "troop"} for entry in troops if entry["id"] not in SIEGE_IDS]
    main_siege = [{**entry, "kind": "siege"} for entry in troops if entry["id"] in SIEGE_IDS]
    main_spells = [{**entry, "kind": "spell"} for entry in parse_entries(sections.get("s", ""))]
    castle_spells = [{**entry, "kind": "spell"} for entry in parse_entries(sections.get("d", ""))]
    castle_units = [{**entry, "kind": "siege" if entry["id"] in SIEGE_IDS else "troop"} for entry in parse_entries(sections.get("i", ""))]
    return {"mainTroops": main_troops, "mainSpells": main_spells, "mainSiege": main_siege, "castleArmy": castle_spells + castle_units}


def expected_heroes(link: str, equipment_overrides: dict[str, list[int | None]] | None = None) -> list[dict]:
    payload = parse_qs(urlparse(link).query)["army"][0]
    sections = dict(SECTION_PATTERN.findall(payload))
    result = []
    for value in sections.get("h", "").split("-"):
        match = HERO_PATTERN.match(value)
        if not match:
            continue
        hero_id = int(match.group(1))
        equipment_ids = [int(item_id) for item_id in match.groups()[3:] if item_id]
        if equipment_overrides and str(hero_id) in equipment_overrides:
            equipment_ids = equipment_overrides[str(hero_id)]
        result.append({
            "heroId": hero_id,
            "mode": int(match.group(2) or 0) if hero_id == 2 else None,
            "petId": int(match.group(3)) if match.group(3) else None,
            "equipmentIds": equipment_ids,
        })
    return result


def components(mask: np.ndarray) -> list[dict[str, int]]:
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=4)
    return [
        {"x": int(x), "y": int(y), "width": int(width), "height": int(height), "area": int(area)}
        for x, y, width, height, area in stats[1:count]
    ]


def detect_slots(image: np.ndarray, region: tuple[float, float, float, float]) -> list[tuple[int, int, int, int]]:
    image_height, image_width = image.shape[:2]
    x, y, width, height = region
    left, top = round(x * image_width), round(y * image_height)
    region_width, full_height = round(width * image_width), round(height * image_height)
    badge_height = max(1, round(full_height * .30))
    crop = image[top : top + badge_height, left : left + region_width]
    maximum = crop.max(axis=2)
    minimum = crop.min(axis=2)
    mask = ((maximum >= 195) & ((maximum - minimum) <= 95)).astype(np.uint8) * 255
    scale = max(.35, region_width / (width * 2160))
    glyphs = [
        component for component in components(mask)
        if 4 * scale <= component["width"] <= 25 * scale
        and 11 * scale <= component["height"] <= 29 * scale
        and component["area"] >= 35 * scale * scale
    ]
    candidates = []
    for component in glyphs:
        looks_like_x = (
            13 * scale <= component["width"] <= 22 * scale
            and 13 * scale <= component["height"] <= 25 * scale
            and component["area"] >= 125 * scale * scale
        )
        has_digit = any(
            other["x"] > component["x"] + 12 * scale
            and other["x"] < component["x"] + 45 * scale
            and abs(other["y"] - component["y"]) < 10 * scale
            for other in glyphs
        )
        if looks_like_x and has_digit:
            candidates.append(component)
    candidates.sort(key=lambda component: component["x"])
    badges = []
    for candidate in candidates:
        if not badges or candidate["x"] - badges[-1]["x"] >= 55 * scale:
            badges.append(candidate)
    if not badges:
        return []
    gaps = sorted(badges[index + 1]["x"] - badge["x"] for index, badge in enumerate(badges[:-1]))
    typical_width = gaps[len(gaps) // 2] if gaps else min(170 * scale, region_width)
    result = []
    for index, badge in enumerate(badges):
        card_left = max(0, round(badge["x"] - 10 * scale))
        next_left = max(card_left + 1, round(badges[index + 1]["x"] - 10 * scale)) if index + 1 < len(badges) else min(region_width, round(card_left + typical_width))
        result.append((left + card_left, top, next_left - card_left, full_height))
    return result


def normalized_art(image: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    x, y, width, height = rect
    art = cv2.resize(image[y : y + height, x : x + width], (64, 64), interpolation=cv2.INTER_AREA)
    height, width = art.shape[:2]
    neutral = tuple(int(value) for value in np.median(art.reshape(-1, 3), axis=0))
    art[: round(height * .27), : round(width * .42)] = neutral
    art[round(height * .70) :, : round(width * .38)] = neutral
    return art


def normalized_visual(image: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    x, y, width, height = rect
    return cv2.resize(image[y : y + height, x : x + width], (64, 64), interpolation=cv2.INTER_AREA)


def detect_hero_subcards(image: np.ndarray) -> tuple[list[tuple[int, int, int, int]], list[tuple[int, int, int, int]]]:
    height, width = image.shape[:2]
    edges = cv2.Canny(image, 70, 160)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for contour in contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        if x < width * .46 and height * .84 < y < height * .91 and 76 < box_width < 102 and 78 < box_height < 103:
            boxes.append((x, y, box_width, box_height))
    boxes.sort(key=lambda box: box[2] * box[3], reverse=True)
    deduplicated = []
    for box in boxes:
        center = (box[0] + box[2] / 2, box[1] + box[3] / 2)
        if not any(abs(center[0] - (other[0] + other[2] / 2)) < 8 and abs(center[1] - (other[1] + other[3] / 2)) < 8 for other in deduplicated):
            deduplicated.append(box)
    equipment = sorted(deduplicated, key=lambda box: box[0])[:8]
    pets = []
    if len(equipment) == 8:
        for index in range(0, 8, 2):
            left, right = equipment[index], equipment[index + 1]
            pet_left = left[0]
            pet_right = right[0] + right[2]
            pet_top = max(0, round((left[1] + right[1]) / 2 - 112))
            pets.append((pet_left, pet_top, pet_right - pet_left, 100))
    return equipment, pets


def is_spell_frame(image: np.ndarray, rect: tuple[int, int, int, int]) -> bool:
    x, y, width, height = rect
    card = image[y : y + height, x : x + width]
    hsv = cv2.cvtColor(card, cv2.COLOR_BGR2HSV)
    strip = hsv[2:6, round(width * .40) : round(width * .90)]
    hue = float(np.median(strip[:, :, 0]))
    return hue >= 132


def align_castle_labels(image: np.ndarray, slots: list[tuple[int, int, int, int]], labels: list[dict]) -> list[dict] | None:
    spells = iter(label for label in labels if label["kind"] == "spell")
    units = iter(label for label in labels if label["kind"] != "spell")
    aligned = []
    try:
        for slot in slots:
            aligned.append(next(spells) if is_spell_frame(image, slot) else next(units))
    except StopIteration:
        return None
    return aligned


def difference_hash(image: np.ndarray) -> str:
    gray = cv2.cvtColor(cv2.resize(image, (9, 8), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    bits = gray[:, :-1] > gray[:, 1:]
    value = sum((1 << index) for index, enabled in enumerate(bits.flatten()) if enabled)
    return f"{value:016x}"


def color_histogram(image: np.ndarray) -> list[int]:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    histogram = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256]).flatten()
    return [int(value) for value in histogram]


def normalized_glyph(mask: np.ndarray, component: dict) -> str:
    glyph = mask[
        component["y"] : component["y"] + component["height"],
        component["x"] : component["x"] + component["width"],
    ]
    normalized = cv2.resize(glyph, (12, 20), interpolation=cv2.INTER_NEAREST) > 0
    value = sum((1 << index) for index, enabled in enumerate(normalized.flatten()) if enabled)
    return f"{value:060x}"


def extract_count_glyphs(image: np.ndarray, rect: tuple[int, int, int, int], count: int) -> list[dict] | None:
    x, y, width, height = rect
    crop = image[y : y + round(height * .30), x : x + width]
    maximum = crop.max(axis=2)
    minimum = crop.min(axis=2)
    mask = ((maximum >= 195) & ((maximum - minimum) <= 95)).astype(np.uint8) * 255
    glyphs = [
        component for component in components(mask)
        if 4 <= component["width"] <= 25 and 11 <= component["height"] <= 29 and component["area"] >= 35
    ]
    x_candidates = [
        component for component in glyphs
        if 13 <= component["width"] <= 22 and 13 <= component["height"] <= 25 and component["area"] >= 125
        and any(other["x"] > component["x"] + 12 and other["x"] < component["x"] + 45 and abs(other["y"] - component["y"]) < 10 for other in glyphs)
    ]
    if not x_candidates:
        return None
    x_glyph = min(x_candidates, key=lambda component: component["x"])
    digits = sorted([
        component for component in glyphs
        if component["x"] > x_glyph["x"] + 12
        and component["x"] < x_glyph["x"] + 85
        and abs(component["y"] - x_glyph["y"]) < 10
    ], key=lambda component: component["x"])
    text = str(count)
    if len(digits) < len(text):
        return None
    digits = digits[: len(text)]
    return [{"digit": digit, "bitmap": normalized_glyph(mask, component)} for digit, component in zip(text, digits)]


def feature_distance(left: dict, right: dict) -> float:
    hash_distance = (int(left["dhash"], 16) ^ int(right["dhash"], 16)).bit_count() / 64
    first = np.asarray(left["hsvHistogram"], dtype=np.float32)
    second = np.asarray(right["hsvHistogram"], dtype=np.float32)
    first /= max(float(first.sum()), 1.0)
    second /= max(float(second.sum()), 1.0)
    chi_square = .5 * float(np.sum((first - second) ** 2 / (first + second + 1e-9)))
    return .65 * hash_distance + .35 * min(1, chi_square)


def leave_one_sample_out(observations: list[dict]) -> dict:
    eligible = top1 = top3 = 0
    per_region = defaultdict(lambda: {"eligible": 0, "top1": 0, "top3": 0})
    for query in observations:
        key = f'{query["kind"]}:{query["id"]}'
        candidates = [
            candidate for candidate in observations
            if candidate["sampleId"] != query["sampleId"]
            and (query["region"] == "castleArmy" or candidate["kind"] == query["kind"])
        ]
        if not any(f'{candidate["kind"]}:{candidate["id"]}' == key for candidate in candidates):
            continue
        scores = {}
        for candidate in candidates:
            candidate_key = f'{candidate["kind"]}:{candidate["id"]}'
            scores[candidate_key] = min(scores.get(candidate_key, 99), feature_distance(query, candidate))
        ranking = sorted(scores, key=scores.get)
        eligible += 1
        per_region[query["region"]]["eligible"] += 1
        if ranking and ranking[0] == key:
            top1 += 1
            per_region[query["region"]]["top1"] += 1
        if key in ranking[:3]:
            top3 += 1
            per_region[query["region"]]["top3"] += 1
    def summarize(values: dict) -> dict:
        count = values["eligible"]
        return {**values, "top1Rate": round(values["top1"] / count, 4) if count else 0, "top3Rate": round(values["top3"] / count, 4) if count else 0}
    return {
        **summarize({"eligible": eligible, "top1": top1, "top3": top3}),
        "ineligibleSingleObservation": len(observations) - eligible,
        "byRegion": {region: summarize(values) for region, values in sorted(per_region.items())},
        "method": "leave-one-sample-out; nearest observation; 65% dHash + 35% HSV chi-square",
    }


def generic_feature_evaluation(observations: list[dict], key_field: str) -> dict:
    eligible = top1 = top3 = 0
    for query in observations:
        candidates = [candidate for candidate in observations if candidate["sampleId"] != query["sampleId"]]
        if not any(candidate[key_field] == query[key_field] for candidate in candidates):
            continue
        scores = {}
        for candidate in candidates:
            key = candidate[key_field]
            scores[key] = min(scores.get(key, 99), feature_distance(query, candidate))
        ranking = sorted(scores, key=scores.get)
        eligible += 1
        top1 += bool(ranking and ranking[0] == query[key_field])
        top3 += query[key_field] in ranking[:3]
    return {
        "eligible": eligible,
        "top1": top1,
        "top3": top3,
        "top1Rate": round(top1 / eligible, 4) if eligible else 0,
        "top3Rate": round(top3 / eligible, 4) if eligible else 0,
        "ineligibleSingleObservation": len(observations) - eligible,
    }


def digit_evaluation(observations: list[dict]) -> dict:
    eligible = correct = 0
    for query in observations:
        candidates = [candidate for candidate in observations if candidate["sampleId"] != query["sampleId"]]
        if not any(candidate["digit"] == query["digit"] for candidate in candidates):
            continue
        scores = {}
        query_value = int(query["bitmap"], 16)
        for candidate in candidates:
            distance = (query_value ^ int(candidate["bitmap"], 16)).bit_count()
            scores[candidate["digit"]] = min(scores.get(candidate["digit"], 999), distance)
        ranking = sorted(scores, key=scores.get)
        eligible += 1
        correct += bool(ranking and ranking[0] == query["digit"])
    return {"eligible": eligible, "correct": correct, "accuracy": round(correct / eligible, 4) if eligible else 0, "ineligibleSingleObservation": len(observations) - eligible}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", default="recognition-samples/batch-01-dev")
    parser.add_argument("--output", default="src/data/recognitionTemplates.generated.json")
    args = parser.parse_args()
    root = Path(args.batch)
    panel_dir = root / "reports" / "preprocessed" / "panels"
    rows = list(csv.DictReader((root / "labels.txt").open(encoding="utf-8"), delimiter="\t"))
    correction_path = root / "actual-equipment.json"
    equipment_corrections = json.loads(correction_path.read_text(encoding="utf-8")).get("samples", {}) if correction_path.exists() else {}
    observations = []
    digit_observations = []
    digit_failures = []
    equipment_observations = []
    pet_observations = []
    mode_observations = []
    hero_subcard_failures = []
    mismatches = []
    for row in rows:
        sample_id = row["id"]
        image = cv2.imread(str(panel_dir / f"{sample_id}.png"), cv2.IMREAD_COLOR)
        if image is None:
            raise FileNotFoundError(f"Missing normalized panel {sample_id}.png; run samples:preprocess first")
        expected = expected_cards(row["link"])
        for region_name, region in REGIONS.items():
            slots = detect_slots(image, region)
            labels = expected[region_name]
            if region_name == "castleArmy" and len(slots) == len(labels):
                labels = align_castle_labels(image, slots, labels)
                if labels is None:
                    mismatches.append({"sample": sample_id, "region": region_name, "detected": len(slots), "expected": len(expected[region_name]), "reason": "spell-frame-count"})
                    continue
            if len(slots) != len(labels):
                mismatches.append({"sample": sample_id, "region": region_name, "detected": len(slots), "expected": len(labels)})
                continue
            for index, (rect, label) in enumerate(zip(slots, labels)):
                art = normalized_art(image, rect)
                count_glyphs = extract_count_glyphs(image, rect, int(label["count"]))
                if count_glyphs is None:
                    digit_failures.append({"sample": sample_id, "region": region_name, "index": index, "count": label["count"]})
                else:
                    digit_observations.extend({**glyph, "sampleId": sample_id} for glyph in count_glyphs)
                observations.append({
                    "sampleId": sample_id,
                    "device": row["device"],
                    "layout": row["layout"],
                    "region": region_name,
                    "index": index,
                    "kind": label["kind"],
                    "id": label["id"],
                    "count": label["count"],
                    "rect": [round(rect[0] / image.shape[1], 6), round(rect[1] / image.shape[0], 6), round(rect[2] / image.shape[1], 6), round(rect[3] / image.shape[0], 6)],
                    "dhash": difference_hash(art),
                    "hsvHistogram": color_histogram(art),
                })
        heroes = expected_heroes(row["link"], equipment_corrections.get(sample_id))
        equipment_slots, pet_slots = detect_hero_subcards(image)
        if len(heroes) != 4 or len(equipment_slots) != 8 or len(pet_slots) != 4:
            hero_subcard_failures.append({"sample": sample_id, "heroes": len(heroes), "equipmentSlots": len(equipment_slots), "petSlots": len(pet_slots)})
        else:
            for hero_index, hero in enumerate(heroes):
                for equipment_index, equipment_id in enumerate(hero["equipmentIds"]):
                    if equipment_id is None:
                        continue
                    rect = equipment_slots[hero_index * 2 + equipment_index]
                    visual = normalized_visual(image, rect)
                    equipment_observations.append({"sampleId": sample_id, "device": row["device"], "layout": row["layout"], "heroId": hero["heroId"], "id": equipment_id, "rect": rect, "dhash": difference_hash(visual), "hsvHistogram": color_histogram(visual)})
                if hero["petId"] is not None:
                    rect = pet_slots[hero_index]
                    visual = normalized_visual(image, rect)
                    pet_observations.append({"sampleId": sample_id, "device": row["device"], "layout": row["layout"], "heroId": hero["heroId"], "id": hero["petId"], "rect": rect, "dhash": difference_hash(visual), "hsvHistogram": color_histogram(visual)})
                if hero["heroId"] == 2:
                    column_left = equipment_slots[hero_index * 2][0]
                    column_right = equipment_slots[hero_index * 2 + 1][0] + equipment_slots[hero_index * 2 + 1][2]
                    rect = (column_right - 62, round(image.shape[0] * .235), 52, 48)
                    visual = normalized_visual(image, rect)
                    mode_observations.append({"sampleId": sample_id, "device": row["device"], "layout": row["layout"], "value": hero["mode"], "rect": rect, "dhash": difference_hash(visual), "hsvHistogram": color_histogram(visual)})
    coverage = Counter(f'{item["kind"]}:{item["id"]}' for item in observations)
    payload = {
        "schemaVersion": 1,
        "sourceBatch": root.name,
        "actualEquipmentCorrections": equipment_corrections,
        "normalization": {"size": [64, 64], "maskedAreas": ["quantity-top-left", "level-bottom-left"]},
        "observations": observations,
        "digitObservations": digit_observations,
        "digitFailures": digit_failures,
        "equipmentObservations": equipment_observations,
        "petObservations": pet_observations,
        "modeObservations": mode_observations,
        "heroSubcardFailures": hero_subcard_failures,
        "componentEvaluation": {
            "digits": digit_evaluation(digit_observations),
            "equipment": generic_feature_evaluation(equipment_observations, "id"),
            "pets": generic_feature_evaluation(pet_observations, "id"),
            "wardenMode": generic_feature_evaluation(mode_observations, "value"),
        },
        "coverage": dict(sorted(coverage.items())),
        "mismatches": mismatches,
        "evaluation": leave_one_sample_out(observations),
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Extracted {len(observations)} card observations covering {len(coverage)} unique items")
    print(f"Region mismatches: {len(mismatches)}")
    return 1 if mismatches else 0


if __name__ == "__main__":
    raise SystemExit(main())
