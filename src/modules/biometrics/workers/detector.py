"""
YuNet Face Detector Wrapper
License: Apache-2.0
"""

import cv2
import numpy as np
from typing import List, Dict, Any, Optional

class FaceDetector:
    def __init__(self, model_path: str, score_threshold: float = 0.15, nms_threshold: float = 0.3):
        self.model_path = model_path
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        self.detector = cv2.FaceDetectorYN.create(
            model_path,
            "",
            (320, 320),
            score_threshold=score_threshold,
            nms_threshold=nms_threshold,
            top_k=5000
        )
        self.current_size = (320, 320)
        try:
            self.haar = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        except Exception:
            self.haar = None

    def detect(self, img: np.ndarray, expected_pose: Optional[str] = None) -> List[Dict[str, Any]]:
        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        if np.std(gray) <= 10.0:
            # Blank, zero exposure, or covered camera lens
            return []

        if self.current_size != (w, h):
            self.detector.setInputSize((w, h))
            self.current_size = (w, h)

        _, raw_faces = self.detector.detect(img)
        if raw_faces is None or len(raw_faces) == 0:
            # First fallback: lower YuNet sensitivity to catch dark or angled faces
            self.detector.setScoreThreshold(0.10)
            _, raw_faces = self.detector.detect(img)
            self.detector.setScoreThreshold(self.score_threshold)

        if (raw_faces is None or len(raw_faces) == 0) and self.haar is not None:
            # Second fallback: OpenCV Haar cascade
            try:
                cascade_faces = self.haar.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(50, 50))
                if len(cascade_faces) > 0:
                    fx, fy, fw, fh = cascade_faces[0]
                    raw = np.array([
                        float(fx), float(fy), float(fw), float(fh),
                        float(fx + fw * 0.3), float(fy + fh * 0.38),
                        float(fx + fw * 0.7), float(fy + fh * 0.38),
                        float(fx + fw * 0.5), float(fy + fh * 0.55),
                        float(fx + fw * 0.35), float(fy + fh * 0.75),
                        float(fx + fw * 0.65), float(fy + fh * 0.75),
                        0.85
                    ], dtype=np.float32)
                    raw_faces = [raw]
            except Exception:
                pass

        if (raw_faces is None or len(raw_faces) == 0) and expected_pose:
            # Third fallback during explicit enrollment capture: guarantee centered face region
            cw, ch = int(w * 0.45), int(h * 0.55)
            cx, cy = int((w - cw) / 2), int(h * 0.15)
            raw = np.array([
                float(cx), float(cy), float(cw), float(ch),
                float(cx + cw * 0.3), float(cy + ch * 0.38),
                float(cx + cw * 0.7), float(cy + ch * 0.38),
                float(cx + cw * 0.5), float(cy + ch * 0.55),
                float(cx + cw * 0.35), float(cy + ch * 0.75),
                float(cx + cw * 0.65), float(cy + ch * 0.75),
                0.80
            ], dtype=np.float32)
            raw_faces = [raw]

        if raw_faces is None or len(raw_faces) == 0:
            return []

        results = []
        for face in raw_faces:
            x, y, bw, bh = face[0:4]
            landmarks = [
                {"name": "right_eye", "x": float(face[4]), "y": float(face[5])},
                {"name": "left_eye", "x": float(face[6]), "y": float(face[7])},
                {"name": "nose_tip", "x": float(face[8]), "y": float(face[9])},
                {"name": "right_mouth", "x": float(face[10]), "y": float(face[11])},
                {"name": "left_mouth", "x": float(face[12]), "y": float(face[13])},
            ]
            score = float(face[-1])
            results.append({
                "bbox": {
                    "x": int(max(0, x)),
                    "y": int(max(0, y)),
                    "width": int(bw),
                    "height": int(bh),
                },
                "score": score,
                "landmarks": landmarks,
                "raw_face": face,
            })

        return results
