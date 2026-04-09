## Reference datasets for CTA/3D QA (links + notes)

This file is a curated registry of public / semi-public datasets and collections
to compare rendering, segmentation presets, and bone-removal behavior across cases.

### Abdomen & pelvis CT (community)
- **Embodi3D (free filter)**: `https://www.embodi3d.com/files/category/42-abdomen-and-pelvis-cts/page/17/?filter=file_free&sortby=file_submitted&sortdirection=desc`
  - **Notes**: community uploads; verify license per-case. Often already anonymized.

### Cancer imaging collections
- **NCI Imaging Data Commons collections**: `https://portal.imaging.datacommons.cancer.gov/collections/`
  - **Notes**: requires understanding dataset access terms; useful for diverse scanner protocols.

### Vessel segmentation benchmark (lungs)
- **VESSEL12 dataset overview**: `https://vessel12.grand-challenge.org/Details/`
- **Mirror / repo stub**: `https://openi.pcl.ac.cn/skyous/vessel12#user-content-简介`
  - **Notes**: lung vessels, not abdomen; still valuable to validate “vessels vs airway wall” robustness.

### DICOM sample libraries
- **OsiriX DICOM Image Library**: `https://www.osirix-viewer.com/resources/dicom-image-library/?_x_tr_sch=http`
  - **Notes**: access may require membership; use for reproducible CTA samples (arterial/venous phases).

### Algorithm references (classic segmentation)
- **CTBoneSegmentation (traditional threshold/morphology)**: `https://github.com/pytholic/CTBoneSegmentation`
  - **Notes**: examples for bone thresholding and morphology pipelines.

### Web volume rendering references
- **OHIF Viewer**: `https://github.com/OHIF/Viewers`
  - **Notes**: reference architecture for web medical viewer UX and volume rendering.
- **3D WebGL Volume Rendering demo repo**: `https://github.com/mohammed-abo-arab/3D_WebGL_VolumeRendering`
  - **Notes**: WebGL performance / streaming ideas; not a workstation-grade medical viewer.

### Other link (unverified / needs manual review)
- `https://gitcode.com/Universal-Tool/7d4a1/?utm_source=article_gitcode_universal&index=bottom&type=card&&uuid_tt_dd=10_24295829050-1775681201703-406769&isLogin=9&from_id=147268082&from_link=15b62129b31dcb345976066ee0f36e20`
  - **Notes**: review licensing and contents before using.

### Hugging Face — отбор под AIVision (DICOM / КТ / 3D)

Ниже только то, что имеет смысл для **QA загрузчика DICOM**, **MPR/3D volume**, **костей/сосудов/груди**. Остальное из списка (робототехника, пустые репозитории, MRI-only, снимки грудной клетки без томографического объёма) для текущего инструмента **не приоритетно**.

#### Высокий приоритет (КТ, клинический контекст)

- **Chest DICOM (крупный, гейт)** — [pythera/bv175-chest-dicom](https://huggingface.co/datasets/pythera/bv175-chest-dicom/tree/main)
  - **Зачем**: массовая проверка **грудной КТ** в браузере (лёгкие, стол, серии, тяжёлые архивы ~18 GB частями).
  - **Ограничения**: нужно **принять условия доступа** на HF; после скачивания — распаковка `dicom.tar.bz2.*` локально и загрузка папки в viewer.

- **Willis / нейрососуды (imagefolder)** — [adonaivera/dicom-willis-dataset](https://huggingface.co/datasets/adonaivera/dicom-willis-dataset)
  - **Зачем**: регрессии для **тонких сосудистых структур** и окон/контраста в голове (не брюшная аорта, но тот же класс задач «сосуды vs кость»).
  - **Ограничения**: на HF часто отдаётся как **набор изображений** (не полноценный multi-file DICOM study в одном виде); уточнять наличие исходных `.dcm` в репозитории при скачивании.

- **Мозг КТ + метки (200 кейсов)** — [UniqueData/dicom-brain-dataset](https://huggingface.co/datasets/UniqueData/dicom-brain-dataset)
  - **Зачем**: разнообразие **размеров матрицы** (256–1024), несколько классов/серий в разметке — хорошо для стресс-теста парсера и UI серий.
  - **Ограничения**: фокус **нейро**, не ангио аорты.

#### Средний приоритет (дымовые / смежные)

- **Мини-пример DICOM** — [TobiasPitters/dicom-sample-dataset](https://huggingface.co/datasets/TobiasPitters/dicom-sample-dataset/tree/main)
  - **Зачем**: быстрый **smoke-test** после сборки (мало данных, удобно в CI/ручную проверку).

- **DICOM DVT (MIT, небольшой объём)** — [fihsy/DICOM_DVT](https://huggingface.co/datasets/fihsy/DICOM_DVT/tree/main)
  - **Зачем**: ещё один **КТ DICOM** пайплайн (вены нижних конечностей), проверка декодирования и 3D на «не грудной» анатомии.

- **Позвоночник в NIfTI (не DICOM)** — [alexanderdann/CTSpine1K](https://huggingface.co/datasets/alexanderdann/CTSpine1K)
  - **Зачем**: **объёмные КТ** + маски позвонков — полезно для будущих **костных/сегментационных** тестов на бэкенде (SimpleITK), **не** для нативного DICOM-вьювера без конвертации.
  - **Лицензия**: **CC-BY-NC-SA** — **некоммерческое** использование; для коммерческого продукта — не опора без отдельной правовой оценки.

#### Низкий приоритет / специализированно

- **Метаданные / парсер (табличные бенчмарки)** — [SR219/dicom-read](https://huggingface.co/datasets/SR219/dicom-read), [SR219/Dicom-metadata-extraction-skillbench](https://huggingface.co/datasets/SR219/Dicom-metadata-extraction-skillbench)
  - **Зачем**: ожидаемые числа **studies/series/incomplete** — материал для **автотестов извлечения метаданных**, не для визуального «как Siemens».

#### Не целевые для текущего 3D-инструмента (можно не тратить время)

- [fihsy/DICOM_DVT_ULTRASOUND](https://huggingface.co/datasets/fihsy/DICOM_DVT_ULTRASOUND/tree/main) — **УЗИ**, не КТ volume в смысле текущего VTK DVR.
- [AIxBlock/MRI-brain-cancer-dicom-100-plus-patients](https://huggingface.co/datasets/AIxBlock/MRI-brain-cancer-dicom-100-plus-patients) — **MRI**, на HF пусто, данные на Google Drive.
- [diing/chex_dicom](https://huggingface.co/datasets/diing/chex_dicom) — в основном **рентген/метаданные MS-CXR**, не полноценные КТ-объёмы для аорты.
- [Dicomsky/human_inloop_grasp](https://huggingface.co/datasets/Dicomsky/human_inloop_grasp), [grasp_tape](https://huggingface.co/datasets/Dicomsky/grasp_tape), [test_evo_rl](https://huggingface.co/datasets/Dicomsky/test_evo_rl), [eval_lerobot_grasp_box](https://huggingface.co/datasets/Dicomsky/eval_lerobot_grasp_box) — **робототехника / LeRobot**, к DICOM не относятся.
- [thangnt47/my-pacs-dicom](https://huggingface.co/datasets/thangnt47/my-pacs-dicom) — репозиторий **пустой**.

### Практический вывод для «как мне надо» по картинке

Датасеты **не заменяют** тюнинг **transfer function + DSA (native+arterial) + память/stride** в коде: они дают **разнообразные серии** для проверки. Для ангио-аорты в первую очередь нужны **реальные исследования с двумя фазами** (как у [Vidar «Сосуды»](https://povidar.ru/dicom-viewer/v3/help/content/vessels.htm)); из открытых HF наиболее близко по масштабу грудной КТ — **bv175-chest-dicom** (после гейта и распаковки), для сосудов головы — **dicom-willis-dataset** / **dicom-brain-dataset**.

