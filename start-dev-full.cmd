@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запуск AIVision: Vite + API inference...
echo.
echo ВАЖНО: не закрывайте это окно и не нажимайте Ctrl+C, пока пользуетесь сайтом — иначе API и сайт остановятся.
echo Запускайте только ОДНО такое окно (не дублируйте «npm run dev:full» в Cursor и в cmd одновременно).
echo Откройте в браузере адрес из строки "Local:" ниже (если порт не 5173 — используйте тот, что напечатан).
echo.
npm run dev:full
pause
