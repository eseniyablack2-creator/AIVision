# AIVision — сервис инференса КТ (Python)

Минимальный HTTP API, согласованный с фронтендом (`frontend/src/lib/ctInferenceTypes.ts`, `ctInferenceApi.ts`).

## Эндпоинты

| Метод | Путь | Назначение |
|--------|------|------------|
| GET | `/health` | Живость, флаги `totalsegmentator`, `localNiftiPathsAllowed`, `aorticScreeningDemo` |
| POST | `/v1/ct-screen` | Сводка `volume_summary_v1` + опционально TotalSegmentator |
| POST | `/v1/segment/total` | Только TotalSegmentator по пути к NIfTI на сервере |
| POST | `/v1/upload-nifti` | Multipart: поле `file` (+ опционально `runTotalSegmentator`) |
| GET | `/v1/masks-file/{jobId}/total_multilabel.nii.gz` | Скачать multilabel NIfTI после сегментации |

- По умолчанию ответ `ct-screen`: `findings: []`, `replaceLocalFindings: false`, `masks: null` — браузер сохраняет локальный скоринг v2.
- Если сегментация прошла успешно: `masks: { "format": "nifti_url", "url": "..." }`, `engine.id` → `totalsegmentator_multilabel`.

## Запуск (без нейросети)

```bash
cd inference
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8787
```

Фронтенд (корень `frontend/`):

```env
VITE_PATHOLOGY_API_URL=http://127.0.0.1:8787
```

## TotalSegmentator (опционально)

1. Установите PyTorch под вашу платформу ([pytorch.org](https://pytorch.org)); для GPU — сборку с CUDA.
2. Затем:

```bash
pip install -r requirements-totalsegmentator.txt
```

Первый запуск скачает веса nnU-Net (несколько GB).

### Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `AIVISION_ALLOW_LOCAL_NIFTI_PATH=1` | **Обязательно**, иначе пути к файлам игнорируются (защита от произвольного чтения диска). |
| `AIVISION_NIFTI_ROOT` | Если задано, `volumeNiftiPath` должен лежать **внутри** этого каталога (после `resolve`). |
| `AIVISION_MASK_CACHE` | Куда писать `mask_cache/<jobId>/total_multilabel.nii.gz` (по умолчанию `inference/mask_cache`). |
| `AIVISION_PUBLIC_BASE_URL` | Базовый URL для поля `masks.url` (например `http://192.168.1.5:8787`). Если не задан, берётся из заголовков запроса (`Host` / `X-Forwarded-*`). |
| `AIVISION_MAX_UPLOAD_MB` | Лимит тела для `POST /v1/upload-nifti` (по умолчанию 512). |
| `AIVISION_DEMO_AORTIC_SCREENING` | Демо-ответ **скрининга ОАС** по неконтрастному КТ (iAorta-подобный контракт). Если не задано или пусто/`0`/`off`/`false` — в ответе `aorticSyndromeScreening: null`. Значения `1`, `low`, `negative` — низкий риск; `alert`, `high`, `aas` — высокий риск (демо IMH и т.п.). Не клиническая модель, только для UI/интеграции. |

### Скрининг острого аортального синдрома (ОАС)

- В теле `POST /v1/ct-screen` передайте `requestAorticSyndromeScreening: true` (фронтенд делает это в режиме просмотра «Аорта · ОАС»).
- В ответе при наличии демо или будущей модели: поле `aorticSyndromeScreening` (`aasProbability`, `alertLevel`, `subtype`, `heatmapNiftiUrl`, …). Без демо и без реальной модели — `null` и предупреждение в `warnings`, если скрининг запрошен.

### Статистики HU в маске аорты (после TotalSegmentator)

Если в `ct-screen` выполнен TotalSegmentator (есть `volumeNiftiPath` и маска сохранена), сервер дополнительно заполняет **`totalsegAortaHuStats`**: среднее/разброс/перцентили HU, объём сегмента `aorta` в мм³, `aortaLabelId` из `totalsegmentator.map_to_binary` (задача `total`, v2). То же поле возвращается в **`POST /v1/segment/total`** и при **`upload-nifti`** с `runTotalSegmentator=true`. Это не скрининг ОАС, а количественная сводка по сегментации.

### Поля JSON (расширение `ct-screen`)

В теле `POST /v1/ct-screen` (рядом с `perSlice`, `aggregate`) можно передать:

- `volumeNiftiPath` — абсолютный путь к `.nii` / `.nii.gz` **на машине, где крутится uvicorn** (не в браузере).
- `totalSegmentatorFast` — `true` для ускоренного режима (по умолчанию `true`).
- `totalSegmentatorDevice` — `"gpu"`, `"cpu"` или `"mps"` (см. документацию TotalSegmentator).

Браузер обычно **не** шлёт локальный путь диска; типичный сценарий — прокси/Electron, curl или будущая загрузка файла отдельным эндпоинтом.

### Пример: только сегментация

```bash
# Windows (cmd): set AIVISION_ALLOW_LOCAL_NIFTI_PATH=1
# PowerShell: $env:AIVISION_ALLOW_LOCAL_NIFTI_PATH=1
# Linux/macOS: export AIVISION_ALLOW_LOCAL_NIFTI_PATH=1

curl -s -X POST http://127.0.0.1:8787/v1/segment/total -H "Content-Type: application/json" -d "{\"volumeNiftiPath\": \"C:/data/ct.nii.gz\", \"fast\": true, \"device\": \"cpu\"}"
```

Ответ при успехе: `jobId`, `masks.nifti_url`, `warnings`. Скачивание: `GET` по `masks.url`.

### Загрузка NIfTI (multipart)

```bash
curl -s -X POST http://127.0.0.1:8787/v1/upload-nifti \
  -F "file=@/path/to/ct.nii.gz" \
  -F "runTotalSegmentator=false"
```

При `runTotalSegmentator=true` после сохранения в `mask_cache/<jobId>/upload.nii.gz` запускается тот же TotalSegmentator, что и для локального пути; в ответе появится `masks`.

## Что дальше для клиники

1. **GPU** на сервере или воркере.
2. **Валидация** точности сегментации и, при необходимости, регистрация ИМН.
3. **Данные**: загрузка NIfTI multipart вместо локального пути, или DICOM на сервере по `seriesInstanceUid`.

### Протоколы

- **Тромбы / ТЭЛА** — обычно **КТЛА** с контрастом и отдельная модель сосудов; не лёгочное окно.
- **Гипертензия / ГЛА** — измерения калибра на специальных сериях + клиника; отдельный пайплайн.

## Формат запроса/ответа

См. типы TypeScript `CtScreenPayloadV1` / `CtScreenResponseV1` и Pydantic `app/schemas.py`. OpenAPI: `http://127.0.0.1:8787/docs` после запуска.
