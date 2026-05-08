@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "PYTHON=%BACKEND%\.venv\Scripts\python.exe"

title TeacherDesk Launcher
echo.
echo Starting TeacherDesk...
echo Project folder: %ROOT%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install Node.js, then run this file again.
  pause
  exit /b 1
)

where py >nul 2>nul
if errorlevel 1 (
  where python >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Python was not found. Install Python, then run this file again.
    pause
    exit /b 1
  )
)

if not exist "%PYTHON%" (
  echo Creating Python virtual environment...
  py -3 -m venv "%BACKEND%\.venv" 2>nul
  if errorlevel 1 python -m venv "%BACKEND%\.venv"
  if errorlevel 1 (
    echo ERROR: Could not create the backend virtual environment.
    pause
    exit /b 1
  )
)

echo Installing/checking backend dependencies...
pushd "%BACKEND%"
"%PYTHON%" -m pip install -r requirements.txt
if errorlevel 1 (
  echo ERROR: Backend dependency installation failed.
  popd
  pause
  exit /b 1
)

echo Applying database migrations...
"%PYTHON%" manage.py migrate
if errorlevel 1 (
  echo ERROR: Database migration failed.
  popd
  pause
  exit /b 1
)
popd

if not exist "%FRONTEND%\node_modules" (
  echo Installing frontend dependencies...
  pushd "%FRONTEND%"
  call npm install
  if errorlevel 1 (
    echo ERROR: Frontend dependency installation failed.
    popd
    pause
    exit /b 1
  )
  popd
)

echo Starting backend server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "if(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue){ exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "TeacherDesk Backend" /D "%BACKEND%" cmd /k ""%PYTHON%" manage.py runserver 127.0.0.1:8000"
) else (
  echo Backend is already running on port 8000.
)

echo Starting frontend server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "if(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue){ exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "TeacherDesk Frontend" /D "%FRONTEND%" cmd /k "npm run dev -- --host 127.0.0.1 --port 5173"
) else (
  echo Frontend is already running on port 5173.
)

echo Waiting for TeacherDesk to become ready...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(45); $ok=$false; while((Get-Date) -lt $deadline -and -not $ok){ try { $backend=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/health/' -TimeoutSec 2; $frontend=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; $ok=($backend.StatusCode -eq 200 -and $frontend.StatusCode -eq 200) } catch { Start-Sleep -Seconds 1 } }; if(-not $ok){ exit 1 }"

if errorlevel 1 (
  echo.
  echo TeacherDesk is still starting. The server windows will show details.
  echo Opening the app anyway...
) else (
  echo TeacherDesk is ready.
)

start "" "http://127.0.0.1:5173/"
echo.
echo You can close this launcher window. Keep the Backend and Frontend windows open while using TeacherDesk.
echo To stop TeacherDesk later, close those windows or double-click Stop TeacherDesk.bat.
pause
