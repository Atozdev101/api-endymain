# Deployment Guide for AtoZ Emails Backend

This guide will help you deploy the backend API to your server at `157.245.218.84`.

## Prerequisites

- SSH access to the server
- Server credentials (provided)
- Your environment variables (Supabase, Stripe, etc.)

## Server Information

- **IP Address**: 157.245.218.84
- **Credentials**: Atoz123456789@Asdacs
- **Note**: The credentials format suggests `username@password` or `username:password`. You'll need to determine the correct format.

## Step-by-Step Deployment

### Option 1: Automated Deployment (Recommended)

1. **Make the deployment script executable**:
   ```bash
   chmod +x deploy.sh
   ```

2. **Run the deployment script**:
   ```bash
   ./deploy.sh
   ```

   **Note**: You may need to modify the `SERVER_USER` variable in `deploy.sh` if your username is different from `root`.

### Option 2: Manual Deployment

#### Step 1: Connect to Your Server

```bash
ssh root@157.245.218.84
# Enter password when prompted: Asdacs
```

If the credentials format is different, try:
```bash
ssh Atoz123456789@157.245.218.84
# Password: Asdacs
```

#### Step 2: Update System and Install Dependencies

```bash
# Update package list
apt-get update

# Install Node.js (v20.x)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2 (Process Manager)
npm install -g pm2

# Install Git (if not already installed)
apt-get install -y git

# Install build essentials (for native modules)
apt-get install -y build-essential
```

#### Step 3: Create Application Directory

```bash
mkdir -p /var/www/atozemails-backend
cd /var/www/atozemails-backend
```

#### Step 4: Upload Your Code

**From your local machine**, use one of these methods:

**Method A: Using SCP (from project root)**
```bash
scp -r * root@157.245.218.84:/var/www/atozemails-backend/
```

**Method B: Using Git (if you have a repository)**
```bash
# On server
cd /var/www/atozemails-backend
git clone <your-repo-url> .
```

**Method C: Using rsync (recommended)**
```bash
rsync -av --exclude='node_modules' \
         --exclude='logs' \
         --exclude='.env' \
         --exclude='.git' \
         ./ root@157.245.218.84:/var/www/atozemails-backend/
```

#### Step 5: Install Dependencies

```bash
# On server
cd /var/www/atozemails-backend
npm install --production
```

#### Step 6: Create Environment File

```bash
# On server
cd /var/www/atozemails-backend
nano .env
```

Add your environment variables (use `.env.example` as a template):
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

Save and exit (Ctrl+X, then Y, then Enter).

#### Step 7: Create Logs Directory

```bash
mkdir -p /var/www/atozemails-backend/logs
```

#### Step 8: Start Application with PM2

```bash
cd /var/www/atozemails-backend

# Start the application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the instructions it outputs
```

#### Step 9: Configure Firewall

```bash
# Allow HTTP traffic
ufw allow 80/tcp

# Allow HTTPS traffic
ufw allow 443/tcp

# Allow your application port (if not using reverse proxy)
ufw allow 5000/tcp

# Enable firewall
ufw enable
```

#### Step 10: Setup Reverse Proxy (Optional but Recommended)

Install Nginx:
```bash
apt-get install -y nginx
```

Create Nginx configuration:
```bash
nano /etc/nginx/sites-available/atozemails-backend
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name 157.245.218.84;  # Or your domain name

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

Enable the site:
```bash
ln -s /etc/nginx/sites-available/atozemails-backend /etc/nginx/sites-enabled/
nginx -t  # Test configuration
systemctl restart nginx
```

## Useful Commands

### PM2 Commands
```bash
# View application status
pm2 status

# View logs
pm2 logs atozemails-backend

# Restart application
pm2 restart atozemails-backend

# Stop application
pm2 stop atozemails-backend

# View application info
pm2 info atozemails-backend

# Monitor resources
pm2 monit
```

### Application Health Check
```bash
# Test if the API is running
curl http://localhost:5000/health

# Or from outside (if firewall allows)
curl http://157.245.218.84:5000/health
```

## Troubleshooting

### Application won't start
1. Check PM2 logs: `pm2 logs atozemails-backend`
2. Check if port 5000 is in use: `netstat -tulpn | grep 5000`
3. Verify .env file exists and has correct values
4. Check Node.js version: `node -v` (should be v18+)

### Can't connect to server
1. Verify SSH credentials
2. Check if SSH is enabled: `systemctl status ssh`
3. Verify firewall allows SSH: `ufw status`

### Application crashes
1. Check logs in `/var/www/atozemails-backend/logs/`
2. Check PM2 logs: `pm2 logs atozemails-backend`
3. Verify all environment variables are set correctly

## Security Recommendations

1. **Change default SSH port** (optional but recommended)
2. **Use SSH keys instead of passwords**
3. **Keep system updated**: `apt-get update && apt-get upgrade`
4. **Use HTTPS** with Let's Encrypt SSL certificate
5. **Restrict firewall** to only necessary ports
6. **Regular backups** of your application and database

## SSL Certificate Setup (Optional)

To enable HTTPS with Let's Encrypt:

```bash
# Install Certbot
apt-get install -y certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d your-domain.com

# Auto-renewal is set up automatically
```

## Updating the Application

When you need to update the code:

```bash
# On server
cd /var/www/atozemails-backend

# Pull latest changes (if using Git)
git pull

# Or upload new files via SCP/rsync

# Install new dependencies (if any)
npm install --production

# Restart application
pm2 restart atozemails-backend
```

## Monitoring

Consider setting up:
- **PM2 Plus** for monitoring (free tier available)
- **Uptime monitoring** (UptimeRobot, Pingdom, etc.)
- **Error tracking** (Sentry, Rollbar, etc.)

## Support

If you encounter issues:
1. Check the logs first
2. Verify all environment variables
3. Ensure all dependencies are installed
4. Check server resources: `htop` or `free -h`

