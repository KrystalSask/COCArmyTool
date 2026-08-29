"""Export and stage the validated equipment classifier for browser inference."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WEIGHTS = ROOT / "artifacts" / "equipment-classification-training-runs" / "equipment-card-v1" / "weights" / "best.pt"
DEFAULT_CLASSES = ROOT / "artifacts" / "equipment-classification-v1" / "classes.json"
DEFAULT_PUBLIC = ROOT / "public" / "models"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument("--classes", type=Path, default=DEFAULT_CLASSES)
    parser.add_argument("--public-dir", type=Path, default=DEFAULT_PUBLIC)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    weights = args.weights.resolve()
    classes_path = args.classes.resolve()
    public_dir = args.public_dir.resolve()
    public_dir.mkdir(parents=True, exist_ok=True)
    if not weights.exists():
        raise FileNotFoundError(weights)
    classes = json.loads(classes_path.read_text(encoding="utf-8"))
    if len(classes) != 42:
        raise RuntimeError(f"expected 42 classes, got {len(classes)}")
    class_by_name = {item["class"]: item for item in classes}

    model = YOLO(str(weights))
    model_names = {int(index): name for index, name in model.names.items()}
    if len(model_names) != len(classes) or any(name not in class_by_name for name in model_names.values()):
        raise RuntimeError("model class names do not match classes.json")

    exported = weights.with_suffix(".onnx")
    if args.force or not exported.exists():
        exported = Path(model.export(
            format="onnx", imgsz=96, opset=17, simplify=True,
            dynamic=False, batch=1, device="cpu",
        )).resolve()
    if not exported.exists():
        raise FileNotFoundError(exported)

    model_name = "equipment-classifier-v1.onnx"
    classes_name = "equipment-classifier-v1-classes.json"
    manifest_name = "equipment-classifier-v1-manifest.json"
    staged_model = public_dir / model_name
    staged_classes = public_dir / classes_name
    staged_manifest = public_dir / manifest_name
    shutil.copy2(exported, staged_model)
    shutil.copy2(classes_path, staged_classes)

    try:
        import onnxruntime as ort
        session = ort.InferenceSession(str(staged_model), providers=["CPUExecutionProvider"])
        inputs = session.get_inputs()
        outputs = session.get_outputs()
    except ImportError as error:
        raise RuntimeError("onnxruntime is required to validate the exported model") from error
    if len(inputs) != 1 or inputs[0].name != "images" or inputs[0].shape != [1, 3, 96, 96]:
        raise RuntimeError(f"unexpected ONNX input contract: {[(item.name, item.shape) for item in inputs]}")
    if len(outputs) != 1 or outputs[0].name != "output0" or outputs[0].shape != [1, len(classes)]:
        raise RuntimeError(f"unexpected ONNX output contract: {[(item.name, item.shape) for item in outputs]}")

    model_classes = [
        {
            "modelIndex": index,
            "className": model_names[index],
            "equipmentId": class_by_name[model_names[index]]["equipmentId"],
            "ownerHeroId": class_by_name[model_names[index]]["ownerHeroId"],
        }
        for index in range(len(classes))
    ]
    manifest = {
        "schemaVersion": 1,
        "modelId": "equipment-classifier-v1",
        "modelVersion": "equipment-card-v1",
        "modelFile": model_name,
        "classesFile": classes_name,
        "classCount": len(classes),
        "input": {
            "name": inputs[0].name,
            "width": 96,
            "height": 96,
            "layout": "NCHW",
            "color": "RGB",
            "normalization": "divide-255",
            "resize": "letterbox-edge-color",
        },
        "output": {"name": outputs[0].name, "kind": "probabilities", "shape": [1, len(classes)]},
        "preprocessingVersion": "equipment-card-96-letterbox-v1",
        "sourceWeightsSha256": sha256(weights),
        "onnxSha256": sha256(staged_model),
        "classes": model_classes,
        "evaluation": {
            "realValidationTop1": 0.947916666666667,
            "realValidationTop3": 0.958333333333333,
            "realTestTop1": 0.986111111111111,
            "realTestTop3": 0.986111111111111,
            "realReferenceClasses": 40,
            "realReferenceMissingEquipmentIds": [16, 60],
        },
    }
    staged_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "model": str(staged_model),
        "classes": str(staged_classes),
        "manifest": str(staged_manifest),
        "input": [inputs[0].name, inputs[0].shape],
        "output": [outputs[0].name, outputs[0].shape],
        "sizeBytes": staged_model.stat().st_size,
        "onnxSha256": manifest["onnxSha256"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
