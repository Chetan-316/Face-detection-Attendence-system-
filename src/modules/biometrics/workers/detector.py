"""
YuNet Face Detector Wrapper
License: Apache-2.0
"""

import cv2
import numpy as np
from typing import List, Dict, Any, Optional

class FaceDetector:
    def __init__(self, model_path: str, score_threshold: float = 0.4, nms_threshold: float = 0.3):
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

    def detect(self, img: np.ndarray) -> List[Dict[str, Any]]:
        h, w = img.shape[:2]
        if self.current_size != (w, h):
            self.detector.setInputSize((w, h))
            self.current_size = (w, h)

        _, raw_faces = self.detector.detect(img)
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
