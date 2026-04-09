"""
Опциональный запуск TotalSegmentator (multilabel NIfTI) для локального прототипа.

Безопасность: пути к объёмам принимаются только при AIVISION_ALLOW_LOCAL_NIFTI_PATH=1
и (если задано) внутри AIVISION_NIFTI_ROOT.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from pathlib import Path

log = logging.getLogger(__name__)

_JOB_ID_RE = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
_MASK_FILENAME = "total_multilabel.nii.gz"


def totalsegmentator_available() -> bool:
    try:
        import nibabel  # noqa: F401
        import torch  # noqa: F401
        from totalsegmentator.python_api import totalsegmentator  # noqa: F401

        return True
    except ImportError as e:
        log.debug("TotalSegmentator unavailable: %s", e)
        return False


def local_nifti_paths_allowed() -> bool:
    v = os.environ.get("AIVISION_ALLOW_LOCAL_NIFTI_PATH", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def mask_cache_dir() -> Path:
    raw = os.environ.get("AIVISION_MASK_CACHE", "")
    if raw.strip():
        return Path(raw).expanduser().resolve()
    return (Path(__file__).resolve().parent.parent / "mask_cache").resolve()


def nifti_root() -> Path | None:
    raw = os.environ.get("AIVISION_NIFTI_ROOT", "").strip()
    if not raw:
        return None
    return Path(raw).expanduser().resolve()


def validate_job_id(job_id: str) -> bool:
    return bool(_JOB_ID_RE.match(job_id))


def resolve_volume_nifti_path(raw_path: str) -> Path:
    if not local_nifti_paths_allowed():
        raise PermissionError(
            "Локальные пути к NIfTI отключены. Задайте AIVISION_ALLOW_LOCAL_NIFTI_PATH=1 "
            "(только доверенная среда)."
        )
    p = Path(raw_path).expanduser().resolve()
    if not p.is_file():
        raise FileNotFoundError(f"Файл не найден: {p}")
    if not (p.name.lower().endswith(".nii.gz") or p.suffix.lower() == ".nii"):
        raise ValueError("Ожидается путь к NIfTI (.nii или .nii.gz)")

    root = nifti_root()
    if root is not None:
        try:
            p.relative_to(root)
        except ValueError as e:
            raise ValueError(
                f"Путь вне корня AIVISION_NIFTI_ROOT ({root}): {p}"
            ) from e
    return p


def new_job_id() -> str:
    return str(uuid.uuid4())


def job_output_dir(job_id: str) -> Path:
    if not validate_job_id(job_id):
        raise ValueError("Некорректный jobId")
    d = mask_cache_dir() / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def spatial_meta_from_nib_image(seg_img: object) -> dict[str, object]:
    """
    Affine 4×4 маски (как nibabel / NIfTI): world_mm = M @ [i, j, k, 1]^T в row-vector форме строк M.
    В JSON — row-major flatten (16 float). coordinateConvention — три буквы из nibabel.aff2axcodes (напр. RAS).
    """
    import logging

    import numpy as np
    from nibabel.orientations import aff2axcodes

    log = logging.getLogger(__name__)
    aff = np.asarray(getattr(seg_img, "affine"), dtype=np.float64)
    row_major = [float(x) for x in aff.ravel(order="C")]
    convention = "unknown"
    try:
        codes = aff2axcodes(aff[:3, :3])
        convention = "".join(str(x) for x in codes)
    except Exception:
        log.debug("aff2axcodes failed for mask image", exc_info=True)
    return {
        "affineVoxelToWorldRowMajor": row_major,
        "coordinateConvention": convention,
    }


def run_totalsegmentator_multilabel(
    nifti_path: Path,
    job_id: str,
    *,
    fast: bool = True,
    device: str = "gpu",
) -> tuple[Path, tuple[int, int, int], dict[str, object]]:
    """
    Запускает TotalSegmentator (ml=True), сохраняет единый multilabel NIfTI в каталог job.

    Returns:
        (путь к .nii.gz, (dim0, dim1, dim2), spatial_meta dict с affineVoxelToWorldRowMajor и coordinateConvention)
    """
    from totalsegmentator.python_api import totalsegmentator
    import nibabel as nib

    out_dir = job_output_dir(job_id)
    ts_scratch = out_dir / "_totalseg_output"
    ts_scratch.mkdir(parents=True, exist_ok=True)

    log.info("TotalSegmentator start job=%s input=%s fast=%s device=%s", job_id, nifti_path, fast, device)
    seg_img = totalsegmentator(
        str(nifti_path),
        output=str(ts_scratch),
        ml=True,
        fast=fast,
        device=device,
        quiet=True,
        verbose=False,
    )
    out_file = out_dir / _MASK_FILENAME
    shape3 = tuple(int(x) for x in seg_img.shape[:3])
    spatial = spatial_meta_from_nib_image(seg_img)
    nib.save(seg_img, str(out_file))
    log.info("TotalSegmentator done job=%s -> %s shape=%s conv=%s", job_id, out_file, shape3, spatial.get("coordinateConvention"))
    return out_file, shape3, spatial


def safe_mask_file_path(job_id: str) -> Path | None:
    if not validate_job_id(job_id):
        return None
    base = mask_cache_dir().resolve()
    p = (base / job_id / _MASK_FILENAME).resolve()
    if not p.is_file():
        return None
    try:
        p.relative_to(base)
    except ValueError:
        return None
    return p


def mask_file_basename() -> str:
    return _MASK_FILENAME
