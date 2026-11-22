# Metro Lab

Учебная лаборатория дискретно-событийного моделирования метро. Python 3.11+, Node.js 20.19+.

Установка из корня (одна команда): `python scripts/setup.py`.

Запуск в двух терминалах:

```powershell
.venv/Scripts/python -m uvicorn api.main:app --host 127.0.0.1 --port 8000
```

```powershell
npm --prefix web run dev
```

Linux/macOS: `.venv/bin/python` вместо `.venv/Scripts/python`.
Откройте http://127.0.0.1:5173. Одна команда для запуска обоих процессов и браузера: `python scripts/demo.py`.

Проверки: `.venv/Scripts/python -m pytest` и `npm --prefix web run build`.
