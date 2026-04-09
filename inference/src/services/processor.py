from __future__ import annotations

from typing import Any

import numpy as np
import SimpleITK as sitk

from preprocessing.normalization import clip_hu, resample_isotropic


def _resample_to_reference(img: sitk.Image, ref: sitk.Image, default_value: float) -> sitk.Image:
    """
    Resample `img` onto `ref` grid (size/spacing/origin/direction).
    This is required when contrast/native series have different geometry.
    """
    res = sitk.Resample(
        img,
        ref,
        sitk.Transform(),
        sitk.sitkLinear,
        float(default_value),
        img.GetPixelID(),
    )
    return res


def _clean_mask_by_volume(mask: sitk.Image, min_vol_mm3: float) -> sitk.Image:
    """Remove small connected components using physical volume threshold."""
    cc = sitk.ConnectedComponent(sitk.Cast(mask > 0, sitk.sitkUInt8))
    stats = sitk.LabelShapeStatisticsImageFilter()
    stats.Execute(cc)
    if stats.GetNumberOfLabels() == 0:
        out = sitk.Image(mask.GetSize(), sitk.sitkUInt8)
        out.CopyInformation(mask)
        return out
    voxel_vol = float(np.prod(mask.GetSpacing()))
    keep_labels: list[int] = []
    for lb in stats.GetLabels():
        vol = float(stats.GetNumberOfPixels(lb)) * voxel_vol
        if vol >= float(min_vol_mm3):
            keep_labels.append(int(lb))
    out = sitk.Image(mask.GetSize(), sitk.sitkUInt8)
    out.CopyInformation(mask)
    if not keep_labels:
        return out
    for lb in keep_labels:
        out = sitk.Or(out, sitk.Cast(cc == lb, sitk.sitkUInt8))
    return sitk.Cast(out > 0, sitk.sitkUInt8)


def _restore_calcium(vessel_mask: sitk.Image, native_image: sitk.Image, dist_mm: float = 2.5) -> sitk.Image:
    calcium = sitk.BinaryThreshold(native_image, lowerThreshold=300, upperThreshold=3000, insideValue=1, outsideValue=0)
    dist = sitk.Abs(sitk.SignedMaurerDistanceMap(vessel_mask, squaredDistance=False, useImageSpacing=True))
    near = sitk.BinaryThreshold(dist, lowerThreshold=0, upperThreshold=dist_mm, insideValue=1, outsideValue=0)
    merged = sitk.Or(vessel_mask, sitk.And(calcium, near))
    return sitk.BinaryFillhole(sitk.Cast(merged, sitk.sitkUInt8))


def _segment_bones(img: sitk.Image) -> sitk.Image:
    mask = sitk.BinaryThreshold(img, lowerThreshold=300, upperThreshold=3000, insideValue=1, outsideValue=0)
    return _clean_mask_by_volume(mask, min_vol_mm3=1000)


def _segment_lungs(img: sitk.Image) -> sitk.Image:
    mask = sitk.BinaryThreshold(img, lowerThreshold=-1000, upperThreshold=-400, insideValue=1, outsideValue=0)
    mask = sitk.BinaryFillhole(mask)
    return _clean_mask_by_volume(mask, min_vol_mm3=5000)


def _select_vascular_components(mask: sitk.Image, keep_top: int) -> sitk.Image:
    """
    Keep only the most likely vascular connected components.

    Heuristic: prefer components with large Z-extent (aorta tree) and non-trivial volume.
    This prevents "solid blocks/shells" when contrast threshold captures non-vascular tissue.
    """
    cc = sitk.ConnectedComponent(sitk.Cast(mask > 0, sitk.sitkUInt8))
    stats = sitk.LabelShapeStatisticsImageFilter()
    stats.Execute(cc)
    labels = list(stats.GetLabels())
    if not labels:
        out = sitk.Image(mask.GetSize(), sitk.sitkUInt8)
        out.CopyInformation(mask)
        return out

    scored: list[tuple[float, int]] = []
    for lb in labels:
        # BoundingBox = (x, y, z, sizeX, sizeY, sizeZ)
        bb = stats.GetBoundingBox(lb)
        vol_vox = float(stats.GetNumberOfPixels(lb))
        z_extent = float(bb[5]) if len(bb) >= 6 else 1.0
        score = z_extent * (1.0 + np.log10(max(vol_vox, 10.0)))
        scored.append((score, int(lb)))
    scored.sort(key=lambda x: x[0], reverse=True)
    selected = [lb for _, lb in scored[: max(1, int(keep_top))]]

    out = sitk.Image(mask.GetSize(), sitk.sitkUInt8)
    out.CopyInformation(mask)
    for lb in selected:
        out = sitk.Or(out, sitk.Cast(cc == lb, sitk.sitkUInt8))
    return sitk.Cast(out > 0, sitk.sitkUInt8)


def _segment_vessels_strict(contrast: sitk.Image, native: sitk.Image, restore_calcium: bool) -> sitk.Image:
    # 1) Bone mask from native (strict) + dilation to remove bone edges
    bone = sitk.BinaryThreshold(native, lowerThreshold=300, upperThreshold=3000, insideValue=1, outsideValue=0)
    bone = sitk.BinaryDilate(bone, [2, 2, 2])
    # 2) Remove bones from contrast by masking out those voxels
    non_bone = sitk.Cast(bone == 0, sitk.sitkUInt8)
    no_bones = sitk.Mask(contrast, non_bone, outsideValue=-1000)
    # 3) Strict iodine threshold
    vessel = sitk.BinaryThreshold(no_bones, lowerThreshold=150, upperThreshold=800, insideValue=1, outsideValue=0)
    # Keep only vascular-like components to avoid large non-vascular blobs.
    vessel = _select_vascular_components(vessel, keep_top=1 if restore_calcium else 2)
    if restore_calcium:
        vessel = _restore_calcium(vessel, native, dist_mm=2.5)
    vessel = sitk.BinaryFillhole(sitk.Cast(vessel, sitk.sitkUInt8))
    return _clean_mask_by_volume(vessel, min_vol_mm3=500)


def process_volume(
    contrast_img: sitk.Image,
    native_img: sitk.Image | None,
    preset_config: dict[str, Any],
) -> sitk.Image:
    preset_id = str(preset_config.get("id", "aorta"))

    # Быстрый режим для интерактивного 3D-превью в браузере.
    target_spacing = 2.5 if preset_id in {"bones", "lungs"} else 1.5
    contrast = clip_hu(resample_isotropic(contrast_img, target_spacing), -1024.0, 3000.0)
    native = clip_hu(resample_isotropic(native_img, target_spacing), -1024.0, 3000.0) if native_img is not None else None

    if preset_id == "bones":
        return _segment_bones(contrast)

    if preset_id == "lungs":
        return _segment_lungs(contrast)

    if preset_id in {"aorta", "vessels_general"}:
        if native is None:
            raise ValueError("Native scan required for vessels presets (bone subtraction).")
        # Always align native to contrast grid to avoid geometry/size mismatch.
        native = _resample_to_reference(native, contrast, default_value=-1024.0)
        restore = bool(preset_config.get("restore_calcium", True)) if preset_id == "aorta" else False
        return _segment_vessels_strict(contrast, native, restore_calcium=restore)

    raise ValueError(f"Unknown preset_id: {preset_id}")
