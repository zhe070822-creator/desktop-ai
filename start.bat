@echo off
cd /d "%~dp0"

if not exist "node_modules\" (
    echo First run: installing dependencies...
    call npm install
    echo.
    echo Dependencies installed. Starting...
    echo.
)

npm start
pause
