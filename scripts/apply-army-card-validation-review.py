"""Apply exported visual-review decisions to the real validation split."""

from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CANDIDATES = ROOT / "artifacts" / "army-card-real-validation-review-v1"
DEFAULT_DATASET = ROOT / "artifacts" / "army-card-classification-cn-v1"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("review_json", type=Path)
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--allow-partial", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    candidates = args.candidates.resolve()
    dataset = args.dataset.resolve()
    val_dir = (dataset / "val").resolve()
    if val_dir.parent != dataset:
        raise RuntimeError(f"unsafe validation target: {val_dir}")
    review = json.loads(args.review_json.read_text(encoding="utf-8"))
    decisions = review.get("decisions", [])
    pending = [row for row in decisions if row.get("decision") == "pending"]
    if pending and not args.allow_partial:
        raise RuntimeError(f"{len(pending)} candidates remain pending; finish review or pass --allow-partial")
    accepted = [row for row in decisions if row.get("decision") in {"approved", "corrected"}]
    if not accepted:
        raise RuntimeError("review contains no approved or corrected candidates")
    train_classes = {path.name for path in (dataset / "train").iterdir() if path.is_dir()}
    unknown = sorted({row.get("class") for row in accepted} - train_classes)
    if unknown:
        raise RuntimeError(f"review contains unknown classes: {unknown}")
    if val_dir.exists():
        if not args.force:
            raise FileExistsError(f"validation split exists; pass --force to replace: {val_dir}")
        shutil.rmtree(val_dir)

    imported = []
    for row in accepted:
        source = candidates / row["path"]
        if not source.exists():
            raise FileNotFoundError(source)
        class_name = row["class"]
        destination = val_dir / class_name / source.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        imported.append({**row, "validationPath": destination.relative_to(dataset).as_posix()})
    (dataset / "validation-manifest.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in imported), encoding="utf-8",
    )
    counts = Counter(row["class"] for row in imported)
    summary = {
        "imported": len(imported), "rejected": sum(row.get("decision") == "rejected" for row in decisions),
        "pending": len(pending), "classCount": len(counts),
        "missingClasses": sorted(train_classes - set(counts)), "perClass": dict(sorted(counts.items())),
    }
    (dataset / "validation-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
