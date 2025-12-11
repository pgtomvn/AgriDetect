# src/app.py 
import os, uuid, numpy as np, cv2, tensorflow as tf
from pathlib import Path
from flask import Flask, render_template, request, redirect, url_for, jsonify, send_from_directory, abort, Response
from werkzeug.utils import secure_filename
from tensorflow.keras.models import load_model as keras_load_model
from jinja2 import TemplateNotFound

from config import (
    PROJECT_ROOT, APP_ROOT, MODELS_DIR,
    STATIC_DIR, UPLOADS_DIR, OUTPUTS_DIR, ensure_runtime_dirs, 
    EFFECTS_DIR,
)

# =========================
# KB integration
# =========================
import unicodedata, re, json
from typing import Optional, List, Tuple

import sqlite3
from werkzeug.exceptions import BadRequest
from feedback_store import FeedbackStore 

# Ưu tiên dùng kb_loader nếu có
try:
    from kb_loader import (
        load_kb_dir as _kb_load_dir,
        get_entry_by_label as _kb_get_by_label,
        get_entry_by_id as _kb_get_by_id,
        is_healthy_entry as _kb_is_healthy,
    )
    _kb_loaded = False
except Exception:
    _kb_load_dir = None
    _kb_get_by_label = None
    _kb_get_by_id = None
    _kb_is_healthy = None
    _kb_loaded = False

def _norm(s: str) -> str:
    s = (s or "").strip().lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"[\s\-]+", "_", s)
    s = re.sub(r"[^a-z0-9_]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s

KNOWN_PLANTS = {"pepper", "potato", "tomato"}

# Tên cây tiếng Việt để hiển thị
PLANT_NAME_VI = {
    "pepper": "Ớt chuông",
    "potato": "Khoai tây",
    "tomato": "Cà chua",
}

PLANT_ALIASES = {
    "pepper": {"pepper", "capsicum", "bellpepper", "bell_pepper"},
    "potato": {"potato", "solanum_tuberosum", "spud"},
    "tomato": {"tomato", "solanum_lycopersicum"},
}

def _canon_plant_loose(s: str) -> Optional[str]:
    t = _norm(s)
    # 1) thử chuẩn hoá cứng
    k = _canon_plant_key(t)
    if k: return k
    # 2) thử alias
    for plant, aliases in PLANT_ALIASES.items():
        if t in aliases or t.startswith(plant + "_") or t.endswith("_" + plant):
            return plant
    return None  

def _canon_plant_key(s: str) -> Optional[str]:
    k = _norm(s)
    if k in KNOWN_PLANTS:
        return k
    head = k.split("_", 1)[0] if k else ""
    return head if head in KNOWN_PLANTS else None

def _kb_items_for(plant: str):
    kb_candidates = [
        PROJECT_ROOT / "data" / "kb" / f"{plant.lower()}_kb.json",
        APP_ROOT     / "data" / "kb" / f"{plant.lower()}_kb.json",
    ]
    for kb_file in kb_candidates:
        try:
            if kb_file.exists():
                data = json.loads(kb_file.read_text(encoding="utf-8"))
                return (data.get("items", []) if isinstance(data, dict) else data) or []
        except Exception as e:
            print(f"[KB] read error {kb_file}: {e}")
            return []
    print(f"[KB] not found KB file for plant={plant} in: {kb_candidates}")
    return []

def is_healthy_entry(entry: dict) -> bool:
    if _kb_is_healthy:
        try:
            return _kb_is_healthy(entry)
        except Exception:
            pass
    return bool(entry and str(entry.get("category", "")).lower() == "healthy")

def smart_get_entry(plant: str, disease_or_label: str):
    if not disease_or_label:
        return None
    plant_key = _canon_plant_key(plant) or plant.lower()
    want = _norm(disease_or_label)
    plant_n = _norm(plant_key)
    want_noplant = re.sub(rf"^{plant_n}_+", "", want)

    # 1) kb_loader (ưu tiên)
    if _kb_get_by_label:
        try:
            e = _kb_get_by_label(disease_or_label, plant=plant_key)
            if e and (str(e.get("_plant") or e.get("plant") or "").lower() == plant_key):
                return e
            elif e:
                print(f"[KB] ignore cross-plant (by_label): want={plant_key}, got={e.get('_plant') or e.get('plant')}")
        except Exception:
            pass

    if _kb_get_by_id:
        try:
            e2 = _kb_get_by_id(disease_or_label)
            if e2 and str(e2.get("_plant") or e2.get("plant") or "").lower() == plant_key:
                return e2
            elif e2:
                print(f"[KB] ignore cross-plant (by_id): want={plant_key}, got={e2.get('_plant') or e2.get('plant')}")
        except Exception:
            pass

    # 2) JSON fallback
    items = _kb_items_for(plant_key)
    for it in items:
        di = _norm(it.get("disease_id") or "")
        name = _norm(it.get("name_vi") or it.get("name") or "")
        lbls = [_norm(x) for x in (it.get("labels") or [])]

        cand = set()
        if di:
            cand.add(di); cand.add(re.sub(rf"^{plant_n}_+", "", di))
        if name:
            cand.add(name); cand.add(f"{plant_n}_{name}")
        for lb in lbls:
            if lb:
                cand.add(lb); cand.add(re.sub(rf"^{plant_n}_+", "", lb))

        if want in cand or want_noplant in cand:
            return it
    return None

def is_healthy_label(name: str) -> bool:
    return bool(name and "healthy" in name.lower())

def label_to_disease_id(plant_label: str, disease_label: str) -> str:
    p = (_canon_plant_key(plant_label) or (plant_label or "").lower()).strip()
    s = (disease_label or "").lower().strip()
    for sep in ("__", "_"):
        pref = p + sep
        if s.startswith(pref):
            s = s[len(pref):]
            break
    s = s.replace("__", "_").replace(" ", "_")
    s = re.sub(r"[^a-z0-9_-]+", "_", s).strip("_")
    if not s:
        s = "unknown"
    return f"{p}_{s}" if not s.startswith(p + "_") else s

# =========================
# Init
# =========================
ensure_runtime_dirs()
# KB boot
try:
    candidates = []
    for d in [PROJECT_ROOT / "data" / "kb", APP_ROOT / "data" / "kb"]:
        if d.exists():
            n_json = len(list(d.glob("*.json")))
            candidates.append((n_json, d))
    candidates.sort(reverse=True)
    kb_dir = candidates[0][1] if candidates else None
    if _kb_load_dir and kb_dir:
        _kb_load_dir(kb_dir)
        _kb_loaded = True
        print(f"[KB] loader active at: {kb_dir} (files={candidates[0][0]})")
    else:
        tried = [str(d) for _, d in candidates] or ['<none>']
        print(f"[KB] loader not found or kb dir missing. Tried: {tried}. Using JSON scan fallback.")
except Exception as e:
    print(f"[KB] loader error, fallback JSON scan: {e}")

app = Flask(
    __name__,
    static_folder=str(STATIC_DIR),
    template_folder=str(PROJECT_ROOT / "templates")
)
app.config["UPLOAD_FOLDER"] = str(UPLOADS_DIR)
app.config["OUTPUT_FOLDER"] = str(OUTPUTS_DIR)

# ==== Runtime + feedback store ====
RUNTIME_DIR = OUTPUTS_DIR / "runtime"
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
REALITY_DIR = Path("data/raw_balanced/reality")
REALITY_DIR.mkdir(parents=True, exist_ok=True)
FEEDBACK_DB = RUNTIME_DIR / "feedback.db"
STASH_DIR   = RUNTIME_DIR / "feedback_images"
STASH_DIR.mkdir(parents=True, exist_ok=True)
store = FeedbackStore(FEEDBACK_DB, reality_root=REALITY_DIR, stash_root=STASH_DIR)

# =========================
# Helpers (paths / io)
# =========================
def pick_first_exists(*paths: Path):
    for p in paths:
        if p and Path(p).exists():
            return Path(p)
    return None

def prefer_keras(base_no_ext: Path):
    d = base_no_ext.with_suffix(".keras")
    if d.is_dir():
        return d
    return pick_first_exists(base_no_ext.with_suffix(".keras"),
                             base_no_ext.with_suffix(".h5"))

def read_lines(path: Path):
    if not path or not path.is_file():
        return None
    return [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]

def _static_url_from_anypath(p: str):
    """Trả về URL /static/... nếu p nằm trong STATIC_DIR/UPLOADS_DIR/OUTPUTS_DIR."""
    if not p:
        return None
    pth = Path(p)
    def posix(rel_path: Path) -> str:
        return rel_path.as_posix()
    try:
        rel = pth.relative_to(STATIC_DIR)
        return url_for("static", filename=posix(rel))
    except Exception:
        pass
    try:
        rel = pth.relative_to(UPLOADS_DIR)
        return url_for("static", filename="uploads/" + posix(rel))
    except Exception:
        pass
    try:
        rel = pth.relative_to(OUTPUTS_DIR)
        return url_for("static", filename="outputs/" + posix(rel))
    except Exception:
        pass
    return None

# ---------- Signature utilities cho SavedModel ----------
def _pick_signature(obj):
    sigs = getattr(obj, "signatures", None)
    if not sigs:
        return None
    if "serving_default" in sigs:
        return sigs["serving_default"]
    if "serve" in sigs:
        return sigs["serve"]
    try:
        return next(iter(sigs.values()))
    except Exception:
        return None

def _infer_hw_from_signature(obj, fallback=(256, 256)):
    fn = _pick_signature(obj)
    if fn is None:
        return fallback
    try:
        args, kwargs = fn.structured_input_signature
        specs = []
        if kwargs:
            specs = list(kwargs.values())
        else:
            specs = [a for a in args if isinstance(a, tf.TensorSpec)]
        for sp in specs:
            if isinstance(sp, tf.TensorSpec) and sp.shape.rank == 4:
                H = int(sp.shape[1]) if sp.shape[1] is not None else fallback[0]
                W = int(sp.shape[2]) if sp.shape[2] is not None else fallback[1]
                return (H, W)
    except Exception:
        pass
    return fallback

def _signature_call_numpy(obj, arr):
    fn = _pick_signature(obj)
    x = tf.convert_to_tensor(arr)
    if fn is None:
        out = obj(x)
    else:
        try:
            args, kwargs = fn.structured_input_signature
            if kwargs:
                key = next(iter(kwargs.keys()))
                out = fn(**{key: x})
            else:
                out = fn(x)
        except Exception:
            out = fn(x)
    if isinstance(out, dict):
        out = next(iter(out.values()))
    elif isinstance(out, (list, tuple)):
        out = out[0]
    return out.numpy()

def safe_load_model(path: Path):
    if not path or not path.exists():
        return None
    try:
        if path.is_file():
            print(f"🔄 Loading model (file): {path.name}")
            return keras_load_model(str(path), compile=False)
        else:
            if (path / "saved_model.pb").is_file():
                print(f"🔄 Loading model (dir): {path.name}")
                try:
                    return keras_load_model(str(path), compile=False)
                except Exception:
                    return tf.saved_model.load(str(path))
            print(f"❌ Không tìm thấy saved_model.pb trong {path}")
            return None
    except Exception as e:
        print(f"❌ Không load được model {path}: {e}")
        return None

def infer_input_size(model_obj, fallback=(256, 256)):
    if model_obj is None:
        return fallback
    try:
        shp = getattr(model_obj, "input_shape", None)
        if shp is not None:
            if isinstance(shp, (list, tuple)):
                shp = shp[0] if shp and isinstance(shp[0], (list, tuple)) else shp
            if len(shp) >= 4 and shp[1] and shp[2]:
                return (int(shp[1]), int(shp[2]))
    except Exception:
        pass
    if hasattr(model_obj, "signatures"):
        return _infer_hw_from_signature(model_obj, fallback)
    return fallback

def model_output_units(keras_model):
    try:
        last = keras_model.layers[-1]
        if hasattr(last, "units") and last.units:
            return int(last.units)
        shp = getattr(last, "output_shape", None)
        if shp is not None:
            return int(shp[-1])
    except Exception:
        pass
    return None

def preprocess_for_keras(img_bgr, target_size):
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    img_resized = cv2.resize(img_rgb, target_size, interpolation=cv2.INTER_AREA)
    arr = img_resized.astype(np.float32) / 255.0
    return np.expand_dims(arr, axis=0)

def predict_any(model_obj, arr, verbose=0):
    if model_obj is None:
        raise ValueError("Model is None")
    if hasattr(model_obj, "predict"):
        return model_obj.predict(arr, verbose=verbose)
    return _signature_call_numpy(model_obj, arr)

# =========================
# Segmentation postprocess
# =========================
def postprocess_mask(prob_map, thr=0.5, min_area_ratio=0.002, dilate_px=3):
    if prob_map.ndim == 3:
        prob_map = prob_map[..., 0]
    h, w = prob_map.shape[:2]
    binm = (prob_map >= thr).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    binm = cv2.morphologyEx(binm, cv2.MORPH_OPEN,  k, 1)
    binm = cv2.morphologyEx(binm, cv2.MORPH_CLOSE, k, 1)
    if dilate_px > 0:
        k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_px, dilate_px))
        binm = cv2.dilate(binm, k2, 1)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binm, connectivity=8)
    rois, min_area = [], int(min_area_ratio * h * w)
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < min_area:
            continue
        x, y, w_i, h_i, _ = stats[i]
        rois.append((x, y, x + w_i, y + h_i))
    return (binm > 0).astype(np.uint8), rois

def make_masked_image(img_bgr, mask_bin):
    m3 = np.repeat((mask_bin > 0).astype(np.uint8)[:, :, None], 3, axis=2)
    out = img_bgr.copy()
    out[m3 == 0] = 0
    return out

# =========================
# Grad-CAM 
# =========================
def _is_keras_model(m) -> bool:
    return hasattr(m, "layers") and hasattr(m, "inputs") and hasattr(m, "outputs")

def _find_last_conv_layer(m):
    for layer in reversed(m.layers):
        try:
            out_shape = getattr(layer, "output_shape", None)
            if out_shape is None:
                out_tensor = getattr(layer, "output", None)
                if out_tensor is not None and len(out_tensor.shape) == 4:
                    return layer.name
            else:
                if isinstance(out_shape, tuple) and len(out_shape) == 4:
                    return layer.name
                if isinstance(out_shape, list):
                    for s in out_shape:
                        if isinstance(s, tuple) and len(s) == 4:
                            return layer.name
        except Exception:
            continue
    return m.layers[-1].name

def grad_cam_keras(model, img_arr, class_idx=None, layer_name=None):
    if not _is_keras_model(model):
        return None
    try:
        if layer_name is None:
            layer_name = _find_last_conv_layer(model)
        conv_layer = model.get_layer(layer_name)
        grad_model = tf.keras.models.Model([model.inputs], [conv_layer.output, model.output])
        img_tensor = tf.convert_to_tensor(img_arr)
        with tf.GradientTape() as tape:
            conv_outputs, predictions = grad_model(img_tensor, training=False)
            if class_idx is None:
                class_idx = tf.argmax(predictions[0])
            loss = predictions[:, class_idx]
        grads = tape.gradient(loss, conv_outputs)
        if grads is None:
            return None
        pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))
        conv_outputs = conv_outputs[0]
        heatmap = tf.reduce_sum(conv_outputs * pooled_grads, axis=-1)
        heatmap = tf.maximum(heatmap, 0)
        maxv = tf.reduce_max(heatmap)
        heatmap = heatmap / (maxv + 1e-8)
        return heatmap.numpy().astype(np.float32)
    except Exception as e:
        print(f"[GradCAM] fail: {e}")
        return None

def _hot_boxes_from_heatmap(heatmap_resized: np.ndarray, thr=0.55, min_area_ratio=0.0008) -> List[Tuple[int,int,int,int]]:
    h, w = heatmap_resized.shape[:2]
    binm = (heatmap_resized >= thr).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    binm = cv2.morphologyEx(binm, cv2.MORPH_OPEN,  k, 1)
    binm = cv2.morphologyEx(binm, cv2.MORPH_CLOSE, k, 1)
    min_area = max(6, int(min_area_ratio * h * w))
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(binm, connectivity=8)
    boxes = []
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < min_area:
            continue
        x, y, wi, hi, _ = stats[i]
        boxes.append((int(x), int(y), int(x+wi), int(y+hi)))
    return boxes

# =========================
# Overlay
# =========================
def draw_overlay(img_bgr, mask_bin, rois, alpha=0.4):
    overlay = img_bgr.copy()
    color_mask = np.zeros_like(img_bgr)
    color_mask[mask_bin > 0] = (0, 255, 0)
    overlay = cv2.addWeighted(overlay, 1.0, color_mask, alpha, 0)
    for i, (x0, y0, x1, y1) in enumerate(rois):
        cv2.rectangle(overlay, (x0, y0), (x1, y1), (0, 0, 255), 2)
        cv2.putText(overlay, f"ROI {i+1}", (x0, max(0, y0-6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)
    return overlay

def draw_overlay_cam(img_bgr, mask_bin, rois, hotspot_boxes_per_roi=None, alpha=0.4):
    overlay = draw_overlay(img_bgr, mask_bin, rois, alpha=alpha)
    if hotspot_boxes_per_roi:
        for i, ((x0, y0, x1, y1), boxes) in enumerate(zip(rois, hotspot_boxes_per_roi)):
            for j, (hx0, hy0, hx1, hy1) in enumerate(boxes or []):
                ax0, ay0, ax1, ay1 = x0 + hx0, y0 + hy0, x0 + hx1, y0 + hy1
                cv2.rectangle(overlay, (ax0, ay0), (ax1, ay1), (0, 0, 255), 2)
                cv2.putText(overlay, f"H{i+1}.{j+1}", (ax0, max(0, ay0-4)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1, cv2.LINE_AA)
    return overlay

def save_image_and_get_url(img_bgr, folder: Path, prefix="overlay"):
    fname = f"{prefix}_{uuid.uuid4().hex[:8]}.jpg"
    fpath = folder / fname
    cv2.imwrite(str(fpath), img_bgr)
    return url_for("static", filename=f"outputs/{fpath.name}")

# =========================
# Paths 
# =========================
def _ok_map(d): return {k: bool(v) for k, v in d.items()}

PLANT_MODEL_PATH = (
    prefer_keras(MODELS_DIR / "plant_classifier_proto_best_f1_reality_v2")
    or prefer_keras(MODELS_DIR / "plant_classifier_proto_best_f1")
    or prefer_keras(MODELS_DIR / "plant_classifier_best_macroF1")
    or prefer_keras(MODELS_DIR / "plant_classifier_best_valLoss")
)
PLANT_CLASSES_PATH = (MODELS_DIR / "classes_plant.txt")

SEG_MODEL_PATHS = {
    "pepper": prefer_keras(MODELS_DIR / "seg_pepper_v2"),
    "potato": prefer_keras(MODELS_DIR / "seg_potato_v2"),
    "tomato": prefer_keras(MODELS_DIR / "seg_tomato_v2"),
}
DISEASE_MODEL_PATHS = {
    "pepper": prefer_keras(MODELS_DIR / "disease_classifier_pepper_reality_best_macroF1.keras"),
    "potato": prefer_keras(MODELS_DIR / "disease_classifier_potato_reality_v2_best_macroF1.keras"),
    "tomato": prefer_keras(MODELS_DIR / "disease_classifier_tomato_reality_v2_best_macroF1.keras"),
}
DISEASE_CLASSES_PATHS = {   
    "pepper": pick_first_exists(MODELS_DIR / "classes_disease_pepper.txt"),
    "potato": pick_first_exists(MODELS_DIR / "classes_disease_potato.txt"),
    "tomato": pick_first_exists(MODELS_DIR / "classes_disease_tomato.txt"),
}

# =========================
# Inference params
# =========================
SEG_THRESH       = 0.50
MIN_AREA_RATIO   = 0.002
DILATE_PX        = 3
PLANT_MIN_CONF   = 0.45
DISEASE_MIN_CONF = 0.40

GRADCAM_ENABLED        = True
GRADCAM_BIN_THR        = 0.55
GRADCAM_MIN_AREA_RATIO = 0.0008

# ==== PLANT SANITY BY SEG ====
PLANT_SANITY_BY_SEG     = True
PLANT_CONF_STRONG       = 0.72
PLANT_SEG_MIN_SCORE     = 0.003
PLANT_SEG_DELTA_MINWIN  = 0.004
PLANT_SEG_HARD_FAIL     = 0.0008

# ==== Reasoning boosts ====
DISEASE_TTA = 4  # 1 = tắt; 4 = [gốc, flipH, flipV, transpose]
DISEASE_TTA_PER_PLANT = {"tomato": 8, "pepper": 4, "potato": 4}
RETRIEVE_ENABLED = True
RETRIEVE_TOPK = 3
INDEX_DIR = MODELS_DIR / "indices"

def disease_predict_with_tta(model, arr, tta=1):
    if tta <= 1:
        out = predict_any(model, arr, verbose=0)[0]
        return np.asarray(out, np.float32)
    img = np.asarray(arr[0])
    variants = [img, np.flip(img, 1), np.flip(img, 0), np.transpose(img, (1,0,2))]
    probs = []
    for v in variants[:int(tta)]:
        p = predict_any(model, np.expand_dims(v, 0), verbose=0)[0]
        probs.append(np.asarray(p, np.float32))
    return np.mean(probs, axis=0).astype(np.float32)

def _build_embedder_from_disease_model(m):
    try:
        penult = m.layers[-2].output
        return tf.keras.models.Model(m.input, penult)
    except Exception:
        return None

def _load_index_npz(npz_path: Path):
    try:
        d = np.load(str(npz_path), allow_pickle=True)
        X = d["X"].astype(np.float32)
        y = d["y"].astype(np.int32)
        classes = [str(x) for x in d["classes"].tolist()]
        paths = [str(x) for x in d["paths"].tolist()]
        dim = int(d["dim"][0]) if "dim" in d else X.shape[1]
        return {"X": X, "y": y, "classes": classes, "paths": paths, "dim": dim}
    except Exception as e:
        print(f"[INDEX] load fail {npz_path}: {e}")
        return None

def _cosine_knn(vec, X, y, classes, topk=3):
    v = vec / (np.linalg.norm(vec) + 1e-8)
    VX = X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-8)
    sims = (VX @ v.reshape(-1,1)).ravel()
    idx = np.argsort(-sims)[:topk]
    return [(classes[int(y[i])], float(sims[i])) for i in idx]

# =========================
# Load models
# =========================
print("🔄 Booting AgriDetect (hybrid + safe Grad-CAM)…")

plant_model     = safe_load_model(PLANT_MODEL_PATH)
plant_classes   = read_lines(PLANT_CLASSES_PATH)
plant_units     = model_output_units(plant_model)
plant_class_mismatch = False
if plant_model and plant_classes and plant_units is not None and len(plant_classes) != plant_units:
    print(f"❌ Class mismatch (plant): outputs={plant_units}, classes_txt={len(plant_classes)}")
    plant_class_mismatch = True

seg_models      = {k: safe_load_model(v) for k, v in SEG_MODEL_PATHS.items()}
disease_models  = {k: safe_load_model(v) for k, v in DISEASE_MODEL_PATHS.items()}
disease_classes = {k: read_lines(p)      for k, p in DISEASE_CLASSES_PATHS.items()}

# Embedders + indices
disease_embedders = {}
disease_indices = {}
for k, m in disease_models.items():
    if m is None or not _is_keras_model(m):
        disease_embedders[k] = None
        continue
    try:
        disease_embedders[k] = _build_embedder_from_disease_model(m)
    except Exception:
        disease_embedders[k] = None
    idx_path = INDEX_DIR / f"dis_{k}_embeds.npz"
    disease_indices[k] = _load_index_npz(idx_path) if idx_path.exists() else None
    if disease_indices[k] and disease_embedders[k]:
        try:
            dim_model = int(disease_embedders[k].output_shape[-1])
            if disease_indices[k]["dim"] != dim_model:
                print(f"[INDEX] dim mismatch for {k}: index={disease_indices[k]['dim']} vs model={dim_model} -> disable")
                disease_indices[k] = None
        except Exception:
            pass

# ====== input sizes (PER-PLANT!) ======
PLANT_INPUT_SIZE    = infer_input_size(plant_model, fallback=(256, 256))
SEG_INPUT_SIZES     = { k: (infer_input_size(m, fallback=(512, 512)) if m else None) for k, m in seg_models.items() }
DISEASE_INPUT_SIZES = { k: (infer_input_size(m, fallback=(300, 300)) if m else None) for k, m in disease_models.items() }

print("Plant OK:", bool(plant_model), "classes:", plant_classes, "→", (PLANT_MODEL_PATH.name if PLANT_MODEL_PATH else None))
print("Seg   OK:", _ok_map(seg_models))
print("Dis   OK:", _ok_map(disease_models))
print("Cls   OK:", {k: bool(disease_classes[k]) for k in disease_classes})
print("📐 sizes → plant:", PLANT_INPUT_SIZE)
print("📐 seg per-plant:", SEG_INPUT_SIZES)
print("📐 disease per-plant:", DISEASE_INPUT_SIZES)

# =========================
# Pipeline
# =========================
def _ensure_probs_1C(y_pred):
    out = y_pred
    if isinstance(out, (list, tuple)):
        out = out[0]
    out = np.asarray(out)
    if out.ndim == 1:
        out = out[None, ...]
    return out

def step1_predict_plant(img_bgr):
    if not plant_model or not plant_classes:
        return None, 0.0
    arr   = preprocess_for_keras(img_bgr, PLANT_INPUT_SIZE)
    try:
        raw = predict_any(plant_model, arr, verbose=0)
    except Exception as e:
        print(f"❌ step1_predict_plant: predict failed: {e}")
        return None, 0.0
    probs = _ensure_probs_1C(raw)[0]
    probs = np.asarray(probs).astype(np.float32)
    if probs.size == 0 or not np.isfinite(probs).any():
        print("❌ step1_predict_plant: empty/invalid probs")
        return None, 0.0
    idx = int(np.nanargmax(probs))
    conf = float(np.nanmax(probs))
    label = (plant_classes or [None])[max(0, min(idx, len(plant_classes)-1))] if plant_classes else None
    return label, conf

def step2_segment(img_bgr, plant_label):
    model = seg_models.get(plant_label)
    if model is None:
        return None, None, []
    H, W = img_bgr.shape[:2]
    seg_size = SEG_INPUT_SIZES.get(plant_label) or (512, 512)
    arr  = preprocess_for_keras(img_bgr, seg_size)
    try:
        prob = predict_any(model, arr, verbose=0)[0]
        prob = np.squeeze(prob)
        if prob.ndim < 2:
            return None, None, []
    except Exception:
        return None, None, []
    prob_up = cv2.resize(prob, (W, H), interpolation=cv2.INTER_LINEAR)
    mask_bin, rois = postprocess_mask(prob_up, SEG_THRESH, MIN_AREA_RATIO, DILATE_PX)
    return prob_up, mask_bin, rois

# ==== PLANT SANITY BY SEG ====
def _seg_score(mask_bin: Optional[np.ndarray]) -> float:
    if mask_bin is None:
        return 0.0
    return float(np.mean(mask_bin > 0))

def _plant_sanity_by_seg(img_bgr, init_label: str, init_conf: float):
    """
    Chạy segmentation cho các plant có model sẵn. Chỉ override khi:
      - Có ÍT NHẤT 2 seg-model hợp lệ, VÀ
      - Có seg-model cho chính plant dự đoán ban đầu, VÀ
      - init_conf < PLANT_CONF_STRONG, VÀ
      - (init_score quá kém hoặc best vượt trội theo ngưỡng)
    """
    candidates = [p for p in KNOWN_PLANTS if seg_models.get(p)]
    init_label_key = _canon_plant_key(init_label) or init_label

    # Nếu thiếu model seg (vd: chỉ có tomato) hoặc không có seg cho plant ban đầu -> KHÔNG override.
    if (len(candidates) < 2) or (init_label_key not in candidates):
        prob_mask, mask_bin, rois = step2_segment(img_bgr, init_label_key) if init_label_key in candidates else (None, None, [])
        score = _seg_score(mask_bin)
        print(f"[PLANT-SANITY] skip override (candidates={candidates}); keep {init_label_key} score={score:.4f}")
        return init_label_key, (prob_mask, mask_bin, rois), {init_label_key: score}

    # Tính điểm cho mọi ứng viên
    scores = {}
    outputs = {}
    for p in candidates:
        prob_mask, mask_bin, rois = step2_segment(img_bgr, p)
        sc = _seg_score(mask_bin)
        scores[p] = sc
        outputs[p] = (prob_mask, mask_bin, rois)

    best_label = max(scores, key=lambda k: scores[k])
    ordered = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    second_best = ordered[1][1] if len(ordered) >= 2 else 0.0

    init_score = scores.get(init_label_key, 0.0)
    best_score = scores.get(best_label, 0.0)

    print(f"[PLANT-SANITY] seg scores (mask%): " +
          ", ".join([f"{k}={scores[k]:.4f}" for k in sorted(scores.keys())]) +
          f" | init={init_label_key}({init_conf:.3f},{init_score:.4f}) best={best_label}({best_score:.4f})")

    override = False
    if init_conf < PLANT_CONF_STRONG:
        if init_score < PLANT_SEG_HARD_FAIL and best_score >= PLANT_SEG_MIN_SCORE:
            override = True
        elif (best_score - max(second_best, init_score)) >= PLANT_SEG_DELTA_MINWIN and best_score >= PLANT_SEG_MIN_SCORE:
            override = True

    final_label = best_label if override else init_label_key
    return final_label, outputs.get(final_label, (None, None, [])), scores

# ===== Original disease step =====
def step3_classify_disease(img_bgr, plant_label, rois, mask_bin):
    model   = disease_models.get(plant_label)
    classes = disease_classes.get(plant_label)
    if model is None or not classes:
        return [], None

    results = []
    if mask_bin is None or not rois:
        H, W = img_bgr.shape[:2]
        rois = [(0, 0, W, H)]
        mask_bin = np.ones((H, W), np.uint8)

    masked  = make_masked_image(img_bgr, mask_bin)
    dis_size = DISEASE_INPUT_SIZES.get(plant_label) or (300, 300)

    for (x0, y0, x1, y1) in rois:
        crop = masked[y0:y1, x0:x1]
        if crop.size == 0:
            continue
        arr   = preprocess_for_keras(crop, dis_size)
        try:
            tta = DISEASE_TTA_PER_PLANT.get(plant_label, DISEASE_TTA)
            probs = disease_predict_with_tta(model, arr, tta=tta)
        except Exception as e:
            print(f"❌ disease predict failed: {e}")
            continue

        probs = np.asarray(probs).astype(np.float32)
        if probs.size == 0 or not np.isfinite(probs).any():
            continue

        idx   = int(np.nanargmax(probs))
        p_cls = float(np.nanmax(probs))
        label = (classes or [None])[max(0, min(idx, len(classes)-1))] if classes else None

        conf_seg   = float(mask_bin[y0:y1, x0:x1].mean())
        conf_total = min(p_cls, conf_seg)
        results.append({
            "bbox": [int(x0), int(y0), int(x1), int(y1)],
            "disease": label,
            "p_cls": p_cls,
            "conf_seg": conf_seg,
            "conf_total": conf_total
        })

    best = max(results, key=lambda r: r["conf_total"]) if results else None
    return results, best

# ===== Disease step with Grad-CAM =====
def step3_classify_disease_cam(img_bgr, plant_label, rois, mask_bin):
    model   = disease_models.get(plant_label)
    classes = disease_classes.get(plant_label)
    if model is None or not classes:
        return [], None, []

    results = []
    hotspot_boxes_per_roi: List[List[Tuple[int,int,int,int]]] = []

    if mask_bin is None or not rois:
        H, W = img_bgr.shape[:2]
        rois = [(0, 0, W, H)]
        mask_bin = np.ones((H, W), np.uint8)

    masked  = make_masked_image(img_bgr, mask_bin)
    dis_size = DISEASE_INPUT_SIZES.get(plant_label) or (300, 300)

    for (x0, y0, x1, y1) in rois:
        crop = masked[y0:y1, x0:x1]
        if crop.size == 0:
            hotspot_boxes_per_roi.append([])
            continue
        arr   = preprocess_for_keras(crop, dis_size)
        try:
            tta = DISEASE_TTA_PER_PLANT.get(plant_label, DISEASE_TTA)
            probs = disease_predict_with_tta(model, arr, tta=tta)
        except Exception as e:
            print(f"❌ disease predict failed: {e}")
            hotspot_boxes_per_roi.append([])
            continue

        probs = np.asarray(probs).astype(np.float32)
        if probs.size == 0 or not np.isfinite(probs).any():
            hotspot_boxes_per_roi.append([])
            continue

        idx   = int(np.nanargmax(probs))
        p_cls = float(np.nanmax(probs))
        label = (classes or [None])[max(0, min(idx, len(classes)-1))] if classes else None

        conf_seg   = float(mask_bin[y0:y1, x0:x1].mean())
        conf_total = min(p_cls, conf_seg)

        roi_hot_boxes: List[Tuple[int,int,int,int]] = []
        if GRADCAM_ENABLED:
            heatmap = grad_cam_keras(model, arr, class_idx=idx)
            if heatmap is not None:
                heatmap = np.asarray(heatmap)
                heatmap = np.squeeze(heatmap)
                if heatmap.dtype != np.float32:
                    heatmap = heatmap.astype(np.float32)
                if heatmap.ndim == 2 and heatmap.size > 0:
                    hm_resized = cv2.resize(heatmap, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_LINEAR)
                    roi_hot_boxes = _hot_boxes_from_heatmap(hm_resized, thr=GRADCAM_BIN_THR, min_area_ratio=GRADCAM_MIN_AREA_RATIO)
        hotspot_boxes_per_roi.append(roi_hot_boxes)

        results.append({
            "bbox": [int(x0), int(y0), int(x1), int(y1)],  # FIX: bỏ dấu phẩy thừa
            "disease": label,
            "p_cls": p_cls,
            "conf_seg": conf_seg,
            "conf_total": conf_total,
            "hotspots": roi_hot_boxes,
        })

    best = max(results, key=lambda r: r["conf_total"]) if results else None
    return results, best, hotspot_boxes_per_roi

# =========================
# API/Pages 
# =========================
@app.get("/api/kb")
def api_get_kb():
    plant = (request.args.get("plant") or "").strip().lower()
    disease_id = request.args.get("disease_id")
    label = request.args.get("label")

    if not plant:
        probe = label or disease_id or ""
        plant_guess = _canon_plant_key(probe)
        if plant_guess:
            plant = plant_guess

    if plant not in KNOWN_PLANTS:
        return jsonify({"found": False, "error": "Thiếu hoặc sai 'plant'. Truyền plant=pepper|potato|tomato"}), 400

    entry = None
    if disease_id:
        entry = smart_get_entry(plant, disease_id)
    if not entry and label:
        entry = smart_get_entry(plant, label)

    return jsonify({"found": bool(entry), "kb": entry})

@app.get("/kb/<plant>/<disease_id>")
def kb_detail_page(plant, disease_id):
    print(f"[KB] request plant={plant} id={disease_id}")
    entry = smart_get_entry(plant, disease_id)
    if not entry:
        pretty = (disease_id or "").replace("_", " ").title()
        entry = {
            "disease_id": disease_id, "name_vi": pretty, "category": "Đang cập nhật",
            "symptoms_core": [], "look_alikes": [], "immediate_actions": [],
            "cultural_management": [], "spray_programs": {"preventive": [], "curative": []},
            "organic_options": [], "nutrition_notes": [], "product_slots": [], "faq": []
        }
    return render_template("kb_detail.html", plant=plant, kb=entry, healthy=is_healthy_entry(entry))

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/effects/<path:filename>")
def effects_static(filename):
    # Flask sẽ tự đoán mimetype theo đuôi .js / .css
    return send_from_directory(EFFECTS_DIR, filename)

@app.route("/post/<slug>")
def info_page(slug):
    # Map slug -> file template
    slug_map = {
        "gia-rau-cu-ha-nhiet-nhung-van-cao": "info.html", 
        "khanh-hoa-tap-huan-quan-ly-sau-benh-va-khoi-phuc-cay-trong-sau-lu": "info2.html",
        "trong-ot-chuong-trong-nha-kinh-lai-mot-ty-dong-tren-ha": "info3.html",
        "nguoi-hoi-sinh-nhung-thua-dat-kho-can-o-ven-do": "info4.html",
        #   thêm nữa ở đây...
        # "ten-slug-khac": "info3.html",
    }
    template_name = slug_map.get(slug)
    if not template_name:
        abort(404)

    try:
        return render_template(template_name)
    except TemplateNotFound:
        abort(404)

@app.route("/assets/info.css")
def info_css():
    # đọc file templates/effects/info.css
    return Response(render_template("effects/info.css"), mimetype="text/css")


@app.route("/assets/info.js")
def info_js():
    # đọc file templates/effects/info.js
    return Response(render_template("effects/info.js"), mimetype="text/javascript")

@app.route("/health")
def health():
    return jsonify({
        "plant_model": bool(plant_model),
        "plant_model_file": (PLANT_MODEL_PATH.name if PLANT_MODEL_PATH else None),
        "plant_units": plant_units,
        "plant_classes": plant_classes,
        "plant_class_mismatch": plant_class_mismatch,
        "seg_models": _ok_map(seg_models),
        "seg_input_sizes": SEG_INPUT_SIZES,
        "disease_models": _ok_map(disease_models),
        "disease_input_sizes": DISEASE_INPUT_SIZES,
        "disease_classes": {k: bool(disease_classes[k]) for k in disease_classes},
        "thresholds": {"plant_min_conf": PLANT_MIN_CONF, "disease_min_conf": DISEASE_MIN_CONF},
        "gradcam": {"enabled": GRADCAM_ENABLED, "thr": GRADCAM_BIN_THR, "min_area_ratio": GRADCAM_MIN_AREA_RATIO},
        "sanity_by_seg": {
            "enabled": PLANT_SANITY_BY_SEG,
            "conf_strong": PLANT_CONF_STRONG,
            "min_score": PLANT_SEG_MIN_SCORE,
            "delta_minwin": PLANT_SEG_DELTA_MINWIN,
            "hard_fail": PLANT_SEG_HARD_FAIL
        }
    })

@app.route("/predict", methods=["POST"])
def predict():
    if not plant_model or not plant_classes:
        return render_template(
            "result.html", image_url=None, overlay_url=None,
            prediction="Model/Classes error", confidence=0.0,
            note="❌ Plant model hoặc classes_plant.txt không hợp lệ.",
            used_legacy=False, plant_label=None, plant_conf=None, roi_rows=[], kb_url=None
        )

    if "file" not in request.files: 
        return redirect(request.url)
    file = request.files["file"]
    if not file or file.filename == "": 
        return redirect(request.url)

    uid = uuid.uuid4().hex[:8]
    base, ext = os.path.splitext(secure_filename(file.filename))
    saved_name = f"{base}_{uid}{ext}"
    img_path = UPLOADS_DIR / saved_name
    file.save(str(img_path))

    img_bgr = cv2.imread(str(img_path))
    if img_bgr is None:
        return render_template(
            "result.html",
            image_url=url_for("static", filename=f"uploads/{saved_name}"),
            prediction="Error", confidence=0.0,
            note="❌ Không đọc được ảnh đầu vào.",
            used_legacy=False, plant_label=None, plant_conf=None,
            roi_rows=[], kb_url=None
        )

    # ===== Bước 1: nhận diện loại cây =====
    plant_label, plant_conf = step1_predict_plant(img_bgr)
    orig_plant_label = plant_label
    canon_plant = _canon_plant_loose(plant_label)
    print(f"[PLANT] raw='{orig_plant_label}' -> canon='{canon_plant}' conf={plant_conf:.3f}")

    if canon_plant not in KNOWN_PLANTS:
        return render_template(
            "result.html",
            image_url=url_for("static", filename=f"uploads/{saved_name}"),
            overlay_url=None,
            prediction="Không chắc chắn (loại cây)",
            confidence=round(float(plant_conf) * 100.0, 2),
            note="❌ Không xác định được cây từ model; không tự ép về tomato. Hãy chụp rõ lá hơn.",
            used_legacy=False, plant_label=str(orig_plant_label),
            plant_conf=round(float(plant_conf) * 100.0, 2),
            roi_rows=[], kb_url=None
        )
    plant_label = canon_plant

    # ===== Bước 2: segmentation (tô vùng lá) =====
    prob_mask, mask_bin, rois = None, None, []
    if PLANT_SANITY_BY_SEG:
        final_plant, (prob_mask, mask_bin, rois), scores = _plant_sanity_by_seg(img_bgr, plant_label, plant_conf)
        if final_plant != plant_label:
            print(f"[PLANT-SANITY] OVERRIDE: {plant_label} → {final_plant} (conf={plant_conf:.3f})")
            plant_label = final_plant
        else:
            if mask_bin is None:
                prob_mask, mask_bin, rois = step2_segment(img_bgr, plant_label)
    else:
        prob_mask, mask_bin, rois = step2_segment(img_bgr, plant_label)

    if plant_label is None:
        return render_template(
            "result.html",
            image_url=url_for("static", filename=f"uploads/{saved_name}"),
            prediction="Error", confidence=0.0,
            note="❌ Plant classifier chưa sẵn sàng.",
            used_legacy=False, plant_label=None, plant_conf=None,
            roi_rows=[], kb_url=None
        )

    # ===== Bước 3: phân loại bệnh (có Grad-CAM) =====
    if GRADCAM_ENABLED:
        regions, best, hotspot_boxes_per_roi = step3_classify_disease_cam(img_bgr, plant_label, rois, mask_bin)
    else:
        regions, best = step3_classify_disease(img_bgr, plant_label, rois, mask_bin)
        hotspot_boxes_per_roi = None

    # ===== Vẽ overlay =====
    overlay_url = None
    if mask_bin is not None:
        if hotspot_boxes_per_roi:
            overlay = draw_overlay_cam(img_bgr, mask_bin, rois, hotspot_boxes_per_roi)
            overlay_url = save_image_and_get_url(overlay, OUTPUTS_DIR, prefix="overlay_cam")
        else:
            overlay = draw_overlay(img_bgr, mask_bin, rois)
            overlay_url = save_image_and_get_url(overlay, OUTPUTS_DIR, prefix="overlay")

    # ===== Gợi ý ảnh giống (retrieval) nếu model bệnh chưa chắc =====
    suggest_lines = []
    if RETRIEVE_ENABLED and regions and best and best["p_cls"] < DISEASE_MIN_CONF:
        try:
            emb = disease_embedders.get(plant_label)
            idx = disease_indices.get(plant_label)
            if emb is not None and idx is not None:
                x0, y0, x1, y1 = best["bbox"]
                if mask_bin is None:
                    H, W = img_bgr.shape[:2]
                    _mask = np.ones((H, W), np.uint8)
                else:
                    _mask = mask_bin
                masked = make_masked_image(img_bgr, _mask)
                crop = masked[y0:y1, x0:x1]
                if crop.size > 0:
                    dis_size = DISEASE_INPUT_SIZES.get(plant_label) or (300, 300)
                    arr = preprocess_for_keras(crop, dis_size)
                    vec = emb.predict(arr, verbose=0)[0]
                    topk = _cosine_knn(vec, idx["X"], idx["y"], idx["classes"], topk=RETRIEVE_TOPK)
                    if topk:
                        s = "Gợi ý gần nhất: " + ", ".join([f"{lab} (~{sim:.2f})" for lab, sim in topk])
                        suggest_lines.append(s)
        except Exception as e:
            print(f"[RETR] fail: {e}")

    # ===== Quyết định text hiển thị =====
    note_parts = []
    if plant_conf < PLANT_MIN_CONF:
        note_parts.append("⚠️ Mô hình chưa chắc chắn về loại cây — nên chụp rõ lá, ít nền hơn.")

    # Tên cây & bệnh tiếng Việt (dùng KB)
    plant_name_vi = PLANT_NAME_VI.get(plant_label, plant_label)
    kb_url = None
    disease_name_vi = None
    disease_label = best["disease"] if (regions and best) else None
    kb_entry = None

    if regions and best:
        # Lấy entry trong KB (nếu có) để dùng name_vi + link chi tiết
        if disease_label:
            kb_entry = smart_get_entry(plant_label, disease_label)

        if kb_entry:
            disease_name_vi = kb_entry.get("name_vi") or kb_entry.get("name") or disease_label
            disease_id = kb_entry.get("disease_id") or label_to_disease_id(plant_label, disease_label)
            kb_url = url_for("kb_detail_page", plant=plant_label.lower(), disease_id=disease_id)
        else:
            disease_name_vi = disease_label
            if disease_label and not is_healthy_label(disease_label):
                disease_id = label_to_disease_id(plant_label, disease_label)
                kb_url = url_for("kb_detail_page", plant=plant_label.lower(), disease_id=disease_id)

        # Dòng “Bệnh được dự đoán: …”
        final_prediction = f"{plant_name_vi} — {disease_name_vi}"
        final_conf = round(float(best["conf_total"]) * 100.0, 2)

        if best["p_cls"] < DISEASE_MIN_CONF:
            note_parts.append("⚠️ Mô hình chưa thật chắc về bệnh — nên cân nhắc chụp thêm ảnh khác.")
            if suggest_lines:
                note_parts.extend(suggest_lines)
    else:
        # Không có bệnh rõ; chỉ hiển thị loại cây (nếu đủ chắc chắn)
        if plant_conf >= PLANT_MIN_CONF:
            final_prediction = plant_name_vi
        else:
            final_prediction = "Không chắc chắn"
        final_conf = round(float(plant_conf) * 100.0, 2)
        kb_url = None

    note = " ".join(note_parts) if note_parts else None
    img_url = url_for("static", filename=f"uploads/{saved_name}")
    pct = lambda x: round(float(x) * 100.0, 2)

    # Cache tên bệnh tiếng Việt cho từng label trong bảng ROI
    disease_vi_cache = {}

    def _display_disease_name(label: str) -> str:
        if not label:
            return ""
        key = (plant_label, label)
        if key in disease_vi_cache:
            return disease_vi_cache[key]
        e = smart_get_entry(plant_label, label)
        if e:
            nm = e.get("name_vi") or e.get("name") or label
        else:
            nm = label
        disease_vi_cache[key] = nm
        return nm

    roi_rows = [{
        "idx": i + 1,
        "bbox": r["bbox"],
        "disease": _display_disease_name(r["disease"]),
        "p_cls": pct(r["p_cls"]),
        "conf_seg": pct(r["conf_seg"]),
        "conf_total": pct(r["conf_total"]),
        "hotspots": len(r.get("hotspots") or [])
    } for i, r in enumerate(regions or [])]

    # Lưu record cho feedback (vẫn dùng label gốc để train lại)
    _conf_for_store = float(best["conf_total"]) if (regions and best) else float(plant_conf)
    _disease_for_store = (best["disease"] if (regions and best) else None)
    image_id = store.save_image_record(
        src_image_path=img_path,
        plant_pred=plant_label,          # label gốc: pepper/potato/tomato
        disease_pred=_disease_for_store, # label gốc: Pepper__bell___Bacterial_spot...
        confidence=_conf_for_store,
        meta={"roi_count": len(rois or []), "overlay": bool(overlay_url)}
    )

    uncertain_flag = (
        plant_conf < PLANT_MIN_CONF
        or (not regions)
        or (regions and best and best["p_cls"] < DISEASE_MIN_CONF)
    )

    return render_template(
        "result.html",
        image_url=img_url,
        overlay_url=overlay_url,
        prediction=final_prediction,
        confidence=final_conf,
        note=note,
        used_legacy=False,
        plant_label=plant_label,          # giữ lại để debug nếu cần
        plant_name_vi=plant_name_vi,      # dùng cho giao diện
        plant_conf=round(float(plant_conf) * 100.0, 2),
        roi_rows=roi_rows,
        kb_url=kb_url,
        image_id=image_id,
        uncertain=uncertain_flag
    )

# ==== UI classes cho trang feedback ====
# cache UI để không phải scan KB nhiều lần
_UI_PLANT_DISEASE_CACHE = None

def _ui_plants_and_diseases_from_models():
    """
    Trả về:
      - plants: ['pepper', 'potato', 'tomato']
      - diseases_by_plant: {plant_slug: [label_gốc, ...]}
      - plant_names_vi: {plant_slug: 'Cà chua', ...}
      - diseases_vi_by_plant: {plant_slug: {label_gốc: 'Tên bệnh tiếng Việt', ...}}
    """
    global _UI_PLANT_DISEASE_CACHE
    if _UI_PLANT_DISEASE_CACHE is not None:
        return _UI_PLANT_DISEASE_CACHE

    plants = []
    for p in (plant_classes or []):
        k = _canon_plant_key(p)
        if k in KNOWN_PLANTS and k not in plants:
            plants.append(k)

    if not plants:
        plants = [k for k in KNOWN_PLANTS if disease_classes.get(k)]

    diseases_by_plant = {p: (disease_classes.get(p) or []) for p in plants}

    # Tên cây tiếng Việt
    plant_names_vi = {p: PLANT_NAME_VI.get(p, p) for p in plants}

    # Tên bệnh tiếng Việt (lấy từ KB nếu có)
    diseases_vi_by_plant = {}
    for p in plants:
        vi_map = {}
        for d in diseases_by_plant[p]:
            e = smart_get_entry(p, d)
            if e:
                nm = e.get("name_vi") or e.get("name") or d
            else:
                nm = d
            vi_map[d] = nm
        diseases_vi_by_plant[p] = vi_map

    _UI_PLANT_DISEASE_CACHE = (plants, diseases_by_plant, plant_names_vi, diseases_vi_by_plant)
    return _UI_PLANT_DISEASE_CACHE

# ==== Feedback routes ====
@app.get("/feedback")
def feedback_page():
    image_id = request.args.get("image_id")
    if not image_id:
        return "Missing image_id", 400

    img_url_qs = request.args.get("img")

    try:
        with sqlite3.connect(str(FEEDBACK_DB)) as conn:
            c = conn.cursor()
            row = c.execute(
                "SELECT original_path, saved_path, plant_pred, disease_pred FROM images WHERE id=?",
                (image_id,)
            ).fetchone()
    except Exception:
        row = None
    if not row:
        return "Image not found", 404

    orig_path, saved_path, plant_pred, disease_pred = row
    img_url = img_url_qs or _static_url_from_anypath(saved_path) or _static_url_from_anypath(orig_path)

    plants, diseases_by_plant, plant_names_vi, diseases_vi_by_plant = _ui_plants_and_diseases_from_models()

    # Việt hoá kết quả mô hình hiện ở đầu trang
    plant_pred_key = _canon_plant_key(plant_pred) or (plant_pred or "")
    plant_pred_vi = PLANT_NAME_VI.get(plant_pred_key, plant_pred or plant_pred_key)

    disease_pred_vi = None
    if disease_pred:
        e = smart_get_entry(plant_pred_key, disease_pred)
        if e:
            disease_pred_vi = e.get("name_vi") or e.get("name") or disease_pred
        else:
            disease_pred_vi = disease_pred

    return render_template(
        "feedback.html",
        image_id=image_id,
        image_url=img_url,
        image_path=(saved_path or orig_path),
        plant_pred=plant_pred,
        disease_pred=disease_pred,
        plant_pred_vi=plant_pred_vi,
        disease_pred_vi=disease_pred_vi,
        plants=plants,
        diseases_by_plant=diseases_by_plant,
        plant_names_vi=plant_names_vi,
        diseases_vi_by_plant=diseases_vi_by_plant,
    )

@app.post("/api/feedback")
def api_feedback():
    try:
        payload = request.get_json(force=True)
        image_id = payload.get("image_id")
        correct_plant = payload.get("correct_plant")
        correct_disease = payload.get("correct_disease")
        user_note = payload.get("user_note")
        if not image_id:
            raise BadRequest("missing image_id")
        fb_id, copied_to = store.save_feedback(
            image_id=image_id,
            correct_plant=correct_plant,
            correct_disease=correct_disease,
            user_note=user_note,
            source_ip=request.remote_addr
        )
        return jsonify({"ok": True, "feedback_id": fb_id, "copied_to": copied_to})
    except BadRequest as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": repr(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)
