@echo off
cd /d "%~dp0"

:: 首次使用：自动检测并安装依赖
if not exist "node_modules\" (
    echo 首次运行，正在安装依赖...
    npm install
    echo.
    echo 依赖安装完成，正在启动...
    echo.
)

npm start
pause
