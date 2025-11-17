# Quick Start Deployment Guide

## 🚀 Fastest Way to Deploy

### Step 1: Test Server Connection

First, verify you can connect to your server. The credentials format might be:
- Username: `root` or `Atoz123456789`
- Password: `Asdacs`

Try connecting:
```bash
ssh root@157.245.218.84
# or
ssh Atoz123456789@157.245.218.84
```

### Step 2: Setup Server (Run on Server)

Once connected to the server, run:
```bash
# Copy and paste the server-setup.sh content, or upload it and run:
bash server-setup.sh
```

Or manually run these commands on the server:
```bash
# Update system
apt-get update && apt-get upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2
npm install -g pm2

# Install other dependencies
apt-get install -y git build-essential nginx

# Setup firewall
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 5000/tcp
echo "y" | ufw enable

# Create app directory
mkdir -p /var/www/atozemails-backend
```

### Step 3: Upload Your Code

**From your local machine** (in the project directory):

```bash
# Upload files (excluding node_modules, .env, logs)
rsync -av --exclude='node_modules' \
         --exclude='logs' \
         --exclude='.env' \
         --exclude='.git' \
         --exclude='deploy_temp' \
         ./ root@157.245.218.84:/var/www/atozemails-backend/
```

Or use SCP:
```bash
scp -r * root@157.245.218.84:/var/www/atozemails-backend/
```

### Step 4: Configure Environment (On Server)

SSH back into the server and create the `.env` file:

```bash
ssh root@157.245.218.84
cd /var/www/atozemails-backend
nano .env
```

Add your environment variables:
```env
PORT=5000
NODE_ENV=production

SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

STRIPE_SECRET_KEY=your_stripe_secret_key_here

NAMECHEAP_API_USER=atozadmin
NAMECHEAP_API_KEY=your_namecheap_api_key_here
NAMECHEAP_USER_NAME=atozadmin
NAMECHEAP_CLIENT_IP=your_client_ip_here
NAMECHEAP_SANDBOX=false

SLACK_TEST=false
```

Save: `Ctrl+X`, then `Y`, then `Enter`

### Step 5: Install Dependencies and Start (On Server)

```bash
cd /var/www/atozemails-backend

# Install dependencies
npm install --production

# Create logs directory
mkdir -p logs

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 config and setup auto-start
pm2 save
pm2 startup
# Follow the instructions it outputs
```

### Step 6: Verify It's Running

```bash
# Check status
pm2 status

# Check logs
pm2 logs atozemails-backend

# Test the API
curl http://localhost:5000/health
```

### Step 7: Setup Nginx Reverse Proxy (Optional but Recommended)

```bash
# Create Nginx config
nano /etc/nginx/sites-available/atozemails-backend
```

Paste this configuration:
```nginx
server {
    listen 80;
    server_name 157.245.218.84;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and restart:
```bash
ln -s /etc/nginx/sites-available/atozemails-backend /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

## ✅ You're Done!

Your API should now be accessible at:
- Direct: `http://157.245.218.84:5000`
- Via Nginx: `http://157.245.218.84`

## 📋 Useful Commands

```bash
# View logs
pm2 logs atozemails-backend

# Restart app
pm2 restart atozemails-backend

# Stop app
pm2 stop atozemails-backend

# View app info
pm2 info atozemails-backend

# Monitor resources
pm2 monit
```

## 🔧 Troubleshooting

**Can't connect?**
- Verify SSH credentials
- Check if SSH is enabled: `systemctl status ssh`

**App won't start?**
- Check logs: `pm2 logs atozemails-backend`
- Verify .env file exists and has correct values
- Check port: `netstat -tulpn | grep 5000`

**Need to update code?**
```bash
# Upload new files, then:
cd /var/www/atozemails-backend
npm install --production
pm2 restart atozemails-backend
```

For more details, see [DEPLOYMENT.md](./DEPLOYMENT.md)

