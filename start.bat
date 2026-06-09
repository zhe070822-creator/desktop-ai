@echo off
cd /d "%~dp0"

if not exist "node_modules\" (
    echo ============================================
    echo   Desktop AI - First Run Setup
    echo ============================================
    echo.
    echo   Dependencies need to be installed first.
    echo   This will download ~200MB and may take
    echo   about 15 minutes depending on your network.
    echo.
    echo ============================================
    echo.
    set /p confirm="Continue with installation? [Y/n]: "
    if /i "%confirm%"=="n" (
        echo Installation cancelled.
        pause
        exit /b
    )
    echo.
    echo Installing dependencies... Please wait.
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo Installation failed. Please check your network and try again.
        pause
        exit /b
    )
    echo.
    echo Installation complete. Starting Desktop AI...
    echo.
)

npm start
pause
