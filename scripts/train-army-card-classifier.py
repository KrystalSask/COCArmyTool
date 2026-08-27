"""Train the closed-set 76-class army-card classifier without random crops."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

import torch
import torchvision.transforms as T
from ultralytics import YOLO
from ultralytics.data.dataset import ClassificationDataset
from ultralytics.models.yolo.classify import ClassificationTrainer


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "artifacts" / "army-card-classification-cn-v1"
DEFAULT_PROJECT = ROOT / "artifacts" / "army-card-training-runs"
SMOKE_DATA = ROOT / "artifacts" / "army-card-classification-smoke"


class ArmyCardDataset(ClassificationDataset):
    """Classification dataset that always preserves the complete 160px canvas."""

    def __init__(self, root: str, args, augment: bool = False, prefix: str = ""):
        super().__init__(root=root, args=args, augment=augment, prefix=prefix)
        transforms: list[object] = [T.Resize((args.imgsz, args.imgsz), antialias=True)]
        if augment:
            # Geometry, occlusion and compression are already modeled by the
            # generator. Keep only mild photometric variation here.
            transforms.append(T.ColorJitter(brightness=0.05, contrast=0.06, saturation=0.04, hue=0.0))
        transforms.append(T.ToTensor())
        self.torch_transforms = T.Compose(transforms)


class ArmyCardTrainer(ClassificationTrainer):
    def build_dataset(self, img_path: str, mode: str = "train", batch=None):
        return ArmyCardDataset(root=img_path, args=self.args, augment=mode == "train", prefix=mode)


def link_or_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def build_smoke_dataset(source: Path) -> dict:
    smoke = SMOKE_DATA.resolve()
    artifacts = (ROOT / "artifacts").resolve()
    if smoke == artifacts or artifacts not in smoke.parents:
        raise RuntimeError(f"unsafe smoke output: {smoke}")
    if smoke.exists():
        shutil.rmtree(smoke)
    counts = {"train": 0, "val": 0}
    validation_records = []
    class_dirs = sorted(path for path in (source / "train").iterdir() if path.is_dir())
    for class_dir in class_dirs:
        images = sorted(class_dir.glob("*.png"))
        if len(images) < 10:
            raise RuntimeError(f"need at least 10 synthetic images for smoke split: {class_dir}")
        selected = {"train": images[:8], "val": images[-2:]}
        for split, paths in selected.items():
            for path in paths:
                link_or_copy(path, smoke / split / class_dir.name / path.name)
                counts[split] += 1
                if split == "val":
                    prefix = class_dir.name.split("_", 1)[0]
                    region = {"troop": "mainTroops", "spell": "mainSpells", "siege": "mainSiege"}[prefix]
                    validation_records.append({
                        "validationPath": (Path("val") / class_dir.name / path.name).as_posix(),
                        "class": class_dir.name, "region": region,
                        "sourceGroup": f"synthetic-smoke:{class_dir.name}",
                    })
    manifest = {
        "purpose": "pipeline smoke test only; metrics are not model-quality evidence",
        "source": str(source), "classCount": len(class_dirs), "counts": counts,
    }
    (smoke / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (smoke / "validation-manifest.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in validation_records), encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--model", default="yolo26n-cls.pt")
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--imgsz", type=int, default=160)
    parser.add_argument("--freeze", type=int, default=10)
    parser.add_argument("--lr0", type=float, default=0.001)
    parser.add_argument("--patience", type=int, default=12)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--device", default="0")
    parser.add_argument("--project", type=Path, default=DEFAULT_PROJECT)
    parser.add_argument("--name", default="army-card-head-v1")
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()

    if not torch.cuda.is_available() and args.device != "cpu":
        raise RuntimeError("CUDA is unavailable; pass --device cpu explicitly to allow CPU training")
    data = args.data.resolve()
    if args.smoke:
        manifest = build_smoke_dataset(data)
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        data = SMOKE_DATA
        args.epochs = min(args.epochs, 3)
        args.name = "smoke-yolo26n-cls"
    elif not (data / "val").exists():
        raise FileNotFoundError(
            f"real validation split is missing: {data / 'val'}; review and import real candidates before formal training"
        )

    model = YOLO(args.model)
    model.train(
        data=str(data), trainer=ArmyCardTrainer, epochs=args.epochs, batch=args.batch,
        imgsz=args.imgsz, freeze=args.freeze, lr0=args.lr0, patience=args.patience,
        workers=args.workers, device=args.device, project=str(args.project), name=args.name,
        exist_ok=True, cache=False, seed=20260825, deterministic=True,
        optimizer="AdamW", plots=False,
        fliplr=0.0, flipud=0.0, degrees=0.0, translate=0.0, scale=0.0,
        shear=0.0, perspective=0.0, erasing=0.0, auto_augment=None,
        hsv_h=0.0, hsv_s=0.0, hsv_v=0.0, verbose=True,
    )


if __name__ == "__main__":
    main()
