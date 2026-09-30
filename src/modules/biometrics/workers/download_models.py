"""
Script to download and verify YuNet and SFace models
Run: python download_models.py
"""

import sys
import os
from model_loader import ensure_models_downloaded, DETECTOR_INFO, EMBEDDER_INFO

def main():
    print("Verifying / Downloading PRAVAHAx Biometric models...")
    yunet_path, sface_path = ensure_models_downloaded()
    print(f"[OK] Detector: {DETECTOR_INFO['name']} ({DETECTOR_INFO['version']}) at {yunet_path} ({os.path.getsize(yunet_path)} bytes)")
    print(f"  License: {DETECTOR_INFO['license']} | Source: {DETECTOR_INFO['source']}")
    print(f"[OK] Embedder: {EMBEDDER_INFO['name']} ({EMBEDDER_INFO['version']}) at {sface_path} ({os.path.getsize(sface_path)} bytes)")
    print(f"  License: {EMBEDDER_INFO['license']} | Source: {EMBEDDER_INFO['source']} | Dim: {EMBEDDER_INFO['embedding_dimension']}")
    print("All models ready for inference.")

if __name__ == "__main__":
    main()
