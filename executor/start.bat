@echo off
setlocal enabledelayedexpansion
title DevPlan Executor �� Autopilot

echo.
echo   ========================================================
echo     DevPlan Executor �� һ�������ű�
echo   ========================================================
echo.

:: ���� Ĭ�ϲ��������ڴ˴��޸ģ� ����
set PROJECT=ai_db
set DEVPLAN_PORT=3210
set POLL_INTERVAL=10
set UI_PORT=5000
set DEVPLAN_ROOT=D:\Project\git\aifastdb-devplan

:: ���� �����в������� ����
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--project" (set PROJECT=%~2& shift& shift& goto parse_args)
if /i "%~1"=="--port" (set DEVPLAN_PORT=%~2& shift& shift& goto parse_args)
if /i "%~1"=="--interval" (set POLL_INTERVAL=%~2& shift& shift& goto parse_args)
if /i "%~1"=="--ui-port" (set UI_PORT=%~2& shift& shift& goto parse_args)
shift
goto parse_args
:args_done

:: ���� �л��� executor Ŀ¼ ����
cd /d "%~dp0"
echo [1/6] ����Ŀ¼: %CD%

:: ���� �����ɽ��� ����
echo [2/6] ��鲢�����ɽ���...

:: ����ռ�� Executor UI �˿ڵ����оɽ���
set NEED_WAIT=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:":%UI_PORT% "') do (
    echo       ������ Executor ���� ^(PID: %%a^)...
    taskkill /pid %%a /f >nul 2>&1
    set NEED_WAIT=1
)
:: ����������Flask debug ģʽ���ܲ����ӽ��̣��˿ڿ��ܱ��� PID ռ��
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:":%UI_PORT% "') do (
    echo       ������������ ^(PID: %%a^)...
    taskkill /pid %%a /f >nul 2>&1
    set NEED_WAIT=1
)
if "!NEED_WAIT!"=="1" (
    echo       �ȴ��˿��ͷ�...
    timeout /t 2 /nobreak >nul
    echo       �ɽ���������
) else (
    echo       �޾ɽ�����Ҫ����
)

:: ���� ��� Python ����
python --version >nul 2>&1
if errorlevel 1 (
    echo [����] δ�ҵ� Python�����Ȱ�װ Python 3.10+
    pause
    exit /b 1
)
echo [3/6] Python �Ѿ���

:: ���� ������� ����
python -c "import pyautogui, pyperclip, ollama, httpx, pydantic_settings, flask, numpy, PIL" >nul 2>&1
if errorlevel 1 (
    echo [3/6] ����ȱʧ�����ڰ�װ...
    pip install -e . --quiet
    if errorlevel 1 (
        echo [����] ������װʧ��
        pause
        exit /b 1
    )
    echo [3/6] ������װ���
) else (
    echo [3/6] �����Ѿ���
)

:: ���� ��� Node.js ����
node --version >nul 2>&1
if errorlevel 1 (
    echo [����] δ�ҵ� Node.js��DevPlan ���ӻ�������Ҫ Node.js
    pause
    exit /b 1
)
echo [4/6] Node.js �Ѿ���

:: ���� ���� DevPlan ���ӻ����� ����
echo [5/6] ���� DevPlan ���ӻ����� (�˿�: %DEVPLAN_PORT%)...

:: �ȼ��˿��Ƿ��ѱ�ռ�ã���������������У�
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%DEVPLAN_PORT%/api/progress?project=%PROJECT%' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    echo [5/6] DevPlan ���ӻ������������У���������
    goto start_executor
)

:: ���´��������� DevPlan ���ӻ�����
start "DevPlan Visualize Server" /min cmd /c "cd /d %DEVPLAN_ROOT% && node dist/visualize/server.js --project %PROJECT% --port %DEVPLAN_PORT%"

:: �ȴ�������������� 15 �룩
echo       �ȴ��������...
set /a WAIT_COUNT=0
:wait_loop
if %WAIT_COUNT% geq 15 (
    echo [����] DevPlan ���� 15 ����δ�������������� Executor...
    goto start_executor
)
timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%DEVPLAN_PORT%/api/progress?project=%PROJECT%' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    echo [5/6] DevPlan ���ӻ������Ѿ��� (http://127.0.0.1:%DEVPLAN_PORT%)
    goto start_executor
)
echo       �ȴ���... (%WAIT_COUNT%/15)
goto wait_loop

:start_executor
:: ���� ���� Executor ����
echo [6/6] ���� Executor...
echo.
echo       ��Ŀ:         %PROJECT%
echo       DevPlan:      http://127.0.0.1:%DEVPLAN_PORT%
echo       ��ѯ���:     %POLL_INTERVAL%s
echo       Web UI:       http://127.0.0.1:%UI_PORT%
echo       �� Ctrl+C ֹͣ
echo.

chcp 65001 >nul 2>&1
python -m src.main --project %PROJECT% --port %DEVPLAN_PORT% --interval %POLL_INTERVAL% --ui-port %UI_PORT%
chcp 936 >nul 2>&1

:: ���� Executor ֹͣ������ ����
echo.
echo Executor ��ֹͣ�����ڹر� DevPlan ���ӻ�����...

:: �ر� DevPlan ���ӻ����񴰿�
taskkill /fi "WINDOWTITLE eq DevPlan Visualize Server" /f >nul 2>&1

echo ȫ��������ֹͣ
pause
