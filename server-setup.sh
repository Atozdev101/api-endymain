#!/bin/bash

# Server setup script - Run this ON THE SERVER after initial SSH connection
# Usage: Run this script on the server: bash server-setup.sh

set -e

echo "🔧 Setting up server for AtoZ Emails Backend..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Update system
echo -e "${YELLOW}📦 Updating system packages...${NC}"
apt-get update
apt-get upgrade -y

# Install Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo -e "${GREEN}✅ Node.js installed: $(node -v)${NC}"
else
    echo -e "${GREEN}✅ Node.js already installed: $(node -v)${NC}"
fi

# Install PM2
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}📦 Installing PM2...${NC}"
    npm install -g pm2
    echo -e "${GREEN}✅ PM2 installed${NC}"
else
    echo -e "${GREEN}✅ PM2 already installed${NC}"
fi

# Install Git
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Git...${NC}"
    apt-get install -y git
    echo -e "${GREEN}✅ Git installed${NC}"
else
    echo -e "${GREEN}✅ Git already installed${NC}"
fi

# Install build essentials
echo -e "${YELLOW}📦 Installing build essentials...${NC}"
apt-get install -y build-essential

# Install Nginx (optional, for reverse proxy)
if ! command -v nginx &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Nginx...${NC}"
    apt-get install -y nginx
    systemctl enable nginx
    echo -e "${GREEN}✅ Nginx installed${NC}"
else
    echo -e "${GREEN}✅ Nginx already installed${NC}"
fi

# Setup firewall
echo -e "${YELLOW}🔥 Configuring firewall...${NC}"
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 5000/tcp  # App port
echo "y" | ufw enable

# Create application directory
APP_DIR="/var/www/atozemails-backend"
if [ ! -d "$APP_DIR" ]; then
    echo -e "${YELLOW}📁 Creating application directory...${NC}"
    mkdir -p $APP_DIR
    chown -R $USER:$USER $APP_DIR
    echo -e "${GREEN}✅ Directory created: $APP_DIR${NC}"
else
    echo -e "${GREEN}✅ Directory already exists: $APP_DIR${NC}"
fi

echo -e "${GREEN}🎉 Server setup complete!${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Upload your application files to $APP_DIR"
echo "  2. Create .env file with your configuration"
echo "  3. Run: cd $APP_DIR && npm install --production"
echo "  4. Run: pm2 start ecosystem.config.js"
echo "  5. Run: pm2 save && pm2 startup"

