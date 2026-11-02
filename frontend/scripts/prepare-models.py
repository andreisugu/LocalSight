#!/usr/bin/env python3
"""Prepare the ONNX models the static frontend loads from ``/models/``.

The browser build has no inference server: the person detector and the face guard run
in the page through ONNX Runtime Web, so every graph must ship inside ``public/``.
This script reproduces them from the EfficientDet-Lite ONNX exports and the
opencv_zoo YuNet release. Both sources used to live in ``ml/``; that reference stack
was removed from this fork, so pass the sources explicitly (see below).

Three steps, one per model:

1. ``efficientdet_lite0.onnx`` and ``efficientdet_lite2.onnx`` are copied byte for
   byte. They are the Apache-2.0 EfficientDet-Lite exports the browser runs: uint8
   ``[1, H, W, 3]`` in (320 px for Lite0, 448 px for Lite2). Lite0 is the default
   detector; Lite2 is the accuracy choice. Each file is verified after the copy: the
   declared input must be NHWC uint8 of the expected side, so a wrong download fails
   here instead of inside the worker.

2. ``yunet.onnx`` is the published YuNet fp32 model with a *dynamic* input shape.
   opencv_zoo ships ``face_detection_yunet_2023mar.onnx`` with the input declared
   as ``[1, 3, 640, 640]``. That fixed size is what OpenCV's ``FaceDetectorYN``
   expects, but it is wrong for a 1080p apron frame: the frame is either squashed
   into 640x640 (tiny faces lose their pixels) or there is an unnecessary resize.
   The graph itself is fully convolutional, so the declared shape is rewritten to
   ``[1, 3, "height", "width"]`` and the same file then accepts any size that is a
   multiple of 32, which is what the fusion layers need.

   The output grids keep their declared 640x640 sizes. ONNX Runtime recomputes
   them at run time and logs a harmless shape-mismatch warning, exactly like the
   removed Python reference did.

Usage (all three sources are required; nothing is downloaded)::

    python3 frontend/scripts/prepare-models.py \\
        --efficientdet-lite0 path/to/efficientdet_lite0.onnx \\
        --efficientdet-lite2 path/to/efficientdet_lite2.onnx \\
        --yunet path/to/face_detection_yunet_2023mar.onnx \\
        --out frontend/public/models

The EfficientDet sources are the ONNX exports of Google's EfficientDet-Lite (Apache-2.0
weights; see THIRD_PARTY.md for the conversion attribution). The YuNet source is the
MIT-licensed file from https://github.com/opencv/opencv_zoo
(``models/face_detection_yunet``). Requires the ``onnx`` package (``pip install onnx``).
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO_ROOT / "frontend" / "public" / "models"

# YuNet fuses three feature strides (8, 16, 32); both input sides must be multiples
# of the largest one for the concatenation to line up.
YUNET_ALIGN = 32

# Person graph -> the square input side its export declares.
EFFICIENTDET_SIZES = {"efficientdet_lite0.onnx": 320, "efficientdet_lite2.onnx": 448}


def sha256(path: Path) -> str:
    """Hex SHA-256 of a file, read in chunks so a 10 MB model stays cheap."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def human_mb(path: Path) -> str:
    """File size rounded to 0.1 MB, for the report line."""
    return f"{path.stat().st_size / (1024 * 1024):.1f} MB"


def input_dims(path: Path) -> tuple[list[int], int]:
    """Declared dims and the ONNX element type of the single graph input."""
    import onnx  # imported here so --help works without the dependency

    graph = onnx.load(str(path)).graph
    if len(graph.input) != 1:
        raise ValueError(f"{path.name}: expected one input, found {len(graph.input)}")
    tensor = graph.input[0].type.tensor_type
    dims = [int(dim.dim_value) for dim in tensor.shape.dim]
    return dims, int(tensor.elem_type)


def copy_efficientdet(source: Path, destination: Path, size: int) -> None:
    """Copy one EfficientDet-Lite export and prove it is the graph the worker expects."""
    import onnx

    if not source.is_file():
        raise FileNotFoundError(
            f"EfficientDet source missing: {source}\n"
            f"Export the {destination.name.replace('.onnx', '')} graph and pass it with "
            f"--{destination.name.replace('_', '-').replace('.onnx', '')}."
        )
    shutil.copyfile(source, destination)
    dims, elem_type = input_dims(destination)
    expected = [1, size, size, 3]
    if dims != expected or elem_type != onnx.TensorProto.UINT8:
        raise ValueError(
            f"{destination.name}: expected uint8 NHWC input {expected}, got "
            f"elem_type {elem_type}, dims {dims}"
        )


def make_yunet_dynamic(source: Path, destination: Path) -> tuple[str, str]:
    """Rewrite YuNet's declared input to ``[1, 3, "height", "width"]``.

    Only the metadata changes; the weights and the ops are untouched. Returns the
    symbolic axes as ``(height_name, width_name)`` after a reload, so the caller
    can prove the file on disk is the patched one.
    """
    import onnx  # imported here so --help works without the dependency

    if not source.is_file():
        raise FileNotFoundError(
            f"YuNet source missing: {source}\n"
            "Download it from opencv_zoo (models/face_detection_yunet) and pass it with --yunet."
        )
    model = onnx.load(str(source))
    dims = model.graph.input[0].type.tensor_type.shape.dim
    dims[0].dim_value = 1
    for axis, name in ((2, "height"), (3, "width")):
        dims[axis].ClearField("dim_value")
        dims[axis].dim_param = name
    onnx.checker.check_model(model)
    onnx.save(model, str(destination))

    reloaded = onnx.load(str(destination))
    input_dims = reloaded.graph.input[0].type.tensor_type.shape.dim
    return input_dims[2].dim_param, input_dims[3].dim_param


def report(path: Path) -> None:
    """Print size and hash in the exact form the README records."""
    print(f"  {path.name}: {human_mb(path)}, {path.stat().st_size} bytes, sha256 {sha256(path)}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy the EfficientDet-Lite graphs and rewrite YuNet's input shape.",
    )
    parser.add_argument(
        "--efficientdet-lite0",
        type=Path,
        required=True,
        help="EfficientDet-Lite0 ONNX source (320 px, Apache-2.0)",
    )
    parser.add_argument(
        "--efficientdet-lite2",
        type=Path,
        required=True,
        help="EfficientDet-Lite2 ONNX source (448 px, Apache-2.0)",
    )
    parser.add_argument(
        "--yunet",
        type=Path,
        required=True,
        help="YuNet fp32 ONNX source (opencv_zoo face_detection_yunet_2023mar.onnx)",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"destination directory (default: {DEFAULT_OUT})")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    lite0_out = out_dir / "efficientdet_lite0.onnx"
    lite2_out = out_dir / "efficientdet_lite2.onnx"
    yunet_out = out_dir / "yunet.onnx"

    print(f"EfficientDet-Lite0: {args.efficientdet_lite0} -> {lite0_out} (320 px)")
    copy_efficientdet(args.efficientdet_lite0, lite0_out, EFFICIENTDET_SIZES[lite0_out.name])

    print(f"EfficientDet-Lite2: {args.efficientdet_lite2} -> {lite2_out} (448 px)")
    copy_efficientdet(args.efficientdet_lite2, lite2_out, EFFICIENTDET_SIZES[lite2_out.name])

    print(f"YuNet: {args.yunet} -> {yunet_out} (dynamic input, multiple of {YUNET_ALIGN})")
    height, width = make_yunet_dynamic(args.yunet, yunet_out)
    if (height, width) != ("height", "width"):
        print(f"error: YuNet input is not dynamic after saving: {height!r}, {width!r}", file=sys.stderr)
        return 1

    print("written:")
    report(lite0_out)
    report(lite2_out)
    report(yunet_out)
    print(f"YuNet input dims after patch: [1, 3, {height!r}, {width!r}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
