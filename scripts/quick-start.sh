#!/usr/bin/env bash
# ChancePing 盯机会 - Linux/Mac 一键启动脚本
# 用法：bash scripts/quick-start.sh
set -e

echo "🚀 ChancePing 盯机会 - 快速启动"
echo "================================"

# 切换到项目根目录（脚本所在目录的上一级）
cd "$(dirname "$0")/.."

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "❌ 未检测到 Node.js，请先安装 Node.js 22+"
  echo "   下载地址：https://nodejs.org/"
  exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "❌ Node.js 版本过低（当前 $(node -v)），需要 22+"
  echo "   请升级 Node.js：https://nodejs.org/"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# 安装依赖
if [ ! -d "node_modules" ]; then
  echo "📦 安装依赖..."
  npm install
else
  echo "✅ 依赖已安装（node_modules 存在）"
fi

# 复制环境变量
if [ ! -f ".env" ]; then
  echo "📝 创建 .env 文件（Mock 模式，无需 API Key）..."
  cp .env.example .env
else
  echo "✅ .env 已存在"
fi
echo "✅ 环境变量已配置（Mock 模式）"

# 编译检查
echo "🔍 编译检查..."
npx tsc --noEmit
echo "✅ 编译通过"

# 启动
echo ""
echo "================================"
echo "🌐 启动 ChancePing..."
echo "   浏览器打开: http://localhost:3000"
echo "   健康检查:   http://localhost:3000/health"
echo "   Web UI:     http://localhost:3000/"
echo "   按 Ctrl+C 停止"
echo "================================"
echo ""

# 使用 npm run dev 启动（等价于 tsx src/api/server.ts）
npm run dev
