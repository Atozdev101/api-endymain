# Domain Setup Guide: api.endyinboxes.com

This guide will help you configure your domain `endyinboxes.com` to point to your API server and set up SSL.

## Prerequisites

- Domain: `endyinboxes.com` (you already have this)
- Server IP: `157.245.218.84`
- Backend running on port 5000

## Step-by-Step Setup

### Step 1: Configure DNS Records

You need to add an A record for the subdomain `api.endyinboxes.com` pointing to your server IP.

**Where to configure:**
- Go to your domain registrar (where you bought `endyinboxes.com`)
- Find DNS management / DNS settings
- Add a new A record:

```
Type: A
Name: api
Value: 157.245.218.84
TTL: 3600 (or default)
```

**Common DNS providers:**
- **Namecheap**: Domain List → Manage → Advanced DNS → Add A Record
- **GoDaddy**: DNS Management → Add Record
- **Cloudflare**: DNS → Add Record
- **Google Domains**: DNS → Custom Records

**Note:** DNS propagation can take 5 minutes to 48 hours, but usually takes 10-30 minutes.

### Step 2: Verify DNS Propagation

Wait a few minutes, then verify DNS is working:

```bash
# From your local machine
nslookup api.endyinboxes.com
# or
dig api.endyinboxes.com

# Should return: 157.245.218.84
```

Or use online tools:
- https://dnschecker.org
- https://www.whatsmydns.net

### Step 3: Upload Nginx Configuration to Server

**From your local machine:**

```bash
cd /Users/mars/Codes/api-endymain
scp nginx-api.conf root@157.245.218.84:/tmp/
```

### Step 4: Configure Nginx on Server

**SSH into your server:**

```bash
ssh root@157.245.218.84
```

**Install Nginx (if not already installed):**

```bash
apt-get update
apt-get install -y nginx
```

**Copy the configuration:**

```bash
cp /tmp/nginx-api.conf /etc/nginx/sites-available/api.endyinboxes.com
ln -s /etc/nginx/sites-available/api.endyinboxes.com /etc/nginx/sites-enabled/
```

**Remove default Nginx site (optional):**

```bash
rm /etc/nginx/sites-enabled/default
```

**Test Nginx configuration:**

```bash
nginx -t
```

**If test passes, restart Nginx:**

```bash
systemctl restart nginx
systemctl enable nginx
```

### Step 5: Configure Firewall

Make sure ports 80 and 443 are open:

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw status
```

### Step 6: Test HTTP Connection

Wait for DNS to propagate (check with `nslookup api.endyinboxes.com`), then test:

```bash
# From your local machine
curl http://api.endyinboxes.com/health

# Should return: {"status":"OK","timestamp":...}
```

### Step 7: Install SSL Certificate (HTTPS)

**Install Certbot:**

```bash
# On server
apt-get update
apt-get install -y certbot python3-certbot-nginx
```

**Get SSL certificate:**

```bash
certbot --nginx -d api.endyinboxes.com
```

**Follow the prompts:**
- Enter your email address
- Agree to terms
- Choose whether to redirect HTTP to HTTPS (recommended: Yes)

**Certbot will automatically:**
- Get the SSL certificate
- Update your Nginx configuration
- Set up auto-renewal

**Test auto-renewal:**

```bash
certbot renew --dry-run
```

### Step 8: Update Nginx Config for HTTPS (Manual Alternative)

If you prefer to manually configure HTTPS, edit the config:

```bash
nano /etc/nginx/sites-available/api.endyinboxes.com
```

Uncomment the HTTPS server block and update SSL paths. Then:

```bash
nginx -t
systemctl reload nginx
```

### Step 9: Update Backend CORS (Optional but Recommended)

Update your backend to allow the new domain. SSH into server:

```bash
cd /var/www/atozemails-backend
nano index.js
```

Update CORS to include your domain:

```javascript
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://endy-main.vercel.app',
    'https://api.endyinboxes.com',
    'http://api.endyinboxes.com', // For development
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true
}));
```

Restart the backend:

```bash
pm2 restart atozemails-backend
```

### Step 10: Update Frontend Environment Variables

**For Local Development (.env.local):**

```env
REACT_APP_API_URL=https://api.endyinboxes.com
```

**For Vercel:**

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Update `REACT_APP_API_URL` (or `NEXT_PUBLIC_API_URL`) to:
   ```
   https://api.endyinboxes.com
   ```
3. Redeploy your Vercel app

## Verification Checklist

- [ ] DNS A record added for `api.endyinboxes.com`
- [ ] DNS propagation verified (`nslookup api.endyinboxes.com`)
- [ ] Nginx configuration installed and tested
- [ ] Nginx restarted successfully
- [ ] HTTP works: `curl http://api.endyinboxes.com/health`
- [ ] SSL certificate installed (HTTPS)
- [ ] HTTPS works: `curl https://api.endyinboxes.com/health`
- [ ] Backend CORS updated (if needed)
- [ ] Frontend environment variables updated
- [ ] Frontend tested with new API URL

## Troubleshooting

### DNS Not Resolving

- Wait longer (can take up to 48 hours)
- Check DNS record is correct
- Clear DNS cache: `sudo dscacheutil -flushcache` (Mac) or `ipconfig /flushdns` (Windows)

### Nginx 502 Bad Gateway

- Check backend is running: `pm2 status`
- Check backend logs: `pm2 logs atozemails-backend`
- Verify backend is listening on port 5000: `netstat -tulpn | grep 5000`

### SSL Certificate Issues

- Make sure DNS is fully propagated before requesting certificate
- Check firewall allows port 80 (needed for Let's Encrypt verification)
- Verify domain is accessible: `curl http://api.endyinboxes.com`

### CORS Errors

- Update backend CORS to include `https://api.endyinboxes.com`
- Check browser console for exact error
- Verify credentials are being sent correctly

## Useful Commands

```bash
# Check Nginx status
systemctl status nginx

# View Nginx logs
tail -f /var/log/nginx/error.log
tail -f /var/log/nginx/access.log

# Test Nginx config
nginx -t

# Reload Nginx
systemctl reload nginx

# Check SSL certificate expiry
certbot certificates

# Renew SSL certificate manually
certbot renew

# Check backend status
pm2 status
pm2 logs atozemails-backend
```

## Next Steps

After setup is complete:
1. Update your frontend to use `https://api.endyinboxes.com`
2. Test all API endpoints
3. Monitor logs for any issues
4. Set up monitoring/alerting (optional)

