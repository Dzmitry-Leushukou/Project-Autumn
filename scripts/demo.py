"""Start the two local servers; Ctrl+C stops both."""
from pathlib import Path
import os
import subprocess
import time
import webbrowser

root = Path(__file__).resolve().parents[1]
python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
processes = []
try:
    processes.append(subprocess.Popen([str(python), "-m", "uvicorn", "api.main:app", "--host", "127.0.0.1", "--port", "8000"], cwd=root))
    processes.append(subprocess.Popen(["npm.cmd" if os.name == "nt" else "npm", "run", "dev"], cwd=root / "web"))
    time.sleep(2)
    webbrowser.open("http://127.0.0.1:5173")
    while all(p.poll() is None for p in processes):
        time.sleep(1)
except KeyboardInterrupt:
    pass
finally:
    for p in processes:
        p.terminate()
    for p in processes:
        p.wait()
