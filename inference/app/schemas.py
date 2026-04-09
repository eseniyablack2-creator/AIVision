"""Pydantic-схемы = JSON-контракт с frontend/src/lib/ctInferenceTypes.ts"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

SCHEMA_VERSION = "1.0"


class Shape(BaseModel):
    slices: int
    rows: int
    cols: int


class SpacingMm(BaseModel):
    z: float | None = None
    row: float | None = None
    col: float | None = None


class CtScreenPerSliceV1(BaseModel):
    z_index: int = Field(alias="zIndex")
    thorax_like: bool = Field(alias="thoraxLike")
    lung_voxels: int = Field(alias="lungVoxels")
    lung_buckets: dict[str, float] = Field(alias="lungBuckets")
    hyper_central_frac: float = Field(alias="hyperCentralFrac")
    calc_frac: float = Field(alias="calcFrac")
    abdomen_soft_frac: float = Field(alias="abdomenSoftFrac")
    interest_score: float = Field(alias="interestScore")
    radiomics_mean_local_std: float | None = Field(default=None, alias="radiomicsMeanLocalStd")
    radiomics_max_gradient: float | None = Field(default=None, alias="radiomicsMaxGradient")
    radiomics_focal_high_clusters: int | None = Field(default=None, alias="radiomicsFocalHighClusters")
    radiomics_focal_low_clusters: int | None = Field(default=None, alias="radiomicsFocalLowClusters")

    model_config = {"populate_by_name": True}


class CtScreenAggregateV1(BaseModel):
    total_lung_voxels: int = Field(alias="totalLungVoxels")
    thorax_slice_count: int = Field(alias="thoraxSliceCount")
    mean_hyper_central_frac: float = Field(alias="meanHyperCentralFrac")
    mean_calc_frac: float = Field(alias="meanCalcFrac")
    mean_abdomen_soft_frac: float = Field(alias="meanAbdomenSoftFrac")
    abdomen_slice_count: int = Field(alias="abdomenSliceCount")
    lung_bucket_totals: dict[str, float] = Field(alias="lungBucketTotals")
    mean_radiomics_local_std: float | None = Field(default=None, alias="meanRadiomicsLocalStd")
    mean_radiomics_max_gradient: float | None = Field(default=None, alias="meanRadiomicsMaxGradient")
    total_focal_high_clusters: int | None = Field(default=None, alias="totalFocalHighClusters")
    total_focal_low_clusters: int | None = Field(default=None, alias="totalFocalLowClusters")

    model_config = {"populate_by_name": True}


class CtScreenRequestV1(BaseModel):
    schema_version: Literal["1.0"] = Field(alias="schemaVersion")
    payload_type: Literal["volume_summary_v1"] = Field(alias="payloadType")
    series_instance_uid: str | None = Field(alias="seriesInstanceUid")
    shape: Shape
    spacing_mm: SpacingMm = Field(alias="spacingMm")
    per_slice: list[CtScreenPerSliceV1] = Field(alias="perSlice")
    aggregate: CtScreenAggregateV1
    # --- опционально: сегментация на сервере (только при AIVISION_ALLOW_LOCAL_NIFTI_PATH=1) ---
    volume_nifti_path: str | None = Field(default=None, alias="volumeNiftiPath")
    total_segmentator_fast: bool = Field(default=True, alias="totalSegmentatorFast")
    total_segmentator_device: str = Field(default="gpu", alias="totalSegmentatorDevice")
    request_aortic_syndrome_screening: bool = Field(
        default=False,
        alias="requestAorticSyndromeScreening",
        description="Клиент просит скрининг ОАС по неконтрастному КТ (если модель подключена).",
    )

    model_config = {"populate_by_name": True}


class TotalSegmentatorSegmentRequestV1(BaseModel):
    """Только сегментация (без сводки volume_summary). Удобно для curl/Postman."""

    volume_nifti_path: str = Field(alias="volumeNiftiPath")
    series_instance_uid: str | None = Field(default=None, alias="seriesInstanceUid")
    fast: bool = True
    device: str = "gpu"

    model_config = {"populate_by_name": True}


class EngineInfo(BaseModel):
    id: str
    label_ru: str = Field(alias="labelRu")
    regulatory_note_ru: str = Field(alias="regulatoryNoteRu")

    model_config = {"populate_by_name": True}


class CtScreenFindingDto(BaseModel):
    id: str
    class_id: int = Field(alias="classId")
    label: str
    confidence: float
    summary: str
    details: str
    clinical_note: str | None = Field(default=None, alias="clinicalNote")
    slice_indices: list[int] = Field(alias="sliceIndices")

    model_config = {"populate_by_name": True}


class LungQuantCategoryApi(BaseModel):
    id: str
    label_ru: str = Field(alias="labelRu")
    percent_of_lung_parenchyma: float = Field(alias="percentOfLungParenchyma")
    clinical_meaning_ru: str = Field(alias="clinicalMeaningRu")

    model_config = {"populate_by_name": True}


class LungNotAssessableApi(BaseModel):
    id: str
    label_ru: str = Field(alias="labelRu")
    reason_ru: str = Field(alias="reasonRu")

    model_config = {"populate_by_name": True}


class LungQuantApiV1(BaseModel):
    engine_id: str = Field(alias="engineId")
    slices_total: int = Field(alias="slicesTotal")
    slices_included: int = Field(alias="slicesIncluded")
    slices_skipped: int = Field(alias="slicesSkipped")
    total_lung_voxels: int = Field(alias="totalLungVoxels")
    categories: list[LungQuantCategoryApi]
    not_assessable: list[LungNotAssessableApi] = Field(alias="notAssessable")
    mediastinal_soft_tissue_proxy_percent: float | None = Field(
        alias="mediastinalSoftTissueProxyPercent"
    )
    summary_line_ru: str = Field(alias="summaryLineRu")
    disclaimer_ru: str = Field(alias="disclaimerRu")

    model_config = {"populate_by_name": True}


class MaskOutputGrid(BaseModel):
    """Размер воксельной сетки NIfTI (оси как в файле)."""

    dim_0: int = Field(alias="dim0")
    dim_1: int = Field(alias="dim1")
    dim_2: int = Field(alias="dim2")

    model_config = {"populate_by_name": True}


class MasksRef(BaseModel):
    format: Literal["nifti_url"]
    url: str
    engine_id: str | None = Field(default=None, alias="engineId")
    output_grid: MaskOutputGrid | None = Field(default=None, alias="outputGrid")
    hint_ru: str | None = Field(default=None, alias="hintRu")
    # --- жёсткая привязка без парсинга заголовка NIfTI на клиенте (дублирует файл при корректном пайплайне) ---
    coordinate_convention: str | None = Field(
        default=None,
        alias="coordinateConvention",
        description="Три буквы осей мира вокселя по nibabel.aff2axcodes (напр. RAS, LPS); unknown если не вычислилось.",
    )
    affine_voxel_to_world_row_major: list[float] | None = Field(
        default=None,
        alias="affineVoxelToWorldRowMajor",
        description="16 float, row-major 4×4: world = строки матрицы · [i,j,k,1] (NIfTI/nibabel).",
    )

    model_config = {"populate_by_name": True}

    @field_validator("affine_voxel_to_world_row_major")
    @classmethod
    def _affine_len_16(cls, v: list[float] | None) -> list[float] | None:
        if v is not None and len(v) != 16:
            raise ValueError("affineVoxelToWorldRowMajor must contain exactly 16 numbers")
        return v


AasSubtypeLiteral = Literal["TAAD", "TBAD", "IMH", "PAU", "none", "indeterminate"]
AlertLevelLiteral = Literal["rule_out", "review", "alert"]


class TotalsegAortaHuStatsV1(BaseModel):
    """
    Постобработка после TotalSegmentator: HU и объём в маске класса aorta (multilabel).
    """

    ok: bool
    mask_empty: bool = Field(alias="maskEmpty")
    engine_id: str = Field(default="totalsegmentator_aorta_hu_stats_v1", alias="engineId")
    reason: str | None = None
    aorta_label_id: int | None = Field(default=None, alias="aortaLabelId")
    voxel_count: int | None = Field(default=None, alias="voxelCount")
    volume_mm3: float | None = Field(default=None, alias="volumeMm3")
    voxel_spacing_mm: list[float] | None = Field(default=None, alias="voxelSpacingMm")
    hu_mean: float | None = Field(default=None, alias="huMean")
    hu_std: float | None = Field(default=None, alias="huStd")
    hu_min: float | None = Field(default=None, alias="huMin")
    hu_max: float | None = Field(default=None, alias="huMax")
    hu_p5: float | None = Field(default=None, alias="huP5")
    hu_p50: float | None = Field(default=None, alias="huP50")
    hu_p95: float | None = Field(default=None, alias="huP95")
    summary_line_ru: str | None = Field(default=None, alias="summaryLineRu")
    disclaimer_ru: str | None = Field(default=None, alias="disclaimerRu")

    model_config = {"populate_by_name": True}


class AorticSyndromeScreeningV1(BaseModel):
    """Скрининг ОАС по неконтрастному КТ (контракт под двухэтапный DL в духе iAorta)."""

    model_id: str | None = Field(default=None, alias="modelId")
    aas_probability: float = Field(alias="aasProbability", ge=0.0, le=1.0)
    alert_level: AlertLevelLiteral = Field(alias="alertLevel")
    threshold_rule_out: float = Field(alias="thresholdRuleOut", ge=0.0, le=1.0)
    threshold_alert: float = Field(alias="thresholdAlert", ge=0.0, le=1.0)
    predicted_subtype: AasSubtypeLiteral | None = Field(default=None, alias="predictedSubtype")
    focus_slice_index: int | None = Field(default=None, alias="focusSliceIndex")
    heatmap_nifti_url: str | None = Field(default=None, alias="heatmapNiftiUrl")
    summary_line_ru: str = Field(alias="summaryLineRu")
    disclaimer_ru: str = Field(alias="disclaimerRu")

    model_config = {"populate_by_name": True}


class CtScreenResponseV1(BaseModel):
    schema_version: Literal["1.0"] = Field(alias="schemaVersion", default="1.0")
    engine: EngineInfo
    replace_local_findings: bool = Field(alias="replaceLocalFindings")
    replace_local_lung_quant: bool = Field(alias="replaceLocalLungQuant")
    findings: list[CtScreenFindingDto]
    focus_slice_index: int | None = Field(alias="focusSliceIndex")
    lung_quant: LungQuantApiV1 | None = Field(alias="lungQuant")
    masks: MasksRef | None = None
    aortic_syndrome_screening: AorticSyndromeScreeningV1 | None = Field(
        default=None,
        alias="aorticSyndromeScreening",
    )
    totalseg_aorta_hu_stats: TotalsegAortaHuStatsV1 | None = Field(
        default=None,
        alias="totalsegAortaHuStats",
        description="HU/объём в маске aorta после TotalSegmentator (если сегментация выполнена).",
    )
    warnings: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}
