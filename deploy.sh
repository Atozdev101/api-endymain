#!/bin/bash

# Deployment script for AtoZ Emails Backend
# Usage: ./deploy.sh

set -e

echo "🚀 Starting deployment process..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Server details
SERVER_IP="157.245.218.84"
SERVER_USER="root"  # Adjust if different
APP_DIR="/var/www/atozemails-backend"

echo -e "${YELLOW}📦 Preparing deployment package...${NC}"

# Create deployment directory
mkdir -p deploy_temp
cd deploy_temp

# Copy project files (excluding node_modules, logs, .env)
rsync -av --exclude='node_modules' \
         --exclude='logs' \
         --exclude='.env' \
         --exclude='.git' \
         --exclude='deploy_temp' \
         --exclude='.DS_Store' \
         ../ ./app/

echo -e "${GREEN}✅ Files prepared${NC}"

echo -e "${YELLOW}📤 Uploading files to server...${NC}"

# Upload to server
scp -r app/* ${SERVER_USER}@${SERVER_IP}:${APP_DIR}/

echo -e "${GREEN}✅ Files uploaded${NC}"

echo -e "${YELLOW}🔧 Running setup on server...${NC}"

# SSH into server and run setup
ssh ${SERVER_USER}@${SERVER_IP} << 'ENDSSH'
cd /var/www/atozemails-backend

# Install Node.js if not installed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Install PM2 if not installed
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Create logs directory if it doesn't exist
mkdir -p logs

# Setup PM2
echo "Setting up PM2..."
pm2 delete atozemails-backend 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo "✅ Deployment complete!"
ENDSSH

# Cleanup
cd ..
rm -rf deploy_temp

echo -e "${GREEN}🎉 Deployment finished!${NC}"
echo -e "${YELLOW}⚠️  Don't forget to:${NC}"
echo -e "   1. SSH into the server and create .env file with your credentials"
echo -e "   2. Restart the app: pm2 restart atozemails-backend"
echo -e "   3. Check logs: pm2 logs atozemails-backend"

