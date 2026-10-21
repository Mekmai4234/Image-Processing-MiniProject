"""Synthetic loader-boundary fixtures. No real references or validation report."""
import copy
from dataclasses import asdict, replace
import hashlib
import json
import unittest

import numpy as np

from test_detector import bottle_image, synthetic_config
from app.inspection import (InspectionConfigError, build_detector_config,
                            catalog_fingerprint, config_fingerprint, rgb_fingerprint,
                            inspect_image)


def configuration_fixture():
    config = synthetic_config(validated=False)
    parameters = asdict(config)
    for key in ("config_version", "products", "validated", "validation_reference"):
        parameters.pop(key)
    parameters = json.loads(json.dumps(parameters))
    catalog, rows, sources, hashes, products = [], [], {}, {}, []
    for kind in ("a", "b"):
        identity, image_id = "bottle_" + kind, "synthetic-source-" + kind
        source = bottle_image(kind)
        sources[image_id] = source
        hashes[image_id] = hashlib.sha256(source.tobytes()).hexdigest()
        catalog.append({"product_id": identity, "display_name": "Synthetic " + kind,
                        "brand": "test-only", "size_ml": 500})
        metadata = {"image_id": image_id, "physical_bottle_id": "test-bottle-" + kind,
                    "capture_session": "test-session-" + kind, "split_group_id": "test-group-" + kind,
                    "split": "development", "label_product": identity, "visible_enough": "yes"}
        rows.append(metadata)
        ref = {k: metadata[k] for k in ("physical_bottle_id", "capture_session", "split_group_id", "split", "label_product")}
        ref.update(template_id="test-template-" + kind, source_image_id=image_id,
                   source_sha256=hashes[image_id], template_rgb_sha256=rgb_fingerprint(source[145:220, 78:162]),
                   source_dimensions=[240, 360], crop=[78, 145, 84, 75], crop_method="exif-rgb-axis-aligned-v1")
        products.append({"product_id": identity, "position": asdict(config.products[0].position), "references": [ref]})
    manifest_hash = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
    document = {"schema_version": "detector-config-v1", "config_version": "synthetic-tests-only-v2",
                "dataset_version": "synthetic-data-only-v1", "manifest_sha256": manifest_hash,
                "catalog_sha256": catalog_fingerprint(catalog), "parameters": parameters,
                "products": products, "validated": False, "validation_reference": None}
    inputs = {"catalog": catalog, "manifest_rows": rows, "manifest_sha256": manifest_hash,
              "source_images": sources, "source_sha256": hashes}
    return document, inputs


def synthetic_report(document):
    # These strings exercise the binding check, NOT actual real-data validation.
    return {"report_id": "synthetic-report-fixture-only", "config_version": document["config_version"],
            "dataset_version": document["dataset_version"], "manifest_sha256": document["manifest_sha256"],
            "config_sha256": config_fingerprint(document), "split": "validation",
            "data_kind": "real", "status": "completed", "sample_count": 2}


class ConfigDocumentTests(unittest.TestCase):
    def setUp(self):
        self.document, self.inputs = configuration_fixture()

    def build(self):
        return build_detector_config(self.document, **self.inputs)

    def test_builds_unvalidated_config_and_crops_exact_rgb_pixels(self):
        config = self.build()
        self.assertFalse(config.validated)
        self.assertEqual(config.config_version, "synthetic-tests-only-v2")
        np.testing.assert_array_equal(config.products[0].templates[0], self.inputs["source_images"]["synthetic-source-a"][145:220, 78:162])
        self.assertFalse(config.products[0].templates[0].flags.writeable)
        self.assertEqual(inspect_image(bottle_image(), "bottle_a", config, color_order="RGB").result, "REVIEW")

    def test_matching_report_binds_to_config_dataset_and_references(self):
        self.document.update(validated=True, validation_reference="synthetic-report-fixture-only")
        self.inputs["validation_report"] = synthetic_report(self.document)
        config = self.build()
        self.assertTrue(config.validated)
        self.assertEqual(inspect_image(bottle_image(), "bottle_a", config, color_order="RGB").result, "PASS")

    def test_stale_report_rejects_threshold_version_dataset_and_crop_changes(self):
        self.document.update(validated=True, validation_reference="synthetic-report-fixture-only")
        self.inputs["validation_report"] = synthetic_report(self.document)
        original = copy.deepcopy(self.document)
        for key in ("threshold", "version", "dataset", "crop"):
            self.document = copy.deepcopy(original)
            if key == "threshold":
                self.document["parameters"]["min_match_score"] = 0.85
            elif key == "version":
                self.document["config_version"] = "changed-v3"
            elif key == "dataset":
                self.document["dataset_version"] = "changed-data"
            else:
                self.document["products"][0]["references"][0]["crop"] = [79, 145, 83, 75]
            with self.subTest(change=key), self.assertRaises(InspectionConfigError):
                self.build()

    def test_validation_report_requires_completed_real_validation_metadata(self):
        self.document.update(validated=True, validation_reference="synthetic-report-fixture-only")
        report = synthetic_report(self.document)
        for key, value in (("split", "test"), ("data_kind", "synthetic"), ("status", "pending"),
                           ("sample_count", 0), ("sample_count", True), ("report_id", "different")):
            self.inputs["validation_report"] = {**report, key: value}
            with self.subTest(key=key, value=value), self.assertRaises(InspectionConfigError):
                self.build()

    def test_report_is_required_even_with_nonempty_validation_reference(self):
        self.document.update(validated=True, validation_reference="no-report")
        with self.assertRaises(InspectionConfigError):
            self.build()

    def test_current_manifest_split_overrides_stale_reference_metadata(self):
        for split in ("validation", "test"):
            self.inputs["manifest_rows"][0]["split"] = split
            with self.subTest(split=split), self.assertRaises(InspectionConfigError):
                self.build()

    def test_file_and_crop_pixel_hash_mismatches_are_rejected(self):
        for change in ("source", "template"):
            document, inputs = configuration_fixture()
            if change == "source":
                inputs["source_sha256"]["synthetic-source-a"] = "0" * 64
            else:
                inputs["source_images"]["synthetic-source-a"][160, 90] = (0, 100, 200)
            with self.subTest(change=change), self.assertRaises(InspectionConfigError):
                build_detector_config(document, **inputs)

    def test_catalog_requires_same_ids_and_identity_hash(self):
        for change in ("name", "missing", "duplicate"):
            document, inputs = configuration_fixture()
            if change == "name":
                inputs["catalog"][0]["display_name"] = "different name"
            elif change == "missing":
                document["products"].pop()
            else:
                inputs["catalog"].append(inputs["catalog"][0])
            with self.subTest(change=change), self.assertRaises(InspectionConfigError):
                build_detector_config(document, **inputs)

    def test_placeholder_catalog_cannot_be_enabled(self):
        self.inputs["catalog"][0]["brand"] = None
        self.document["catalog_sha256"] = catalog_fingerprint(self.inputs["catalog"])
        self.document.update(validated=True, validation_reference="synthetic-report-fixture-only")
        self.inputs["validation_report"] = synthetic_report(self.document)
        with self.assertRaises(InspectionConfigError):
            self.build()

    def test_bad_roi_limits_rgb_and_reference_provenance_are_config_errors(self):
        mutations = ("roi", "limit", "dtype", "provenance", "identity", "visibility", "size", "method")
        for change in mutations:
            document, inputs = configuration_fixture()
            ref = document["products"][0]["references"][0]
            if change == "roi":
                document["products"][0]["position"]["expected_roi"] = [0, 0, 2, 1]
            elif change == "limit":
                document["parameters"]["max_image_pixels"] = 100
            elif change == "dtype":
                inputs["source_images"]["synthetic-source-a"] = np.zeros((360, 240, 3), np.float32)
            elif change == "provenance":
                ref["capture_session"] = "different"
            elif change == "identity":
                inputs["manifest_rows"][0]["label_product"] = "bottle_b"
            elif change == "visibility":
                inputs["manifest_rows"][0]["visible_enough"] = "unknown"
            elif change == "size":
                ref["source_dimensions"] = [360, 240]
            else:
                ref["crop_method"] = "unknown"
            with self.subTest(change=change), self.assertRaises(InspectionConfigError):
                build_detector_config(document, **inputs)

    def test_same_image_with_different_expected_product_can_share_reference(self):
        row = dict(self.inputs["manifest_rows"][0], expected_product="bottle_b")
        self.inputs["manifest_rows"].append(row)
        self.assertFalse(self.build().validated)

    def test_conflicting_manifest_identity_for_same_image_is_rejected(self):
        self.inputs["manifest_rows"].append(dict(self.inputs["manifest_rows"][0], split="test"))
        with self.assertRaises(InspectionConfigError):
            self.build()

    def test_unknown_fields_and_schema_do_not_silently_change_detector(self):
        for key in ("unknown", "schema", "parameter"):
            document, inputs = configuration_fixture()
            if key == "unknown":
                document["trusted_client_profile"] = True
            elif key == "schema":
                document["schema_version"] = "v999"
            else:
                document["parameters"]["validated"] = True
            with self.subTest(change=key), self.assertRaises(InspectionConfigError):
                build_detector_config(document, **inputs)

    def test_build_does_not_mutate_document_sources_or_input_catalog(self):
        document_before = copy.deepcopy(self.document)
        source_before = self.inputs["source_images"]["synthetic-source-a"].copy()
        config = self.build()
        np.testing.assert_array_equal(source_before, self.inputs["source_images"]["synthetic-source-a"])
        self.assertEqual(document_before, self.document)
        self.inputs["source_images"]["synthetic-source-a"][:] = 0
        self.assertTrue(config.products[0].templates[0].any())

    def test_fingerprint_rejects_nonfinite_json(self):
        self.document["parameters"]["min_match_score"] = float("nan")
        with self.assertRaises(InspectionConfigError):
            config_fingerprint(self.document)


if __name__ == "__main__":
    unittest.main()
