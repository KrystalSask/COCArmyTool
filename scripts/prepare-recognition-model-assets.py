"""Validate and publish the browser recognition models and derived metadata."""

from __future__ import annotations

import ast
import hashlib
import json
import re
import shutil
import urllib.request
import time
from pathlib import Path

import onnxruntime as ort


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "models"
CLASSIFIER = ROOT / "artifacts" / "army-card-classifier-cn-v2.onnx"
OCR = ROOT / "artifacts" / ".ocr-baseline-venv" / "Lib" / "site-packages" / "rapidocr" / "models" / "PP-OCRv6_rec_small.onnx"
EXPECTED = {
    CLASSIFIER: "f01ea7454c3c24e8588205c8b6a6f821719fbe8c094b3a6d79fee69d7569d358",
    OCR: "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_hash(path: Path) -> str:
    actual = sha256(path)
    if actual != EXPECTED[path]:
        raise RuntimeError(f"Unexpected SHA-256 for {path}: {actual}")
    return actual


def shape(node) -> list[int | str]:
    return [value if isinstance(value, int) else "dynamic" for value in node.shape]


def main() -> None:
    classifier_hash = require_hash(CLASSIFIER)
    ocr_hash = require_hash(OCR)
    classifier = ort.InferenceSession(str(CLASSIFIER), providers=["CPUExecutionProvider"])
    ocr = ort.InferenceSession(str(OCR), providers=["CPUExecutionProvider"])

    names = ast.literal_eval(classifier.get_modelmeta().custom_metadata_map["names"])
    if sorted(names) != list(range(76)):
        raise RuntimeError("Classifier metadata must contain exactly the indexes 0..75")
    classes = []
    for index in range(76):
        match = re.fullmatch(r"(troop|spell|siege)_(\d{3})_(.+)", names[index])
        if not match:
            raise RuntimeError(f"Invalid classifier class name: {names[index]}")
        classes.append({"index": index, "className": names[index], "kind": match.group(1), "id": int(match.group(2))})

    characters = ocr.get_modelmeta().custom_metadata_map.get("character")
    if not characters:
        raise RuntimeError("OCR model has no embedded character table")
    charset = ["blank", *characters.splitlines(), " "]
    output_width = ocr.get_outputs()[0].shape[-1]
    if output_width != len(charset):
        raise RuntimeError(f"OCR output width {output_width} != charset length {len(charset)}")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    classifier_name = "army-card-classifier-cn-v2.onnx"
    ocr_name = "army-count-ocr-ppocrv6-small-v1.onnx"
    shutil.copyfile(CLASSIFIER, OUTPUT / classifier_name)
    shutil.copyfile(OCR, OUTPUT / ocr_name)
    (OUTPUT / "army-card-classes-cn-v2.json").write_text(json.dumps(classes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUTPUT / "army-count-ocr-charset-v1.json").write_text(json.dumps(charset, ensure_ascii=False) + "\n", encoding="utf-8")

    manifest = {
        "version": 1,
        "classifier": {
            "version": "army-card-classifier-cn-v2",
            "file": classifier_name,
            "sha256": classifier_hash,
            "input": {"name": classifier.get_inputs()[0].name, "shape": shape(classifier.get_inputs()[0])},
            "output": {"name": classifier.get_outputs()[0].name, "shape": shape(classifier.get_outputs()[0])},
            "classes": "army-card-classes-cn-v2.json",
            "preprocessing": "army-card-left-pad-rgb-chw-div255-v1",
            "license": "AGPL-3.0-only",
            "notice": "MODEL-NOTICE.txt",
            "licenseFile": "LICENSE-AGPL-3.0.txt",
        },
        "ocr": {
            "version": "ppocrv6-rec-small-v1",
            "file": ocr_name,
            "sha256": ocr_hash,
            "input": {"name": ocr.get_inputs()[0].name, "shape": shape(ocr.get_inputs()[0])},
            "output": {"name": ocr.get_outputs()[0].name, "shape": shape(ocr.get_outputs()[0])},
            "charset": "army-count-ocr-charset-v1.json",
            "preprocessing": "ppocr-height48-bgr-chw-minus0.5-div0.5-v1",
            "license": "Apache-2.0",
            "notice": "MODEL-NOTICE.txt",
            "licenseFile": "LICENSE-Apache-2.0.txt",
        },
        "runtime": {"name": "onnxruntime-web", "license": "MIT", "licenseFile": "LICENSE-ONNX-RUNTIME.txt"},
    }
    (OUTPUT / "recognition-model-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUTPUT / "MODEL-NOTICE.txt").write_text(
        "Army card classifier\n"
        "  Source model: artifacts/army-card-classifier-cn-v2.onnx\n"
        "  Export metadata: Ultralytics YOLO; license declared by model: AGPL-3.0\n"
        "  License: https://www.gnu.org/licenses/agpl-3.0.txt\n\n"
        "Army count OCR\n"
        "  Model: RapidOCR PP-OCRv6_rec_small.onnx (RapidOCR 3.9.2)\n"
        "  RapidOCR license: Apache-2.0\n"
        "  Source: https://github.com/RapidAI/RapidOCR\n"
        "  License: https://www.apache.org/licenses/LICENSE-2.0.txt\n",
        encoding="utf-8",
    )
    license_sources = {
        "LICENSE-AGPL-3.0.txt": "https://www.gnu.org/licenses/agpl-3.0.txt",
        "LICENSE-Apache-2.0.txt": "https://raw.githubusercontent.com/RapidAI/RapidOCR/main/LICENSE",
        "LICENSE-ONNX-RUNTIME.txt": "https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE",
    }
    for filename, url in license_sources.items():
        target = OUTPUT / filename
        if not target.exists():
            request = urllib.request.Request(url, headers={"User-Agent": "COCArmyTool-model-asset-preparer/1"})
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(request, timeout=30) as response:
                        target.write_bytes(response.read())
                    break
                except OSError:
                    if attempt == 2:
                        raise
                    time.sleep(attempt + 1)
        if target.stat().st_size < 1_000:
            raise RuntimeError(f"License resource is incomplete: {target}")
    print(f"Published 2 verified models and metadata to {OUTPUT}")


if __name__ == "__main__":
    main()
