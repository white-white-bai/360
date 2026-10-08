@echo off
rem The one-command door for the probe: uses the venv, not whatever `python` happens to be.
setlocal
if not exist "%~dp0.venv\Scripts\python.exe" (
  echo No venv yet. Run these first:
  echo   python -m venv .venv
  echo   .venv\Scripts\pip install -e ".[dev]"
  exit /b 1
)
"%~dp0.venv\Scripts\python.exe" -m agent.probe %*
