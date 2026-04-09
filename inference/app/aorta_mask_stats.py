"""
Статистики HU внутри маски аорты из multilabel TotalSegmentator.

Используется идентификатор класса «aorta» из totalsegmentator.map_to_binary.class_map
(задача total — TotalSegmentator v2; при отсутствии — total_v1).
Не является диагностикой ОАС: только геометрия сегментации + распределение HU.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


def _resolve_aorta_label_id() -> int:
    try:
        from totalsegmentator.map_to_binary import class_map

        total = class_map.get("total") or {}
        for lid, name in total.items():
            if name == "aorta":
                return int(lid)
        v1 = class_map.get("total_v1") or {}
        for lid, name in v1.items():
            if name == "aorta":
                return int(lid)
    except Exception:
        log.debug("totalsegmentator map not available for aorta label id", exc_info=True)
    return 52


def _squeeze_3d(arr: Any) -> Any:
    import numpy as np

    a = np.asarray(arr)
    if a.ndim > 3:
        a = a[..., 0]
    return a


def compute_totalseg_aorta_hu_stats(
    volume_nifti_path: Path,
    segmentation_nifti_path: Path,
) -> dict[str, Any]:
    """
    Считает HU по вокселям, где multilabel == aorta.

    Returns:
        Словарь для поля totalsegAortaHuStats (camelCase ключи на границе FastAPI JSON).
    """
    import nibabel as nib
    import numpy as np

    engine_id = "totalsegmentator_aorta_hu_stats_v1"
    disclaimer = (
        "Статистика по маске аорты TotalSegmentator: не диагноз и не скрининг ОАС; "
        "зависит от качества сегментации и фазы/окна КТ."
    )

    vol_img = nib.load(str(volume_nifti_path))
    seg_img = nib.load(str(segmentation_nifti_path))

    vol = _squeeze_3d(vol_img.get_fdata(dtype=np.float32))
    seg = _squeeze_3d(seg_img.get_fdata(dtype=np.float32))

    if vol.shape != seg.shape:
        return {
            "ok": False,
            "maskEmpty": True,
            "engineId": engine_id,
            "reason": "shape_mismatch",
            "summaryLineRu": (
                f"Объём {tuple(vol.shape)} и маска {tuple(seg.shape)} не совпадают — статистика не посчитана."
            ),
            "disclaimerRu": disclaimer,
        }

    label_id = _resolve_aorta_label_id()
    mask = seg == float(label_id)
    voxel_count = int(np.count_nonzero(mask))

    if voxel_count == 0:
        return {
            "ok": True,
            "maskEmpty": True,
            "engineId": engine_id,
            "aortaLabelId": label_id,
            "summaryLineRu": (
                f"Класс aorta (label {label_id}) не найден в multilabel-маске — возможен другой FOV или сбой сегментации."
            ),
            "disclaimerRu": disclaimer,
        }

    hu = vol[mask].astype(np.float64, copy=False)
    spacing = tuple(float(x) for x in vol_img.header.get_zooms()[:3])
    voxel_mm3 = abs(spacing[0] * spacing[1] * spacing[2])
    volume_mm3 = float(voxel_count * voxel_mm3)

    def pct(p: float) -> float:
        return float(np.percentile(hu, p))

    mean_hu = float(np.mean(hu))
    return {
        "ok": True,
        "maskEmpty": False,
        "engineId": engine_id,
        "aortaLabelId": label_id,
        "voxelCount": voxel_count,
        "volumeMm3": volume_mm3,
        "voxelSpacingMm": list(spacing),
        "huMean": mean_hu,
        "huStd": float(np.std(hu)),
        "huMin": float(np.min(hu)),
        "huMax": float(np.max(hu)),
        "huP5": pct(5.0),
        "huP50": pct(50.0),
        "huP95": pct(95.0),
        "summaryLineRu": (
            f"TotalSegmentator: аорта (label {label_id}), {voxel_count} вокс., "
            f"объём ≈ {volume_mm3 * 1e-3:.1f} см³, средний HU ≈ {mean_hu:.1f}"
        ),
        "disclaimerRu": disclaimer,
    }
