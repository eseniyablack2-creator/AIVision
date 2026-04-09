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
- `docs/` — требования и пошаговые инструкции.

Репозиторий: [github.com/eseniyablack2-creator/AIVision](https://github.com/eseniyablack2-creator/AIVision)

Запуск локально:

Из **корня репозитория** (после `npm install` внутри `frontend/`):
```bash
npm install --prefix frontend
npm run dev
```

Или как раньше из папки приложения:
```bash
cd frontend
npm install
npm run dev
```

Откройте в браузере адрес, который покажет Vite (обычно `http://localhost:5173/`).
