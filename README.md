# AIVision

Локальный проект для создания инструмента радиолога с помощью Codex.

Что мы делаем:
- просмотр DICOM-исследований КТ;
- базовые 2D-инструменты радиолога;
- MPR и 3D-визуализация;
- подготовка к сегментации сосудов, суставов и костных структур;
- пошаговая разработка так, чтобы проектом можно было управлять без глубокого опыта в программировании.

С чего начинаем:
1. Формализуем требования и границы MVP.
2. Выбираем стек и архитектуру.
3. Собираем первый рабочий прототип: загрузка DICOM, просмотр серии, окно/уровень, зум, pan, измерения.
4. Затем переходим к MPR, 3D и сегментации.

Основные документы:
- `docs/technical-spec.md` — основное ТЗ;
- `docs/roadmap.md` — дорожная карта этапов;
- `docs/clinical-requirements.md` — клинические сценарии и обязательные режимы;
- `docs/technical-dossier-aivision.md` — полное техническое досье (структура «как iAorta»: проблема, архитектура, данные, риски, шпаргалка);
- `docs/product-vision.md` — продуктовый ориентир уровня "лучший viewer";
- `docs/omniview-reference.md` — полный референс функций OmniView XP;
- `docs/step-01.md` — самый первый практический шаг;
- `docs/awesome-dicom-for-aivision.md` — карта ресурсов из [awesome-dicom](https://github.com/open-dicom/awesome-dicom) под наш стек и дорожную карту.

Текущая структура:
- `frontend/` — клиентское приложение на React + TypeScript + Vite;
- `inference/` — сервер CT/inference (FastAPI `app.main`, порт **8787** при `npm run dev:full`);
- `scripts/` — в т.ч. `run-inference.mjs` для корневого `dev:full`;
- `docs/` — требования и пошаговые инструкции.

Репозиторий: [github.com/eseniyablack2-creator/AIVision](https://github.com/eseniyablack2-creator/AIVision)

Запуск локально:

### Вариант A — фронт + API (рекомендуется, индикатор «API подключен»)

Из **корня** (один раз: зависимости фронта, корневой `concurrently`, venv в `inference/`):

```bash
npm install --prefix frontend
npm install
cd inference
py -m venv .venv
.\.venv\Scripts\pip install -e ".[dev]"
cd ..
npm run dev:full
```

На Linux/macOS замените строку с `pip` на: `.venv/bin/pip install -e ".[dev]"`.

Откройте в браузере адрес из строки **`Local:`** в терминале (часто **`http://localhost:5174/`** — порт **5173** часто занят другими программами).

То же самое можно запустить из папки `frontend/` командой **`npm run dev:full`** (она проксирует в корень репозитория). Если выполнить её только из `frontend`, не сделав `npm install` в **корне**, не будет пакета `concurrently` — сначала один раз выполните `npm install` из корня `AIVision`, как в блоке выше.

### Переменные окружения (`frontend/.env`)

- **CT-скрининг и REST OpenAPI** — `inference/app/main.py` (**Uvicorn**, порт **8787**). Для `npm run dev:full` **`VITE_PATHOLOGY_API_URL` можно не задавать**: запросы идут через префикс **`/__aivision_inference`** на тот же хост, что и Vite.
- Порт **8000** (`start-aivision.ps1`, **`api.main`**, 3D **`/v1/visualize`**) — отдельный процесс. Для него при необходимости задайте **`VITE_SEGMENTATION_API_URL`**, а не `VITE_PATHOLOGY_API_URL` на `:8000`.
- Шаблон с комментариями: **`frontend/.env.example`**.

В **режиме разработки** значение `VITE_PATHOLOGY_API_URL` только на **loopback и порт 8000** для CT API **игнорируется** (типичная устаревшая строка в `.env`); клиент подключается к **8787** (см. `getExplicitPathologyApiBaseFromEnv` в `frontend/src/lib/inferenceApiBase.ts`).

### Вариант B — только фронт

```bash
npm install --prefix frontend
npm run dev
```

Без запущенного inference статус API будет «недоступен»; просмотр DICOM и локальный 2D/3D при этом работают.

### Если «API недоступен» после `npm run dev:full` (Windows)

**1. В логе API строка вроде `error while attempting to bind on address ('0.0.0.0', 8787)` и `winerror 10048`**  
Порт **8787** уже занят (часто остался старый процесс Python/uvicorn). Скрипт `scripts/run-inference.mjs` при запуске **сам завершает** предыдущий **Python**, который держит 8787, и поднимает API снова (отключить: `set AIVISION_NO_AUTO_KILL_INFERENCE=1`). Если порт занят **не** Python — освободите вручную:

В **cmd** или **PowerShell** от имени пользователя:

```text
netstat -ano | findstr :8787
```

В последней колонке будет **PID** (номер процесса). Завершите процесс (подставьте свой PID вместо `12345`):

```text
taskkill /PID 12345 /F
```

Затем снова из корня репозитория: `npm run dev:full`.

В Windows можно дважды щёлкнуть **`start-dev-full.cmd`** в корне репозитория — откроется окно с тем же запуском.

**2. Сайт открылся не на 5173, а на 5174 (или другом)**  
Это нормально: порт 5173 был занят. Открывайте **тот адрес**, который напечатал Vite в консоли (строка `Local: http://localhost:...`).

**3. Ошибка при `py -m venv .venv` («Unable to copy … venvlauncher.exe»)**  
Часто мешают синхронизация папки (OneDrive), антивирус или права. Попробуйте: закрыть программы, временно выключить синхронизацию для папки проекта, удалить папку `inference\.venv` и снова выполнить `py -m venv .venv` в каталоге `inference`.

**4. Открыли сайт по адресу `http://192.168.x.x:5173` (Network), а API «недоступен»**  
На части ПК с Windows запросы из браузера на другой порт (`:8787`) режутся или задерживаются. В режиме `npm run dev` Vite проксирует API через префикс `/__aivision_inference` (тот же адрес и порт, что у страницы). После обновления `vite.config.ts` перезапустите dev-сервер. Удобно также открывать строку **Local** из консоли Vite (`http://localhost:5173/` и т.п.).
