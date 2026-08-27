"""Evaluate raw and region-constrained Top-1/Top-3 on real card crops."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import torch
from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = ROOT / "artifacts" / "army-card-classification-cn-v1"
DEFAULT_OUTPUT = ROOT / "artifacts" / "army-card-evaluation-v1"
REGION_PREFIX = {"mainTroops": "troop_", "mainSpells": "spell_", "mainSiege": "siege_"}


def summarize(rows: list[dict], top1_key: str, top3_key: str) -> dict:
    count = len(rows)
    top1 = sum(row[top1_key] == row["actual"] for row in rows)
    top3 = sum(row["actual"] in row[top3_key] for row in rows)
    return {
        "count": count, "top1": top1, "top3": top3,
        "top1Rate": round(top1 / count, 6) if count else 0,
        "top3Rate": round(top3 / count, 6) if count else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--imgsz", type=int, default=160)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--device", default="0")
    args = parser.parse_args()

    dataset, output = args.dataset.resolve(), args.output.resolve()
    manifest_path = dataset / "validation-manifest.jsonl"
    if not manifest_path.exists():
        raise FileNotFoundError(f"missing reviewed validation manifest: {manifest_path}")
    records = [json.loads(line) for line in manifest_path.read_text(encoding="utf-8").splitlines() if line]
    paths = [str(dataset / row["validationPath"]) for row in records]
    # Exported ONNX classifiers do not always expose enough metadata for
    # Ultralytics to infer the task; force classification for parity testing.
    model = YOLO(str(args.model.resolve()), task="classify")
    names = model.names
    if isinstance(names, dict):
        ordered_names = [names[index] for index in range(len(names))]
    else:
        ordered_names = list(names)
    if args.model.suffix.lower() == ".onnx":
        # The deployment export intentionally has a fixed batch of one. A list
        # source is stacked by Ultralytics regardless of `batch`, so run each
        # validation crop independently for an apples-to-apples parity check.
        results = [
            model.predict(path, imgsz=args.imgsz, batch=1, device=args.device, verbose=False)[0]
            for path in paths
        ]
    else:
        results = model.predict(
            paths, imgsz=args.imgsz, batch=args.batch, device=args.device, verbose=False,
        )
    if len(results) != len(records):
        raise RuntimeError(f"prediction count mismatch: {len(results)} != {len(records)}")

    evaluated = []
    for record, result in zip(records, results):
        probabilities = result.probs.data.detach().cpu()
        raw_indices = torch.topk(probabilities, k=min(3, len(ordered_names))).indices.tolist()
        raw_top3 = [ordered_names[index] for index in raw_indices]
        prefix = REGION_PREFIX.get(record["region"])
        allowed = [index for index, name in enumerate(ordered_names) if prefix is None or name.startswith(prefix)]
        constrained = probabilities[allowed]
        constrained_indices = torch.topk(constrained, k=min(3, len(allowed))).indices.tolist()
        constrained_top3 = [ordered_names[allowed[index]] for index in constrained_indices]
        allowed_mass = float(constrained.sum())
        top_index = allowed[constrained_indices[0]]
        evaluated.append({
            "path": record["validationPath"], "actual": record["class"], "region": record["region"],
            "sourceGroup": record["sourceGroup"], "rawTop1": raw_top3[0], "rawTop3": raw_top3,
            "rawScore": round(float(probabilities[raw_indices[0]]), 7),
            "constrainedTop1": constrained_top3[0], "constrainedTop3": constrained_top3,
            "constrainedScore": round(float(probabilities[top_index]) / max(allowed_mass, 1e-12), 7),
        })

    by_region = {}
    for region in sorted({row["region"] for row in evaluated}):
        region_rows = [row for row in evaluated if row["region"] == region]
        by_region[region] = {
            "raw": summarize(region_rows, "rawTop1", "rawTop3"),
            "constrained": summarize(region_rows, "constrainedTop1", "constrainedTop3"),
        }
    per_class = {}
    for class_name in sorted({row["actual"] for row in evaluated}):
        class_rows = [row for row in evaluated if row["actual"] == class_name]
        per_class[class_name] = summarize(class_rows, "constrainedTop1", "constrainedTop3")
    confusion = Counter((row["actual"], row["constrainedTop1"]) for row in evaluated)
    report = {
        "model": str(args.model.resolve()), "dataset": str(dataset), "sampleCount": len(evaluated),
        "sourceGroupCount": len({row["sourceGroup"] for row in evaluated}),
        "raw": summarize(evaluated, "rawTop1", "rawTop3"),
        "constrained": summarize(evaluated, "constrainedTop1", "constrainedTop3"),
        "byRegion": by_region, "perClass": per_class,
        "confusion": [
            {"actual": actual, "predicted": predicted, "count": count}
            for (actual, predicted), count in sorted(confusion.items())
        ],
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (output / "predictions.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=[
            "path", "actual", "region", "sourceGroup", "rawTop1", "rawTop3", "rawScore",
            "constrainedTop1", "constrainedTop3", "constrainedScore",
        ])
        writer.writeheader()
        for row in evaluated:
            writer.writerow({**row, "rawTop3": "|".join(row["rawTop3"]), "constrainedTop3": "|".join(row["constrainedTop3"])})
    print(json.dumps({key: report[key] for key in ["sampleCount", "sourceGroupCount", "raw", "constrained", "byRegion"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
