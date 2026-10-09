"""
Verify or download the active PRAVAHAx biometric model pair.

For the legacy engine, OpenCV Zoo URLs are built in.
For SCRFD + AdaFace, model files must be supplied by the operator through
SCRFD_MODEL_PATH / ADAFACE_MODEL_PATH or explicit operator-approved URLs.
"""

import os

from model_loader import (
    ACTIVE_ENGINE,
    DETECTOR_INFO,
    EMBEDDER_INFO,
    ensure_models_downloaded,
)


def main():
    print(f"Verifying PRAVAHAx biometric engine: {ACTIVE_ENGINE}")
    detector_path, embedder_path = ensure_models_downloaded()

    print(
        f"[OK] Detector: {DETECTOR_INFO['name']} ({DETECTOR_INFO['version']}) "
        f"at {detector_path} ({os.path.getsize(detector_path)} bytes)"
    )
    print(
        f"  License: {DETECTOR_INFO['license']} | Source: {DETECTOR_INFO['source']}"
    )
    print(
        f"[OK] Embedder: {EMBEDDER_INFO['name']} ({EMBEDDER_INFO['version']}) "
        f"at {embedder_path} ({os.path.getsize(embedder_path)} bytes)"
    )
    print(
        f"  License: {EMBEDDER_INFO['license']} | Source: {EMBEDDER_INFO['source']} "
        f"| Dim: {EMBEDDER_INFO['embedding_dimension']}"
    )
    print("All active-engine models ready for inference.")


if __name__ == "__main__":
    main()
