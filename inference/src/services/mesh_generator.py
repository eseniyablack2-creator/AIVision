from __future__ import annotations

import io

import numpy as np
import SimpleITK as sitk
import trimesh
from scipy import ndimage
from skimage.measure import marching_cubes


def _remove_small(mask: np.ndarray, min_voxels: int = 500) -> np.ndarray:
    labeled, num = ndimage.label(mask > 0)
    if num == 0:
        return np.zeros_like(mask, dtype=bool)
    sizes = ndimage.sum(mask > 0, labeled, range(1, num + 1))
    out = np.zeros_like(mask, dtype=bool)
    for idx, size in enumerate(sizes, start=1):
        if int(size) >= min_voxels:
            out |= labeled == idx
    return out


def _downsample_mask_if_needed(mask: np.ndarray, max_dim: int = 240) -> tuple[np.ndarray, float]:
    """
    Downsample a binary mask for meshing performance.

    Returns (mask_ds, scale) where `scale` is the zoom factor applied to each axis.
    IMPORTANT: when scale < 1, voxel spacing must be divided by scale to preserve physical size.
    """
    shape = np.array(mask.shape, dtype=np.int32)
    current_max = int(shape.max())
    if current_max <= max_dim:
        return mask, 1.0
    scale = max_dim / float(current_max)
    zoom_factors = (scale, scale, scale)
    ds = ndimage.zoom(mask.astype(np.uint8), zoom=zoom_factors, order=0) > 0
    return ds, float(scale)


def mask_to_glb(mask_image: sitk.Image) -> bytes:
    mask = sitk.GetArrayFromImage(mask_image).astype(bool)  # z, y, x
    mask = _remove_small(mask, min_voxels=500)
    mask, scale = _downsample_mask_if_needed(mask, max_dim=240)
    if not np.any(mask):
        raise ValueError("Mask is empty after cleanup")

    spacing_xyz = mask_image.GetSpacing()
    spacing_zyx = (spacing_xyz[2], spacing_xyz[1], spacing_xyz[0])
    if scale != 1.0:
        spacing_zyx = tuple(float(s) / float(scale) for s in spacing_zyx)
    step_size = 1
    if max(mask.shape) > 220:
        step_size = 2
    if max(mask.shape) > 300:
        step_size = 3
    verts, faces, normals, _ = marching_cubes(
        mask.astype(np.float32),
        level=0.5,
        spacing=spacing_zyx,
        step_size=step_size,
        allow_degenerate=False,
    )
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, vertex_normals=normals, process=False)
    trimesh.smoothing.filter_taubin(mesh, iterations=10, lamb=0.5, nu=-0.53)
    trimesh.repair.fix_normals(mesh)
    trimesh.repair.fill_holes(mesh)
    if len(mesh.faces) > 120_000 and hasattr(mesh, "simplify_quadric_decimation"):
        try:
            mesh = mesh.simplify_quadric_decimation(120_000)
        except Exception:
            pass

    data = mesh.export(file_type="glb")
    if isinstance(data, bytes):
        return data
    if isinstance(data, bytearray):
        return bytes(data)
    if hasattr(data, "read"):
        return data.read()
    if isinstance(data, str):
        return data.encode("utf-8")
    if isinstance(data, io.BytesIO):
        return data.getvalue()
    raise TypeError("Unexpected GLB export type")
