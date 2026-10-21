"""Strict, in-memory configuration boundary for the Backend-owned file loader.

04 reads files, verifies byte hashes and normalizes EXIF to RGB; 03 verifies the
document, current manifest/provenance, crops and validation-report version binding.
No filenames are opened here and no client config is accepted by HTTP implicitly.
"""
from dataclasses import fields
import hashlib
import json
import re

import numpy as np

from .config import DetectorConfig, PositionRules, ProductConfig
from .preprocess import prepare_image
from .types import InspectionConfigError, InspectionInputError

SCHEMA_VERSION = "detector-config-v1"
_SHA = re.compile(r"[0-9a-f]{64}\Z")


def _object(value, required, optional=(), *, name):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise InspectionConfigError(f"{name}: missing or unknown fields")
    return value


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise InspectionConfigError(f"{name} must be a nonempty string")
    return value


def _digest(value, name):
    if not isinstance(value, str) or not _SHA.fullmatch(value):
        raise InspectionConfigError(f"{name} must be a lowercase SHA-256")
    return value


def _canonical_digest(value):
    try:
        payload = json.dumps(value, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise InspectionConfigError("configuration must contain finite JSON values") from exc
    return hashlib.sha256(payload).hexdigest()


def rgb_fingerprint(image):
    """Hash normalized RGB dimensions and pixels, distinct from file-byte hashes."""
    if (not isinstance(image, np.ndarray) or image.dtype != np.uint8 or image.ndim != 3
            or image.shape[2] != 3 or min(image.shape[:2]) < 2):
        raise InspectionConfigError("fingerprint requires RGB uint8 HxWx3")
    digest = hashlib.sha256(f"RGB:uint8:{image.shape[1]}:{image.shape[0]}:".encode("ascii"))
    digest.update(np.ascontiguousarray(image).tobytes())
    return digest.hexdigest()


def catalog_fingerprint(catalog):
    if not isinstance(catalog, (list, tuple)) or not catalog:
        raise InspectionConfigError("catalog must be nonempty")
    normalized = []
    seen = set()
    for product in catalog:
        if not isinstance(product, dict):
            raise InspectionConfigError("catalog product must be an object")
        identity = _text(product.get("product_id"), "catalog.product_id")
        if identity in seen:
            raise InspectionConfigError("duplicate catalog product")
        seen.add(identity)
        normalized.append({"product_id": identity,
                           "display_name": _text(product.get("display_name"), "display_name"),
                           "brand": product.get("brand"), "size_ml": product.get("size_ml")})
    return _canonical_digest(sorted(normalized, key=lambda p: p["product_id"]))


def config_fingerprint(document):
    """Bind calibration to parameters, dataset, catalog and reference hashes.

    Only readiness/reference flags are excluded, so the same calibration can be
    enabled after validation without changing the calibrated payload's digest.
    """
    if not isinstance(document, dict):
        raise InspectionConfigError("configuration must be an object")
    return _canonical_digest({k: v for k, v in document.items()
                              if k not in ("validated", "validation_reference")})


def build_detector_config(document, *, catalog, manifest_rows, manifest_sha256,
                          source_images, source_sha256, validation_report=None):
    """Build config from trusted Backend data; never loads files or defaults to DEMO.

    source_images: {image_id: EXIF-normalized RGB source pixels}.
    source_sha256: {image_id: SHA-256 of actual source file bytes, checked by 04}.
    manifest_rows/hash: current 05-audited manifest and its actual byte digest.
    """
    _object(document, ("schema_version", "config_version", "dataset_version",
                       "manifest_sha256", "catalog_sha256", "parameters", "products",
                       "validated", "validation_reference"), name="document")
    if document["schema_version"] != SCHEMA_VERSION:
        raise InspectionConfigError("unsupported detector schema_version")
    for key in ("config_version", "dataset_version"):
        _text(document[key], key)
    if type(document["validated"]) is not bool:
        raise InspectionConfigError("validated must be boolean")
    if _digest(document["manifest_sha256"], "manifest_sha256") != _digest(manifest_sha256, "current manifest hash"):
        raise InspectionConfigError("manifest version/hash mismatch; reselect references")
    if _digest(document["catalog_sha256"], "catalog_sha256") != catalog_fingerprint(catalog):
        raise InspectionConfigError("catalog version/hash mismatch")
    if not isinstance(manifest_rows, (list, tuple)) or not isinstance(source_images, dict) or not isinstance(source_sha256, dict):
        raise InspectionConfigError("manifest/source data must be provided by Backend loader")
    catalog_ids = {product["product_id"] for product in catalog}
    allowed = {f.name for f in fields(DetectorConfig)} - {
        "config_version", "products", "validated", "validation_reference"}
    parameters = document["parameters"]
    if not isinstance(parameters, dict) or set(parameters) - allowed:
        raise InspectionConfigError("unknown detector parameter")
    required = {"min_sharpness", "min_match_score", "min_match_margin", "background_distance",
                "max_background_spread", "label_contrast", "min_bottle_area",
                "label_width_range", "label_height_range"}
    if required - parameters.keys():
        raise InspectionConfigError("missing detector parameter")
    limit = parameters.get("max_image_pixels", 20_000_000)
    if type(limit) is not int or limit < 1:
        raise InspectionConfigError("max_image_pixels must be a positive integer")
    if not isinstance(document["products"], list) or not document["products"]:
        raise InspectionConfigError("products/references are not ready")
    rows = {}
    for row in manifest_rows:
        if not isinstance(row, dict):
            raise InspectionConfigError("manifest row must be an object")
        identity = _text(row.get("image_id"), "manifest.image_id")
        # Same pixels may be tested against different expected products.
        owned = {k: row.get(k) for k in ("physical_bottle_id", "capture_session", "split_group_id",
                                         "split", "label_product", "visible_enough")}
        if identity in rows and rows[identity] != owned:
            raise InspectionConfigError("conflicting manifest metadata for one image")
        rows[identity] = owned
    products, product_ids, template_ids = [], set(), set()
    for product in document["products"]:
        _object(product, ("product_id", "position", "references"), name="product")
        product_id = _text(product["product_id"], "product_id")
        if product_id not in catalog_ids or product_id in product_ids:
            raise InspectionConfigError("product IDs must match catalog without duplicates")
        product_ids.add(product_id)
        _object(product["position"], ("expected_roi", "center_tolerance", "size_tolerance", "max_tilt_deg"), name="position")
        rules = PositionRules(**product["position"])
        rules.validate()
        refs = product["references"]
        if not isinstance(refs, list) or not refs:
            raise InspectionConfigError("each product needs development references")
        templates = []
        for ref in refs:
            _object(ref, ("template_id", "source_image_id", "source_sha256", "template_rgb_sha256",
                          "physical_bottle_id", "capture_session", "split_group_id", "split",
                          "label_product", "source_dimensions", "crop", "crop_method"), name="reference")
            template_id = _text(ref["template_id"], "template_id")
            if template_id in template_ids:
                raise InspectionConfigError("duplicate template_id")
            template_ids.add(template_id)
            image_id = _text(ref["source_image_id"], "source_image_id")
            meta = rows.get(image_id)
            if meta is None or meta["split"] != "development" or ref["split"] != "development":
                raise InspectionConfigError("references must belong to current development split")
            if meta["label_product"] != product_id or meta["visible_enough"] != "yes":
                raise InspectionConfigError("reference label identity/visibility is not verified")
            for key in ("physical_bottle_id", "capture_session", "split_group_id", "label_product"):
                if _text(ref[key], key) != meta[key]:
                    raise InspectionConfigError(f"reference provenance mismatch: {key}")
            if _digest(ref["source_sha256"], "source_sha256") != source_sha256.get(image_id):
                raise InspectionConfigError("source file hash mismatch")
            if ref["crop_method"] != "exif-rgb-axis-aligned-v1":
                raise InspectionConfigError("unsupported crop method")
            try:
                rgb = prepare_image(source_images.get(image_id), color_order="RGB", max_pixels=limit)
            except InspectionInputError as exc:
                raise InspectionConfigError(f"invalid reference source: {exc}") from exc
            if ref["source_dimensions"] != [rgb.shape[1], rgb.shape[0]]:
                raise InspectionConfigError("reference source dimensions mismatch")
            box = ref["crop"]
            if (not isinstance(box, list) or len(box) != 4 or any(type(v) is not int for v in box)):
                raise InspectionConfigError("crop must be integer [x,y,width,height]")
            x, y, w, h = box
            if min(x, y) < 0 or min(w, h) < 2 or x + w > rgb.shape[1] or y + h > rgb.shape[0]:
                raise InspectionConfigError("reference crop is outside source")
            template = rgb[y:y + h, x:x + w].copy()
            if _digest(ref["template_rgb_sha256"], "template_rgb_sha256") != rgb_fingerprint(template):
                raise InspectionConfigError("template pixels/hash mismatch")
            template.setflags(write=False)
            templates.append(template)
        products.append(ProductConfig(product_id, tuple(templates), rules))
    if product_ids != catalog_ids:
        raise InspectionConfigError("detector and products API catalog must contain the same products")
    reference = document["validation_reference"]
    if document["validated"]:
        _text(reference, "validation_reference")
        report_fields = {"report_id": reference, "config_version": document["config_version"],
                         "dataset_version": document["dataset_version"],
                         "manifest_sha256": manifest_sha256, "config_sha256": config_fingerprint(document),
                         "split": "validation", "data_kind": "real", "status": "completed"}
        if not isinstance(validation_report, dict) or any(validation_report.get(k) != v for k, v in report_fields.items()):
            raise InspectionConfigError("validation report does not match config/dataset/reference version")
        if type(validation_report.get("sample_count")) is not int or validation_report["sample_count"] < 1:
            raise InspectionConfigError("validation report needs real sample counts")
        for product in catalog:
            if (not isinstance(product.get("brand"), str) or not product["brand"].strip()
                    or type(product.get("size_ml")) is not int or product["size_ml"] <= 0):
                raise InspectionConfigError("validated catalog needs actual brand and size")
    elif reference is not None:
        raise InspectionConfigError("unvalidated config must have null validation_reference")
    config = DetectorConfig(config_version=document["config_version"], products=tuple(products),
                            validated=document["validated"], validation_reference=reference, **parameters)
    config.validate()
    # Do not permit flat reference patterns to be activated as a calibrated config.
    if config.validated:
        from .preprocess import normalized_pattern
        if any(float(normalized_pattern(t, config.match_size).std()) <= config.min_pattern_std
               for p in config.products for t in p.templates):
            raise InspectionConfigError("validated reference template has no usable pattern")
    return config
