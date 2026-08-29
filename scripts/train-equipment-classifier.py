"""Train the closed-set 42-class equipment-card classifier."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import torch
import torchvision.transforms as T
from ultralytics import YOLO
from ultralytics.data.dataset import ClassificationDataset
from ultralytics.models.yolo.classify import ClassificationTrainer


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "artifacts" / "equipment-classification-v1"
DEFAULT_PROJECT = ROOT / "artifacts" / "equipment-classification-training-runs"


class EquipmentDataset(ClassificationDataset):
    """Keep the generator's 96x96 preprocessing unchanged during training."""

    def __init__(self, root: str, args, augment: bool = False, prefix: str = ""):
        super().__init__(root=root, args=args, augment=augment, prefix=prefix)
        self.torch_transforms = T.Compose([
            T.Resize((args.imgsz, args.imgsz), antialias=True),
            T.ToTensor(),
        ])


class EquipmentTrainer(ClassificationTrainer):
    def build_dataset(self, img_path: str, mode: str = "train", batch=None):
        return EquipmentDataset(root=img_path, args=self.args, augment=mode == "train", prefix=mode)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--model", default="yolo26n-cls.pt")
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--imgsz", type=int, default=96)
    parser.add_argument("--freeze", type=int, default=10)
    parser.add_argument("--lr0", type=float, default=0.001)
    parser.add_argument("--patience", type=int, default=8)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--device", default="0")
    parser.add_argument("--project", type=Path, default=DEFAULT_PROJECT)
    parser.add_argument("--name", default="equipment-card-v1")
    args = parser.parse_args()

    if not torch.cuda.is_available() and args.device != "cpu":
        raise RuntimeError("CUDA is unavailable; pass --device cpu explicitly to allow CPU training")
    data = args.data.resolve()
    for split in ("train", "val", "test"):
        if not (data / split).exists():
            raise FileNotFoundError(f"dataset split is missing: {data / split}")
    classes_path = data / "classes.json"
    if not classes_path.exists():
        raise FileNotFoundError(f"class mapping is missing: {classes_path}")
    classes = json.loads(classes_path.read_text(encoding="utf-8"))
    if len(classes) != 42:
        raise RuntimeError(f"expected 42 equipment classes, got {len(classes)}")

    model = YOLO(args.model)
    model.train(
        data=str(data), trainer=EquipmentTrainer, epochs=args.epochs, batch=args.batch,
        imgsz=args.imgsz, freeze=args.freeze, lr0=args.lr0, patience=args.patience,
        workers=args.workers, device=args.device, project=str(args.project), name=args.name,
        exist_ok=True, cache=False, seed=20260827, deterministic=True,
        optimizer="AdamW", plots=False,
        fliplr=0.0, flipud=0.0, degrees=0.0, translate=0.0, scale=0.0,
        shear=0.0, perspective=0.0, erasing=0.0, auto_augment=None,
        hsv_h=0.0, hsv_s=0.0, hsv_v=0.0, verbose=True,
    )
    run = (args.project / args.name).resolve()
    best = run / "weights" / "best.pt"
    metadata = {
        "model": "equipment-classifier-v1",
        "weights": str(best),
        "weightsSha256": sha256(best) if best.exists() else None,
        "classCount": len(classes),
        "classesFile": str(classes_path),
        "preprocessingVersion": "equipment-card-96-letterbox-v1",
        "inputSize": [args.imgsz, args.imgsz],
        "data": str(data),
        "trainingRun": str(run),
        "epochs": args.epochs,
        "batch": args.batch,
        "device": args.device,
    }
    (run / "model-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
