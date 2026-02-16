# -*- coding: utf-8 -*-
# DevPlan Executor — 一键启动脚本 (PowerShell)
#
# 自动启动依赖服务 + Executor，停止时自动清理
#
# 用法:
#   .\start.ps1                                    # 默认参数
#   .\start.ps1 -Project ai_db                     # 指定项目
#   .\start.ps1 -Project ai_db -Port 3210          # 指定端口
#   .\start.ps1 -FallbackTimeout 120               # 兜底超时 2 分钟
#   .\start.ps1 -NoUI                              # 不启动 Web UI

param(
    [string]$Project = "ai_db",
    [int]$Port = 3210,
    [int]$Interval = 15,
    [string]$Model = "gemma3:27b",
    [int]$UIPort = 5000,
    [int]$FallbackTimeout = 180,
    [switch]$NoUI,
    [switch]$NoSplit,
    [string]$LogLevel = "INFO",
    [string]$DevPlanRoot = "D:\Project\git\aifastdb-devplan"
)

$Host.UI.RawUI.WindowTitle = "DevPlan Executor — Autopilot"

Write-Host ""
Write-Host "  ========================================================" -ForegroundColor Cyan
Write-Host "    DevPlan Executor — 一键启动脚本" -ForegroundColor Cyan
Write-Host "  ========================================================" -ForegroundColor Cyan
Write-Host ""

# ── 切换到 executor 目录 ──
Set-Location $PSScriptRoot
Write-Host "[1/6] 工作目录: $PWD" -ForegroundColor Green

# ── 清理旧进程 ──
Write-Host "[2/6] 检查并清理旧进程..." -ForegroundColor Green
$oldPids = (netstat -ano | Select-String "LISTENING" | Select-String ":$UIPort ") -replace '.*\s+(\d+)$', '$1' | Sort-Object -Unique
if ($oldPids) {
    foreach ($pid in $oldPids) {
        $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($p) {
            Write-Host "       清理旧进程: PID=$pid ($($p.ProcessName))" -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 2
    Write-Host "       旧进程已清理" -ForegroundColor Green
} else {
    Write-Host "       无旧进程需要清理" -ForegroundColor Green
}

# ── 检查 Python ──
try {
    $pyVer = python --version 2>&1
    Write-Host "[3/6] $pyVer" -ForegroundColor Green
} catch {
    Write-Host "[错误] 未找到 Python，请先安装 Python 3.10+" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

# ── 检查依赖 ──
$depCheck = python -c "import pyautogui, pyperclip, ollama, httpx, pydantic_settings, flask, numpy, PIL" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[3/6] 依赖缺失，正在安装..." -ForegroundColor Yellow
    pip install -e . --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 依赖安装失败" -ForegroundColor Red
        Read-Host "按回车退出"
        exit 1
    }
    Write-Host "[3/6] 依赖安装完成" -ForegroundColor Green
} else {
    Write-Host "[3/6] 依赖已就绪" -ForegroundColor Green
}

# ── 检查 Node.js ──
try {
    $nodeVer = node --version 2>&1
    Write-Host "[4/6] Node.js $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "[错误] 未找到 Node.js，DevPlan 可视化服务需要 Node.js" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

# ── 启动 DevPlan 可视化服务 ──
Write-Host "[5/6] 启动 DevPlan 可视化服务 (端口: $Port)..." -ForegroundColor Green

$devplanProcess = $null
$devplanAlreadyRunning = $false

# 检查服务是否已在运行
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:${Port}/api/progress?project=$Project" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    Write-Host "[5/6] DevPlan 可视化服务已在运行，跳过启动" -ForegroundColor Green
    $devplanAlreadyRunning = $true
} catch {
    # 服务未运行，启动它
    $serverJs = Join-Path $DevPlanRoot "dist\visualize\server.js"
    if (-not (Test-Path $serverJs)) {
        Write-Host "[错误] 未找到 $serverJs" -ForegroundColor Red
        Write-Host "       请先在 $DevPlanRoot 目录下运行 npm run build" -ForegroundColor Yellow
        Read-Host "按回车退出"
        exit 1
    }

    $devplanProcess = Start-Process -FilePath "node" `
        -ArgumentList "`"$serverJs`" --project $Project --port $Port" `
        -WorkingDirectory $DevPlanRoot `
        -WindowStyle Minimized `
        -PassThru

    # 等待服务就绪（最多 15 秒）
    Write-Host "       等待服务就绪..." -ForegroundColor DarkGray
    $ready = $false
    for ($i = 1; $i -le 15; $i++) {
        Start-Sleep -Seconds 1
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:${Port}/api/progress?project=$Project" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            $ready = $true
            break
        } catch {
            Write-Host "       等待中... ($i/15)" -ForegroundColor DarkGray
        }
    }

    if ($ready) {
        Write-Host "[5/6] DevPlan 可视化服务已就绪 (http://127.0.0.1:$Port)" -ForegroundColor Green
    } else {
        Write-Host "[警告] DevPlan 服务 15 秒内未就绪，继续启动 Executor..." -ForegroundColor Yellow
    }
}

# ── 构建启动参数 ──
$execArgs = @(
    "-m", "src.main",
    "--project", $Project,
    "--port", $Port,
    "--interval", $Interval,
    "--model", $Model,
    "--ui-port", $UIPort,
    "--log-level", $LogLevel
)

if ($NoUI) { $execArgs += "--no-ui" }
if ($NoSplit) { $execArgs += "--no-split" }

# 设置兜底超时环境变量
$env:EXECUTOR_FALLBACK_NO_CHANGE_TIMEOUT = $FallbackTimeout

# ── 显示启动参数 ──
Write-Host ""
Write-Host "[6/6] 启动 Executor..." -ForegroundColor Green
Write-Host ""
Write-Host "       项目:         $Project" -ForegroundColor White
Write-Host "       DevPlan:      http://127.0.0.1:$Port" -ForegroundColor White
Write-Host "       轮询间隔:     ${Interval}s" -ForegroundColor White
Write-Host "       视觉模型:     $Model" -ForegroundColor White
Write-Host "       兜底超时:     ${FallbackTimeout}s" -ForegroundColor White
Write-Host "       Web UI:       $(if ($NoUI) { '禁用' } else { "http://127.0.0.1:$UIPort" })" -ForegroundColor White
Write-Host ""
Write-Host "       按 Ctrl+C 停止" -ForegroundColor DarkGray
Write-Host ""

# ── 启动 Executor ──
try {
    python @execArgs
} finally {
    # ── 清理：停止 DevPlan 可视化服务 ──
    Write-Host ""
    if ($devplanProcess -and -not $devplanAlreadyRunning) {
        Write-Host "正在关闭 DevPlan 可视化服务 (PID: $($devplanProcess.Id))..." -ForegroundColor Yellow
        try {
            Stop-Process -Id $devplanProcess.Id -Force -ErrorAction SilentlyContinue
            Write-Host "DevPlan 可视化服务已关闭" -ForegroundColor Green
        } catch {
            Write-Host "DevPlan 服务已自行退出" -ForegroundColor DarkGray
        }
    }
    Write-Host "全部服务已停止" -ForegroundColor Yellow
    Read-Host "按回车退出"
}
