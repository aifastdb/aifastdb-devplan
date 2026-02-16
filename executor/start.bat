@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title DevPlan Executor — Autopilot

echo.
echo   ========================================================
echo     DevPlan Executor — 一键启动脚本
echo   ========================================================
echo.

:: ── 默认参数（可在此处修改） ──
set PROJECT=ai_db
set DEVPLAN_PORT=3210
set POLL_INTERVAL=15
set UI_PORT=5000
set DEVPLAN_ROOT=D:\Project\git\aifastdb-devplan

:: ── 命令行参数覆盖 ──
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--project" (set PROJECT=%~2& shift& shift& goto parse_args)
if /i "%~1"=="--port" (set DEVPLAN_PORT=%~2& shift& shift& goto parse_args)
if /i "%~1"=="--interval" (set POLL_INTERVAL=%~2& shift& shift& goto parse_args)
if /i "%~1"=="--ui-port" (set UI_PORT=%~2& shift& shift& goto parse_args)
shift
goto parse_args
:args_done

:: ── 切换到 executor 目录 ──
cd /d "%~dp0"
echo [1/6] 工作目录: %CD%

:: ── 清理旧进程 ──
echo [2/6] 检查并清理旧进程...

:: 清理占用 Executor UI 端口的所有旧进程
set NEED_WAIT=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:":%UI_PORT% "') do (
    echo       清理旧 Executor 进程 ^(PID: %%a^)...
    taskkill /pid %%a /f >nul 2>&1
    set NEED_WAIT=1
)
:: 二次清理：Flask debug 模式可能产生子进程，端口可能被新 PID 占用
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:":%UI_PORT% "') do (
    echo       清理残留进程 ^(PID: %%a^)...
    taskkill /pid %%a /f >nul 2>&1
    set NEED_WAIT=1
)
if "!NEED_WAIT!"=="1" (
    echo       等待端口释放...
    timeout /t 2 /nobreak >nul
    echo       旧进程已清理
) else (
    echo       无旧进程需要清理
)

:: ── 检查 Python ──
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.10+
    pause
    exit /b 1
)
echo [3/6] Python 已就绪

:: ── 检查依赖 ──
python -c "import pyautogui, pyperclip, ollama, httpx, pydantic_settings, flask, numpy, PIL" >nul 2>&1
if errorlevel 1 (
    echo [3/6] 依赖缺失，正在安装...
    pip install -e . --quiet
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo [3/6] 依赖安装完成
) else (
    echo [3/6] 依赖已就绪
)

:: ── 检查 Node.js ──
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，DevPlan 可视化服务需要 Node.js
    pause
    exit /b 1
)
echo [4/6] Node.js 已就绪

:: ── 启动 DevPlan 可视化服务 ──
echo [5/6] 启动 DevPlan 可视化服务 (端口: %DEVPLAN_PORT%)...

:: 先检查端口是否已被占用（服务可能已在运行）
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%DEVPLAN_PORT%/api/progress?project=%PROJECT%' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    echo [5/6] DevPlan 可视化服务已在运行，跳过启动
    goto start_executor
)

:: 在新窗口中启动 DevPlan 可视化服务
start "DevPlan Visualize Server" /min cmd /c "cd /d %DEVPLAN_ROOT% && node dist/visualize/server.js --project %PROJECT% --port %DEVPLAN_PORT%"

:: 等待服务就绪（最多等 15 秒）
echo       等待服务就绪...
set /a WAIT_COUNT=0
:wait_loop
if %WAIT_COUNT% geq 15 (
    echo [警告] DevPlan 服务 15 秒内未就绪，继续启动 Executor...
    goto start_executor
)
timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%DEVPLAN_PORT%/api/progress?project=%PROJECT%' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    echo [5/6] DevPlan 可视化服务已就绪 (http://127.0.0.1:%DEVPLAN_PORT%)
    goto start_executor
)
echo       等待中... (%WAIT_COUNT%/15)
goto wait_loop

:start_executor
:: ── 启动 Executor ──
echo [6/6] 启动 Executor...
echo.
echo       项目:         %PROJECT%
echo       DevPlan:      http://127.0.0.1:%DEVPLAN_PORT%
echo       轮询间隔:     %POLL_INTERVAL%s
echo       Web UI:       http://127.0.0.1:%UI_PORT%
echo       按 Ctrl+C 停止
echo.

python -m src.main --project %PROJECT% --port %DEVPLAN_PORT% --interval %POLL_INTERVAL% --ui-port %UI_PORT%

:: ── Executor 停止后清理 ──
echo.
echo Executor 已停止，正在关闭 DevPlan 可视化服务...

:: 关闭 DevPlan 可视化服务窗口
taskkill /fi "WINDOWTITLE eq DevPlan Visualize Server" /f >nul 2>&1

echo 全部服务已停止
pause
