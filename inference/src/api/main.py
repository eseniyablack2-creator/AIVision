from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path

import SimpleITK as sitk
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.datastructures import UploadFile as StarletteUploadFile

from config import ProcessingConfig
from mesh.reconstruction import mask_to_stl
from segmentation.vessel_seg import VascularSegmenter
from services.dicom_loader import load_largest_series, save_uploads_to_temp_dir
from services.mesh_generator import mask_to_glb
from services.presets import get_preset
from services.processor import process_volume

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)

app = FastAPI(title="AIVision Segmentation API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SegmentRequest(BaseModel):
    contrast_path: str = Field(..., description="Folder with DICOM CTA contrast series")
    native_path: str | None = Field(default=None, description="Folder with native DICOM series")
    output_name: str = Field(default="aorta_mesh")


class SegmentResponse(BaseModel):
    mask_path: str
    mesh_stl_path: str
    mesh_3mf_path: str
    report: dict[str, float | int]


def _run_pipeline(req: SegmentRequest) -> SegmentResponse:
    segmenter = VascularSegmenter(ProcessingConfig())
    mask, report = segmenter.segment_cta_aorta(req.contrast_path, req.native_path)

    output_dir = Path(tempfile.gettempdir()) / "aivision_outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    mask_path = output_dir / f"{req.output_name}_mask.nii.gz"
    sitk.WriteImage(mask, str(mask_path))

    mask_np = sitk.GetArrayFromImage(mask).astype("uint8")
    spacing_xyz = mask.GetSpacing()
    spacing_zyx = (spacing_xyz[2], spacing_xyz[1], spacing_xyz[0])
    mesh_data = mask_to_stl(mask_np, spacing_zyx, output_dir / req.output_name)

    return SegmentResponse(
        mask_path=str(mask_path),
        mesh_stl_path=mesh_data["stl_path"],
        mesh_3mf_path=mesh_data["three_mf_path"],
        report={**report, **mesh_data["stats"]},
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/segment/aorta", response_model=SegmentResponse)
async def segment_aorta(req: SegmentRequest, _: BackgroundTasks) -> SegmentResponse:
    try:
        return _run_pipeline(req)
    except Exception as exc:  # pragma: no cover
        LOGGER.exception("Segmentation endpoint failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/v1/visualize")
async def visualize(request: Request) -> Response:
    contrast_tmp: Path | None = None
    native_tmp: Path | None = None
    try:
        # Важно: стандартный лимит Starlette = 1000 файлов, для КТ этого часто мало.
        form = await request.form(max_files=20_000)
        preset_id = str(form.get("preset_id") or "").strip()
        if not preset_id:
            raise HTTPException(status_code=400, detail="preset_id is required")

        contrast_raw = form.getlist("contrast_files")
        native_raw = form.getlist("native_files")
        contrast_files = [f for f in contrast_raw if isinstance(f, StarletteUploadFile)]
        native_files = [f for f in native_raw if isinstance(f, StarletteUploadFile)]

        preset = get_preset(preset_id)
        if not contrast_files:
            raise HTTPException(status_code=400, detail="contrast_files is required")

        contrast_tmp = save_uploads_to_temp_dir(contrast_files, "aivision_contrast_")
        contrast_img = load_largest_series(contrast_tmp)

        native_img = None
        if native_files:
            native_tmp = save_uploads_to_temp_dir(native_files, "aivision_native_")
            native_img = load_largest_series(native_tmp)

        if bool(preset.get("requires_native")) and native_img is None:
            raise HTTPException(
                status_code=400,
                detail=f"Preset '{preset_id}' requires native_files (non-contrast series) to remove bones.",
            )

        mask = process_volume(contrast_img, native_img, preset)
        glb = mask_to_glb(mask)
        return Response(content=glb, media_type="model/gltf-binary")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        LOGGER.exception("Visualize endpoint failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if contrast_tmp and contrast_tmp.exists():
            shutil.rmtree(contrast_tmp, ignore_errors=True)
        if native_tmp and native_tmp.exists():
            shutil.rmtree(native_tmp, ignore_errors=True)
