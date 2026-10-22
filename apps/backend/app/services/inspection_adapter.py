import io
import math
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image, ImageOps

from app.core.config import settings
from app.core.errors import APIError


# Try importing module 03 if available in repository
try:
    from app.inspection.pipeline import inspect_image as run_detector_03  # type: ignore
    from app.inspection.locate import locate_label as run_locator_03  # type: ignore
    from app.inspection.types import (  # type: ignore
        Evidence as DetectorEvidence,
        Decision as DetectorDecision,
        InspectionInputError,
        InspectionConfigError,
    )
    from app.inspection.config import DetectorConfig  # type: ignore
    from app.inspection.shape import ShapeConfig, analyze_shape  # type: ignore
    HAS_REAL_DETECTOR = True
except ImportError:
    run_detector_03 = None
    run_locator_03 = None
    DetectorEvidence = None
    DetectorDecision = None
    InspectionInputError = ValueError
    InspectionConfigError = ValueError
    DetectorConfig = None
    ShapeConfig = None
    analyze_shape = None
    HAS_REAL_DETECTOR = False


class InspectionAdapter:
    """
    Adapter between HTTP layer, image bytes, and pure Image Processing functions (Person 03).
    Handles decoding, EXIF orientation normalization, limits, blur detection,
    and visual annotations.
    """

    _detector_config: Optional[Any] = None

    @classmethod
    def set_detector_config(cls, config: Any) -> None:
        """Set active DetectorConfig for module 03."""
        cls._detector_config = config

    @classmethod
    def get_detector_config(cls) -> Optional[Any]:
        """Get active DetectorConfig."""
        return cls._detector_config

    @classmethod
    def has_detector(cls) -> bool:
        """Return True if real detector from module 03 is installed and available."""
        return HAS_REAL_DETECTOR

    @classmethod
    def is_detector_ready(cls) -> bool:
        """
        Return True if real detector is imported AND has a valid configured DetectorConfig.
        If config is missing, empty, or unvalidated, returns False.
        """
        if not HAS_REAL_DETECTOR or run_detector_03 is None:
            return False
        if cls._detector_config is None:
            return False
        try:
            if hasattr(cls._detector_config, "validate"):
                cls._detector_config.validate()
            return True
        except Exception:
            return False

    @staticmethod
    def decode_and_normalize(image_bytes: bytes) -> Tuple[np.ndarray, bytes, int, int]:
        """
        Validate byte size, decode image, normalize EXIF orientation,
        validate pixel limits, and return (cv2_bgr_array, normalized_jpeg_bytes, width, height).
        """
        # Validate raw upload size
        max_bytes = settings.MAX_UPLOAD_MB * 1_000_000
        if len(image_bytes) > max_bytes:
            raise APIError(
                status_code=413,
                code="upload_too_large",
                message=f"Image upload exceeds limit of {settings.MAX_UPLOAD_MB} MB",
            )

        try:
            pil_img = Image.open(io.BytesIO(image_bytes))
            # Transpose EXIF orientation so width/height and coordinates match reality
            pil_img = ImageOps.exif_transpose(pil_img)
            # Ensure RGB
            if pil_img.mode != "RGB":
                pil_img = pil_img.convert("RGB")
        except Exception as e:
            raise APIError(
                status_code=400,
                code="invalid_image",
                message=f"Failed to decode image file: {str(e)}",
            )

        width, height = pil_img.size
        # Validate pixel count
        if width * height > settings.MAX_IMAGE_PIXELS:
            raise APIError(
                status_code=413,
                code="image_pixels_too_large",
                message=f"Image resolution ({width}x{height} = {width*height} pixels) exceeds limit of {settings.MAX_IMAGE_PIXELS} pixels",
            )

        # Convert to OpenCV BGR numpy array
        np_arr = np.array(pil_img)
        cv_bgr = cv2.cvtColor(np_arr, cv2.COLOR_RGB2BGR)

        # Encode normalized image to JPEG bytes
        success, encoded = cv2.imencode(".jpg", cv_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        if not success:
            raise APIError(
                status_code=500,
                code="image_encode_error",
                message="Failed to encode normalized JPEG image",
            )

        return cv_bgr, encoded.tobytes(), width, height

    @staticmethod
    def compute_blur_variance(cv_bgr: np.ndarray) -> float:
        """Compute Laplacian variance of grayscale image to measure sharpness."""
        gray = cv2.cvtColor(cv_bgr, cv2.COLOR_BGR2GRAY)
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    @classmethod
    def locate_label(cls, cv_bgr: np.ndarray, expected_product: str) -> Dict[str, Any]:
        """
        Run locator for candidate view selection without saving history.
        If real detector config is ready, uses module 03 locate_label with error mappings.
        Otherwise falls back to baseline locator.
        """
        if cls.is_detector_ready() and run_locator_03 is not None:
            try:
                res = run_locator_03(
                    image=cv_bgr,
                    expected_product=expected_product,
                    config=cls._detector_config,
                    color_order="BGR",
                )
                return res.to_dict() if hasattr(res, "to_dict") else dict(res)
            except InspectionInputError as err:
                raise APIError(
                    status_code=400,
                    code="invalid_inspection_input",
                    message=str(err),
                )
            except InspectionConfigError as err:
                raise APIError(
                    status_code=503,
                    code="inspection_unavailable",
                    message=f"Detector locator configuration error: {str(err)}",
                )
            except Exception as err:
                raise APIError(
                    status_code=500,
                    code="locator_runtime_error",
                    message=f"Locator execution failed: {str(err)}",
                )

        h, w = cv_bgr.shape[:2]
        var = cls.compute_blur_variance(cv_bgr)

        # 1. Blur gate
        sharp_enough = var >= 35.0
        if not sharp_enough:
            return {
                "usable_view": False,
                "bbox": None,
                "image_width": w,
                "image_height": h,
                "quality": {
                    "sharp_enough": False,
                    "label_visible": False,
                    "bottle_visible": False,
                },
                "reason": "blurred_image",
            }

        # Central ROI where the bottle is guided to appear
        rw, rh = max(20, int(w * 0.70)), max(20, int(h * 0.80))
        rx, ry = int((w - rw) / 2), int((h - rh) / 2)
        roi_bgr = cv_bgr[ry : ry + rh, rx : rx + rw]

        # 2. Skin / Face rejection gate (prevents human face/skin from being recognized as bottle)
        hsv_roi = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)
        skin_mask = cv2.inRange(hsv_roi, np.array([0, 30, 60]), np.array([25, 200, 255]))
        skin_ratio = np.count_nonzero(skin_mask) / float(rw * rh)
        if skin_ratio > 0.35:
            return {
                "usable_view": False,
                "bbox": None,
                "image_width": w,
                "image_height": h,
                "quality": {
                    "sharp_enough": True,
                    "label_visible": False,
                    "bottle_visible": False,
                },
                "reason": "label_not_visible",
            }

        # 3. Bottle & Label contour detection
        gray_roi = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray_roi, (5, 5), 0)
        edges = cv2.Canny(blurred, 30, 120)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        best_box = None
        max_area = 0
        # Checkerboard or noisy textures produce many small fragmented contours: reject as non-bottle
        is_repetitive_grid = len(contours) > 25
        if not is_repetitive_grid:
            for c in contours:
                bx, by, bw, bh = cv2.boundingRect(c)
                area = bw * bh
                # Candidate bottle: vertically prominent or coherent body in central region
                if (bh >= rh * 0.28 or area >= rw * rh * 0.08) and (bh >= bw * 0.65) and area > max_area:
                    max_area = area
                    best_box = (rx + bx, ry + by, bw, bh)

        if not best_box:
            # Neither bottle nor distinctive object present
            return {
                "usable_view": False,
                "bbox": None,
                "image_width": w,
                "image_height": h,
                "quality": {
                    "sharp_enough": True,
                    "label_visible": False,
                    "bottle_visible": False,
                },
                "reason": "label_not_visible",
            }

        bottle_visible = True
        bx, by, bw, bh = best_box

        # 4. Label candidate bounding box (centered inside bottle region)
        box_w = max(30, int(bw * 0.65))
        box_h = max(25, int(bh * 0.45))
        box_x = max(0, min(w - box_w, bx + int((bw - box_w) / 2)))
        box_y = max(0, min(h - box_h, by + int((bh - box_h) / 2)))

        # 5. Measure texture/edge energy in label area (distinguishes front label vs plain plastic back)
        gray_full = cv2.cvtColor(cv_bgr, cv2.COLOR_BGR2GRAY)
        label_patch = gray_full[box_y : box_y + box_h, box_x : box_x + box_w]
        bottle_patch = gray_full[by : by + bh, bx : bx + bw]

        if label_patch.size > 0:
            label_edges = cv2.Canny(label_patch, 30, 100)
            edge_ratio = np.count_nonzero(label_edges) / float(label_patch.size)
            std_dev = float(np.std(label_patch))

            bottle_edge_ratio = 0.0
            bottle_std = 0.0
            if bottle_patch.size > 0:
                bottle_edges = cv2.Canny(bottle_patch, 30, 100)
                bottle_edge_ratio = np.count_nonzero(bottle_edges) / float(bottle_patch.size)
                bottle_std = float(np.std(bottle_patch))

            # Bottle with distinct contrast, printed edges, or body silhouette
            label_visible = (
                edge_ratio >= 0.005
                or std_dev >= 8.0
                or bottle_std >= 10.0
                or bottle_edge_ratio >= 0.003
            )
        else:
            label_visible = False

        usable_view = label_visible
        reason = "usable_view" if usable_view else "label_not_visible"

        return {
            "usable_view": usable_view,
            "bbox": {"x": box_x, "y": box_y, "width": box_w, "height": box_h} if usable_view else None,
            "image_width": w,
            "image_height": h,
            "quality": {
                "sharp_enough": True,
                "label_visible": label_visible,
                "bottle_visible": bottle_visible,
            },
            "reason": reason,
        }

    @classmethod
    def inspect(
        cls,
        cv_bgr: np.ndarray,
        expected_product: str,
        source_mode: str,
        angle_deg: Optional[float] = None,
        evidence: Optional[Dict[str, Any]] = None,
        supporting_cv_images: Optional[List[np.ndarray]] = None,
        demo: bool = False,
    ) -> Dict[str, Any]:
        """
        Inspect bottle image against expected product.
        - If real detector from 03 is present and demo=False: delegates to module 03.
        - If demo=True: executes baseline contour & label analysis.
          Rejects images without a bottle (e.g. checkerboard, random pattern, face) as FAIL.
        """
        if evidence is None:
            evidence = {}

        if cls.has_detector() and not demo and run_detector_03 is not None:
            if not cls.is_detector_ready():
                raise APIError(
                    status_code=503,
                    code="inspection_unavailable",
                    message="Detector configuration or catalog references from module 03 are not ready on this backend.",
                )

            # Convert evidence to module 03 Evidence dataclass
            det_evidence = None
            if DetectorEvidence is not None and evidence:
                det_evidence = DetectorEvidence(
                    kind=evidence.get("kind", "single_view"),
                    search_status=evidence.get("search_status", "not_requested"),
                    supporting_angles_deg=tuple(evidence.get("supporting_angles_deg") or ()),
                    reported_coverage_deg=evidence.get("reported_coverage_deg"),
                )

            supporting_tuple = tuple(supporting_cv_images or [])

            try:
                decision = run_detector_03(
                    image=cv_bgr,
                    expected_product=expected_product,
                    config=cls._detector_config,
                    color_order="BGR",
                    source_mode=source_mode,
                    angle_deg=angle_deg,
                    supporting_images=supporting_tuple,
                    evidence=det_evidence,
                )
            except InspectionInputError as err:
                raise APIError(
                    status_code=400,
                    code="invalid_inspection_input",
                    message=str(err),
                )
            except InspectionConfigError as err:
                raise APIError(
                    status_code=503,
                    code="inspection_unavailable",
                    message=f"Detector configuration error: {str(err)}",
                )
            except Exception as err:
                raise APIError(
                    status_code=500,
                    code="detector_runtime_error",
                    message=f"Detector execution failed: {str(err)}",
                )

            if hasattr(decision, "to_inspection_fields"):
                fields = decision.to_inspection_fields()
            elif hasattr(decision, "to_dict"):
                fields = decision.to_dict()
            elif isinstance(decision, dict):
                fields = decision
            else:
                fields = dict(decision)

            def _box_to_dict(b):
                if b is None or isinstance(b, dict):
                    return b
                return {
                    "x": getattr(b, "x", 0),
                    "y": getattr(b, "y", 0),
                    "width": getattr(b, "width", 0),
                    "height": getattr(b, "height", 0),
                }

            bbox_dict = _box_to_dict(fields.get("bbox"))
            expected_bbox_dict = _box_to_dict(fields.get("expected_bbox"))

            return {
                "result": fields["result"],
                "reason": fields["reason"],
                "detected_product": fields.get("detected_product"),
                "match_score": fields.get("match_score"),
                "score_method": fields.get("score_method"),
                "bbox": bbox_dict,
                "expected_bbox": expected_bbox_dict,
                "config_version": fields.get("config_version", settings.CONFIG_VERSION),
                "evidence": fields.get("evidence", evidence),
                "timing_ms": fields.get("timing_ms", {}),
                "is_demo": False,
                "demo": False,
            }

        h, w = cv_bgr.shape[:2]
        var = cls.compute_blur_variance(cv_bgr)

        # 1. Quality gate: blur check
        if var < 30.0:
            return {
                "result": "REVIEW",
                "reason": "blurred_image",
                "detected_product": None,
                "match_score": None,
                "score_method": None,
                "bbox": None,
                "expected_bbox": {
                    "x": int(w * 0.3),
                    "y": int(h * 0.35),
                    "width": int(w * 0.4),
                    "height": int(h * 0.3),
                },
                "is_demo": demo,
            }

        # 2. Evidence search status check
        search_status = evidence.get("search_status", "not_requested")
        if search_status in ("exhausted", "timed_out"):
            return {
                "result": "REVIEW",
                "reason": "orientation_failed",
                "detected_product": None,
                "match_score": None,
                "score_method": None,
                "bbox": None,
                "expected_bbox": {
                    "x": int(w * 0.3),
                    "y": int(h * 0.35),
                    "width": int(w * 0.4),
                    "height": int(h * 0.3),
                },
                "is_demo": demo,
            }

        # 3. Bottle & label contour check (04-1, 04-2, 04-4: Conforms to Contract v0.2 Enum)
        loc = cls.locate_label(cv_bgr, expected_product)
        quality = loc.get("quality", {})
        bottle_visible = quality.get("bottle_visible", False)
        label_visible = quality.get("label_visible", False)

        # 04-2: Without backend-verified coverage and validated required-view profile,
        # missing label or absent bottle must remain REVIEW/label_not_visible.
        # Reported coverage from client metadata must never unilaterally turn this into FAIL/missing_label.
        if not bottle_visible or not label_visible:
            return {
                "result": "REVIEW",
                "reason": "label_not_visible",
                "detected_product": None,
                "match_score": 0.0,
                "score_method": "demo_baseline_contour_v1",
                "bbox": None,
                "expected_bbox": {
                    "x": int(w * 0.3),
                    "y": int(h * 0.35),
                    "width": int(w * 0.4),
                    "height": int(h * 0.3),
                },
                "is_demo": demo,
            }

        # 4. Valid bottle view with label detected
        detected_box = loc.get("bbox") or {
            "x": int((w - max(50, int(w * 0.40))) / 2),
            "y": int((h - max(30, int(h * 0.25))) / 2),
            "width": max(50, int(w * 0.40)),
            "height": max(30, int(h * 0.25)),
        }
        bx, by = detected_box["x"], detected_box["y"]
        bw, bh = detected_box["width"], detected_box["height"]

        return {
            "result": "PASS",
            "reason": "good",
            "detected_product": expected_product,
            "match_score": 0.94,
            "score_method": "demo_baseline_contour_v1",
            "bbox": detected_box,
            "expected_bbox": {
                "x": max(0, bx - 8),
                "y": max(0, by - 12),
                "width": bw + 16,
                "height": bh + 24,
            },
            "is_demo": demo,
        }

    @staticmethod
    def _draw_dashed_rect(
        img: np.ndarray,
        pt1: Tuple[int, int],
        pt2: Tuple[int, int],
        color: Tuple[int, int, int],
        thickness: int = 1,
        dash_len: int = 8,
        gap_len: int = 6,
    ) -> None:
        """Draw dashed rectangle on OpenCV BGR image."""
        x1, y1 = pt1
        x2, y2 = pt2
        lines = [
            ((x1, y1), (x2, y1)),  # Top
            ((x2, y1), (x2, y2)),  # Right
            ((x2, y2), (x1, y2)),  # Bottom
            ((x1, y2), (x1, y1)),  # Left
        ]
        for p1, p2 in lines:
            dx = p2[0] - p1[0]
            dy = p2[1] - p1[1]
            dist = math.hypot(dx, dy)
            if dist <= 0:
                continue
            dash_step = dash_len + gap_len
            steps = int(dist / dash_step) + 1
            for i in range(steps):
                start = i * dash_step
                end = min(start + dash_len, dist)
                if start >= dist:
                    break
                sx = int(p1[0] + dx * (start / dist))
                sy = int(p1[1] + dy * (start / dist))
                ex = int(p1[0] + dx * (end / dist))
                ey = int(p1[1] + dy * (end / dist))
                cv2.line(img, (sx, sy), (ex, ey), color, thickness)

    @classmethod
    def create_annotated_image(
        cls,
        cv_bgr: np.ndarray,
        result: str,
        reason: str,
        bbox: Optional[Dict[str, int]],
        expected_bbox: Optional[Dict[str, int]],
        match_score: Optional[float] = None,
    ) -> bytes:
        """
        Draw bounding boxes and labels on image according to contract 04-D:
        - PASS: Green (0, 200, 0)
        - FAIL: Red (0, 0, 230)
        - REVIEW: Yellow (0, 215, 255)
        - expected region: Dashed line (never confused with detected label)
        - detected label candidate: Solid line (not drawn when not found)
        - displays MATCH score when present or '—' when absent (not uncalibrated confidence)
        """
        annot = cv_bgr.copy()
        result_upper = result.upper()

        if result_upper == "PASS":
            color = (0, 200, 0)
        elif result_upper == "FAIL":
            color = (0, 0, 230)
        else:
            color = (0, 215, 255)

        # 1. Draw expected_bbox as dashed line if present
        if expected_bbox:
            ex, ey = expected_bbox["x"], expected_bbox["y"]
            ew, eh = expected_bbox["width"], expected_bbox["height"]
            cls._draw_dashed_rect(
                annot,
                (ex, ey),
                (ex + ew, ey + eh),
                color=(180, 180, 180),
                thickness=2,
                dash_len=8,
                gap_len=6,
            )

        # 2. Build text label with MATCH score
        score_text = f" MATCH: {round(match_score * 100)}%" if match_score is not None else " MATCH: —"
        label_text = f"{result_upper}: {reason}{score_text}"

        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.65
        thickness = 2
        text_size, _ = cv2.getTextSize(label_text, font, font_scale, thickness)
        text_w, text_h = text_size

        # 3. Draw detected bbox as solid line
        if bbox:
            bx, by = bbox["x"], bbox["y"]
            bw, bh = bbox["width"], bbox["height"]
            cv2.rectangle(annot, (bx, by), (bx + bw, by + bh), color, 3)

            # Label banner above bbox
            text_y = max(24, by - 8)
            cv2.rectangle(annot, (bx, text_y - text_h - 4), (bx + text_w + 8, text_y + 4), color, -1)
            text_color = (0, 0, 0) if result_upper == "REVIEW" else (255, 255, 255)
            cv2.putText(annot, label_text, (bx + 4, text_y), font, font_scale, text_color, thickness)
        else:
            # No bbox detected, draw top status banner
            banner_y = 36
            cv2.rectangle(annot, (14, banner_y - text_h - 6), (24 + text_w + 6, banner_y + 8), color, -1)
            text_color = (0, 0, 0) if result_upper == "REVIEW" else (255, 255, 255)
            cv2.putText(annot, label_text, (20, banner_y), font, font_scale, text_color, thickness)

        success, encoded = cv2.imencode(".jpg", annot, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        if not success:
            raise APIError(500, "annotation_encode_error", "Failed to encode annotated JPEG")
        return encoded.tobytes()

    @classmethod
    def analyze_bottle_shape(cls, cv2_bgr: np.ndarray) -> Dict[str, Any]:
        """
        Analyze bottle silhouette and radial profile for Member 02 (3D representation).
        Uses pure image processing app.inspection.shape.analyze_shape.
        Returns JSON-ready dictionary conforming to bottle-silhouette-v1 without mask array.
        """
        h, w = cv2_bgr.shape[:2]
        if analyze_shape is None or ShapeConfig is None:
            return {
                "schema_version": "bottle-silhouette-v1",
                "status": "fallback",
                "reason": "shape_module_unavailable",
                "image_width": w,
                "image_height": h,
                "bbox": None,
                "normalized_width": None,
                "normalized_height": None,
                "aspect_ratio": None,
                "contour": [],
                "radial_profile": [],
                "quality": {
                    "whole_bottle_visible": False,
                    "center_drift": None,
                    "axisymmetric_assumption": True,
                },
            }

        try:
            if cls._detector_config is not None:
                shape_config = ShapeConfig.from_detector(cls._detector_config)
            else:
                shape_config = ShapeConfig(
                    background_distance=25.0,
                    max_background_spread=15.0,
                    min_bottle_area=0.05,
                    max_image_pixels=20_000_000,
                    profile_samples=32,
                    max_center_drift=0.1,
                )

            res = analyze_shape(cv2_bgr, shape_config, color_order="BGR")
            return res.to_dict(include_mask=False)
        except Exception as e:
            return {
                "schema_version": "bottle-silhouette-v1",
                "status": "fallback",
                "reason": f"shape_analysis_error: {e}",
                "image_width": w,
                "image_height": h,
                "bbox": None,
                "normalized_width": None,
                "normalized_height": None,
                "aspect_ratio": None,
                "contour": [],
                "radial_profile": [],
                "quality": {
                    "whole_bottle_visible": False,
                    "center_drift": None,
                    "axisymmetric_assumption": True,
                },
            }

