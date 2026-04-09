from __future__ import annotations

import numpy as np
import SimpleITK as sitk

from segmentation.vessel_seg import VascularSegmenter


def test_make_report_has_positive_metrics() -> None:
    mask_np = np.zeros((32, 32, 32), dtype=np.uint8)
    mask_np[10:22, 10:22, 10:22] = 1
    mask = sitk.GetImageFromArray(mask_np)
    mask.SetSpacing((1.0, 1.0, 1.0))

    seg = VascularSegmenter()
    report = seg._make_report(mask, calcium_spots=3).to_dict()

    assert report["volume_ml"] > 0
    assert report["max_diameter_mm"] > 0
    assert report["calcium_spots_restored"] == 3
