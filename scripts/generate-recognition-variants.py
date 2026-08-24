"""Generate reproducible robustness variants without modifying real source samples."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


VARIANTS = {
    "jpeg-q95": {"format": "JPEG", "quality": 95},
    "jpeg-q85": {"format": "JPEG", "quality": 85},
    "jpeg-q70": {"format": "JPEG", "quality": 70},
    "webp-q90": {"format": "WEBP", "quality": 90},
    "scale-75": {"scale": 0.75, "format": "PNG"},
    "scale-50": {"scale": 0.50, "format": "PNG"},
    "brightness-105": {"brightness": 1.05, "format": "PNG"},
    "contrast-105": {"contrast": 1.05, "format": "PNG"},
    "blur-06": {"blur": 0.6, "format": "PNG"},
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("batch", nargs="?", default="recognition-samples/batch-01-dev")
    parser.add_argument("--ids", default="", help="Comma-separated sample ids; default is every image")
    args = parser.parse_args()
    batch = Path(args.batch).resolve()
    ids = {value.strip() for value in args.ids.split(",") if value.strip()}
    sources = [path for path in sorted((batch / "images").iterdir()) if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"} and (not ids or path.stem in ids)]
    output_root = batch / "derived"
    records = []

    for source in sources:
        with Image.open(source) as opened:
            image = opened.convert("RGB")
            for name, params in VARIANTS.items():
                derived = image.copy()
                if "scale" in params:
                    derived = derived.resize((round(image.width * params["scale"]), round(image.height * params["scale"])), Image.Resampling.LANCZOS)
                if "brightness" in params:
                    derived = ImageEnhance.Brightness(derived).enhance(params["brightness"])
                if "contrast" in params:
                    derived = ImageEnhance.Contrast(derived).enhance(params["contrast"])
                if "blur" in params:
                    derived = derived.filter(ImageFilter.GaussianBlur(params["blur"]))
                folder = output_root / name
                folder.mkdir(parents=True, exist_ok=True)
                extension = ".jpg" if params["format"] == "JPEG" else ".webp" if params["format"] == "WEBP" else ".png"
                target = folder / f"{source.stem}{extension}"
                save_options = {key: value for key, value in params.items() if key in {"quality"}}
                derived.save(target, params["format"], **save_options)
                records.append({
                    "source": str(source.relative_to(batch)).replace("\\", "/"),
                    "sourceSha256": sha256(source),
                    "variant": name,
                    "parameters": params,
                    "output": str(target.relative_to(batch)).replace("\\", "/"),
                    "outputSha256": sha256(target),
                    "width": derived.width,
                    "height": derived.height,
                })

    manifest = {"schemaVersion": 1, "batch": batch.name, "realSampleCount": len(sources), "derivedSampleCount": len(records), "derivedDataOnly": True, "variants": list(VARIANTS), "records": records}
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(records)} derived variants from {len(sources)} real samples")


if __name__ == "__main__":
    main()
