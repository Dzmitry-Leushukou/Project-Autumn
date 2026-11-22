"""Start the two local servers; Ctrl+C stops both."""

from pathlib import Path
import os
import subprocess
import time
import webbrowser
import urllib.request

root = Path(__file__).resolve().parents[1]
python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
processes = []
try:
    processes.append(
        subprocess.Popen(
            [
                str(python),
                "-m",
                "uvicorn",
                "api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            cwd=root,
        )
    )
    processes.append(
        subprocess.Popen(
            ["npm.cmd" if os.name == "nt" else "npm", "run", "dev"], cwd=root / "web"
        )
    )
    for _ in range(60):
        if any(p.poll() is not None for p in processes):
            raise RuntimeError(
                "Сервер завершился при запуске; проверьте журнал и занятость портов 8000/5173"
            )
        try:
            with urllib.request.urlopen("http://127.0.0.1:5173", timeout=1) as response:
                frontend_ready = response.status == 200
            with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=1) as response:
                if frontend_ready and response.status == 200:
                    break
        except OSError:
            time.sleep(0.5)
    else:
        raise RuntimeError("Не удалось дождаться Vite")
    webbrowser.open("http://127.0.0.1:5173")
    while all(p.poll() is None for p in processes):
        time.sleep(1)
except KeyboardInterrupt:
    pass
finally:
    for p in processes:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(p.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            p.terminate()
    for p in processes:
        p.wait()
