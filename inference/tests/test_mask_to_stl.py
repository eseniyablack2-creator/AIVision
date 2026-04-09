from __future__ import annotations

from pathlib import Path

import numpy as np

from mesh.reconstruction import mask_to_stl


def test_mask_to_stl_creates_mesh_files(tmp_path: Path) -> None:
    z, y, x = np.ogrid[:48, :48, :48]
    sphere = (z - 24) ** 2 + (y - 24) ** 2 + (x - 24) ** 2 <= 14**2
    output = mask_to_stl(
        mask_array=sphere.astype(np.uint8),
        spacing=(1.0, 1.0, 1.0),
        output_path=tmp_path / "aorta_mesh",
        target_faces=50_000,
    )

    assert (tmp_path / "aorta_mesh.stl").exists()
    assert output["stats"]["volume_ml"] > 0
    assert output["stats"]["surface_area_mm2"] > 0
