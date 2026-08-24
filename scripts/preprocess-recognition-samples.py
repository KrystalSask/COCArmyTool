"""Generate local, reproducible panel crops for screenshot-recognition development."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


NORMALIZED_SIZE = (2160, 1120)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("batch", nargs="?", default="recognition-samples/batch-01-dev")
    parser.add_argument("--metadata", default="recognition-samples/batch-01-dev/metadata.json")
    return parser.parse_args()


def edge_score_x(gray: np.ndarray, x: int, top: int, bottom: int) -> float:
    left = gray[top:bottom, max(0, x - 1)].astype(np.float32)
    right = gray[top:bottom, min(gray.shape[1] - 1, x + 1)].astype(np.float32)
    return float(np.mean(np.abs(right - left)))


def edge_score_y(gray: np.ndarray, y: int, left: int, right: int) -> float:
    top = gray[max(0, y - 1), left:right].astype(np.float32)
    bottom = gray[min(gray.shape[0] - 1, y + 1), left:right].astype(np.float32)
    return float(np.mean(np.abs(bottom - top)))


def best_near(expected: int, limit: int, scorer, radius: int = 10) -> tuple[int, float]:
    candidates = range(max(1, expected - radius), min(limit - 1, expected + radius + 1))
    scored = [(value, scorer(value)) for value in candidates]
    return max(scored, key=lambda item: item[1])


def refine_panel(image: np.ndarray, reference: dict) -> tuple[dict, dict]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    left0, top0, right0, bottom0 = (reference[key] for key in ("left", "top", "right", "bottom"))
    left, left_score = best_near(left0, gray.shape[1], lambda x: edge_score_x(gray, x, top0, bottom0))
    right, right_score = best_near(right0, gray.shape[1], lambda x: edge_score_x(gray, x, top0, bottom0))
    top, top_score = best_near(top0, gray.shape[0], lambda y: edge_score_y(gray, y, left, right))
    bottom, bottom_score = best_near(bottom0, gray.shape[0], lambda y: edge_score_y(gray, y, left, right))
    if right - left < image.shape[1] * 0.7 or bottom - top < image.shape[0] * 0.5:
        raise ValueError("面板边缘检测结果不合理")
    return (
        {"left": left, "top": top, "right": right, "bottom": bottom},
        {"left": left_score, "top": top_score, "right": right_score, "bottom": bottom_score},
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    batch = Path(args.batch).resolve()
    metadata = json.loads(Path(args.metadata).resolve().read_text(encoding="utf-8"))
    profiles = {profile["device"]: profile for profile in metadata["profiles"]}
    reports = batch / "reports" / "preprocessed"
    panels = reports / "panels"
    panels.mkdir(parents=True, exist_ok=True)

    with (batch / "labels.txt").open(encoding="utf-8-sig", newline="") as stream:
        labels = list(csv.DictReader(stream, delimiter="\t"))

    records = []
    thumbnails = []
    for label in labels:
        sample_id = label["id"]
        matches = [path for path in (batch / "images").glob(f"{sample_id}.*") if path.suffix.lower() in {".png", ".jpg", ".jpeg"}]
        if len(matches) != 1:
            raise ValueError(f"样本 {sample_id} 应有且仅有一张图片")
        source = matches[0]
        image = cv2.imread(str(source), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"无法读取 {source}")
        profile = profiles.get(label["device"])
        if not profile:
            raise ValueError(f"设备 {label['device']} 没有采集配置")
        height, width = image.shape[:2]
        if (width, height) != (profile["width"], profile["height"]):
            raise ValueError(f"样本 {sample_id} 分辨率 {width}x{height} 与设备配置不一致")

        panel, edge_scores = refine_panel(image, profile["panel"])
        crop = image[panel["top"]:panel["bottom"], panel["left"]:panel["right"]]
        normalized = cv2.resize(crop, NORMALIZED_SIZE, interpolation=cv2.INTER_AREA)
        target = panels / f"{sample_id}.png"
        if not cv2.imwrite(str(target), normalized):
            raise ValueError(f"无法写入 {target}")

        thumb = cv2.resize(normalized, (540, 280), interpolation=cv2.INTER_AREA)
        thumbnails.append((sample_id, label["device"], cv2.cvtColor(thumb, cv2.COLOR_BGR2RGB)))
        records.append({
            "id": sample_id,
            "device": label["device"],
            "layout": label["layout"],
            "sourceFile": source.name,
            "sourceSha256": sha256(source),
            "sourceSize": {"width": width, "height": height},
            "referencePanel": profile["panel"],
            "detectedPanel": panel,
            "edgeScores": {key: round(value, 4) for key, value in edge_scores.items()},
            "normalizedSize": {"width": NORMALIZED_SIZE[0], "height": NORMALIZED_SIZE[1]},
            "panelFile": str(target.relative_to(batch)).replace("\\", "/"),
        })

    manifest = {
        "batch": batch.name,
        "sampleCount": len(records),
        "algorithm": "profile-window + grayscale edge refinement v1",
        "rawFilesModified": False,
        "normalizedSize": {"width": NORMALIZED_SIZE[0], "height": NORMALIZED_SIZE[1]},
        "samples": records,
    }
    (reports / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    columns = 2
    cell_width, cell_height = 560, 320
    rows = (len(thumbnails) + columns - 1) // columns
    sheet = Image.new("RGB", (cell_width * columns, cell_height * rows), "#171311")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, (sample_id, device, thumb) in enumerate(thumbnails):
        x = (index % columns) * cell_width + 10
        y = (index // columns) * cell_height + 28
        sheet.paste(Image.fromarray(thumb), (x, y))
        draw.text((x, 7 + (index // columns) * cell_height), f"{sample_id}  {device}", fill="white", font=font)
    sheet.save(reports / "contact-sheet.jpg", quality=88, optimize=True)
    print(f"已预处理 {len(records)} 个样本；原图未修改")
    print(f"清单：{reports / 'manifest.json'}")


if __name__ == "__main__":
    main()
