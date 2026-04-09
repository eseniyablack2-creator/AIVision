from __future__ import annotations

import logging
from typing import Sequence

import numpy as np
import SimpleITK as sitk

LOGGER = logging.getLogger(__name__)


def to_hu(image: sitk.Image, slope: float = 1.0, intercept: float = 0.0) -> sitk.Image:
    array = sitk.GetArrayFromImage(image).astype(np.float32) * slope + intercept
    hu_image = sitk.GetImageFromArray(array)
    hu_image.CopyInformation(image)
    return hu_image


def clip_hu(image: sitk.Image, low: float = -1000.0, high: float = 3000.0) -> sitk.Image:
    return sitk.Clamp(image, lowerBound=low, upperBound=high)


def resample_isotropic(
    image: sitk.Image,
    target_spacing: float | Sequence[float] = 1.0,
    interpolator: int = sitk.sitkLinear,
) -> sitk.Image:
    if isinstance(target_spacing, float):
        spacing = [target_spacing] * 3
    else:
        spacing = list(target_spacing)
    original_spacing = image.GetSpacing()
    original_size = image.GetSize()

    new_size = [
        int(round(original_size[i] * (original_spacing[i] / spacing[i]))) for i in range(3)
    ]
    LOGGER.info("Resampling from spacing %s to %s", original_spacing, spacing)
    return sitk.Resample(
        image,
        new_size,
        sitk.Transform(),
        interpolator,
        image.GetOrigin(),
        spacing,
        image.GetDirection(),
        0.0,
        image.GetPixelID(),
    )
