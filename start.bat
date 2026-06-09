@echo off
cd /d "%~dp0"

if exist "node_modules\" goto run

echo ============================================
echo   Desktop AI - First Run Setup
echo ============================================
echo.
echo   Dependencies need to be installed first.
echo   This will download about 400MB and may
echo   take 15 minutes depending on your network.
echo.
echo ============================================
echo.
choice /c YN /m "Continue with installation"
if errorlevel 2 goto cancel

echo.
echo Installing dependencies... Please wait.
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo Installation failed. Check your network and try again.
    pause
    exit /b
)
echo.
echo Installation complete. Starting Desktop AI...
echo.

:run
npm start
pause
exit /b

:cancel
echo Installation cancelled.
pause
exit /b
