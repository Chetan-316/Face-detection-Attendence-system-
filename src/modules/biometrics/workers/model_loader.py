"""
Model Loader for PRAVAHAx Biometric Pipeline
Manages verified YuNet face detector and SFace face embedding models.
Licenses: Apache 2.0 (OpenCV Zoo official models)
"""

import os
import sys
import urllib.request

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"

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
}

def get_models_dir() -> str:
    env_dir = os.environ.get("MODELS_DIR")
    if env_dir:
        abs_env = os.path.abspath(env_dir)
        os.makedirs(abs_env, exist_ok=True)
        return abs_env

    # Use models/ at project root
    cwd_models = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../models"))
    os.makedirs(cwd_models, exist_ok=True)
    return cwd_models

def ensure_models_downloaded(models_dir: str = None) -> tuple[str, str]:
    if models_dir is None:
        models_dir = get_models_dir()
    os.makedirs(models_dir, exist_ok=True)

    yunet_path = os.path.join(models_dir, DETECTOR_INFO["filename"])
    sface_path = os.path.join(models_dir, EMBEDDER_INFO["filename"])

    root_yunet = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../models", DETECTOR_INFO["filename"]))
    root_sface = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../models", EMBEDDER_INFO["filename"]))

    if not os.path.exists(yunet_path) or os.path.getsize(yunet_path) < 100000:
        if os.path.exists(root_yunet) and os.path.getsize(root_yunet) >= 100000:
            yunet_path = root_yunet
        else:
            sys.stderr.write(f"Downloading YuNet detector to {yunet_path}...\n")
            urllib.request.urlretrieve(YUNET_URL, yunet_path)

    if not os.path.exists(sface_path) or os.path.getsize(sface_path) < 1000000:
        if os.path.exists(root_sface) and os.path.getsize(root_sface) >= 1000000:
            sface_path = root_sface
        else:
            sys.stderr.write(f"Downloading SFace recognizer to {sface_path}...\n")
            urllib.request.urlretrieve(SFACE_URL, sface_path)

    return yunet_path, sface_path
