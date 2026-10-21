"""Render synthetic behavior evidence only. Never reads production captures."""
import argparse
from pathlib import Path

import cv2
import numpy as np

from test_detector import bottle_image, synthetic_config
from test_shape_and_annotation import silhouette_image
from app.inspection import ShapeConfig, analyze_shape, inspect_image, annotate_image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = synthetic_config()
    sheet = np.full((840, 1040, 3), (16, 27, 42), np.uint8)
    cv2.putText(sheet, "SYNTHETIC TEST FIXTURES - NOT REAL DATA OR ACCURACY", (15, 24),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (245, 245, 245), 1, cv2.LINE_AA)
    images = (bottle_image(), bottle_image("b"), bottle_image(label_y=220), bottle_image(None))
    for index, image in enumerate(images):
        decision = inspect_image(image, "bottle_a", config, color_order="RGB")
        annotated = annotate_image(image, decision, color_order="RGB")
        left = index * 260 + 10
        sheet[40:400, left:left + 240] = annotated
    for index, kind in enumerate(("straight", "tapered", "waist", "fallback")):
        image = silhouette_image(kind) if kind != "fallback" else np.full((360, 240, 3), 240, np.uint8)
        result = analyze_shape(image, ShapeConfig.from_detector(config), color_order="RGB")
        if result.contour:
            cv2.polylines(image, [np.array(result.contour, np.int32)], True, (0, 220, 160), 2)
        if result.mask is not None:
            # Small profile sketch to the right of the measured silhouette.
            for sample in result.radial_profile:
                y = result.bbox.y + round(sample["y_fraction"] * (result.bbox.height - 1))
                radius = round(sample["radius_over_height"] * result.bbox.height)
                cv2.circle(image, (120 + radius, y), 2, (245, 80, 80), -1)
        left = index * 260 + 10
        cv2.putText(sheet, f"{kind}: {result.status}", (left, 430), cv2.FONT_HERSHEY_SIMPLEX,
                    0.5, (240, 240, 240), 1, cv2.LINE_AA)
        sheet[445:805, left:left + 240] = image
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(args.output), cv2.cvtColor(sheet, cv2.COLOR_RGB2BGR)):
        raise RuntimeError("could not write preview PNG")
    print(args.output.resolve())


if __name__ == "__main__":
    main()
