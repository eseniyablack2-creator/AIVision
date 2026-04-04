# OmniView XP Reference

Этот документ фиксирует полный пользовательский список желаемых функций для идеального DICOM-просмотрщика.

Он служит:
- продуктовым эталоном;
- ориентиром для архитектуры;
- чеклистом для будущих этапов разработки.

## Основные блоки

1. Загрузка и управление исследованиями:
- Smart Ingestion;
- Streaming Viewer;
- Tag Anomaly Fixer;
- поддержка большого числа исследований и серий.

2. Viewport Engine:
- точный рендер;
- AI Window;
- синхронизация окон;
- тайлинг и стекинг;
- PET/CT fusion;
- мультиоконная компоновка.

3. Навигация:
- cine;
- bookmarks;
- 4D timeline;
- умный скролл;
- глобальная кинолента серий.

4. MPR и объем:
- ортогональный MPR;
- oblique MPR;
- curved planar reformations;
- 3D cursor;
- volume rendering;
- MIP/minIP/MeanIP;
- clipping plane;
- fly-through.

5. Измерения и анализ:
- длина;
- угол;
- ROI;
- volumetry;
- profile line;
- heatmap;
- история измерений;
- активный измеритель Pulsar.

6. Обработка изображений:
- шумоподавление;
- edge-preserving filters;
- metal artifact reduction;
- motion correction;
- super resolution;
- bone subtraction;
- local histogram equalization.

7. AI Copilot:
- похожие случаи;
- вероятные паттерны;
- фоновый детектор находок;
- семантический поиск;
- автоматический RECIST;
- оценка качества исследования;
- помощь в отчете.

8. Сравнение исследований:
- side-by-side;
- flipbook;
- morphing;
- subtraction;
- automatic registration;
- визуализация прогрессии.

9. Аннотации и отчет:
- smart arrow;
- layers;
- voice commands;
- smart phrases;
- one-button report;
- export to DICOM SC;
- cine MP4.

10. Профили и настройки:
- роли пользователей;
- профили радиологов по специализации;
- горячие клавиши;
- адаптивный интерфейс;
- dark/light режим;
- performance monitoring.

11. Клинические пакеты:
- кардиология;
- нейрорадиология;
- маммология;
- радиотерапия;
- сосудистые протоколы;
- костно-суставные сценарии.

## Важная оговорка

Наличие этого списка не означает, что все функции должны быть реализованы сразу.

Правильный путь внедрения:
1. Стабильный viewer.
2. Рабочие инструменты радиолога.
3. Layout и MPR.
4. Сравнение в динамике.
5. 3D и сегментация.
6. AI-подсказки и клинические пакеты.
