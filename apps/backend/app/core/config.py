import os
from pathlib import Path
from typing import Any, Dict, List
from dotenv import load_dotenv

# Calculate repository root strictly relative to this config file:
# apps/backend/app/core/config.py -> core (1) -> app (2) -> backend (3) -> apps (4) -> REPO_ROOT (5)
REPO_ROOT: Path = Path(__file__).resolve().parent.parent.parent.parent.parent

# Explicitly load .env from repository root if it exists
env_path = REPO_ROOT / ".env"
if env_path.is_file():
    # Process environment variables take precedence (override=False)
    load_dotenv(dotenv_path=env_path, override=False)


class Settings:
    REPO_ROOT: Path = REPO_ROOT
    CONFIG_VERSION: str = "v0.2"

    # API & Network
    VITE_API_BASE_URL: str = os.getenv("VITE_API_BASE_URL", "http://127.0.0.1:8000")
    WEB_ORIGIN: str = os.getenv("WEB_ORIGIN", "http://localhost:5173")

    # Timezone
    APP_TIMEZONE: str = os.getenv("APP_TIMEZONE", "Asia/Bangkok")

    # Limits
    MAX_UPLOAD_MB: int = int(os.getenv("MAX_UPLOAD_MB", "10"))
    MAX_IMAGE_PIXELS: int = int(os.getenv("MAX_IMAGE_PIXELS", "20000000"))
    MAX_INSPECTION_VIEWS: int = int(os.getenv("MAX_INSPECTION_VIEWS", "12"))
    MAX_REQUEST_MB: int = int(os.getenv("MAX_REQUEST_MB", "40"))

    # Rotation / Simulation
    MAX_ROTATION_DEG: int = int(os.getenv("MAX_ROTATION_DEG", "360"))
    ROTATION_STEP_DEG: int = int(os.getenv("ROTATION_STEP_DEG", "30"))
    SAVE_ROTATION_FRAMES: bool = os.getenv("SAVE_ROTATION_FRAMES", "false").lower() in ("true", "1", "yes")

    # Paths (Resolved against REPO_ROOT if relative)
    _raw_storage_root: str = os.getenv("STORAGE_ROOT", "./storage")
    _raw_dataset_root: str = os.getenv("DATASET_ROOT", "./datasets")

    @property
    def STORAGE_ROOT(self) -> Path:
        p = Path(self._raw_storage_root)
        if not p.is_absolute():
            p = (self.REPO_ROOT / p).resolve()
        return p

    @property
    def DATASET_ROOT(self) -> Path:
        p = Path(self._raw_dataset_root)
        if not p.is_absolute():
            p = (self.REPO_ROOT / p).resolve()
        return p

    # Catalog
    SUPPORTED_PRODUCTS: List[Dict[str, Any]] = [
        {
            "product_id": "bottle_a",
            "display_name": "Bottle A — รอเลือกยี่ห้อและรุ่นจริง",
            "brand": None,
            "size_ml": None,
            "reference_paths": [],
            "validated": False,
        },
        {
            "product_id": "bottle_b",
            "display_name": "Bottle B — รอเลือกยี่ห้อและรุ่นจริง",
            "brand": None,
            "size_ml": None,
            "reference_paths": [],
            "validated": False,
        },
    ]

    @property
    def simulation_defaults(self) -> Dict[str, int]:
        return {
            "max_rotation_deg": self.MAX_ROTATION_DEG,
            "rotation_step_deg": self.ROTATION_STEP_DEG,
        }

    def validate_storage_root(self) -> bool:
        """Ensure STORAGE_ROOT exists and is writable."""
        root = self.STORAGE_ROOT
        try:
            root.mkdir(parents=True, exist_ok=True)
            test_file = root / ".write_test"
            test_file.touch()
            test_file.unlink()
            return True
        except Exception as e:
            raise RuntimeError(f"STORAGE_ROOT '{root}' is not writable or cannot be created: {e}")


settings = Settings()
