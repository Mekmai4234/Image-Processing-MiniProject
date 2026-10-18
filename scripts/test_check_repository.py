"""Regression cases for the scaffold gate; these do not test the future app."""
import csv
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from check_repository import MODULES, ROOT, SAMPLES, SKIP_DIRS, validate_repository


class RepositoryCheckTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for module in MODULES:
            for name in ("env.txt", "step.txt", "process.txt"):
                self.write(f"{module}/{name}", "Guide\n" * 200)
        for path in ("README.md", "CONTRIBUTING.md", ".env.example", ".gitignore",
                     "docs/team.md", "docs/api-contract.md", "docs/architecture.md",
                     "docs/dataset-guide.md", "docs/storage-guide.md", "docs/testing-plan.md",
                     "docs/implementation-status.md", "docs/configuration.md", "prototypes/conveyor-demo.html",
                     "storage/README.md", "datasets/README.md"):
            self.write(path, "Fixture\n")
        (self.root / "examples").mkdir()
        for name in (*SAMPLES, "products.example.json", "labels.csv"):
            shutil.copyfile(ROOT / "examples" / name, self.root / "examples" / name)

    def write(self, relative_path, content):
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def errors(self):
        return "\n".join(validate_repository(self.root))

    def test_current_examples_pass(self):
        self.assertEqual([], validate_repository(self.root))

    def test_each_contract_and_catalog_is_required(self):
        for name in (*SAMPLES, "products.example.json"):
            with self.subTest(name=name):
                path = self.root / "examples" / name
                original = path.read_bytes()
                path.unlink()
                self.assertIn(name, self.errors())
                path.write_bytes(original)

    def test_invalid_contract_values_are_rejected(self):
        path = self.root / "examples/inspection-pass.json"
        original = json.loads(path.read_text(encoding="utf-8"))
        mutations = [
            ("result", "ERROR"), ("reason", "no_label"), ("source_mode", "unknown"),
            ("storage_status", "success"), ("inspection_id", "demo-pass-001"),
            ("client_request_id", "request-001"), ("match_score", True),
            ("match_score", float("nan")), ("match_score", 1.01),
            ("score_method", "template_ccoeff_normed"), ("image_width", 0),
            ("image_height", True), ("bbox", {"x": 399, "y": 0, "width": 2, "height": 2}),
            ("bbox", {"x": 0}), ("created_at", "2026-10-18T00:00:00"),
            ("orientation_deg", 360), ("timing_ms", {"total": 1}),
            ("expected_product", "not_in_catalog"), ("demo", False),
            ("config_version", "other-version"),
        ]
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                mutated = dict(original, **{field: value})
                path.write_text(json.dumps(mutated), encoding="utf-8")
                self.assertTrue(validate_repository(self.root))
        path.write_text(json.dumps(original), encoding="utf-8")

    def test_malformed_json_and_missing_field_report_errors(self):
        self.write("examples/inspection-pass.json", "{")
        self.assertIn("invalid JSON", self.errors())
        self.write("examples/inspection-pass.json", "{}")
        self.assertIn("missing fields", self.errors())

    def test_saved_image_urls_match_inspection_and_kind(self):
        path = self.root / "examples/inspection-pass.json"
        result = json.loads(path.read_text(encoding="utf-8"))
        result["images"]["original"] = result["images"]["annotated"]
        path.write_text(json.dumps(result), encoding="utf-8")
        self.assertIn("images.original", self.errors())

    def test_evidence_does_not_claim_unseen_single_view_coverage(self):
        path = self.root / "examples/inspection-pass.json"
        result = json.loads(path.read_text(encoding="utf-8"))
        result["evidence"]["verified_coverage"] = True
        path.write_text(json.dumps(result), encoding="utf-8")
        self.assertIn("single view cannot claim verified coverage", self.errors())

    def test_partial_human_review_is_rejected(self):
        path = self.root / "examples/inspection-pass.json"
        result = json.loads(path.read_text(encoding="utf-8"))
        result["reviewed_result"] = "PASS"
        path.write_text(json.dumps(result), encoding="utf-8")
        self.assertIn("invalid human review fields", self.errors())

    def test_split_leakage_checks_each_identity_independently(self):
        path = self.root / "examples/labels.csv"
        with path.open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream)
            columns, rows = reader.fieldnames, list(reader)
        for field in ("image_id", "filename", "physical_bottle_id", "capture_session", "split_group_id"):
            with self.subTest(field=field):
                altered = [dict(row) for row in rows]
                altered[1][field] = altered[0][field]
                with path.open("w", encoding="utf-8", newline="") as stream:
                    writer = csv.DictWriter(stream, fieldnames=columns)
                    writer.writeheader()
                    writer.writerows(altered)
                self.assertIn(f"split leakage for {field}", self.errors())

    def test_multiview_and_failed_storage_keep_evidence_alignment(self):
        path = self.root / "examples/inspection-orientation-review.json"
        result = json.loads(path.read_text(encoding="utf-8"))
        result["storage_status"] = "failed"
        result["storage_error"] = {"code": "write_failed", "message": "Example failure", "retryable": True}
        result["evidence"]["supporting_images"][1] = None
        path.write_text(json.dumps(result), encoding="utf-8")
        self.assertEqual([], validate_repository(self.root))
        result["storage_status"] = "saved"
        result["storage_error"] = None
        path.write_text(json.dumps(result), encoding="utf-8")
        self.assertIn("invalid supporting image URL", self.errors())

    def test_view_kind_requires_correct_number_of_evidence_images(self):
        path = self.root / "examples/inspection-pass.json"
        result = json.loads(path.read_text(encoding="utf-8"))
        result["evidence"]["kind"] = "multi_view"
        path.write_text(json.dumps(result), encoding="utf-8")
        self.assertIn("view kind and image count disagree", self.errors())

    def test_local_dependencies_and_captures_are_not_walked(self):
        for directory in SKIP_DIRS:
            self.write(f"{directory}/nested/private.md", "[broken](does-not-exist.md)")
        self.assertEqual([], validate_repository(self.root))

    def test_dataset_and_storage_root_guides_still_have_link_checks(self):
        for name in ("storage", "datasets"):
            with self.subTest(name=name):
                self.write(f"{name}/README.md", "[broken](does-not-exist.md)")
                self.assertIn(f"{name}", self.errors())
                self.write(f"{name}/README.md", "Fixture\n")


if __name__ == "__main__":
    unittest.main()
