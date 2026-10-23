"""Check scaffold documents and synthetic examples, not the real dataset or app."""
import csv
import json
import math
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
MODULES = ["01_web_ui", "02_simulation_3d", "03_image_processing",
           "04_webcam_backend_logging", "05_dataset_testing"]
SAMPLES = {"inspection-pass.json": "PASS", "inspection-fail.json": "FAIL",
           "inspection-review.json": "REVIEW", "inspection-orientation-review.json": "REVIEW"}
REASONS = {
    "PASS": {"good"},
    "FAIL": {"wrong_label", "misplaced_label", "missing_label", "blurred_image",
             "label_not_visible", "unknown_product", "ambiguous_match", "orientation_failed"},
    "REVIEW": {"blurred_image", "label_not_visible", "unknown_product",
               "ambiguous_match", "orientation_failed"},
}
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "storage", "datasets",
             "outputs", "dist", "build", "__pycache__", ".pytest_cache",
             ".mypy_cache", ".ruff_cache", "coverage", "htmlcov",
             "playwright-report", "test-results"}
FIELDS = {"inspection_id", "client_request_id", "created_at", "source_mode",
          "expected_product", "detected_product", "result", "reason", "match_score",
          "score_method", "bbox", "expected_bbox", "image_width", "image_height",
          "orientation_deg", "timing_ms", "config_version", "storage_status",
          "images", "evidence", "storage_error", "reviewed_result", "reviewed_reason", "reviewed_at", "reviewer", "demo"}
CSV_FIELDS = {"image_id", "filename", "physical_bottle_id", "capture_session",
              "product_id", "label_product", "split_group_id", "expected_product", "angle_deg", "label_present",
              "position_ok", "visible_enough", "result", "reason", "split", "reviewer"}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def uuid(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except (ValueError, AttributeError, TypeError):
        return False


def utc_timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.utcoffset() is not None and parsed.utcoffset().total_seconds() == 0
    except (AttributeError, TypeError, ValueError):
        return False


def markdown_files(root):
    """Prune local data/dependencies before walking; retain their root guides."""
    for folder, directories, files in os.walk(root):
        directories[:] = [name for name in directories if name not in SKIP_DIRS]
        yield from (Path(folder) / name for name in files if name.endswith(".md"))
    for name in ("storage", "datasets"):
        path = root / name / "README.md"
        if path.is_file():
            yield path


def validate_repository(root):
    root = Path(root)
    errors = []

    def check(condition, path, message):
        if not condition:
            errors.append(f"{path.relative_to(root)}: {message}")
        return bool(condition)

    def text(path):
        try:
            value = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            check(False, path, f"cannot read UTF-8 text ({exc})")
            return None
        check("\ufffd" not in value and "\x00" not in value, path, "invalid text characters")
        return value

    def document(path):
        value = text(path)
        if value is None:
            return None
        try:
            result = json.loads(value)
        except json.JSONDecodeError as exc:
            check(False, path, f"invalid JSON ({exc})")
            return None
        return result if check(isinstance(result, dict), path, "JSON root must be an object") else None

    for module in MODULES:
        for name in ("env.txt", "step.txt", "process.txt"):
            path = root / module / name
            value = text(path)
            if value is not None:
                check(len(value.strip()) >= 900, path, "guide too short (minimum 900 characters)")

    required = ["README.md", "CONTRIBUTING.md", ".env.example", ".gitignore",
                "docs/team.md", "docs/api-contract.md", "docs/architecture.md",
                "docs/dataset-guide.md", "docs/storage-guide.md", "docs/testing-plan.md",
                "docs/implementation-status.md", "docs/configuration.md", "prototypes/conveyor-demo.html",
                "storage/README.md", "datasets/README.md"]
    for name in required:
        check((root / name).is_file(), root / name, "missing required file")
    for path in markdown_files(root):
        value = text(path)
        if value is None:
            continue
        for link in re.findall(r"\]\(([^)]+)\)", value):
            if "://" in link or link.startswith(("#", "mailto:")):
                continue
            target = unquote(link.strip("<>").split("#")[0])
            check(not target or (path.parent / target).exists(), path, f"broken link: {link}")

    path = root / "examples/products.example.json"
    catalog = document(path)
    product_ids, config_version = set(), None
    if catalog is not None:
        check(catalog.get("demo") is True, path, "synthetic catalog must declare demo: true")
        config_version = catalog.get("config_version")
        check(isinstance(config_version, str) and bool(config_version.strip()), path, "invalid config_version")
        products = catalog.get("products")
        if check(isinstance(products, list) and bool(products), path, "products must be a nonempty list"):
            for product in products:
                if not check(isinstance(product, dict), path, "product must be an object"):
                    continue
                product_id = product.get("product_id")
                if check(isinstance(product_id, str) and bool(product_id.strip()), path, "invalid product_id"):
                    check(product_id not in product_ids, path, f"duplicate product_id: {product_id}")
                    product_ids.add(product_id)
                check(isinstance(product.get("display_name"), str) and bool(product["display_name"].strip()), path, "invalid display_name")
                check(product.get("validated") is False, path, "demo product must declare validated: false")
                check(isinstance(product.get("reference_paths"), list), path, "reference_paths must be a list")

    identifiers = {"inspection_id": set(), "client_request_id": set()}
    for name, expected_result in SAMPLES.items():
        path = root / "examples" / name
        result = document(path)
        if result is None:
            continue
        missing = FIELDS - result.keys()
        if not check(not missing, path, f"missing fields: {', '.join(sorted(missing))}"):
            continue
        for field, values in identifiers.items():
            value = result[field]
            if check(uuid(value), path, f"{field} must be a canonical UUID"):
                check(value not in values, path, f"duplicate {field} across independent examples")
                values.add(value)
        check(result["demo"] is True, path, "synthetic example must declare demo: true")
        check(result["result"] == expected_result, path, f"result must be {expected_result}")
        check(isinstance(result["reason"], str) and result["reason"] in REASONS[expected_result], path, "invalid result/reason")
        check(result["source_mode"] in ("simulation", "webcam"), path, "invalid source_mode")
        check(result["storage_status"] in ("pending", "saved", "failed"), path, "invalid storage_status")
        storage_error = result["storage_error"]
        if storage_error is not None:
            check(isinstance(storage_error, dict)
                  and all(isinstance(storage_error.get(key), str) and storage_error[key].strip() for key in ("code", "message"))
                  and type(storage_error.get("retryable")) is bool, path, "invalid storage_error")
        if result["storage_status"] == "failed":
            check(storage_error is not None, path, "failed storage needs storage_error")
        if result["storage_status"] == "saved":
            check(storage_error is None, path, "saved storage must clear storage_error")
        check(isinstance(result["expected_product"], str) and result["expected_product"] in product_ids, path, "expected_product is not in catalog")
        detected = result["detected_product"]
        check(detected is None or isinstance(detected, str) and detected in product_ids, path, "detected_product is not in catalog")
        check(result["config_version"] == config_version, path, "config_version differs from catalog")
        check(utc_timestamp(result["created_at"]), path, "created_at must be an ISO-8601 UTC timestamp")
        score = result["match_score"]
        check(score is None or number(score) and 0 <= score <= 1, path, "invalid match_score")
        methods = (None,) if score is None else ('template_ccoeff_normed_clamped_v1', 'reference_template_search_ccoeff_v1')
        check(result["score_method"] in methods, path, "invalid score_method")
        width, height = result["image_width"], result["image_height"]
        valid_size = all(type(value) is int and value > 0 for value in (width, height))
        check(valid_size, path, "image dimensions must be positive integers")
        for field in ("bbox", "expected_bbox"):
            box = result[field]
            if box is None:
                continue
            if not check(isinstance(box, dict) and set(box) == {"x", "y", "width", "height"}, path, f"invalid {field} fields"):
                continue
            if not check(all(number(value) for value in box.values()), path, f"invalid {field} numeric values"):
                continue
            check(box["x"] >= 0 and box["y"] >= 0 and box["width"] > 0 and box["height"] > 0
                  and (not valid_size or box["x"] + box["width"] <= width and box["y"] + box["height"] <= height),
                  path, f"{field} outside image bounds or invalid dimensions")
        angle = result["orientation_deg"]
        check(angle is None or number(angle) and 0 <= angle < 360, path, "invalid orientation_deg")
        timing = result["timing_ms"]
        timing_keys = {"orientation", "inspection", "storage", "total"}
        if check(isinstance(timing, dict) and timing_keys <= timing.keys(), path, "invalid timing_ms fields"):
            check(all(number(timing[key]) and timing[key] >= 0 for key in timing_keys), path, "invalid timing_ms values")
        images = result["images"]
        if check(isinstance(images, dict) and set(images) == {"original", "annotated"}, path, "invalid images fields"):
            for kind, url in images.items():
                expected_url = f"/api/inspections/{result['inspection_id']}/images/{kind}"
                check(url == expected_url or url is None and result["storage_status"] != "saved",
                      path, f"images.{kind} must point to this inspection and image kind")
        evidence = result["evidence"]
        evidence_fields = {"kind", "search_status", "supporting_angles_deg", "reported_coverage_deg",
                           "verified_coverage", "required_view_profile", "supporting_images"}
        if check(isinstance(evidence, dict) and evidence_fields <= evidence.keys(), path, "invalid evidence fields"):
            check(evidence["kind"] in ("single_view", "multi_view"), path, "invalid evidence kind")
            check(evidence["search_status"] in ("not_requested", "usable_view_found", "exhausted", "timed_out"), path, "invalid evidence search_status")
            check(type(evidence["verified_coverage"]) is bool, path, "verified_coverage must be boolean")
            coverage = evidence["reported_coverage_deg"]
            check(coverage is None or number(coverage) and 0 <= coverage <= 360, path, "invalid reported_coverage_deg")
            profile = evidence["required_view_profile"]
            check(profile is None or isinstance(profile, str) and bool(profile.strip()), path, "invalid required_view_profile")
            angles, supporting = evidence["supporting_angles_deg"], evidence["supporting_images"]
            if check(isinstance(angles, list) and isinstance(supporting, list), path, "supporting angles/images must be lists"):
                check(len(angles) == len(supporting), path, "supporting angles/images count mismatch")
                check(all(angle is None or number(angle) and 0 <= angle < 360 for angle in angles), path, "invalid supporting angle")
                for index, url in enumerate(supporting):
                    check(url == f"/api/inspections/{result['inspection_id']}/images/supporting/{index}"
                          or url is None and result["storage_status"] != "saved", path, "invalid supporting image URL")
                check((evidence["kind"] == "single_view" and not supporting)
                      or (evidence["kind"] == "multi_view" and bool(supporting)), path, "view kind and image count disagree")
            if evidence["verified_coverage"] is True:
                check(isinstance(profile, str) and bool(profile.strip()), path, "verified coverage requires a profile")
            if evidence["kind"] == "single_view":
                check(not evidence["verified_coverage"], path, "single view cannot claim verified coverage")
        reviewed = result["reviewed_result"]
        check((reviewed is None and result["reviewer"] is None and result["reviewed_reason"] is None and result["reviewed_at"] is None)
              or (isinstance(reviewed, str) and reviewed in REASONS
                  and isinstance(result["reviewer"], str) and bool(result["reviewer"].strip())
                  and isinstance(result["reviewed_reason"], str) and result["reviewed_reason"] in REASONS[reviewed]
                  and utc_timestamp(result["reviewed_at"])),
              path, "invalid human review fields")
        if expected_result == "PASS":
            check(detected == result["expected_product"] and result["bbox"] is not None and score is not None,
                  path, "PASS needs matching product, bbox and score")
        if result["reason"] == "missing_label":
            check(result["bbox"] is None, path, "missing_label must not invent a detected bbox")
            check(isinstance(evidence, dict) and evidence.get("verified_coverage") is True,
                  path, "missing_label needs verified evidence")
        if result["reason"] == "wrong_label":
            check(detected is not None and detected != result["expected_product"], path, "wrong_label needs a different detected product")

    path = root / "examples/labels.csv"
    value = text(path)
    if value is not None:
        reader = csv.DictReader(value.splitlines())
        missing = CSV_FIELDS - set(reader.fieldnames or [])
        if check(not missing, path, f"missing CSV columns: {', '.join(sorted(missing))}"):
            groups = {field: {} for field in ("image_id", "filename", "physical_bottle_id", "capture_session", "split_group_id")}
            row_count = 0
            for row_number, row in enumerate(reader, start=2):
                row_count += 1
                if not check(None not in row and all(value is not None for value in row.values()), path, f"row {row_number}: incorrect column count"):
                    continue
                split = row["split"]
                check(split in ("development", "validation", "test"), path, f"row {row_number}: invalid split")
                for field, mapping in groups.items():
                    key = row[field].strip()
                    if check(bool(key), path, f"row {row_number}: empty {field}"):
                        check(key not in mapping or mapping[key] == split, path, f"row {row_number}: split leakage for {field}={key}")
                        mapping[key] = split
                check(row["reason"] in REASONS.get(row["result"], set()), path, f"row {row_number}: invalid result/reason")
                check(row["expected_product"] in product_ids, path, f"row {row_number}: expected_product is not in catalog")
                check(row["product_id"] in product_ids, path, f"row {row_number}: product_id is not in catalog")
                check(not row["label_product"] or row["label_product"] in product_ids, path, f"row {row_number}: invalid label_product")
                for field in ("label_present", "position_ok", "visible_enough"):
                    check(row[field] in ("yes", "no", "unknown"), path, f"row {row_number}: invalid {field}")
            check(row_count > 0, path, "example manifest must contain rows")
    return errors


if __name__ == "__main__":
    failures = validate_repository(ROOT)
    if failures:
        raise SystemExit("\n".join(failures))
    print("OK: module guides, documentation links, synthetic contracts/catalog and example CSV groups")
