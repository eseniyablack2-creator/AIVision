# Ресурсы из [awesome-dicom](https://github.com/open-dicom/awesome-dicom) для AIVision

Источник списка: [open-dicom/awesome-dicom](https://github.com/open-dicom/awesome-dicom) (каталог под **CC0-1.0**).  
Этот документ — **внутренняя карта**: что из каталога относится к нашей идее (веб-viewer КТ, MPR, 3D, динамика, похожие случаи, сегментация, inference).  
**Лицензии:** у каждого проекта по ссылке свой `LICENSE`; некоммерческий статус AIVision не отменяет требований (атрибуция, GPL-совместимость и т.д.). Перед добавлением зависимости — проверить репозиторий.

Связанные документы: [roadmap.md](./roadmap.md), [clinical-requirements.md](./clinical-requirements.md), [inobitek-manual-parity-matrix.md](./inobitek-manual-parity-matrix.md).

---

## Легенда приоритетов

| Код | Смысл |
|-----|--------|
| **0** | Уже используем или прямое продолжение текущего стека |
| **1** | Рекомендуется следующим шагом (экспорт DICOM, DICOMWeb, SEG) |
| **2** | Полезно на среднем горизонте (сервер, конвертация, RT) |
| **3** | Справочно / другой язык / узкая ниша |
| **—** | Мало пересечений с текущим scope (сохраняем ссылку) |

---

## Уже в экосистеме AIVision (из списка JS)

| Ресурс | Ссылка | Заметка |
|--------|--------|---------|
| **dicomParser** | [cornerstonejs/dicom-parser](https://github.com/cornerstonejs/dicom-parser) | Парсинг P10, теги, метаданные — **0** |
| **Cornerstone / WADO loader** | [cornerstonejs](https://github.com/cornerstonejs/), [cornerstoneWADOImageLoader](https://github.com/cornerstonejs/dicom-image-loader) | Декодирование срезов, сжатие — **0** |
| **VTK.js** | [Kitware/vtk-js](https://github.com/Kitware/vtk-js) | Как у **VolView**; у нас объёмный рендер — **0** |

---

## JavaScript / TypeScript — что подключать или изучать по задачам

### Общее (парсинг, DICOMWeb, запись файлов)

| Ресурс | Ссылка | Для AIVision | Пр. |
|--------|--------|--------------|-----|
| **dcmjs** | [dcmjs-org/dcmjs](https://github.com/dcmjs-org/dcmjs) | Создание/редактирование датасетов, Secondary Capture, SEG/SR в перспективе | **1** |
| **dicomweb-client** | [dcmjs-org/dicomweb-client](https://github.com/dcmjs-org/dicomweb-client) | QIDO/WADO/STOW с браузера при появлении архива | **1** |
| **Efferent.Dicom** | [Efferent-Health/Dicom](https://github.com/Efferent-Health/Dicom) | Альтернатива/дополнение для чтения-записи TS — оценить лицензию и API | **2** |
| **Daikon** | [rii-mango/Daikon](https://github.com/rii-mango/Daikon) | Чистый JS reader — дублирует часть Cornerstone; имеет смысл при минимальном бандле | **3** |
| **dcmjs-codecs** | [PantelisGeorgiadis/dcmjs-codecs](https://github.com/PantelisGeorgiadis/dcmjs-codecs) | Транскодинг в связке с dcmjs | **2** |
| **dcmjs-dimse** | [PantelisGeorgiadis/dcmjs-dimse](https://github.com/PantelisGeorgiadis/dcmjs-dimse) | DIMSE в **Node** (не в браузер) — если нужен C-STORE/ECHO с десктоп-агента | **3** |
| **dicomweb-proxy** | [knopkem/dicomweb-proxy](https://github.com/knopkem/dicomweb-proxy) | Мост DICOMWeb ↔ DIMSE для локального Orthanc/PACS | **2** |

### Визуализация и референсы UX

| Ресурс | Ссылка | Для AIVision | Пр. |
|--------|--------|--------------|-----|
| **VolView** | [Kitware/VolView](https://github.com/Kitware/VolView) | Эталон VTK.js: crop, пресеты, клинический UX — **изучать**, не обязательно встраивать | **1** |
| **OHIF Viewers** | [OHIF/Viewers](https://github.com/OHIF/Viewers) | DICOMweb PWA, layout, tool system — паттерны и архитектура | **1** |
| **NiiVue** | [niivue/niivue](https://github.com/niivue/niivue) | WebGL: DICOM/NIfTI, чертежи — полезно для fusion/оверлеев и трасок | **2** |
| **DWV** / **dwv-react** | [ivmartel/dwv](https://github.com/ivmartel/dwv), [dwv-react](https://github.com/ivmartel/dwv-react) | Zero-footprint 2D-инструменты, идеи для измерений | **2** |
| **dcmjs-imaging** | [PantelisGeorgiadis/dcmjs-imaging](https://github.com/PantelisGeorgiadis/dcmjs-imaging) | Рендер и оверлеи на dcmjs | **2** |
| **dicom.ts** | [wearemothership/dicom.ts](https://github.com/wearemothership/dicom.ts) | Быстрый рендер — сравнить с текущим путём | **3** |
| **bluelight** | [cylab-tw/bluelight](https://github.com/cylab-tw/bluelight) | Лёгкий SPA-viewer — референс | **3** |
| **dicom-microscopy-viewer** | [ImagingDataCommons/dicom-microscopy-viewer](https://github.com/ImagingDataCommons/dicom-microscopy-viewer) | WSI/микроскопия — **не КТ**; оставить если расширим модальности | **—** |
| **dicomviewer** (Nextcloud) | [ayselafsar/dicomviewer](https://github.com/ayselafsar/dicomviewer) | Интеграция с Nextcloud — не наш продукт | **—** |
| **dicomViewerLib** | [fourctv/dicomViewerLib](https://github.com/fourctv/dicomViewerLib) | Angular + Cornerstone — **—** |
| **U Dicom Viewer** | [webnamics/u-dicom-viewer](https://github.com/webnamics/u-dicom-viewer) | Простой веб-viewer — референс | **3** |

### Локальные DICOMWeb-серверы (для разработки и демо)

| Ресурс | Ссылка | Для AIVision | Пр. |
|--------|--------|--------------|-----|
| **dicomweb-pacs** | [knopkem/dicomweb-pacs](https://github.com/knopkem/dicomweb-pacs) | SQLite + DICOMweb — быстрый стенд | **2** |
| **dicomweb-server** | [dcmjs-org/dicomweb-server](https://github.com/dcmjs-org/dicomweb-server) | CouchDB + лёгкий сервер | **3** |

---

## Серверы и тулкиты (C++ / C# / Java) — не в бандл фронта

Использовать как **отдельные сервисы** или **CLI**, если появится PACS, конвертация, жёсткая валидация.

| Ресурс | Ссылка | Для AIVision | Пр. |
|--------|--------|--------------|-----|
| **Orthanc** | [Orthanc](https://github.com/jodogne/OrthancMirror) | DICOM + REST/DICOMweb — эталон для связки с `dicomweb-client` | **2** |
| **DCMTK** | [DCMTK/dcmtk](https://github.com/DCMTK/dcmtk) | Конвертация, сеть, утилиты командной строки | **2** |
| **GDCM** | [malaterre/GDCM](https://github.com/malaterre/GDCM) | Чтение/запись, сжатие | **2** |
| **vtk-dicom** | [dgobbi/vtk-dicom](https://github.com/dgobbi/vtk-dicom) | DICOM ↔ VTK, утилиты | **2** |
| **dcm2niix** | [rordenlab/dcm2niix](https://github.com/rordenlab/dcm2niix) | DICOM → NIfTI (у вас уже путь через NIfTI для масок) | **2** |
| **DicomToMesh** | [AOT-AG/DicomToMesh](https://github.com/AOT-AG/DicomToMesh) | Объём → mesh (STL/OBJ) для 3D-печати/визуализации | **3** |
| **CTK** | [commontk/CTK](https://github.com/commontk/CTK) | Виджеты и утилиты для desktop C++ — **—** для чистого веба |
| **MITK** | [MITK/MITK](https://github.com/MITK/MITK) | Полноценная станция — референс алгоритмов | **3** |
| **SimpleITK** | [SimpleITK/SimpleITK](https://github.com/SimpleITK/SimpleITK) | Регистрация, фильтры — **Python/C++** бэкенд | **2** |
| **fo-dicom** | [fo-dicom/fo-dicom](https://github.com/fo-dicom/fo-dicom) | .NET toolkit — если появится сервис на C# | **3** |
| **dicom-server** (Microsoft) | [microsoft/dicom-server](https://github.com/microsoft/dicom-server) | Azure DICOM — облачный сценарий | **3** |
| **DICOMcloud** | [DICOMcloud/DICOMcloud](https://github.com/DICOMcloud/DICOMcloud) | DICOMweb server | **3** |
| **dcm4che** | [dcm4che/dcm4che](https://github.com/dcm4che/dcm4che) | Enterprise Java stack | **3** |
| **Dicoogle** | [bioinformatics-ua/dicoogle](https://github.com/bioinformatics-ua/dicoogle) | PACS с индексацией | **3** |
| **Weasis** | [nroduit/Weasis](https://github.com/nroduit/Weasis) | Desktop/web viewer — референс | **3** |

---

## Python — бэкенд inference, анонимизация, DICOM-объекты

| Ресурс | Ссылка | Для AIVision | Пр. |
|--------|--------|--------------|-----|
| **pydicom** | [pydicom/pydicom](https://github.com/pydicom/pydicom) | Чтение/запись на сервере, валидация тегов | **1** |
| **pynetdicom** | [pydicom/pynetdicom](https://github.com/pydicom/pynetdicom) | DIMSE SCP/SCU — приём/отправка исследований | **2** |
| **highdicom** | [ImagingDataCommons/highdicom](https://github.com/ImagingDataCommons/highdicom) | SEG, SR, аннотации в стандартном виде | **2** |
| **dicomweb-client** (Python) | [ImagingDataCommons/dicomweb-client](https://github.com/ImagingDataCommons/dicomweb-client) | Клиент IDC/Google Healthcare API | **2** |
| **deid** | [pydicom/deid](https://github.com/pydicom/deid) | Анонимизация — сравнить с текущим ZIP-экспортом | **2** |
| **dicom-anonymizer** | [KitwareMedical/dicom-anonymizer](https://github.com/KitwareMedical/dicom-anonymizer) | Обезличивание по профилю DICOM | **2** |
| **dicom-numpy** | [innolitics/dicom-numpy](https://github.com/innolitics/dicom-numpy) | Массивы из DICOM для пайплайнов | **2** |
| **dicom-standard** | [innolitics/dicom-standard](https://github.com/innolitics/dicom-standard) | JSON со стандарта — автоген тегов в UI | **3** |
| **dcmrtstruct2nii** | [Sikerdebaard/dcmrtstruct2nii](https://github.com/Sikerdebaard/dcmrtstruct2nii) | RTSTRUCT → маска NIfTI | **2** |
| **dicompyler** | [dicompyler](https://github.com/dicompyler/) | DICOM RT — радиотерапия | **—** |
| **MedPy** | [loli/medpy](https://github.com/loli/medpy) | Мед. image processing | **3** |
| **mercure** | [mercure-imaging/mercure](https://github.com/mercure-imaging/mercure) | Маршрутизация DICOM + ML | **3** |
| **Niffler** | [Emory-HITI/Niffler](https://github.com/Emory-HITI/Niffler) | ML-пайплайны на DICOM | **3** |

### Конвертация (Python)

| Ресурс | Ссылка | Пр. |
|--------|--------|-----|
| [dicom2nifti](https://github.com/icometrix/dicom2nifti) | MR/CT → NIfTI | **2** |
| [dcmstack](https://github.com/moloney/dcmstack) | Метаданные + NIfTI | **3** |
| [heudiconv](https://github.com/nipy/heudiconv) | Организация нейро-DICOM → BIDS | **—** |
| [bidskit](https://github.com/jmtyszka/bidskit) | DICOM → BIDS | **—** |
| [Dicomifier](https://github.com/lamyj/dicomifier) | Bruker ↔ DICOM/NIfTI | **—** |
| [dicomsort](https://github.com/pieper/dicomsort) | Сортировка файлов по иерархии | **2** |

---

## Go / Rust / MATLAB / прочее

| Ресурс | Ссылка | Для AIVision | Пр. |
|--------|--------|--------------|-----|
| **dicom** (Go) | [suyashkumar/dicom](https://github.com/suyashkumar/dicom) | Высокопроизводительный парсер — микросервис на Go | **3** |
| **DICOM-rs** | [Enet4/dicom-rs](https://github.com/Enet4/dicom-rs) | Rust — если нужен безопасный нативный воркер | **3** |
| **dicm2nii** (MATLAB) | [xiangruili/dicm2nii](https://github.com/xiangruili/dicm2nii) | Лабораторные сценарии | **—** |

---

## Датасеты (тесты, обучение, демо)

| Ресурс | Ссылка | Для AIVision |
|--------|--------|--------------|
| **TCIA** | [cancerimagingarchive.net](https://www.cancerimagingarchive.net/) | Публичные КТ/МРТ; проверять условия использования |
| **IDC** | [Imaging Data Commons](https://datacommons.cancer.gov/repository/imaging-data-commons) | Облако, DICOM + DICOMweb API |
| **MIDRC** | [midrc.org](https://www.midrc.org/) | COVID-имиджинг, большие когорты |
| **COVID-CT-MD** | [ShahinSHH/COVID-CT-MD](https://github.com/ShahinSHH/COVID-CT-MD) | Грудная КТ в **DICOM**: 169 COVID-19, 60 CAP, 76 норма; подмножество с метками инфильтрата на уровне **среза** и **доли лёгкого** (`*.npy`, `Index.csv`); полный архив на **Figshare** (ссылка в README репозитория); описание и цитирование — [Scientific Data, 2021](https://doi.org/10.1038/s41597-021-00900-3). **Важно:** сортировать срезы по тегу **(0020,1041) Slice Location**, иначе метки не совпадут с изображениями. |

---

## Обучение и стандарт

| Ресурс | Ссылка |
|--------|--------|
| DICOM Standard | [dicomstandard.org/current](https://www.dicomstandard.org/current) |
| DICOM Standard Browser | [dicom.innolitics.com](https://dicom.innolitics.com/ciods) |
| DICOM Library | [dicomlibrary.com](https://www.dicomlibrary.com/) |
| DICOM is Easy (блог) | [dicomiseasy.blogspot.com](https://dicomiseasy.blogspot.com/2011/10/introduction-to-dicom-chapter-1.html) |
| Microsoft training | [Medical imaging data module](https://learn.microsoft.com/en-us/training/modules/medical-imaging-data/) |

---

## Валидация и «тяжёлые» станции

| Ресурс | Ссылка | Для AIVision |
|--------|--------|--------------|
| **DVTk** | [dvtk-org/DVTk](https://github.com/dvtk-org/DVTk) | Тестирование DICOM-сети |
| **3D Slicer** | [slicer.org](https://slicer.org) | Референс сегментации/регистрации |
| **AlizaMS** | [AlizaMedicalImaging/AlizaMS](https://github.com/AlizaMedicalImaging/AlizaMS) | Desktop viewer |

---

## Рекомендуемый порядок «забора» в продукт (не всё в npm сразу)

1. **Уже есть:** dicom-parser, Cornerstone3D + image loader, vtk.js.  
2. **Следующий логичный шаг:** **dcmjs** — экспорт Secondary Capture / простых объектов из того, что уже рисуем в viewer.  
3. **Параллельно по инфраструктуре:** локальный **Orthanc** + **dicomweb-client** — если решите отойти от «только File API».  
4. **Бэкенд inference:** **pydicom** / **highdicom** для корректных SEG/SR при сохранении результатов AI.  
5. **Тесты:** выгрузки из **IDC** / **TCIA** под регрессию парсера и MPR; для сценариев грудной КТ и COVID-подобных паттернов — смотреть **COVID-CT-MD** (DICOM + метки; см. таблицу «Датасеты» выше).  
6. **Идеи UX/3D:** читать код/доки **VolView**, **OHIF** без полного форка.

Обновляйте этот файл при смене scope: отмечайте галочками в коммите или внизу таблицы «принято / отклонено / отложено».

---

*Последняя синхронизация перечня с upstream: readme awesome-dicom (raw). При расхождении ориентир — [официальный репозиторий списка](https://github.com/open-dicom/awesome-dicom).*
