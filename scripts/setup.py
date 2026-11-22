"""One command installation on Windows, Linux and macOS."""
import os
from pathlib import Path
import subprocess
import sys
import venv

root = Path(__file__).resolve().parents[1]
os.chdir(root)
venv.create(root / ".venv", with_pip=True)
python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
subprocess.run([str(python), "-m", "pip", "install", "-e", ".[test]"], check=True)
subprocess.run(["npm.cmd" if os.name == "nt" else "npm", "ci", "--prefix", "web"], check=True)
