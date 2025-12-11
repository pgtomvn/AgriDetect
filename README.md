# AgriDetect

Plant identification → segmentation → disease classification (with safe Grad-CAM explainability for disease only). Flask web app + TensorFlow models. This repo excludes datasets by default and tracks model binaries with Git LFS.

## Features
- Plant ID model (prototype-regularized, MixUp)
- Segmentation + per-plant sanity checks
- Disease classifier with Grad-CAM (visualization gated to disease predictions)
- Feedback capture via SQLite (optional)
- Clean separation of `src/`, `models/`, runtime dirs (`uploads/`, `outputs/`)

## Tech Stack
- Python 3.10+
- Flask, Werkzeug
- TensorFlow / Keras, NumPy, OpenCV, scikit-learn, Matplotlib

## Repo Layout (typical)
