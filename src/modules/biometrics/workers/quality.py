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
        min_face_size: int = 60,
        min_size_ratio: float = 0.10,
        min_blur_score: float = 40.0,
        min_brightness: float = 35.0,
        max_brightness: float = 230.0,
        min_confidence: float = 0.50,
        center_margin_ratio: float = 0.12
    ):
        self.min_face_size = min_face_size
        self.min_size_ratio = min_size_ratio
        self.min_blur_score = min_blur_score
        self.min_brightness = min_brightness
        self.max_brightness = max_brightness
        self.min_confidence = min_confidence
        self.center_margin_ratio = center_margin_ratio

    def classify_pose(self, landmarks: List[Dict[str, float]], bbox: Dict[str, int]) -> str:
        """
        Classifies head pose into FRONT, LEFT, RIGHT, UP, DOWN
        using YuNet facial landmark geometry.
        Landmark indices:
        0: right_eye (subject's right eye, image left)
        1: left_eye (subject's left eye, image right)
        2: nose_tip
        3: right_mouth
        4: left_mouth
        """
        if not landmarks or len(landmarks) < 5:
            return "FRONT"

        import math
        r_eye = landmarks[0]
        l_eye = landmarks[1]
        nose = landmarks[2]
        r_mouth = landmarks[3]
        l_mouth = landmarks[4]

        d_right_eye = math.hypot(nose["x"] - r_eye["x"], nose["y"] - r_eye["y"])
        d_left_eye = math.hypot(nose["x"] - l_eye["x"], nose["y"] - l_eye["y"])
        total_eye_dist = d_right_eye + d_left_eye

        if total_eye_dist <= 0:
            return "FRONT"

        # Eye asymmetry:
        # Turning to subject's left (nose closer to left eye): d_left_eye < d_right_eye -> asymmetry > 0
        # Turning to subject's right (nose closer to right eye): d_right_eye < d_left_eye -> asymmetry < 0
        eye_asymmetry = (d_right_eye - d_left_eye) / total_eye_dist

        # Vertical ratio: nose relative to eye-line and mouth-line
        eye_mid_y = (r_eye["y"] + l_eye["y"]) / 2.0
        mouth_mid_y = (r_mouth["y"] + l_mouth["y"]) / 2.0
        vert_span = mouth_mid_y - eye_mid_y

        if vert_span > 0:
            vert_ratio = (nose["y"] - eye_mid_y) / vert_span
        else:
            vert_ratio = 0.55

        # Check vertical pitch if horizontal yaw is relatively centered
        if abs(eye_asymmetry) < 0.22:
            if vert_ratio < 0.44:
                return "UP"
            elif vert_ratio > 0.68:
                return "DOWN"

        # Check horizontal yaw
        if eye_asymmetry > 0.15:
            return "LEFT"
        elif eye_asymmetry < -0.15:
            return "RIGHT"

        # Check vertical pitch if not strongly turned
        if vert_ratio < 0.44:
            return "UP"
        elif vert_ratio > 0.68:
            return "DOWN"

        return "FRONT"

    def evaluate(self, img: np.ndarray, detected_faces: List[Dict[str, Any]]) -> Dict[str, Any]:
        h, w = img.shape[:2]
        face_count = len(detected_faces)

        # 1. Exactly one face check
        if face_count == 0:
            return {
                "is_valid": False,
                "rejection_reason": "NO_FACE",
                "message": "Position your face in front of the camera.",
                "face_count": 0,
                "detected_pose": None,
                "metrics": None
            }

        if face_count > 1:
            return {
                "is_valid": False,
                "rejection_reason": "MULTIPLE_FACES",
                "message": "Only one person should be visible.",
                "face_count": face_count,
                "detected_pose": None,
                "metrics": None
            }

        face = detected_faces[0]
        bbox = face["bbox"]
        bx, by, bw, bh = bbox["x"], bbox["y"], bbox["width"], bbox["height"]
        confidence = face["score"]
        landmarks = face.get("landmarks", [])

        detected_pose = self.classify_pose(landmarks, bbox)

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
                "message": "Center your face inside the guide.",
                "face_count": 1,
                "detected_pose": detected_pose,
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
            "detected_pose": detected_pose,
            "bbox": bbox,
            "frame_width": w,
            "frame_height": h,
        }

        # 2. Confidence check
        if confidence < self.min_confidence:
            return {
                "is_valid": False,
                "rejection_reason": "LOW_DETECTION_CONFIDENCE",
                "message": "Look straight at the camera.",
                "face_count": 1,
                "detected_pose": detected_pose,
                "metrics": metrics
            }

        # 3. Size check
        if bw < self.min_face_size or bh < self.min_face_size or bw < (w * self.min_size_ratio) or bh < (h * self.min_size_ratio):
            return {
                "is_valid": False,
                "rejection_reason": "FACE_TOO_SMALL",
                "message": "Move closer.",
                "face_count": 1,
                "detected_pose": detected_pose,
                "metrics": metrics
            }

        # 4. Off center check
        if cx < min_cx or cx > max_cx or cy < min_cy or cy > max_cy:
            return {
                "is_valid": False,
                "rejection_reason": "FACE_OFF_CENTER",
                "message": "Center your face inside the guide.",
                "face_count": 1,
                "detected_pose": detected_pose,
                "metrics": metrics
            }

        # 5. Blur check
        if blur_score < self.min_blur_score:
            return {
                "is_valid": False,
                "rejection_reason": "TOO_BLURRY",
                "message": "Hold still.",
                "face_count": 1,
                "detected_pose": detected_pose,
                "metrics": metrics
            }

        # 6. Lighting checks
        if brightness < self.min_brightness:
            return {
                "is_valid": False,
                "rejection_reason": "TOO_DARK",
                "message": "Improve the lighting.",
                "face_count": 1,
                "detected_pose": detected_pose,
                "metrics": metrics
            }

        if brightness > self.max_brightness:
            return {
                "is_valid": False,
                "rejection_reason": "TOO_BRIGHT",
                "message": "Move away from direct glare.",
                "face_count": 1,
                "detected_pose": detected_pose,
                "metrics": metrics
            }

        # All quality checks passed!
        return {
            "is_valid": True,
            "rejection_reason": None,
            "message": "Good quality face sample detected.",
            "face_count": 1,
            "detected_pose": detected_pose,
            "metrics": metrics
        }
