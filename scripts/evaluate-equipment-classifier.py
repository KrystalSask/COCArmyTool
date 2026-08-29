"""Evaluate an equipment classifier on synthetic and real reference splits."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "artifacts" / "equipment-classification-v1"
DEFAULT_MODEL = ROOT / "artifacts" / "equipment-classification-training-runs" / "equipment-card-v1" / "weights" / "best.pt"
DEFAULT_OUTPUT = ROOT / "artifacts" / "equipment-classification-evaluation-v1"


def font(size: int):
    for candidate in (Path("C:/Windows/Fonts/arial.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def top_predictions(result, limit: int = 3) -> tuple[list[int], list[float]]:
    if result.probs is None:
        return [], []
    values = result.probs.data.detach().float().cpu()
    indices = values.argsort(descending=True)[:limit].tolist()
    return indices, [float(values[index]) for index in indices]


def predict_records(model: YOLO, rows: list[dict], data_root: Path, classes: list[dict], device: str) -> list[dict]:
    # ImageFolder/Ultralytics sorts directory names lexicographically, while
    # classes.json is ordered by numeric equipment ID. Convert model indices
    # back through the stable class name before computing metrics.
    class_index_by_name = {item["class"]: item["index"] for item in classes}
    model_index_to_class_index = {
        model_index: class_index_by_name[class_name]
        for model_index, class_name in model.names.items()
        if class_name in class_index_by_name
    }
    predictions: list[dict] = []
    batch_size = 256
    for start in range(0, len(rows), batch_size):
        batch = rows[start:start + batch_size]
        paths = [str(data_root / row["path"]) for row in batch]
        results = model.predict(paths, imgsz=96, device=device, verbose=False)
        if len(results) != len(batch):
            raise RuntimeError(f"prediction count mismatch: expected {len(batch)}, got {len(results)}")
        for row, result in zip(batch, results):
            indices, scores = top_predictions(result, 3)
            mapped_indices = [model_index_to_class_index[index] for index in indices if index in model_index_to_class_index]
            predictions.append({
                "path": row["path"],
                "class": row["class"],
                "classIndex": row["classIndex"],
                "equipmentId": row["equipmentId"],
                "predictedClassIndex": mapped_indices[0] if mapped_indices else None,
                "top3ClassIndices": mapped_indices,
                "top3Scores": scores,
            })
    return predictions


def confusion_image(matrix: np.ndarray, classes: list[dict], path: Path) -> None:
    size = len(classes)
    cell = 24
    margin_left, margin_top = 70, 70
    image = Image.new("RGB", (margin_left + size * cell + 10, margin_top + size * cell + 10), "white")
    draw = ImageDraw.Draw(image)
    maximum = max(1, int(matrix.max()))
    for row in range(size):
        for column in range(size):
            value = int(matrix[row, column])
            intensity = round(255 - 210 * value / maximum)
            draw.rectangle((margin_left + column * cell, margin_top + row * cell, margin_left + (column + 1) * cell - 1, margin_top + (row + 1) * cell - 1), fill=(intensity, intensity, 255))
    label_font = font(9)
    for index, item in enumerate(classes):
        label = str(item["equipmentId"])
        draw.text((margin_left + index * cell + 3, margin_top - 14), label, font=label_font, fill="black")
        draw.text((margin_left - 24, margin_top + index * cell + 6), label, font=label_font, fill="black")
    draw.text((margin_left, 24), "预测列 →", font=font(13), fill="black")
    draw.text((8, margin_top - 28), "真实行 ↓", font=font(13), fill="black")
    image.save(path, "PNG", optimize=True)


def evaluate_split(name: str, rows: list[dict], model: YOLO, data_root: Path, output: Path, classes: list[dict], device: str) -> dict:
    predictions = predict_records(model, rows, data_root, classes, device)
    class_count = len(classes)
    matrix = np.zeros((class_count, class_count), dtype=np.int64)
    per_class_total = Counter()
    per_class_correct = Counter()
    top1_scores: list[float] = []
    margins: list[float] = []
    top1 = top3 = 0
    for prediction in predictions:
        target = prediction["classIndex"]
        predicted = prediction["predictedClassIndex"]
        if predicted is not None:
            matrix[target, predicted] += 1
        per_class_total[target] += 1
        if predicted == target:
            top1 += 1
            per_class_correct[target] += 1
        if target in prediction["top3ClassIndices"]:
            top3 += 1
        if prediction["top3Scores"]:
            top1_scores.append(prediction["top3Scores"][0])
            margins.append(prediction["top3Scores"][0] - (prediction["top3Scores"][1] if len(prediction["top3Scores"]) > 1 else 0.0))
    recalls = []
    for item in classes:
        index = item["index"]
        total = per_class_total[index]
        recalls.append({
            "equipmentId": item["equipmentId"],
            "displayName": item["displayName"],
            "count": total,
            "correct": per_class_correct[index],
            "recall": per_class_correct[index] / total if total else None,
        })
    confusion_rows = []
    for true_index, predicted_index in zip(*np.where(matrix > 0)):
        if true_index != predicted_index:
            confusion_rows.append({
                "trueEquipmentId": classes[true_index]["equipmentId"],
                "predictedEquipmentId": classes[predicted_index]["equipmentId"],
                "count": int(matrix[true_index, predicted_index]),
            })
    confusion_rows.sort(key=lambda row: row["count"], reverse=True)
    matrix_path = output / f"confusion-matrix-{name}.png"
    confusion_image(matrix, classes, matrix_path)
    result = {
        "split": name,
        "sampleCount": len(rows),
        "top1": top1 / len(rows) if rows else None,
        "top3": top3 / len(rows) if rows else None,
        "meanTop1Score": sum(top1_scores) / len(top1_scores) if top1_scores else None,
        "meanTop1Top2Margin": sum(margins) / len(margins) if margins else None,
        "minRecall": min((row["recall"] for row in recalls if row["recall"] is not None), default=None),
        "missingClasses": [row["equipmentId"] for row in recalls if row["count"] == 0],
        "perClassRecall": recalls,
        "mainConfusions": confusion_rows[:20],
        "confusionMatrix": matrix_path.name,
        "predictionFile": f"predictions-{name}.jsonl",
    }
    (output / result["predictionFile"]).write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in predictions), encoding="utf-8")
    return result


def write_report(summary: dict, classes: list[dict], path: Path) -> None:
    names = {item["equipmentId"]: item["displayName"] for item in classes}
    lines = [
        "# 装备分类模型 v1 评估报告",
        "",
        f"- 模型：`{summary['model']}`",
        f"- 类别数：{summary['classCount']}",
        "- 合成训练集指标仅用于检查训练管线；真实 val/test 才用于观察截图泛化效果。",
        "",
        "## 指标",
        "",
        "| split | 样本数 | Top-1 | Top-3 | 最低已覆盖类别召回率 | 未覆盖装备 ID |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for result in summary["splits"]:
        missing = ", ".join(str(item) for item in result["missingClasses"]) or "无"
        top1 = "-" if result["top1"] is None else f"{result['top1']:.2%}"
        top3 = "-" if result["top3"] is None else f"{result['top3']:.2%}"
        minimum = "-" if result["minRecall"] is None else f"{result['minRecall']:.2%}"
        lines.append(f"| {result['split']} | {result['sampleCount']} | {top1} | {top3} | {minimum} | {missing} |")
    lines.extend(["", "## 主要混淆", ""])
    for result in summary["splits"]:
        lines.append(f"### {result['split']}")
        confusions = result["mainConfusions"][:10]
        if not confusions:
            lines.append("无非对角混淆。")
        else:
            for confusion in confusions:
                true_id = confusion["trueEquipmentId"]
                predicted_id = confusion["predictedEquipmentId"]
                lines.append(f"- {true_id} {names.get(true_id, '')} → {predicted_id} {names.get(predicted_id, '')}：{confusion['count']} 次")
        lines.append("")
    lines.extend([
        "## 限制",
        "",
        "- 当前真实参考裁片覆盖 40/42 类；装备 ID 16 和 60 没有真实裁片。",
        "- 真实 val/test 按完整原始截图分组，未发生 source screenshot 跨 split 泄漏。",
        "- 未加入空槽、unknown、误框或其他负样本，因此本报告不包含拒识指标。",
    ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--device", default="0")
    args = parser.parse_args()
    data = args.data.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    classes = json.loads((data / "classes.json").read_text(encoding="utf-8"))
    rows = [json.loads(line) for line in (data / "samples.jsonl").open(encoding="utf-8") if line.strip()]
    split_rows = {
        "synthetic-train": [row for row in rows if row.get("split") == "train"],
        "real-val": [row for row in rows if row.get("split") == "val"],
        "real-test": [row for row in rows if row.get("split") == "test"],
    }
    model = YOLO(str(args.model.resolve()))
    results = [evaluate_split(name, split, model, data, output, classes, args.device) for name, split in split_rows.items()]
    summary = {
        "model": str(args.model.resolve()),
        "data": str(data),
        "classCount": len(classes),
        "note": "synthetic-train is a training-set diagnostic; real-val and real-test are the meaningful reference metrics",
        "splits": results,
    }
    (output / "metrics.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_report(summary, classes, output / "REPORT.md")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
