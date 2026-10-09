"""
PRAVAHAx face detector abstraction.

legacy engine: OpenCV YuNet
scrfd_adaface engine: SCRFD 2.5G KPS through ONNX Runtime

The public FaceDetector interface remains stable so enrollment and recognition
services do not need to know which detector is active.
"""

from typing import Any, Dict, List, Optional

import cv2
import numpy as np

from model_loader import ACTIVE_ENGINE


class _YuNetDetector:
    def __init__(
        self,
        model_path: str,
        score_threshold: float = 0.15,
        nms_threshold: float = 0.3,
    ):
        self.model_path = model_path
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        self.detector = cv2.FaceDetectorYN.create(
            model_path,
            "",
            (320, 320),
            score_threshold=score_threshold,
            nms_threshold=nms_threshold,
            top_k=5000,
        )
        self.current_size = (320, 320)
        try:
            self.haar = cv2.CascadeClassifier(
                cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            )
        except Exception:
            self.haar = None

    def detect(
        self, img: np.ndarray, expected_pose: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        if np.std(gray) <= 10.0:
            return []

        if self.current_size != (w, h):
            self.detector.setInputSize((w, h))
            self.current_size = (w, h)

        _, raw_faces = self.detector.detect(img)
        if raw_faces is None or len(raw_faces) == 0:
            self.detector.setScoreThreshold(0.10)
            _, raw_faces = self.detector.detect(img)
            self.detector.setScoreThreshold(self.score_threshold)

        if (raw_faces is None or len(raw_faces) == 0) and self.haar is not None:
            try:
                cascade_faces = self.haar.detectMultiScale(
                    gray,
                    scaleFactor=1.1,
                    minNeighbors=4,
                    minSize=(50, 50),
                )
                if len(cascade_faces) > 0:
                    fx, fy, fw, fh = cascade_faces[0]
                    raw_faces = [
                        np.array(
                            [
                                float(fx),
                                float(fy),
                                float(fw),
                                float(fh),
                                float(fx + fw * 0.3),
                                float(fy + fh * 0.38),
                                float(fx + fw * 0.7),
                                float(fy + fh * 0.38),
                                float(fx + fw * 0.5),
                                float(fy + fh * 0.55),
                                float(fx + fw * 0.35),
                                float(fy + fh * 0.75),
                                float(fx + fw * 0.65),
                                float(fy + fh * 0.75),
                                0.85,
                            ],
                            dtype=np.float32,
                        )
                    ]
            except Exception:
                pass

        # The new engine never fabricates an enrollment face. Keep legacy behavior
        # conservative as well: if detection fails, enrollment must ask for recapture.
        if raw_faces is None or len(raw_faces) == 0:
            return []

        results: List[Dict[str, Any]] = []
        for face in raw_faces:
            x, y, bw, bh = face[0:4]
            landmarks = [
                {"name": "right_eye", "x": float(face[4]), "y": float(face[5])},
                {"name": "left_eye", "x": float(face[6]), "y": float(face[7])},
                {"name": "nose_tip", "x": float(face[8]), "y": float(face[9])},
                {"name": "right_mouth", "x": float(face[10]), "y": float(face[11])},
                {"name": "left_mouth", "x": float(face[12]), "y": float(face[13])},
            ]
            results.append(
                {
                    "bbox": {
                        "x": int(max(0, x)),
                        "y": int(max(0, y)),
                        "width": int(max(0, bw)),
                        "height": int(max(0, bh)),
                    },
                    "score": float(face[-1]),
                    "landmarks": landmarks,
                    "raw_face": face,
                }
            )
        return results


class _SCRFDDetector:
    """Minimal SCRFD ONNX inference wrapper with five-landmark decoding."""

    def __init__(
        self,
        model_path: str,
        score_threshold: float = 0.45,
        nms_threshold: float = 0.4,
        input_size=(640, 640),
    ):
        import onnxruntime as ort

        self.model_path = model_path
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        self.input_size = tuple(input_size)
        self.center_cache: Dict[Any, np.ndarray] = {}

        available = ort.get_available_providers()
        requested = []
        if "CUDAExecutionProvider" in available:
            requested.append("CUDAExecutionProvider")
        requested.append("CPUExecutionProvider")

        self.session = ort.InferenceSession(model_path, providers=requested)
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [o.name for o in self.session.get_outputs()]
        output_count = len(self.output_names)

        if output_count == 9:
            self.feature_strides = [8, 16, 32]
            self.num_anchors = 2
            self.use_kps = True
        elif output_count == 15:
            self.feature_strides = [8, 16, 32, 64, 128]
            self.num_anchors = 1
            self.use_kps = True
        else:
            raise RuntimeError(
                f"SCRFD KPS model must expose 9 or 15 outputs; found {output_count}."
            )

    @staticmethod
    def _distance_to_bbox(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
        x1 = points[:, 0] - distance[:, 0]
        y1 = points[:, 1] - distance[:, 1]
        x2 = points[:, 0] + distance[:, 2]
        y2 = points[:, 1] + distance[:, 3]
        return np.stack([x1, y1, x2, y2], axis=-1)

    @staticmethod
    def _distance_to_kps(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
        preds = []
        for idx in range(0, distance.shape[1], 2):
            preds.append(points[:, idx % 2] + distance[:, idx])
            preds.append(points[:, idx % 2 + 1] + distance[:, idx + 1])
        return np.stack(preds, axis=-1)

    def _anchor_centers(
        self, input_height: int, input_width: int, stride: int
    ) -> np.ndarray:
        key = (input_height, input_width, stride, self.num_anchors)
        cached = self.center_cache.get(key)
        if cached is not None:
            return cached

        height = input_height // stride
        width = input_width // stride
        centers = np.stack(np.mgrid[:height, :width][::-1], axis=-1).astype(
            np.float32
        )
        centers = (centers * stride).reshape((-1, 2))
        if self.num_anchors > 1:
            centers = np.stack(
                [centers] * self.num_anchors, axis=1
            ).reshape((-1, 2))
        if len(self.center_cache) < 100:
            self.center_cache[key] = centers
        return centers

    @staticmethod
    def _flatten_output(arr: np.ndarray, columns: int) -> np.ndarray:
        out = np.asarray(arr)
        if out.ndim >= 3 and out.shape[0] == 1:
            out = out[0]
        return out.reshape((-1, columns))

    def _nms(self, det: np.ndarray) -> List[int]:
        if det.size == 0:
            return []

        x1, y1, x2, y2, scores = (
            det[:, 0],
            det[:, 1],
            det[:, 2],
            det[:, 3],
            det[:, 4],
        )
        areas = np.maximum(0.0, x2 - x1 + 1) * np.maximum(0.0, y2 - y1 + 1)
        order = scores.argsort()[::-1]
        keep: List[int] = []

        while order.size > 0:
            i = int(order[0])
            keep.append(i)
            if order.size == 1:
                break
            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])

            w = np.maximum(0.0, xx2 - xx1 + 1)
            h = np.maximum(0.0, yy2 - yy1 + 1)
            inter = w * h
            union = areas[i] + areas[order[1:]] - inter
            iou = np.divide(
                inter,
                np.maximum(union, 1e-6),
                out=np.zeros_like(inter),
                where=union > 0,
            )
            remaining = np.where(iou <= self.nms_threshold)[0]
            order = order[remaining + 1]

        return keep

    def detect(
        self, img: np.ndarray, expected_pose: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        if img is None or img.size == 0:
            return []

        original_h, original_w = img.shape[:2]
        if original_h <= 0 or original_w <= 0:
            return []

        input_w, input_h = self.input_size
        image_ratio = original_h / float(original_w)
        model_ratio = input_h / float(input_w)

        if image_ratio > model_ratio:
            new_h = input_h
            new_w = max(1, int(new_h / image_ratio))
        else:
            new_w = input_w
            new_h = max(1, int(new_w * image_ratio))

        det_scale = new_h / float(original_h)
        resized = cv2.resize(img, (new_w, new_h))
        canvas = np.zeros((input_h, input_w, 3), dtype=np.uint8)
        canvas[:new_h, :new_w] = resized

        blob = cv2.dnn.blobFromImage(
            canvas,
            scalefactor=1.0 / 128.0,
            size=(input_w, input_h),
            mean=(127.5, 127.5, 127.5),
            swapRB=True,
        )
        outputs = self.session.run(
            self.output_names, {self.input_name: blob.astype(np.float32)}
        )

        fmc = len(self.feature_strides)
        scores_all = []
        bboxes_all = []
        kps_all = []

        for idx, stride in enumerate(self.feature_strides):
            scores = self._flatten_output(outputs[idx], 1).reshape(-1)
            bbox_pred = self._flatten_output(outputs[idx + fmc], 4) * stride
            kps_pred = self._flatten_output(outputs[idx + fmc * 2], 10) * stride
            centers = self._anchor_centers(input_h, input_w, stride)

            count = min(
                len(scores), len(bbox_pred), len(kps_pred), len(centers)
            )
            if count <= 0:
                continue

            scores = scores[:count]
            bbox_pred = bbox_pred[:count]
            kps_pred = kps_pred[:count]
            centers = centers[:count]

            positive = np.where(scores >= self.score_threshold)[0]
            if positive.size == 0:
                continue

            bboxes = self._distance_to_bbox(
                centers, bbox_pred
            )[positive]
            kps = self._distance_to_kps(
                centers, kps_pred
            )[positive].reshape((-1, 5, 2))

            scores_all.append(scores[positive])
            bboxes_all.append(bboxes)
            kps_all.append(kps)

        if not scores_all:
            return []

        scores = np.concatenate(scores_all, axis=0)
        bboxes = np.concatenate(bboxes_all, axis=0) / det_scale
        kps = np.concatenate(kps_all, axis=0) / det_scale

        det = np.concatenate([bboxes, scores[:, None]], axis=1)
        order = scores.argsort()[::-1]
        det = det[order]
        kps = kps[order]

        keep = self._nms(det)
        det = det[keep]
        kps = kps[keep]

        results: List[Dict[str, Any]] = []
        for idx in range(det.shape[0]):
            x1, y1, x2, y2, score = det[idx]
            x1 = float(np.clip(x1, 0, original_w - 1))
            y1 = float(np.clip(y1, 0, original_h - 1))
            x2 = float(np.clip(x2, 0, original_w - 1))
            y2 = float(np.clip(y2, 0, original_h - 1))
            bw = max(0.0, x2 - x1)
            bh = max(0.0, y2 - y1)

            # SCRFD landmark order is image-left eye, image-right eye, nose,
            # image-left mouth, image-right mouth. Existing quality code names
            # those by the subject's anatomy.
            pts = kps[idx]
            landmarks = [
                {"name": "right_eye", "x": float(pts[0][0]), "y": float(pts[0][1])},
                {"name": "left_eye", "x": float(pts[1][0]), "y": float(pts[1][1])},
                {"name": "nose_tip", "x": float(pts[2][0]), "y": float(pts[2][1])},
                {"name": "right_mouth", "x": float(pts[3][0]), "y": float(pts[3][1])},
                {"name": "left_mouth", "x": float(pts[4][0]), "y": float(pts[4][1])},
            ]

            results.append(
                {
                    "bbox": {
                        "x": int(round(x1)),
                        "y": int(round(y1)),
                        "width": int(round(bw)),
                        "height": int(round(bh)),
                    },
                    "score": float(score),
                    "landmarks": landmarks,
                    "raw_face": None,
                }
            )

        return results


class FaceDetector:
    def __init__(
        self,
        model_path: str,
        score_threshold: Optional[float] = None,
        nms_threshold: Optional[float] = None,
    ):
        if ACTIVE_ENGINE == "scrfd_adaface":
            self.impl = _SCRFDDetector(
                model_path,
                score_threshold=score_threshold
                if score_threshold is not None
                else float(
                    __import__("os").environ.get("SCRFD_SCORE_THRESHOLD", "0.45")
                ),
                nms_threshold=nms_threshold
                if nms_threshold is not None
                else float(
                    __import__("os").environ.get("SCRFD_NMS_THRESHOLD", "0.4")
                ),
            )
        else:
            self.impl = _YuNetDetector(
                model_path,
                score_threshold=score_threshold if score_threshold is not None else 0.15,
                nms_threshold=nms_threshold if nms_threshold is not None else 0.3,
            )

    def detect(
        self, img: np.ndarray, expected_pose: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        return self.impl.detect(img, expected_pose=expected_pose)
