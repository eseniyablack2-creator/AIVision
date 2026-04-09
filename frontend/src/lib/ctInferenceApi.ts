/**
 * Вызов серверного инференса AIVision: POST /v1/ct-screen
 */

import type { LungQuantCategoryRow, LungVolumeQuantReport } from './ctLungQuantification'
import type { PathologyFinding, PathologyClassId, VolumePathologyResult, PathologyEngineInfo } from './ctPathologyScreen'
import { PathologyClass } from './ctPathologyScreen'
import {
  CT_SCREEN_SCHEMA_VERSION,
  type CtScreenFindingDto,
  type CtScreenPayloadV1,
  type CtScreenResponseV1,
} from './ctInferenceTypes'

function isPathologyClassId(n: number): n is PathologyClassId {
  return (Object.values(PathologyClass) as number[]).includes(n)
}

function dtoToFinding(d: CtScreenFindingDto): PathologyFinding | null {
  if (!isPathologyClassId(d.classId)) return null
  return {
    id: d.id,
    classId: d.classId,
    label: d.label,
    confidence: clamp01(d.confidence),
    summary: d.summary,
    details: d.details,
    clinicalNote: d.clinicalNote ?? '',
    sliceIndices: Array.isArray(d.sliceIndices) ? d.sliceIndices.map((z) => Math.floor(z)) : [],
  }
}

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function remoteEngineToLocal(
  e: CtScreenResponseV1['engine'],
  id: PathologyEngineInfo['id'],
): PathologyEngineInfo {
  return {
    id,
    labelRu: e.labelRu,
    regulatoryNoteRu: e.regulatoryNoteRu,
  }
}

/**
 * Слияние ответа сервера с локальным результатом v2.
 */
export function mergeCtScreenResponse(
  local: VolumePathologyResult,
  remote: CtScreenResponseV1,
): VolumePathologyResult {
  let findings = local.findings
  let engine = local.engine
  let rationale = local.rationale
  let focusSliceIndex = local.focusSliceIndex

  if (remote.warnings.length > 0) {
    rationale = `${local.rationale} [Сервер: ${remote.warnings.join('; ')}]`
  }

  const mapped = remote.findings
    .map((d) => dtoToFinding(d))
    .filter((f): f is PathologyFinding => f !== null)

  if (remote.replaceLocalFindings) {
    if (mapped.length > 0) {
      findings = mapped
      engine = remoteEngineToLocal(remote.engine, 'remote_model')
    } else {
      rationale = `${rationale} Сервер запросил замену находок, но прислал пустой список — оставлены локальные.`
      engine = remoteEngineToLocal(remote.engine, 'remote_hybrid')
    }
  } else if (mapped.length > 0) {
    findings = [...local.findings, ...mapped].sort((a, b) => b.confidence - a.confidence).slice(0, 10)
    engine = remoteEngineToLocal(remote.engine, 'remote_hybrid')
  }

  if (remote.focusSliceIndex !== null && remote.focusSliceIndex >= 0) {
    focusSliceIndex = remote.focusSliceIndex
  }

  return {
    ...local,
    findings,
    focusSliceIndex,
    engine,
    rationale,
  }
}

export function lungQuantFromApiPayload(data: CtScreenResponseV1['lungQuant']): LungVolumeQuantReport | null {
  if (!data) return null
  return {
    engineId: data.engineId,
    slicesTotal: data.slicesTotal,
    slicesIncluded: data.slicesIncluded,
    slicesSkipped: data.slicesSkipped,
    totalLungVoxels: data.totalLungVoxels,
    categories: data.categories.map(
      (c): LungQuantCategoryRow => ({
        id: c.id as LungQuantCategoryRow['id'],
        labelRu: c.labelRu,
        percentOfLungParenchyma: c.percentOfLungParenchyma,
        clinicalMeaningRu: c.clinicalMeaningRu,
      }),
    ),
    notAssessable: data.notAssessable,
    mediastinalSoftTissueProxyPercent: data.mediastinalSoftTissueProxyPercent,
    summaryLineRu: data.summaryLineRu,
    disclaimerRu: data.disclaimerRu,
  }
}

export function applyLungQuantFromApi(
  local: LungVolumeQuantReport | null,
  remote: CtScreenResponseV1,
): LungVolumeQuantReport | null {
  if (remote.replaceLocalLungQuant && remote.lungQuant) {
    return lungQuantFromApiPayload(remote.lungQuant)
  }
  return local
}

export async function fetchCtScreenInference(
  baseUrl: string,
  payload: CtScreenPayloadV1,
  signal: AbortSignal,
): Promise<CtScreenResponseV1 | null> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/ct-screen`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal,
    credentials: 'omit',
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    console.warn('[ct-screen]', res.status, t.slice(0, 200))
    return null
  }
  const data = (await res.json()) as CtScreenResponseV1
  if (data.schemaVersion !== CT_SCREEN_SCHEMA_VERSION) {
    console.warn('[ct-screen] unsupported schema', data.schemaVersion)
    return null
  }
  return data
}
