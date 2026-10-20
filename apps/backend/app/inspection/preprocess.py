"""Already-decoded pixels only. Adapter owns EXIF normalization exactly once."""
import cv2
import numpy as np

from .types import Box, InspectionInputError


def prepare_image(image: np.ndarray, *, color_order: str, max_pixels: int) -> np.ndarray:
    if color_order not in ("RGB", "BGR"):
        raise InspectionInputError("color_order must explicitly be RGB or BGR")
    if (not isinstance(image, np.ndarray) or image.dtype != np.uint8
            or image.ndim != 3 or image.shape[2] != 3 or min(image.shape[:2]) < 8):
        raise InspectionInputError("image must be uint8 HxWx3, at least 8x8; decode/EXIF first")
    if image.shape[0] * image.shape[1] > max_pixels:
        raise InspectionInputError("image exceeds max_image_pixels")
    # Return an independent contiguous image; never change caller pixels.
    return np.ascontiguousarray(image[..., ::-1] if color_order == "BGR" else image).copy()


def crop(image: np.ndarray, box: Box) -> np.ndarray:
    return image[box.y:box.y + box.height, box.x:box.x + box.width]


def sharpness(rgb: np.ndarray) -> float:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def normalized_pattern(rgb: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    return cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), size,
                      interpolation=cv2.INTER_AREA).astype(np.float32)
