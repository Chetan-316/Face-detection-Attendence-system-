"""
PRAVAHAx face embedding abstraction.

legacy engine: OpenCV SFace, 128-D
scrfd_adaface engine: AdaFace IR50 ONNX, 512-D

Both paths return L2-normalized vectors and share the same aggregation contract.
"""

from typing import Any, Dict, List, Optional
import os

import cv2
import numpy as np

from model_loader import ACTIVE_ENGINE


class _BaseAggregator:
    def __init__(self, consistency_threshold: float):
        self.consistency_threshold = consistency_threshold

    def aggregate_samples(self, embeddings: List[List[float]]) -> Dict[str, Any]:
        if not embeddings:
            return {
                "success": False,
                "error": "NO_EMBEDDINGS",
                "message": "At least one accepted embedding is required",
            }

        mat = np.array(embeddings, dtype=np.float32)
        if mat.ndim != 2:
            return {
                "success": False,
                "error": "INVALID_EMBEDDINGS",
                "message": "Embedding samples must have a consistent vector dimension",
            }

        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms < 1e-6] = 1.0
        mat = mat / norms

        n_samples = len(mat)
        if n_samples == 1:
            return {
                "success": True,
                "template": mat[0].tolist(),
                "samples_count": 1,
                "consistency_score": 1.0,
                "outliers_rejected": 0,
            }

        mean_vec = np.mean(mat, axis=0)
        mean_norm = np.linalg.norm(mean_vec)
        if mean_norm > 1e-6:
            mean_vec = mean_vec / mean_norm

        similarities = np.dot(mat, mean_vec)
        valid_mask = similarities >= self.consistency_threshold
        valid_count = int(np.sum(valid_mask))
        outliers_count = n_samples - valid_count

        min_required_valid = max(1, int(np.ceil(n_samples * 0.6)))
        if valid_count < min_required_valid:
            return {
                "success": False,
                "error": "INCONSISTENT_SAMPLES",
                "message": (
                    "Captured samples showed significant facial inconsistency "
                    f"({outliers_count}/{n_samples} inconsistent). Recapture required."
                ),
                "similarities": [round(float(s), 3) for s in similarities],
                "consistency_score": round(float(np.mean(similarities)), 3),
            }

        valid_samples = mat[valid_mask]
        final_template = np.mean(valid_samples, axis=0)
        final_norm = np.linalg.norm(final_template)
        if final_norm > 1e-6:
            final_template = final_template / final_norm

        consistency_score = float(np.mean(similarities[valid_mask]))
        return {
            "success": True,
            "template": [round(float(x), 6) for x in final_template.tolist()],
            "samples_count": valid_count,
            "consistency_score": round(consistency_score, 3),
            "outliers_rejected": outliers_count,
        }


class _SFaceEmbedder(_BaseAggregator):
    def __init__(self, model_path: str, consistency_threshold: float = 0.40):
        super().__init__(consistency_threshold)
        self.model_path = model_path
        self.recognizer = cv2.FaceRecognizerSF.create(model_path, "")

    def align_and_extract(self, img: np.ndarray, face: Dict[str, Any]) -> np.ndarray:
        raw_face = face.get("raw_face")
        if raw_face is None:
            raise RuntimeError("SFace requires YuNet raw face landmarks for alignment")

        aligned_face = self.recognizer.alignCrop(img, raw_face)
        feature = self.recognizer.feature(aligned_face)
        feat = feature.flatten().astype(np.float32)
        norm = np.linalg.norm(feat)
        if norm > 1e-6:
            feat = feat / norm
        return feat


class _AdaFaceEmbedder(_BaseAggregator):
    """AdaFace IR50 ONNX inference on five-point aligned 112x112 RGB crops."""

    # Canonical ArcFace/AdaFace five-point target for 112x112 aligned faces.
    _DST = np.array(
        [
            [38.2946, 51.6963],
            [73.5318, 51.5014],
            [56.0252, 71.7366],
            [41.5493, 92.3655],
            [70.7299, 92.2041],
        ],
        dtype=np.float32,
    )

    def __init__(self, model_path: str, consistency_threshold: float = 0.35):
        import onnxruntime as ort

        super().__init__(consistency_threshold)
        self.model_path = model_path
        self.color_space = os.environ.get("ADAFACE_COLOR_SPACE", "RGB").strip().upper()
        if self.color_space not in {"RGB", "BGR"}:
            raise RuntimeError(
                f"Unsupported ADAFACE_COLOR_SPACE '{self.color_space}'. Use RGB or BGR."
            )

        available = ort.get_available_providers()
        providers = []
        if "CUDAExecutionProvider" in available:
            providers.append("CUDAExecutionProvider")
        providers.append("CPUExecutionProvider")

        self.session = ort.InferenceSession(model_path, providers=providers)
        self.input = self.session.get_inputs()[0]
        self.input_name = self.input.name
        self.outputs = self.session.get_outputs()

    @staticmethod
    def _landmark_map(face: Dict[str, Any]) -> Dict[str, Any]:
        landmarks = face.get("landmarks") or []
        return {
            item.get("name"): item
            for item in landmarks
            if isinstance(item, dict) and item.get("name")
        }

    def _align(self, img: np.ndarray, face: Dict[str, Any]) -> np.ndarray:
        lm = self._landmark_map(face)
        required = [
            "right_eye",
            "left_eye",
            "nose_tip",
            "right_mouth",
            "left_mouth",
        ]
        if any(name not in lm for name in required):
            raise RuntimeError("AdaFace alignment requires five SCRFD landmarks")

        src = np.array(
            [
                [lm["right_eye"]["x"], lm["right_eye"]["y"]],
                [lm["left_eye"]["x"], lm["left_eye"]["y"]],
                [lm["nose_tip"]["x"], lm["nose_tip"]["y"]],
                [lm["right_mouth"]["x"], lm["right_mouth"]["y"]],
                [lm["left_mouth"]["x"], lm["left_mouth"]["y"]],
            ],
            dtype=np.float32,
        )

        matrix, _ = cv2.estimateAffinePartial2D(
            src,
            self._DST,
            method=cv2.LMEDS,
        )
        if matrix is None:
            raise RuntimeError("Could not estimate face alignment transform")

        return cv2.warpAffine(
            img,
            matrix,
            (112, 112),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )

    def _preprocess(self, aligned_bgr: np.ndarray) -> np.ndarray:
        model_image = (
            cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2RGB)
            if self.color_space == "RGB"
            else aligned_bgr
        )
        arr = model_image.astype(np.float32) / 255.0
        arr = (arr - 0.5) / 0.5
        arr = np.transpose(arr, (2, 0, 1))[None, ...]
        return np.ascontiguousarray(arr, dtype=np.float32)

    def _select_embedding_output(self, outputs: List[np.ndarray]) -> np.ndarray:
        candidates = []
        for out in outputs:
            arr = np.asarray(out)
            flat = arr.reshape(-1)
            candidates.append(flat)
            if flat.size == 512:
                return flat.astype(np.float32)

        if not candidates:
            raise RuntimeError("AdaFace model produced no outputs")

        # Fail loudly instead of silently accepting an incompatible export.
        sizes = [int(c.size) for c in candidates]
        raise RuntimeError(
            f"AdaFace ONNX must expose a 512-D embedding output; got output sizes {sizes}"
        )

    def align_and_extract(self, img: np.ndarray, face: Dict[str, Any]) -> np.ndarray:
        aligned = self._align(img, face)
        tensor = self._preprocess(aligned)
        outputs = self.session.run(None, {self.input_name: tensor})
        feat = self._select_embedding_output(outputs)

        norm = np.linalg.norm(feat)
        if norm <= 1e-6:
            raise RuntimeError("AdaFace produced a zero-norm embedding")
        return feat / norm


class FaceEmbedder:
    def __init__(self, model_path: str, consistency_threshold: Optional[float] = None):
        if ACTIVE_ENGINE == "scrfd_adaface":
            threshold = (
                consistency_threshold
                if consistency_threshold is not None
                else 0.35
            )
            self.impl = _AdaFaceEmbedder(model_path, threshold)
        else:
            threshold = (
                consistency_threshold
                if consistency_threshold is not None
                else 0.40
            )
            self.impl = _SFaceEmbedder(model_path, threshold)

    def align_and_extract(self, img: np.ndarray, face: Dict[str, Any]) -> np.ndarray:
        return self.impl.align_and_extract(img, face)

    def aggregate_samples(self, embeddings: List[List[float]]) -> Dict[str, Any]:
        return self.impl.aggregate_samples(embeddings)
