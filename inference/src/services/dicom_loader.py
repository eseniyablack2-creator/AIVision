from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Iterable

import pydicom
import SimpleITK as sitk
from fastapi import UploadFile

from preprocessing.normalization import to_hu


def _safe_name(name: str) -> str:
    base = Path(name or "slice.dcm").name
    return base if base else "slice.dcm"


def save_uploads_to_temp_dir(files: Iterable[UploadFile], prefix: str) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix=prefix))
    for idx, up in enumerate(files):
        target = tmp / f"{idx:05d}_{_safe_name(up.filename or '')}"
        data = up.file.read()
        target.write_bytes(data)
    return tmp


def load_largest_series(input_dir: Path) -> sitk.Image:
    series_ids = sitk.ImageSeriesReader.GetGDCMSeriesIDs(str(input_dir)) or []
    if not series_ids:
        raise ValueError(f"No DICOM series found in '{input_dir}'")

    best_files: list[str] = []
    for sid in series_ids:
        files = list(sitk.ImageSeriesReader.GetGDCMSeriesFileNames(str(input_dir), sid))
        if len(files) > len(best_files):
            best_files = files

    if not best_files:
        raise ValueError(f"No readable DICOM files in '{input_dir}'")

    # Convert to Hounsfield Units (HU) explicitly.
    # SimpleITK often applies rescale, but not consistently across modalities/inputs.
    # For robust threshold-based presets (bones/lungs/vessels), we enforce slope/intercept from the source DICOM.
    slope = 1.0
    intercept = 0.0
    try:
        ds0 = pydicom.dcmread(best_files[0], stop_before_pixels=True, force=True)
        slope = float(getattr(ds0, "RescaleSlope", 1.0) or 1.0)
        intercept = float(getattr(ds0, "RescaleIntercept", 0.0) or 0.0)
    except Exception:
        slope = 1.0
        intercept = 0.0

    reader = sitk.ImageSeriesReader()
    reader.SetFileNames(best_files)
    img = reader.Execute()
    return to_hu(img, slope=slope, intercept=intercept)

