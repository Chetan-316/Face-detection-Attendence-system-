"""
Face Embedder & Feature Aggregator Module
License: Apache-2.0
Uses SFace (SphereFace2) model to extract 128-dimensional L2-normalized embeddings,
performs face alignment with 5 landmarks, and handles sample consistency checking and template aggregation.
"""

import cv2
import numpy as np
from typing import List, Dict, Any, Tuple, Optional

class FaceEmbedder:
    def __init__(self, model_path: str, consistency_threshold: float = 0.65):
        self.model_path = model_path
        self.consistency_threshold = consistency_threshold
        self.recognizer = cv2.FaceRecognizerSF.create(model_path, "")

    def align_and_extract(self, img: np.ndarray, raw_face: np.ndarray) -> np.ndarray:
        """
        Aligns the face crop to canonical 112x112 using landmarks, then extracts 128-d feature vector.
        """
        aligned_face = self.recognizer.alignCrop(img, raw_face)
        feature = self.recognizer.feature(aligned_face)
        
        # Flatten and L2 normalize
        feat_1d = feature.flatten().astype(np.float32)
        norm = np.linalg.norm(feat_1d)
        if norm > 1e-6:
            feat_1d = feat_1d / norm
        return feat_1d

    def aggregate_samples(self, embeddings: List[List[float]]) -> Dict[str, Any]:
        """
        Aggregates multiple accepted embeddings into a single consolidated resident template.
        Validates sample consistency by ensuring all samples belong to the same person.
        Rejects outliers and fails if inconsistency is detected.
        """
        if not embeddings or len(embeddings) == 0:
            return {
                "success": False,
                "error": "NO_EMBEDDINGS",
                "message": "At least one accepted embedding is required"
            }

        mat = np.array(embeddings, dtype=np.float32)
        # Ensure L2 normalized
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
                "outliers_rejected": 0
            }

        # Compute centroid (mean vector)
        mean_vec = np.mean(mat, axis=0)
        mean_norm = np.linalg.norm(mean_vec)
        if mean_norm > 1e-6:
            mean_vec = mean_vec / mean_norm

        # Compute cosine similarities of each sample with the mean vector
        similarities = np.dot(mat, mean_vec)

        valid_mask = similarities >= self.consistency_threshold
        valid_count = int(np.sum(valid_mask))
        outliers_count = n_samples - valid_count

        # If too many samples are inconsistent, fail enrollment
        min_required_valid = max(1, int(np.ceil(n_samples * 0.6)))
        if valid_count < min_required_valid:
            return {
                "success": False,
                "error": "INCONSISTENT_SAMPLES",
                "message": f"Captured samples showed significant facial inconsistency ({outliers_count}/{n_samples} inconsistent). Recapture required.",
                "similarities": [round(float(s), 3) for s in similarities],
                "consistency_score": round(float(np.mean(similarities)), 3)
            }

        # Aggregate only valid samples
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
            "outliers_rejected": outliers_count
        }
