/**
 * Запуск FastAPI inference (app.main) на :8787 из каталога inference/.
 * Используется корневым `npm run dev:full`.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const INFERENCE_PORT = 8787

/** Windows: PID процесса, слушающего TCP :8787 (только LISTENING). */
function getWindowsListenerPid(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', windowsHide: true })
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const parts = line.trim().split(/\s+/)
      const last = parts[parts.length - 1]
      if (/^\d+$/.test(last)) return Number(last)
    }
  } catch {
    /* findstr: нет совпадений */
  }
  return null
}

/** Windows: имя образа процесса (python.exe и т.д.). */
function getWindowsProcessImageName(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8', windowsHide: true })
    const line = out.trim().split(/\r?\n/)[0] ?? ''
    return line.split(/\s+/)[0] ?? ''
  } catch {
    return ''
  }
}

function sleepMs(ms) {
  try {
    execSync(`ping 127.0.0.1 -n ${Math.max(2, Math.ceil(ms / 1000) + 1)} >nul`, { stdio: 'ignore', windowsHide: true })
  } catch {
    /* ignore */
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inf = path.join(root, 'inference')
const win = process.platform === 'win32'
const py = win ? path.join(inf, '.venv', 'Scripts', 'python.exe') : path.join(inf, '.venv', 'bin', 'python')

if (!fs.existsSync(py)) {
  console.error(
    '[AIVision inference] Нет виртуального окружения. Выполните один раз:\n' +
      '  cd inference\n' +
      (win ? '  py -m venv .venv\n' : '  python3 -m venv .venv\n') +
      `  ${win ? '.venv\\Scripts\\pip' : '.venv/bin/pip'} install -e ".[dev]"`,
  )
  process.exit(1)
}

if (win) {
  let busyPid = getWindowsListenerPid(INFERENCE_PORT)
  if (busyPid != null) {
    const noAuto = process.env.AIVISION_NO_AUTO_KILL_INFERENCE === '1'
    const image = getWindowsProcessImageName(busyPid).toLowerCase()
    const looksLikePython =
      image === 'python.exe' ||
      image === 'pythonw.exe' ||
      image === 'py.exe' ||
      image.includes('python')

    if (!noAuto && looksLikePython) {
      console.error(
        `[AIVision inference] Порт ${INFERENCE_PORT} занят старым Python (PID ${busyPid}, ${image}). Завершаю процесс и запускаю API заново.`,
      )
      try {
        execSync(`taskkill /PID ${busyPid} /F`, { stdio: 'inherit', windowsHide: true })
      } catch {
        console.error(
          `[AIVision inference] Не удалось завершить PID ${busyPid}. Выполните вручную: taskkill /PID ${busyPid} /F`,
        )
        process.exit(1)
      }
      sleepMs(900)
      busyPid = getWindowsListenerPid(INFERENCE_PORT)
    }

    if (busyPid != null) {
      console.error(
        `[AIVision inference] Порт ${INFERENCE_PORT} всё ещё занят (PID ${busyPid}).\n` +
          'Закройте окно со старым «npm run dev:full» или выполните:\n' +
          `  taskkill /PID ${busyPid} /F\n` +
          'Отключить авто-завершение Python: set AIVISION_NO_AUTO_KILL_INFERENCE=1\n' +
          'Затем снова: npm run dev:full',
      )
      process.exit(1)
    }
  }
}

/** 0.0.0.0 — иначе при открытии сайта как localhost:5173 запрос на 127.0.0.1:8787 иногда не попадает в слушатель (IPv4/IPv6). */
const child = spawn(
  py,
  ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', String(INFERENCE_PORT)],
  { cwd: inf, stdio: 'inherit', shell: false },
)

child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 0)
})
