"""
AIVision inference HTTP API.

Запуск: из каталога inference/
  pip install -r requirements.txt
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8787
  (--host 0.0.0.0 чтобы запросы с localhost:порт в браузере стабильно доходили до API)

Опционально TotalSegmentator:
  pip install -r requirements-totalsegmentator.txt

Фронтенд: VITE_PATHOLOGY_API_URL=http://127.0.0.1:8787
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import totalsegmentator_service as ts
from .aorta_mask_stats import compute_totalseg_aorta_hu_stats
from .schemas import (
    CtScreenRequestV1,
    TotalSegmentatorSegmentRequestV1,
    TotalsegAortaHuStatsV1,
)

log = logging.getLogger(__name__)

_MASK_CLIENT_HINT_RU = (
    "Сетка как у входного NIfTI. В JSON также affineVoxelToWorldRowMajor (16 float) и "
    "coordinateConvention (nibabel aff2axcodes) — клиент может сверить с заголовком без доверия к файлу. "
    "В viewer: индексы с crop/stride, иначе affine с сервера или из NIfTI."
)

app = FastAPI(
    title="AIVision CT inference",
    version="0.2.0",
    description="POST /v1/ct-screen (volume_summary_v1), опционально TotalSegmentator → masks.nifti_url",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _public_base_url(request: Request) -> str:
    env = os.environ.get("AIVISION_PUBLIC_BASE_URL", "").strip()
    if env:
        return env.rstrip("/")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "127.0.0.1:8787"
    scheme = request.headers.get("x-forwarded-proto") or "http"
    return f"{scheme}://{host}".rstrip("/")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "aivision-inference",
        "model_loaded": False,
        "totalsegmentator": ts.totalsegmentator_available(),
        "localNiftiPathsAllowed": ts.local_nifti_paths_allowed(),
        "aorticScreeningDemo": os.environ.get("AIVISION_DEMO_AORTIC_SCREENING", "").strip(),
    }


def _merge_aortic_screening_into_payload(
    payload: dict,
    *,
    requested: bool,
    shape_slices: int,
) -> None:
    """
    Пока нет обученного двухэтапного пайплайна ОАС: null или демо из AIVISION_DEMO_AORTIC_SCREENING.
    Значения: 1 / low — низкий риск; alert / high / aas — тревога (проверка UI).
    """
    raw = os.environ.get("AIVISION_DEMO_AORTIC_SCREENING", "").strip().lower()
    demo_on = raw not in ("", "0", "false", "no", "off")
    mid = max(0, min(max(shape_slices - 1, 0), shape_slices // 2))

    if not demo_on:
        payload["aorticSyndromeScreening"] = None
        if requested:
            w = payload.setdefault("warnings", [])
            if isinstance(w, list):
                w.append(
                    "Скрининг ОАС запрошен (requestAorticSyndromeScreening), сервер без модели. "
                    "UI: задайте AIVISION_DEMO_AORTIC_SCREENING=1 или =alert"
                )
        return

    if raw in ("alert", "high", "aas"):
        payload["aorticSyndromeScreening"] = {
            "modelId": "demo_two_stage_placeholder",
            "aasProbability": 0.91,
            "alertLevel": "alert",
            "thresholdRuleOut": 0.3,
            "thresholdAlert": 0.65,
            "predictedSubtype": "IMH",
            "focusSliceIndex": mid if shape_slices > 0 else None,
            "heatmapNiftiUrl": None,
            "summaryLineRu": "Демо: высокая вероятность ОАС (заглушка под Stage1 nnU-Net + Stage2 MTN).",
            "disclaimerRu": "Только разработка. Не для клиники. Подключите веса и валидацию.",
        }
    else:
        payload["aorticSyndromeScreening"] = {
            "modelId": "demo_two_stage_placeholder",
            "aasProbability": 0.08,
            "alertLevel": "rule_out",
            "thresholdRuleOut": 0.3,
            "thresholdAlert": 0.65,
            "predictedSubtype": "none",
            "focusSliceIndex": None,
            "heatmapNiftiUrl": None,
            "summaryLineRu": "Демо: низкая вероятность ОАС (заглушка сервера).",
            "disclaimerRu": "Только разработка. Не для клиники.",
        }


def _stub_ct_screen_response(series_uid: str | None) -> dict:
    """Ответ без модели: клиент оставляет локальные находки v2, видит предупреждение."""
    return {
        "schemaVersion": "1.0",
        "engine": {
            "id": "python_stub",
            "labelRu": "Python-сервис (заглушка, веса не загружены)",
            "regulatoryNoteRu": (
                "Подключите MONAI / nnU-Net или TotalSegmentator: загрузите веса, "
                "прогоните объём (NIfTI на сервере или расширьте контракт), "
                "заполните findings и при необходимости replaceLocalFindings=true."
            ),
        },
        "replaceLocalFindings": False,
        "replaceLocalLungQuant": False,
        "findings": [],
        "focusSliceIndex": None,
        "lungQuant": None,
        "masks": None,
        "aorticSyndromeScreening": None,
        "totalsegAortaHuStats": None,
        "warnings": [
            "Модель не выполнялась: возвращён пустой список findings. "
            "Реализуйте инференс в этом сервисе или проксируйте во внешний GPU-сервис.",
            f"seriesInstanceUid: {series_uid or '(не передан)'}",
        ],
    }


async def _maybe_run_totalsegmentator(
    request: Request,
    *,
    volume_nifti_path: str | None,
    fast: bool,
    device: str,
    series_uid: str | None,
) -> tuple[dict | None, list[str], str | None, Path | None, Path | None]:
    """
    Возвращает (masks_dict, warnings, job_id, volume_path, seg_multilabel_path).
    Последние два пути — только при успешной сегментации (для постобработки HU в маске аорты).
    """
    extra: list[str] = []
    if not volume_nifti_path or not volume_nifti_path.strip():
        return None, extra, None, None, None

    if not ts.local_nifti_paths_allowed():
        extra.append(
            "Поле volumeNiftiPath проигнорировано: задайте AIVISION_ALLOW_LOCAL_NIFTI_PATH=1 "
            "(только доверенная машина; не включайте на публичном сервере)."
        )
        return None, extra, None, None, None

    if not ts.totalsegmentator_available():
        extra.append(
            "TotalSegmentator не установлен. Установите: pip install -r requirements-totalsegmentator.txt"
        )
        return None, extra, None, None, None

    try:
        nifti = ts.resolve_volume_nifti_path(volume_nifti_path.strip())
    except (OSError, ValueError, PermissionError) as e:
        extra.append(f"Путь к NIfTI отклонён: {e}")
        return None, extra, None, None, None

    job_id = ts.new_job_id()
    try:
        out_path, out_shape, spatial = await asyncio.to_thread(
            ts.run_totalsegmentator_multilabel,
            nifti,
            job_id,
            fast=fast,
            device=device,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("TotalSegmentator failed job=%s", job_id)
        extra.append(f"TotalSegmentator завершился с ошибкой: {e}")
        return None, extra, None, None, None

    base = _public_base_url(request)
    fname = ts.mask_file_basename()
    url = f"{base}/v1/masks-file/{job_id}/{fname}"
    extra.append(
        f"TotalSegmentator: multilabel NIfTI jobId={job_id} series={series_uid or 'n/a'}"
    )
    return {
        "format": "nifti_url",
        "url": url,
        "engineId": "totalsegmentator",
        "outputGrid": {"dim0": out_shape[0], "dim1": out_shape[1], "dim2": out_shape[2]},
        "hintRu": _MASK_CLIENT_HINT_RU,
        **spatial,
    }, extra, job_id, nifti, out_path


@app.post("/v1/ct-screen")
async def ct_screen(request: Request) -> JSONResponse:
    try:
        raw = await request.json()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}") from e

    try:
        req = CtScreenRequestV1.model_validate(raw)
    except Exception as e:  # noqa: BLE001
        log.warning("ct-screen validate failed: %s", e)
        raise HTTPException(status_code=422, detail=str(e)) from e

    log.info(
        "ct-screen series=%s slices=%s thorax_slices=%s nifti=%s",
        req.series_instance_uid,
        req.shape.slices,
        req.aggregate.thorax_slice_count,
        "yes" if req.volume_nifti_path else "no",
    )

    payload = _stub_ct_screen_response(req.series_instance_uid)

    masks, seg_warnings, _job_id, vol_path, seg_path = await _maybe_run_totalsegmentator(
        request,
        volume_nifti_path=req.volume_nifti_path,
        fast=req.total_segmentator_fast,
        device=req.total_segmentator_device,
        series_uid=req.series_instance_uid,
    )
    if masks is not None:
        payload["masks"] = masks
        payload["engine"] = {
            "id": "totalsegmentator_multilabel",
            "labelRu": "TotalSegmentator (multilabel NIfTI)",
            "regulatoryNoteRu": (
                "Локальный прототип без регистрации ИМН. Маски — для исследования/визуализации; "
                "клиническое решение не принимать по автоматической сегментации без валидации."
            ),
        }
        payload["warnings"] = [
            w
            for w in payload["warnings"]
            if not w.startswith("Модель не выполнялась")
            and not w.startswith("seriesInstanceUid:")
        ]
        payload["warnings"].extend(seg_warnings)
        if vol_path is not None and seg_path is not None:
            try:
                raw_stats = await asyncio.to_thread(
                    compute_totalseg_aorta_hu_stats,
                    vol_path,
                    seg_path,
                )
                payload["totalsegAortaHuStats"] = TotalsegAortaHuStatsV1.model_validate(
                    raw_stats
                ).model_dump(by_alias=True)
            except Exception as e:  # noqa: BLE001
                log.warning("totalseg aorta HU stats failed: %s", e)
                payload["totalsegAortaHuStats"] = None
                w = payload.setdefault("warnings", [])
                if isinstance(w, list):
                    w.append(f"Статистика HU в маске аорты не посчитана: {e}")
    else:
        payload["warnings"].extend(seg_warnings)

    _merge_aortic_screening_into_payload(
        payload,
        requested=req.request_aortic_syndrome_screening,
        shape_slices=req.shape.slices,
    )

    return JSONResponse(content=payload)


@app.post("/v1/segment/total")
async def segment_total(request: Request, body: TotalSegmentatorSegmentRequestV1) -> JSONResponse:
    """
    Только TotalSegmentator (удобно вызывать отдельно от сводки volume_summary).
    Тело: { "volumeNiftiPath": "/abs/path/ct.nii.gz", "fast": true, "device": "gpu" }
    """
    masks, warnings, job_id, vol_path, seg_path = await _maybe_run_totalsegmentator(
        request,
        volume_nifti_path=body.volume_nifti_path,
        fast=body.fast,
        device=body.device,
        series_uid=body.series_instance_uid,
    )
    if masks is None:
        return JSONResponse(
            status_code=422,
            content={
                "schemaVersion": "1.0",
                "jobId": None,
                "masks": None,
                "totalsegAortaHuStats": None,
                "warnings": warnings,
            },
        )
    stats_payload: dict | None = None
    if vol_path is not None and seg_path is not None:
        try:
            raw_stats = await asyncio.to_thread(
                compute_totalseg_aorta_hu_stats,
                vol_path,
                seg_path,
            )
            stats_payload = TotalsegAortaHuStatsV1.model_validate(raw_stats).model_dump(
                by_alias=True
            )
        except Exception as e:  # noqa: BLE001
            log.warning("totalseg aorta HU stats (segment/total): %s", e)
            warnings = [*warnings, f"Статистика HU в маске аорты не посчитана: {e}"]
    return JSONResponse(
        content={
            "schemaVersion": "1.0",
            "jobId": job_id,
            "masks": masks,
            "totalsegAortaHuStats": stats_payload,
            "warnings": warnings,
        }
    )


@app.get("/v1/masks-file/{job_id}/{filename}")
def download_mask_file(job_id: str, filename: str) -> FileResponse:
    if filename != ts.mask_file_basename():
        raise HTTPException(status_code=404, detail="Unknown file")
    path = ts.safe_mask_file_path(job_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Mask not found or expired")
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=f"aivision_totalseg_{job_id}.nii.gz",
    )


def _max_upload_bytes() -> int:
    try:
        mb = int(os.environ.get("AIVISION_MAX_UPLOAD_MB", "512").strip() or "512")
    except ValueError:
        mb = 512
    return max(16, mb) * 1024 * 1024


@app.post("/v1/upload-nifti")
async def upload_nifti(
    request: Request,
    file: UploadFile = File(...),
    run_total_segmentator: Annotated[bool, Form(alias="runTotalSegmentator")] = False,
    total_segmentator_fast: Annotated[bool, Form(alias="totalSegmentatorFast")] = True,
    total_segmentator_device: Annotated[str, Form(alias="totalSegmentatorDevice")] = "gpu",
) -> JSONResponse:
    """
    Multipart: поле файла `file` (.nii / .nii.gz). Опционально form `runTotalSegmentator=true`.
    Требует AIVISION_ALLOW_LOCAL_NIFTI_PATH=1. Лимит размера: AIVISION_MAX_UPLOAD_MB (по умолчанию 512).
    """
    warnings: list[str] = []
    if not ts.local_nifti_paths_allowed():
        raise HTTPException(
            status_code=403,
            detail="Загрузка отключена. Задайте AIVISION_ALLOW_LOCAL_NIFTI_PATH=1.",
        )

    job_id = ts.new_job_id()
    out_dir = ts.job_output_dir(job_id)
    raw_name = (file.filename or "").lower()
    if raw_name.endswith(".nii.gz"):
        dest = out_dir / "upload.nii.gz"
    elif raw_name.endswith(".nii"):
        dest = out_dir / "upload.nii"
    else:
        dest = out_dir / "upload.nii.gz"

    max_b = _max_upload_bytes()
    total = 0
    try:
        with dest.open("wb") as f:
            while True:
                chunk = await file.read(8 * 1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_b:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Файл больше лимита {max_b // (1024 * 1024)} MiB (AIVISION_MAX_UPLOAD_MB).",
                    )
                f.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise

    masks: dict[str, object] | None = None
    upload_stats: dict | None = None
    if run_total_segmentator:
        if not ts.totalsegmentator_available():
            warnings.append(
                "TotalSegmentator не установлен — сегментация пропущена. pip install -r requirements-totalsegmentator.txt"
            )
        else:
            try:
                seg_out, out_shape, spatial = await asyncio.to_thread(
                    ts.run_totalsegmentator_multilabel,
                    dest,
                    job_id,
                    fast=total_segmentator_fast,
                    device=total_segmentator_device,
                )
                base = _public_base_url(request)
                masks = {
                    "format": "nifti_url",
                    "url": f"{base}/v1/masks-file/{job_id}/{ts.mask_file_basename()}",
                    "engineId": "totalsegmentator",
                    "outputGrid": {"dim0": out_shape[0], "dim1": out_shape[1], "dim2": out_shape[2]},
                    "hintRu": _MASK_CLIENT_HINT_RU,
                    **spatial,
                }
                warnings.append(f"TotalSegmentator: multilabel готов, jobId={job_id}")
                try:
                    raw_stats = await asyncio.to_thread(
                        compute_totalseg_aorta_hu_stats,
                        dest.resolve(),
                        seg_out,
                    )
                    upload_stats = TotalsegAortaHuStatsV1.model_validate(raw_stats).model_dump(
                        by_alias=True
                    )
                except Exception as stats_e:  # noqa: BLE001
                    log.warning("upload-nifti aorta stats: %s", stats_e)
                    warnings.append(f"Статистика HU в маске аорты не посчитана: {stats_e}")
            except Exception as e:  # noqa: BLE001
                log.exception("upload-nifti totalseg failed job=%s", job_id)
                warnings.append(f"TotalSegmentator ошибка: {e}")

    return JSONResponse(
        content={
            "schemaVersion": "1.0",
            "jobId": job_id,
            "savedVolumePath": str(dest.resolve()),
            "masks": masks,
            "totalsegAortaHuStats": upload_stats,
            "warnings": warnings,
        }
    )


@app.get("/")
def root() -> dict:
    return {
        "service": "aivision-inference",
        "docs": "/docs",
        "health": "/health",
        "ct_screen": "POST /v1/ct-screen",
        "segment_total": "POST /v1/segment/total",
        "upload_nifti": "POST /v1/upload-nifti (multipart)",
        "mask_file": "GET /v1/masks-file/{jobId}/total_multilabel.nii.gz",
    }
