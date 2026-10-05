@echo off
chcp 65001 >nul
title Webmuic 聚合音乐播放器

echo ========================================================
echo         Webmuic 本机聚合音乐播放器 (Windows)
echo ========================================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js！
    echo 请先前往 https://nodejs.org/ 下载安装 Node.js (推荐 LTS 20.x 或更高版本)。
    echo.
    pause
    exit /b 1
)

:: 检查是否已安装依赖
if not exist "node_modules\" (
    echo [提示] 尚未检测到项目依赖，将自动执行初始化安装...
    echo.
    call "%~dp0install-windows.bat"
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装未完成，无法启动。
        pause
        exit /b 1
    )
)

echo [准备就绪] 正在启动聚合播放器服务（四个子进程守护中）...
echo 启动完成后将自动在默认浏览器打开 http://127.0.0.1:5173
echo.
echo 如需关闭播放器，请在当前窗口按 Ctrl+C 并输入 Y 确认，窗口会自动清理后台进程。
echo.

node "%~dp0scripts\dev-all.mjs" --open

if %errorlevel% neq 0 (
    echo.
    echo [提示] 服务已停止。
    pause
)
