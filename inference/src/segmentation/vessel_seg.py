from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from scipy import ndimage

from config import ProcessingConfig
from dataio import DicomLoader
from preprocessing import clip_hu, resample_isotropic
from segmentation.backends import CPUSegmentationBackend, GPUSegmentationBackend, SegmentationBackend
from segmentation.bone_removal import mmbe_bone_removal

LOGGER = logging.getLogger(__name__)


@dataclass
class VesselSegmentationReport:
    volume_ml: float
    max_diameter_mm: float
    calcium_spots_restored: int

    def to_dict(self) -> dict[str, float | int]:
        return {
            "volume_ml": float(self.volume_ml),
            "max_diameter_mm": float(self.max_diameter_mm),
            "calcium_spots_restored": int(self.calcium_spots_restored),
        }


class VascularSegmenter:
    def __init__(self, config: ProcessingConfig | None = None) -> None:
        self.config = config or ProcessingConfig()
        self.loader = DicomLoader()
        self.backend: SegmentationBackend = (
            GPUSegmentationBackend() if self.config.use_gpu else CPUSegmentationBackend()
        )

    def segment_cta_aorta(
        self, contrast_path: str | Path, native_path: str | Path | None = None
    ) -> tuple[sitk.Image, dict[str, float | int]]:
        try:
            contrast_img = self.loader.load_series(contrast_path)
            contrast_img = clip_hu(
                resample_isotropic(contrast_img, self.config.target_spacing_mm),
                self.config.hu_clip_min,
                self.config.hu_clip_max,
            )

            calcium_spots = 0
            if native_path is not None:
                native_img = self.loader.load_series(native_path)
                native_img = clip_hu(
                    resample_isotropic(native_img, self.config.target_spacing_mm),
                    self.config.hu_clip_min,
                    self.config.hu_clip_max,
                )
                vessel_input, _ = mmbe_bone_removal(
                    contrast_img,
                    native_img,
                    threshold_hu=self.config.bone_threshold_hu,
                    dilation_vox=self.config.dilation_radius_vox,
                )
            else:
                native_img = None
                vessel_input = sitk.BinaryMorphologicalOpening(
                    sitk.BinaryThreshold(contrast_img, 150, 800, insideValue=1, outsideValue=0),
                    [1, 1, 1],
                )
                vessel_input = sitk.Mask(contrast_img, sitk.Cast(vessel_input, sitk.sitkUInt8), outsideValue=-1000.0)

            seeds = self._find_seeds(vessel_input)
            vessels = self.extract_vessels(vessel_input, seeds)

            if native_img is not None:
                vessels, calcium_spots = self.restore_calcium(vessels, native_img)

            vessels = self._postprocess(vessels)
            report = self._make_report(vessels, calcium_spots).to_dict()
            return vessels, report
        except Exception as exc:  # pragma: no cover
            LOGGER.exception("Failed to segment CTA aorta")
            raise RuntimeError(f"Segmentation failed: {exc}") from exc

    def extract_vessels(
        self, image: sitk.Image, seed_points: list[tuple[int, int, int]]
    ) -> sitk.Image:
        mask = self.backend.region_grow(image, seed_points, low=150.0, high=800.0)
        return sitk.Cast(mask > 0, sitk.sitkUInt8)

    def restore_calcium(
        self, vessel_mask: sitk.Image, native_image: sitk.Image
    ) -> tuple[sitk.Image, int]:
        calcium_mask = sitk.BinaryThreshold(native_image, 300, 3000, insideValue=1, outsideValue=0)
        vessel_np = sitk.GetArrayFromImage(vessel_mask).astype(np.uint8)
        calcium_np = sitk.GetArrayFromImage(calcium_mask).astype(np.uint8)

        spacing_xyz = vessel_mask.GetSpacing()
        spacing_zyx = (spacing_xyz[2], spacing_xyz[1], spacing_xyz[0])
        max_distance_vox = max(1.0, 2.0 / min(spacing_zyx))

        distance_to_vessel = ndimage.distance_transform_edt(1 - vessel_np, sampling=spacing_zyx)
        candidate = (calcium_np > 0) & (distance_to_vessel <= max_distance_vox)

        labels, num = ndimage.label(candidate)
        restored = np.zeros_like(candidate, dtype=bool)
        restored_count = 0
        for label_id in range(1, num + 1):
            component = labels == label_id
            if component.any() and np.any(ndimage.binary_dilation(component, iterations=1) & (vessel_np > 0)):
                restored |= component
                restored_count += 1

        merged = (vessel_np > 0) | restored
        merged_img = sitk.GetImageFromArray(merged.astype(np.uint8))
        merged_img.CopyInformation(vessel_mask)
        return sitk.Cast(merged_img, sitk.sitkUInt8), restored_count

    def _find_seeds(self, image: sitk.Image) -> list[tuple[int, int, int]]:
        arr = sitk.GetArrayFromImage(image)
        masked = np.where((arr >= 150) & (arr <= 800), arr, -np.inf)
        if np.all(np.isneginf(masked)):
            sz = image.GetSize()
            return [(sz[0] // 2, sz[1] // 2, sz[2] // 2)]

        top_indices = np.argpartition(masked.ravel(), -8)[-8:]
        seeds: list[tuple[int, int, int]] = []
        zyx_coords = np.array(np.unravel_index(top_indices, masked.shape)).T
        for z, y, x in zyx_coords:
            seeds.append((int(x), int(y), int(z)))
        return seeds

    def _postprocess(self, mask: sitk.Image) -> sitk.Image:
        cc = sitk.ConnectedComponent(mask)
        relabeled = sitk.RelabelComponent(cc, sortByObjectSize=True)
        largest = sitk.Cast(relabeled == 1, sitk.sitkUInt8)
        filled = sitk.BinaryFillhole(largest)
        return sitk.BinaryMedian(filled, [1, 1, 1])

    def _make_report(self, mask: sitk.Image, calcium_spots: int) -> VesselSegmentationReport:
        arr = sitk.GetArrayFromImage(mask).astype(bool)
        spacing = mask.GetSpacing()
        voxel_volume_mm3 = spacing[0] * spacing[1] * spacing[2]
        volume_ml = float(arr.sum() * voxel_volume_mm3 / 1000.0)

        diam_mm: float = 0.0
        if arr.any():
            dt = ndimage.distance_transform_edt(arr, sampling=(spacing[2], spacing[1], spacing[0]))
            diam_mm = float(2.0 * np.max(dt))

        return VesselSegmentationReport(
            volume_ml=volume_ml,
            max_diameter_mm=diam_mm,
            calcium_spots_restored=calcium_spots,
        )
