"""
PRAVAHAx Face Biometric Worker Process
Continuous warm background worker for face detection, quality analysis, landmark alignment,
and embedding generation.
Communicates with Node.js host via JSON-lines over stdin/stdout.
"""

import sys
import os
import json
import base64
import time
import argparse
import traceback
import numpy as np

# Ensure worker directory is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from model_loader import ensure_models_downloaded, DETECTOR_INFO, EMBEDDER_INFO
from detector import FaceDetector
from quality import QualityChecker
from embedder import FaceEmbedder

def log_event(event_type, **kwargs):
    payload = {"type": event_type, "timestamp": time.time(), **kwargs}
    sys.stderr.write(json.dumps(payload) + "\n")
    sys.stderr.flush()

def send_response(data: dict):
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()

def main():
    parser = argparse.ArgumentParser(description="PRAVAHAx Face Biometric Worker")
    parser.add_argument("--mock", action="store_true", help="Run in synthetic mock mode for tests without models")
    args = parser.parse_args()

    detector = None
    embedder = None
    quality_checker = QualityChecker()
    is_mock = args.mock

    if not is_mock:
        try:
            import cv2
            yunet_path, sface_path = ensure_models_downloaded()
            detector = FaceDetector(yunet_path)
            embedder = FaceEmbedder(sface_path)
            log_event("ready", mode="real", detector=DETECTOR_INFO["name"], embedder=EMBEDDER_INFO["name"])
        except Exception as e:
            log_event("error", error="INIT_FAILED", message=str(e), trace=traceback.format_exc())
            # If real initialization fails, fallback to mock to allow process to stay alive
            is_mock = True

    if is_mock:
        log_event("ready", mode="mock")

    # Notify ready on stdout as well
    send_response({
        "event": "started",
        "mock": is_mock,
        "detectorLoaded": not is_mock and detector is not None,
        "embedderLoaded": not is_mock and embedder is not None
    })

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd_data = json.loads(line)
        except json.JSONDecodeError as e:
            send_response({"success": False, "error": "INVALID_JSON", "message": str(e)})
            continue

        command = cmd_data.get("command")

        if command == "ping":
            send_response({"success": True, "pong": True, "time": time.time()})

        elif command == "health":
            send_response({
                "success": True,
                "status": "UP",
                "workerReady": True,
                "mock": is_mock,
                "detectorLoaded": not is_mock and detector is not None,
                "embedderLoaded": not is_mock and embedder is not None,
                "detectorName": DETECTOR_INFO["name"],
                "detectorVersion": DETECTOR_INFO["version"],
                "modelName": EMBEDDER_INFO["name"],
                "modelVersion": EMBEDDER_INFO["version"],
                "embeddingDimension": EMBEDDER_INFO["embedding_dimension"],
                "runtime": EMBEDDER_INFO["runtime"],
                "license": EMBEDDER_INFO["license"]
            })

        elif command == "process_frame":
            # Image can be passed as base64 string
            b64_data = cmd_data.get("image_base64")
            if not b64_data:
                send_response({"success": False, "error": "MISSING_IMAGE", "message": "image_base64 is required"})
                continue

            # Strip data URI header if present
            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]

            try:
                if is_mock:
                    mock_pose = cmd_data.get("mock_pose") or cmd_data.get("expected_pose") or "FRONT"
                    # Generate deterministic synthetic sample for mock mode
                    send_response({
                        "success": True,
                        "quality": {
                            "is_valid": True,
                            "rejection_reason": None,
                            "message": "Good quality face sample detected (mock)",
                            "face_count": 1,
                            "detected_pose": mock_pose,
                            "metrics": {
                                "face_count": 1,
                                "confidence": 0.95,
                                "blur_score": 120.0,
                                "brightness": 128.0,
                                "detected_pose": mock_pose,
                                "bbox": {"x": 200, "y": 140, "width": 240, "height": 260},
                                "frame_width": 640,
                                "frame_height": 480
                            }
                        },
                        "embedding": [round(float(np.sin(i + 0.1)), 6) for i in range(128)]
                    })
                    continue

                try:
                    img_bytes = base64.b64decode(b64_data)
                except Exception as decode_err:
                    send_response({
                        "success": False,
                        "error": "DECODE_FAILED",
                        "quality": {
                            "is_valid": False,
                            "rejection_reason": "NO_FACE",
                            "message": f"Failed to decode base64 image: {str(decode_err)}",
                            "face_count": 0,
                            "metrics": None
                        },
                        "embedding": None
                    })
                    continue

                import cv2
                np_arr = np.frombuffer(img_bytes, np.uint8)
                img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

                if img is None:
                    send_response({
                        "success": False,
                        "error": "DECODE_FAILED",
                        "quality": {
                            "is_valid": False,
                            "rejection_reason": "NO_FACE",
                            "message": "Failed to decode image frame",
                            "face_count": 0,
                            "metrics": None
                        },
                        "embedding": None
                    })
                    continue

                # Run detector
                faces = detector.detect(img)
                expected_pose = cmd_data.get("expected_pose")
                quality_res = quality_checker.evaluate(img, faces, expected_pose=expected_pose)

                embedding = None
                if quality_res["is_valid"] and len(faces) >= 1:
                    primary_face = faces[0] if len(faces) == 1 else sorted(faces, key=lambda f: f["bbox"]["width"] * f["bbox"]["height"], reverse=True)[0]
                    raw_face = primary_face["raw_face"]
                    feat = embedder.align_and_extract(img, raw_face)
                    embedding = [round(float(x), 6) for x in feat.tolist()]

                # Clear frame from memory immediately
                del img
                del np_arr

                send_response({
                    "success": True,
                    "quality": quality_res,
                    "embedding": embedding
                })

            except Exception as e:
                send_response({
                    "success": False,
                    "error": "PROCESSING_ERROR",
                    "message": str(e),
                    "trace": traceback.format_exc()
                })

        elif command == "extract_faces":
            b64_data = cmd_data.get("image_base64")
            if not b64_data:
                send_response({"success": False, "error": "MISSING_IMAGE", "faces": []})
                continue

            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]

            min_face_size = int(cmd_data.get("min_face_size") or 50)
            min_confidence = float(cmd_data.get("min_confidence") or 0.6)

            try:
                if is_mock:
                    if "mock_faces" in cmd_data:
                        send_response({
                            "success": True,
                            "faces": cmd_data["mock_faces"]
                        })
                        continue

                    # Synthetic mock face for testing without camera
                    mock_embedding = [round(float(np.sin(i + 0.1)), 6) for i in range(128)]
                    send_response({
                        "success": True,
                        "faces": [
                            {
                                "faceIndex": 0,
                                "bbox": {"x": 200, "y": 140, "width": 240, "height": 260},
                                "detectionConfidence": 0.95,
                                "embedding": mock_embedding,
                                "quality": {
                                    "usable": True,
                                    "rejectionReason": None,
                                    "blurScore": 120.0,
                                    "brightness": 128.0
                                }
                            }
                        ]
                    })
                    continue

                try:
                    img_bytes = base64.b64decode(b64_data)
                except Exception as decode_err:
                    send_response({
                        "success": False,
                        "error": "DECODE_FAILED",
                        "message": str(decode_err),
                        "faces": []
                    })
                    continue

                import cv2
                np_arr = np.frombuffer(img_bytes, np.uint8)
                img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

                if img is None:
                    send_response({
                        "success": False,
                        "error": "DECODE_FAILED",
                        "message": "Failed to decode image frame",
                        "faces": []
                    })
                    continue

                h, w = img.shape[:2]
                detected_faces = detector.detect(img) if detector else []
                extracted = []

                for idx, face in enumerate(detected_faces):
                    raw_face = face["raw_face"]
                    bbox = face["bbox"]
                    score = face["score"]

                    bx, by, bw, bh = bbox["x"], bbox["y"], bbox["width"], bbox["height"]
                    y1 = max(0, by)
                    y2 = min(h, by + bh)
                    x1 = max(0, bx)
                    x2 = min(w, bx + bw)
                    crop = img[y1:y2, x1:x2]

                    blur_score = 0.0
                    brightness = 0.0
                    rejection_reason = None

                    if crop.size == 0 or bw < 10 or bh < 10:
                        rejection_reason = "FACE_OFF_CENTER"
                    else:
                        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
                        blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                        brightness = float(np.mean(gray))

                        if bw < min_face_size or bh < min_face_size:
                            rejection_reason = "FACE_TOO_SMALL"
                        elif score < min_confidence:
                            rejection_reason = "LOW_DETECTION_CONFIDENCE"
                        elif blur_score < 20.0:
                            rejection_reason = "TOO_BLURRY"
                        elif brightness < 20.0:
                            rejection_reason = "TOO_DARK"
                        elif brightness > 240.0:
                            rejection_reason = "TOO_BRIGHT"

                    usable = (rejection_reason is None)
                    emb = None

                    if usable and embedder:
                        try:
                            feat = embedder.align_and_extract(img, raw_face)
                            emb = [round(float(x), 6) for x in feat.tolist()]
                        except Exception as align_err:
                            usable = False
                            rejection_reason = f"ALIGNMENT_ERROR: {str(align_err)}"

                    extracted.append({
                        "faceIndex": idx,
                        "bbox": bbox,
                        "detectionConfidence": round(score, 3),
                        "embedding": emb,
                        "quality": {
                            "usable": usable,
                            "rejectionReason": rejection_reason,
                            "blurScore": round(blur_score, 1),
                            "brightness": round(brightness, 1)
                        }
                    })

                del img
                del np_arr

                send_response({
                    "success": True,
                    "faces": extracted
                })

            except Exception as e:
                send_response({
                    "success": False,
                    "error": "PROCESSING_ERROR",
                    "message": str(e),
                    "faces": [],
                    "trace": traceback.format_exc()
                })

        elif command == "aggregate_embeddings":
            embeddings = cmd_data.get("embeddings", [])
            if is_mock or embedder is None:
                # Mock aggregation
                if not embeddings:
                    send_response({"success": False, "error": "NO_EMBEDDINGS"})
                else:
                    arr = np.array(embeddings, dtype=np.float32)
                    mean_v = np.mean(arr, axis=0)
                    norm = np.linalg.norm(mean_v)
                    if norm > 1e-6:
                        mean_v = mean_v / norm
                    send_response({
                        "success": True,
                        "template": [round(float(x), 6) for x in mean_v.tolist()],
                        "samples_count": len(embeddings),
                        "consistency_score": 0.98,
                        "outliers_rejected": 0
                    })
            else:
                agg_res = embedder.aggregate_samples(embeddings)
                send_response(agg_res)

        elif command == "stop":
            send_response({"success": True, "event": "stopping"})
            break

        else:
            send_response({"success": False, "error": "UNKNOWN_COMMAND", "command": command})

    log_event("stopped")

if __name__ == "__main__":
    main()
