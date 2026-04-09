from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np
import trimesh
from scipy import ndimage
from skimage.measure import marching_cubes

LOGGER = logging.getLogger(__name__)


def _remove_small_components(mask: np.ndarray, min_voxels: int = 500) -> np.ndarray:
    labeled, num = ndimage.label(mask > 0)
    if num == 0:
        return np.zeros_like(mask, dtype=bool)
    out = np.zeros_like(mask, dtype=bool)
    sizes = ndimage.sum(mask > 0, labeled, range(1, num + 1))
    for idx, size in enumerate(sizes, start=1):
        if int(size) >= min_voxels:
            out |= labeled == idx
    return out


def _estimate_min_thickness_mm(mask: np.ndarray, spacing: tuple[float, float, float]) -> float:
    if not np.any(mask):
        return 0.0
    dist = ndimage.distance_transform_edt(mask, sampling=spacing)
    positive = dist[dist > 0]
    if positive.size == 0:
        return 0.0
    return float(2.0 * np.percentile(positive, 5))


def mask_to_stl(
    mask_array: np.ndarray,
    spacing: tuple[float, float, float],
    output_path: str | Path,
    target_faces: int = 200_000,
) -> dict[str, Any]:
    """
    Convert binary mask volume to STL/3MF mesh with cleanup and stats.
    spacing order is (z, y, x) for numpy volume.
    """
    output_base = Path(output_path)
    output_base.parent.mkdir(parents=True, exist_ok=True)

    clean_mask = _remove_small_components(mask_array.astype(bool), min_voxels=500)
    if not np.any(clean_mask):
        raise ValueError("Mask is empty after removing small components.")

    verts, faces, normals, _ = marching_cubes(clean_mask.astype(np.float32), level=0.5, spacing=spacing)
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, vertex_normals=normals, process=False)

    trimesh.smoothing.filter_laplacian(mesh, lamb=0.1, iterations=5)

    if len(mesh.faces) > target_faces and hasattr(mesh, "simplify_quadric_decimation"):
        mesh = mesh.simplify_quadric_decimation(target_faces)

    trimesh.repair.fix_normals(mesh)
    trimesh.repair.fill_holes(mesh)
    is_manifold = bool(mesh.is_watertight)

    stl_path = output_base.with_suffix(".stl")
    mesh.export(stl_path)

    three_mf_path = output_base.with_suffix(".3mf")
    try:
        mesh.export(three_mf_path)
    except Exception:
        LOGGER.warning("3MF export failed, writing OBJ fallback with .3mf suffix")
        mesh.export(three_mf_path.with_suffix(".obj"))

    voxel_volume_mm3 = float(np.prod(spacing))
    volume_ml = float(clean_mask.sum() * voxel_volume_mm3 / 1000.0)
    surface_area_mm2 = float(mesh.area)
    min_thickness_mm = _estimate_min_thickness_mm(clean_mask, spacing)

    return {
        "stl_path": str(stl_path),
        "three_mf_path": str(three_mf_path),
        "stats": {
            "volume_ml": volume_ml,
            "surface_area_mm2": surface_area_mm2,
            "min_thickness_mm": min_thickness_mm,
            "faces": int(len(mesh.faces)),
            "vertices": int(len(mesh.vertices)),
            "is_manifold": is_manifold,
        },
    }
