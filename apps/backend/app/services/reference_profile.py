"""Local prototype references. Never manufactures dataset validation or accuracy."""
import json
import re
import threading
from pathlib import Path
from uuid import uuid4

import cv2

from app.core.config import settings
from app.core.errors import APIError
from app.inspection.config import DetectorConfig, PositionRules, ProductConfig
from app.inspection.segmentation import segment_foreground, whole_upright_bottle
from app.services.inspection_adapter import InspectionAdapter

LOCK = threading.RLock()
NOTICE = "Experimental reference matching; thresholds are not calibrated on an independent dataset."


def profile_root():
    return settings.STORAGE_ROOT / "reference-profile"


def read_profile():
    file = profile_root() / "profile.json"
    return json.loads(file.read_text(encoding="utf-8")) if file.exists() else {"version": None, "products": {}}


def image_path(item):
    filename = item["image"]
    if not re.fullmatch(r"[0-9a-f]{32}\.jpg", filename):
        raise ValueError("Invalid reference filename")
    return profile_root() / filename


def activate(profile):
    products = []
    catalog = []
    for identity in ("bottle_a", "bottle_b"):
        item = profile["products"].get(identity)
        if not item:
            catalog.append({"product_id": identity, "display_name": f"Bottle {identity[-1].upper()} — ยังไม่มีภาพอ้างอิง",
                            "reference_paths": [], "validated": False})
            continue
        image = cv2.imread(str(image_path(item)))
        if image is None:
            raise ValueError("Reference image missing or unreadable")
        x, y, w, h = item["crop_pixels"]
        template = cv2.cvtColor(image[y:y+h, x:x+w], cv2.COLOR_BGR2RGB)
        rules = PositionRules(tuple(item["expected_roi"]), (0.14, 0.12), (0.25, 0.2), 12)
        products.append(ProductConfig(identity, (template,), rules))
        catalog.append({"product_id": identity, "display_name": item["name"], "validated": False,
                        "reference_paths": [f"/api/reference-profile/images/{identity}"]})
    config = None
    if products:
        config = DetectorConfig(config_version=profile["version"], products=tuple(products),
            min_sharpness=25, min_match_score=0.72, min_match_margin=0.08,
            background_distance=18, max_background_spread=30, label_contrast=20,
            min_bottle_area=0.03, label_width_range=(0.1, 0.99), label_height_range=(0.06, 0.65),
            reference_mode=True, validated=False)
        config.validate()
    InspectionAdapter.set_detector_config(config)
    settings.SUPPORTED_PRODUCTS = catalog
    if config:
        settings.CONFIG_VERSION = config.config_version


def load_profile():
    with LOCK:
        profile = read_profile()
        if profile["products"]:
            activate(profile)


def remove_reference(identity):
    with LOCK:
        profile = read_profile()
        if identity not in profile['products']:
            raise APIError(404, 'not_found', 'Reference not configured')
        # Keep a recoverable snapshot and all source images on local disk.
        archive = profile_root() / f"profile-backup-{uuid4().hex}.json"
        archive.write_text(json.dumps(profile, ensure_ascii=False), encoding='utf-8')
        del profile['products'][identity]
        profile['version'] = f"reference-{uuid4().hex[:12]}"
        activate(profile)
        temporary = profile_root() / 'profile.json.tmp'
        temporary.write_text(json.dumps(profile, ensure_ascii=False), encoding='utf-8')
        temporary.replace(profile_root() / 'profile.json')
    return public_profile()


def public_profile():
    with LOCK:
        profile = read_profile()
        return {"version": profile["version"], "notice": NOTICE, "validated": False,
                "ready": bool(profile["products"]) and InspectionAdapter.is_detector_ready(),
                "products": [{"product_id": key, "name": value["name"], "crop": value["crop"],
                              "image_url": f"/api/reference-profile/images/{key}"}
                             for key, value in profile["products"].items()]}


def save_reference(identity, name, payload, crop):
    if identity not in ("bottle_a", "bottle_b") or not name.strip() or len(name.strip()) > 100:
        raise APIError(400, "invalid_reference", "Choose Bottle A/B and a name of 1–100 characters")
    import math
    if (not isinstance(crop, list) or len(crop) != 4 or
        any(type(v) not in (int, float) or not math.isfinite(v) for v in crop)):
        raise APIError(400, "invalid_crop", "Crop needs four finite normalized numbers")
    x, y, w, h = crop
    if min(x, y) < 0 or min(w, h) <= 0 or x+w > 1.000001 or y+h > 1.000001:
        raise APIError(400, "invalid_crop", "Crop must fit inside the image")
    bgr, normalized, width, height = InspectionAdapter.decode_and_normalize(payload)
    box = segment_foreground(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), background_distance=18,
                             max_background_spread=30, min_area=0.03)
    if box.box is None or not whole_upright_bottle(box.box, width, height):
        raise APIError(400, "reference_background", "Use a whole upright bottle on a plain background, with space around every edge")
    px, py, pw, ph = round(x*width), round(y*height), round(w*width), round(h*height)
    bottle = box.box
    roi = [(px-bottle.x)/bottle.width, (py-bottle.y)/bottle.height, pw/bottle.width, ph/bottle.height]
    if min(pw, ph) < 12 or min(roi) < 0 or roi[0]+roi[2] > 1 or roi[1]+roi[3] > 1:
        raise APIError(400, "invalid_crop", "Select the label inside the bottle, at least 12 pixels wide and high")
    if bgr[py:py+ph, px:px+pw].std() < 3:
        raise APIError(400, "invalid_reference", "The selected label needs a visible printed pattern")
    with LOCK:
        profile = read_profile()
        filename = f"{uuid4().hex}.jpg"
        profile_root().mkdir(parents=True, exist_ok=True)
        (profile_root() / filename).write_bytes(normalized)
        profile["products"][identity] = {"name": name.strip(), "image": filename,
            "crop": crop, "crop_pixels": [px, py, pw, ph], "expected_roi": roi}
        profile["version"] = f"reference-{uuid4().hex[:12]}"
        # Validate the complete candidate before publishing it. Old references are retained locally.
        activate(profile)
        temporary = profile_root() / "profile.json.tmp"
        temporary.write_text(json.dumps(profile, ensure_ascii=False), encoding="utf-8")
        temporary.replace(profile_root() / "profile.json")
    return public_profile()
