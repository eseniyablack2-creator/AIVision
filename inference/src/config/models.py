from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PresetConfig(BaseModel):
    name: str
    description: str = ""
    hu_min: float = 150.0
    hu_max: float = 800.0
    requires_native_scan: bool = False
    segmentation_method: Literal[
        "threshold",
        "region_growing",
        "unet_stub",
        "mmbe_then_region_growing",
    ] = "region_growing"
    min_component_volume_mm3: float = 100.0
    export_format: Literal["stl", "obj", "3mf"] = "stl"


class ProcessingConfig(BaseModel):
    target_spacing_mm: float = Field(default=1.0, gt=0)
    hu_clip_min: float = -1000.0
    hu_clip_max: float = 3000.0
    bone_threshold_hu: float = 300.0
    dilation_radius_vox: int = Field(default=2, ge=0)
    small_component_min_voxels: int = Field(default=500, ge=1)
    use_gpu: bool = False
