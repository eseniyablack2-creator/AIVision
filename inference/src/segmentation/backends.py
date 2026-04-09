from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import SimpleITK as sitk


class SegmentationBackend(Protocol):
    def region_grow(
        self, image: sitk.Image, seeds: list[tuple[int, int, int]], low: float, high: float
    ) -> sitk.Image: ...


@dataclass
class CPUSegmentationBackend:
    def region_grow(
        self, image: sitk.Image, seeds: list[tuple[int, int, int]], low: float, high: float
    ) -> sitk.Image:
        return sitk.ConnectedThreshold(
            image,
            seedList=[tuple(map(int, seed)) for seed in seeds],
            lower=low,
            upper=high,
            replaceValue=1,
        )


@dataclass
class GPUSegmentationBackend:
    """
    GPU stub to keep architecture extensible.
    You can later replace internals with ONNX/TensorRT/CUDA kernels.
    """

    fallback: CPUSegmentationBackend = field(default_factory=CPUSegmentationBackend)

    def region_grow(
        self, image: sitk.Image, seeds: list[tuple[int, int, int]], low: float, high: float
    ) -> sitk.Image:
        return self.fallback.region_grow(image, seeds, low, high)
