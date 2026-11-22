"""One command installation on Windows, Linux and macOS."""

import os
from pathlib import Path
import subprocess
import venv

root = Path(__file__).resolve().parents[1]
os.chdir(root)
venv.create(root / ".venv", with_pip=True)
python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
subprocess.run(
    [str(python), "-m", "pip", "install", "-r", "requirements.lock.txt"], check=True
)
subprocess.run(
    [str(python), "-m", "pip", "install", "--no-deps", "-e", "."], check=True
)
subprocess.run(
    ["npm.cmd" if os.name == "nt" else "npm", "ci", "--prefix", "web"], check=True
)
