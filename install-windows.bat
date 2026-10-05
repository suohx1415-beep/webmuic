@echo off
chcp 65001 >nul
title Webmuic - Windows 依赖安装向导

echo ========================================================
echo         Webmuic Windows 一键环境安装向导
echo ========================================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js！
    echo 请先前往 https://nodejs.org/ 下载并安装 Node.js (推荐 LTS 20.x 或更高版本)。
    echo 安装完成后请重新打开此脚本。
    echo.
    pause
    exit /b 1
)

:: 检查 npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 npm！
    echo 请检查 Node.js 安装是否完整。
    echo.
    pause
    exit /b 1
)

echo [1/3] 环境检查通过：
node -v
npm -v
echo.

echo [2/3] 正在启动安装脚本（无需全局安装 pnpm，自动通过 npx 支持）...
echo.

node scripts/install-all.mjs

if %errorlevel% neq 0 (
    echo.
    echo [错误] 安装过程中遇到异常，请检查上方日志。
    pause
    exit /b 1
)

echo.
echo ========================================================
echo  安装完成！现在你可以直接双击 start-windows.bat 启动播放器！
echo ========================================================
echo.
pause
