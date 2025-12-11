# src/config.py
from pathlib import Path

# Thư mục: .../AgriDetect/src
PROJECT_ROOT = Path(__file__).resolve().parent
# Thư mục gốc dự án: .../AgriDetect
APP_ROOT = PROJECT_ROOT.parent

# Thư mục templates (HTML + hiệu ứng JS/CSS custom)
TEMPLATES_DIR = PROJECT_ROOT / "templates"
EFFECTS_DIR   = TEMPLATES_DIR / "effects"   # ví dụ: aurora.js, future_effect.js ...

# ===== Data =====
DATA_ROOT = APP_ROOT / "data"
RAW_PLANTVILLAGE = DATA_ROOT / "raw" / "PlantVillage"
DISEASE_REGIONS = DATA_ROOT / "disease_regions"

# ===== Models / Weights =====
MODELS_DIR = APP_ROOT / "models"
LEGACY_DIR = MODELS_DIR / "legacy"
WEIGHTS_DIR = APP_ROOT / "weights"

# ===== Static (Flask) =====
STATIC_DIR = APP_ROOT / "static"
UPLOADS_DIR = STATIC_DIR / "uploads"
OUTPUTS_DIR = STATIC_DIR / "outputs"

def ensure_runtime_dirs():
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
