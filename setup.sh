#!/bin/bash
echo "===== WeChatSim 安装脚本 ====="

# 安装 Node.js (如果没有)
if ! command -v node &> /dev/null; then
    echo "安装 Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# 安装 PM2
if ! command -v pm2 &> /dev/null; then
    echo "安装 PM2..."
    sudo npm install -g pm2
fi

# 安装依赖
echo "安装项目依赖..."
npm install

# 创建上传目录
mkdir -p public/uploads

# 启动
echo "启动服务..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo ""
echo "===== 安装完成 ====="
echo "访问: http://你的域名:7000"
echo "PM2 管理: pm2 status / pm2 logs wechatsim / pm2 restart wechatsim"
