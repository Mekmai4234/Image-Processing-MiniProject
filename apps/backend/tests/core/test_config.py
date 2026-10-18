from pathlib import Path
from app.core.config import settings, REPO_ROOT


def test_repo_root_resolution():
    assert REPO_ROOT.exists()
    assert (REPO_ROOT / "docs").is_dir()
    assert (REPO_ROOT / "apps" / "backend").is_dir()


def test_storage_root_absolute():
    assert settings.STORAGE_ROOT.is_absolute()
    assert settings.STORAGE_ROOT.name == "storage"
    assert settings.STORAGE_ROOT.parent == REPO_ROOT


def test_dataset_root_absolute():
    assert settings.DATASET_ROOT.is_absolute()
    assert settings.DATASET_ROOT.name == "datasets"
    assert settings.DATASET_ROOT.parent == REPO_ROOT


def test_storage_root_validation():
    assert settings.validate_storage_root() is True
    assert settings.STORAGE_ROOT.is_dir()


def test_simulation_defaults():
    defaults = settings.simulation_defaults
    assert "max_rotation_deg" in defaults
    assert "rotation_step_deg" in defaults
    assert defaults["max_rotation_deg"] > 0
    assert defaults["rotation_step_deg"] > 0
