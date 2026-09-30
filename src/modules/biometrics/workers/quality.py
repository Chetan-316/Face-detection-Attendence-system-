"""
Face Quality Assessment Module for PRAVAHAx Biometric Pipeline
Enforces the mandatory Single-Face constraint and quality gates:
- NO_FACE
- MULTIPLE_FACES
- FACE_TOO_SMALL
- FACE_OFF_CENTER
- TOO_BLURRY
- TOO_DARK
- TOO_BRIGHT
- LOW_DETECTION_CONFIDENCE
"""

import cv2
import numpy as np
from typing import Dict, Any, List, Optional

class QualityChecker:
    def __init__(
        self,
        min_face_size: int = 80,
        min_size_ratio: float = 0.12,
        min_blur_score: float = 50.0,
        min_brightness: float = 40.0,
        max_brightness: float = 220.0,
        min_confidence: float = 0.65,
        center_margin_ratio: float = 0.20
    ):
        self.min_face_size = min_face_size
        self.min_size_ratio = min_size_ratio
        self.min_blur_score = min_blur_score
        self.min_brightness = min_brightness
        self.max_brightness = max_brightness
        self.min_confidence = min_confidence
        self.center_margin_ratio = center_margin_ratio

    def evaluate(self, img: np.ndarray, detected_faces: List[Dict[str, Any]]) -> Dict[str, Any]:
        h, w = img.shape[:2]
        face_count = len(detected_faces)

        # 1. Exactly one face check
        if face_count == 0:
            return {
                "is_valid": False,
                "rejection_reason": "NO_FACE",
                "message": "No face detected. Please position yourself in front of the camera.",
                "face_count": 0,
                "metrics": None
            }

        if face_count > 1:
            return {
                "is_valid": False,
                "rejection_reason": "MULTIPLE_FACES",
                "message": "Multiple faces detected. Only one person must be visible during enrollment.",
                "face_count": face_count,
                "metrics": None
            }

        face = detected_faces[0]
        bbox = face["bbox"]
        bx, by, bw, bh = bbox["x"], bbox["y"], bbox["width"], bbox["height"]
        confidence = face["score"]

        # Crop face region safely for blur and lighting analysis
        y1 = max(0, by)
        y2 = min(h, by + bh)
        x1 = max(0, bx)
        x2 = min(w, bx + bw)
        face_crop = img[y1:y2, x1:x2]

        if face_crop.size == 0:
            return {
                "is_valid": False,
                "rejection_reason": "FACE_OFF_CENTER",
                "message": "Face is outside the capture frame.",
                "face_count": 1,
                "metrics": None
            }

        gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY) if len(face_crop.shape) == 3 else face_crop
        blur_score = float(cv2.Laplacian(gray_crop, cv2.CV_64F).var())
        brightness = float(np.mean(gray_crop))

        # Check Center Region
        cx = bx + bw / 2.0
        cy = by + bh / 2.0
        min_cx = w * self.center_margin_ratio
        max_cx = w * (1.0 - self.center_margin_ratio)
        min_cy = h * self.center_margin_ratio
        max_cy = h * (1.0 - self.center_margin_ratio)

        metrics = {
            "face_count": 1,
            "confidence": round(confidence, 3),
            "blur_score": round(blur_score, 1),
            "brightness": round(brightness, 1),
            "bbox": bbox,
            "frame_width": w,
            "frame_height": h,
        }

        # 2. Confidence check
        if confidence < self.min_confidence:
            return {
                "is_valid": False,
                "rejection_reason": "LOW_DETECTION_CONFIDENCE",
                "message": "Detection confidence is low. Please face the camera directly.",
                "metrics": metrics
            }

        # 3. Size check
        if bw < self.min_face_size or bh < self.min_face_size or bw < (w * self.min_size_ratio) or bh < (h * self.min_size_ratio):
            return {
                "is_valid": False,
                "rejection_reason": "FACE_TOO_SMALL",
                "message": "Please move closer to the camera.",
                "metrics": metrics
            }

        # 4. Off center check
        if cx < min_cx or cx > max_cx or cy < min_cy or cy > max_cy:
            return {
                "is_valid": False,
                "rejection_reason": "FACE_OFF_CENTER",
                "message": "Please center your face inside the capture region.",
                "metrics": metrics
            }

        # 5. Blur check
        if blur_score < self.min_blur_score:
            return {
                "is_valid": False,
                "rejection_reason": "TOO_BLURRY",
                "message": "Image is blurry. Please hold still.",
                "metrics": metrics
            }

        # 6. Lighting checks
        if brightness < self.min_brightness:
            return {
                "is_valid": False,
                "rejection_reason": "TOO_DARK",
                "message": "Lighting is too low. Please improve illumination.",
                "metrics": metrics
            }

        if brightness > self.max_brightness:
            return {
                "is_valid": False,
                "rejection_reason": "TOO_BRIGHT",
                "message": "Image is overexposed. Please adjust lighting or avoid direct glare.",
                "metrics": metrics
            }

        # All quality checks passed!
        return {
            "is_valid": True,
            "rejection_reason": None,
            "message": "Good quality face sample detected.",
            "metrics": metrics
        }
