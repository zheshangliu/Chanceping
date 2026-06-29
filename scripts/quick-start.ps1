# ChancePing 盯机会 - Windows 一键启动脚本
# 用法：powershell -ExecutionPolicy Bypass -File scripts\quick-start.ps1
# 或在 PowerShell 中：.\scripts\quick-start.ps1

$ErrorActionPreference = "Stop"

Write-Host "ChancePing 盯机会 - 快速启动" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 切换到项目根目录（脚本所在目录的上一级）
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

# 检查 Node.js
$nodeVersion = (node -v 2>$null)
if (-not $nodeVersion) {
    Write-Host "未检测到 Node.js，请先安装 Node.js 22+" -ForegroundColor Red
    Write-Host "   下载地址：https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}
$major = [int]($nodeVersion -replace 'v(\d+).*', '$1')
if ($major -lt 22) {
    Write-Host "Node.js 版本过低（当前 $nodeVersion），需要 22+" -ForegroundColor Red
    Write-Host "   请升级 Node.js：https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}
Write-Host "Node.js $nodeVersion" -ForegroundColor Green

# 安装依赖
if (-not (Test-Path "node_modules")) {
    Write-Host "安装依赖..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "依赖安装失败" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "依赖已安装（node_modules 存在）" -ForegroundColor Green
}

# 复制环境变量
if (-not (Test-Path ".env")) {
    Write-Host "创建 .env 文件（Mock 模式，无需 API Key）..." -ForegroundColor Yellow
    Copy-Item .env.example .env
} else {
    Write-Host ".env 已存在" -ForegroundColor Green
}
Write-Host "环境变量已配置（Mock 模式）" -ForegroundColor Green

# 编译检查
Write-Host "编译检查..." -ForegroundColor Yellow
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
    Write-Host "编译失败，请检查 TypeScript 错误" -ForegroundColor Red
    exit 1
}
Write-Host "编译通过" -ForegroundColor Green

# 启动
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "启动 ChancePing..." -ForegroundColor Cyan
Write-Host "   浏览器打开: http://localhost:3000" -ForegroundColor White
Write-Host "   健康检查:   http://localhost:3000/health" -ForegroundColor White
Write-Host "   Web UI:     http://localhost:3000/" -ForegroundColor White
Write-Host "   按 Ctrl+C 停止" -ForegroundColor White
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 使用 npm run dev 启动（等价于 tsx src/api/server.ts）
npm run dev
