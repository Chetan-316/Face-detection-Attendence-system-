"""
PRAVAHAx biometric model registry.

Two engine contracts are supported:
- legacy: YuNet + SFace (current Apache/MIT-friendly prototype)
- scrfd_adaface: SCRFD 2.5G KPS + AdaFace IR50

The SCRFD/AdaFace path deliberately does NOT hard-code public research checkpoints.
Model artifacts must be supplied by the operator through local paths or explicit URLs,
so deployment can use properly licensed weights.
"""

import hashlib
import os
import sys
import urllib.request
from typing import Optional, Tuple

ACTIVE_ENGINE = os.environ.get("BIOMETRIC_ENGINE", "legacy").strip().lower()
if ACTIVE_ENGINE not in {"legacy", "scrfd_adaface"}:
    raise RuntimeError(
        f"Unsupported BIOMETRIC_ENGINE '{ACTIVE_ENGINE}'. "
        "Use 'legacy' or 'scrfd_adaface'."
    )

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"

if ACTIVE_ENGINE == "scrfd_adaface":
    DETECTOR_INFO = {
        "name": "SCRFD",
        "version": os.environ.get("SCRFD_MODEL_VERSION", "2.5G-KPS"),
        "license": os.environ.get(
            "SCRFD_MODEL_LICENSE",
            "Operator-supplied model; verify commercial rights before production use",
        ),
        "source": os.environ.get("SCRFD_MODEL_SOURCE", "Operator supplied"),
        "filename": os.environ.get("SCRFD_MODEL_FILENAME", "scrfd_2.5g_kps.onnx"),
        "input_shape": "[1, 3, 640, 640]",
        "outputs": "bounding_box, confidence, 5_landmarks",
        "runtime": "ONNX Runtime",
    }

    EMBEDDER_INFO = {
        "name": "AdaFace",
        "version": os.environ.get("ADAFACE_MODEL_VERSION", "IR50"),
        "license": os.environ.get(
            "ADAFACE_MODEL_LICENSE",
            "Operator-supplied model; verify checkpoint and training-data terms before production use",
        ),
        "source": os.environ.get("ADAFACE_MODEL_SOURCE", "Operator supplied"),
        "filename": os.environ.get("ADAFACE_MODEL_FILENAME", "adaface_ir50.onnx"),
        "input_shape": "[1, 3, 112, 112]",
        "embedding_dimension": 512,
        "runtime": "ONNX Runtime",
        "template_version": "2.0.0",
    }
else:
    DETECTOR_INFO = {
        "name": "YuNet",
        "version": "2023mar",
        "license": "Apache-2.0",
        "source": "OpenCV Zoo / libfacedetection",
        "filename": "face_detection_yunet_2023mar.onnx",
        "input_shape": "dynamic [1, 3, H, W]",
        "outputs": "bounding_box, confidence, 5_landmarks",
        "runtime": "OpenCV DNN using ONNX model files",
    }

    EMBEDDER_INFO = {
        "name": "SFace",
        "version": "2021dec",
        "license": "Apache-2.0",
        "source": "OpenCV Zoo",
        "filename": "face_recognition_sface_2021dec.onnx",
        "input_shape": "[1, 3, 112, 112]",
        "embedding_dimension": 128,
        "runtime": "OpenCV DNN using ONNX model files",
        "template_version": "1.0.0",
    }


def get_models_dir() -> str:
    env_dir = os.environ.get("MODELS_DIR") or os.environ.get("MODEL_DIR")
    if env_dir:
        abs_env = os.path.abspath(env_dir)
        os.makedirs(abs_env, exist_ok=True)
        return abs_env

    cwd_models = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../../../models")
    )
    os.makedirs(cwd_models, exist_ok=True)
    return cwd_models


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_optional_sha(path: str, expected: Optional[str], label: str) -> None:
    if not expected:
        return
    actual = _sha256(path)
    if actual.lower() != expected.strip().lower():
        raise RuntimeError(
            f"{label} checksum mismatch. Expected {expected}, got {actual}."
        )


def _resolve_operator_model(
    *,
    models_dir: str,
    filename: str,
    path_env: str,
    url_env: str,
    sha_env: str,
    min_bytes: int,
    label: str,
) -> str:
    configured_path = os.environ.get(path_env)
    path = (
        os.path.abspath(configured_path)
        if configured_path
        else os.path.join(models_dir, filename)
    )

    if os.path.exists(path) and os.path.getsize(path) >= min_bytes:
        _verify_optional_sha(path, os.environ.get(sha_env), label)
        return path

    url = os.environ.get(url_env)
    if not url:
        raise RuntimeError(
            f"{label} is not installed. Provide {path_env} pointing to a licensed "
            f"model file, or set {url_env} to an operator-approved download URL."
        )

    os.makedirs(os.path.dirname(path), exist_ok=True)
    sys.stderr.write(f"Downloading operator-supplied {label} to {path}...\n")
    urllib.request.urlretrieve(url, path)

    if not os.path.exists(path) or os.path.getsize(path) < min_bytes:
        raise RuntimeError(f"Downloaded {label} file is missing or unexpectedly small.")

    _verify_optional_sha(path, os.environ.get(sha_env), label)
    return path


def ensure_models_downloaded(models_dir: str = None) -> Tuple[str, str]:
    if models_dir is None:
        models_dir = get_models_dir()
    os.makedirs(models_dir, exist_ok=True)

    if ACTIVE_ENGINE == "scrfd_adaface":
        detector_path = _resolve_operator_model(
            models_dir=models_dir,
            filename=DETECTOR_INFO["filename"],
            path_env="SCRFD_MODEL_PATH",
            url_env="SCRFD_MODEL_URL",
            sha_env="SCRFD_MODEL_SHA256",
            min_bytes=500_000,
            label="SCRFD 2.5G KPS detector",
        )
        embedder_path = _resolve_operator_model(
            models_dir=models_dir,
            filename=EMBEDDER_INFO["filename"],
            path_env="ADAFACE_MODEL_PATH",
            url_env="ADAFACE_MODEL_URL",
            sha_env="ADAFACE_MODEL_SHA256",
            min_bytes=5_000_000,
            label="AdaFace IR50 recognizer",
        )
        return detector_path, embedder_path

    yunet_path = os.path.join(models_dir, DETECTOR_INFO["filename"])
    sface_path = os.path.join(models_dir, EMBEDDER_INFO["filename"])

    root_yunet = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "../../../../models",
            DETECTOR_INFO["filename"],
        )
    )
    root_sface = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "../../../../models",
            EMBEDDER_INFO["filename"],
        )
    )

    if not os.path.exists(yunet_path) or os.path.getsize(yunet_path) < 100_000:
        if os.path.exists(root_yunet) and os.path.getsize(root_yunet) >= 100_000:
            yunet_path = root_yunet
        else:
            sys.stderr.write(f"Downloading YuNet detector to {yunet_path}...\n")
            urllib.request.urlretrieve(YUNET_URL, yunet_path)

    if not os.path.exists(sface_path) or os.path.getsize(sface_path) < 1_000_000:
        if os.path.exists(root_sface) and os.path.getsize(root_sface) >= 1_000_000:
            sface_path = root_sface
        else:
            sys.stderr.write(f"Downloading SFace recognizer to {sface_path}...\n")
            urllib.request.urlretrieve(SFACE_URL, sface_path)

    return yunet_path, sface_path
