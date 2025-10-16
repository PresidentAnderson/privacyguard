# PrivacyGuard Deployment Guide

## 🚀 Production Deployment

### Prerequisites

#### System Requirements
- **OS**: Ubuntu 20.04 LTS or later
- **Node.js**: v18.0.0 or later
- **MongoDB**: v5.0 or later
- **Memory**: 4GB minimum, 8GB recommended
- **Storage**: 50GB minimum for archives
- **Network**: HTTPS certificate for production

#### Dependencies
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install MongoDB
wget -qO - https://www.mongodb.org/static/pgp/server-5.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/5.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-5.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# Install Chrome for Puppeteer
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt-get update
sudo apt-get install -y google-chrome-stable

# Install PM2 for process management
sudo npm install -g pm2
```

### Application Deployment

#### 1. Clone and Setup
```bash
# Clone repository
git clone https://github.com/privacyguard/privacyguard.git
cd privacyguard

# Install dependencies
npm install

# Create required directories
npm run setup
```

#### 2. Environment Configuration
```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env
```

**Required Environment Variables:**
```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb://localhost:27017/privacyguard

# Security
JWT_SECRET=your_secure_jwt_secret_key_here
ENCRYPTION_KEY=your_32_character_encryption_key_here

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@domain.com
SMTP_PASS=your_app_password

# Cloud Storage (choose one)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_S3_BUCKET=privacyguard-archives

# API Keys
STRIPE_SECRET_KEY=sk_live_your_stripe_key
HAVEIBEENPWNED_API_KEY=your_hibp_api_key

# Legal Compliance
DPA_CONTACT_EMAIL=dpa@yourcompany.com
LEGAL_COMPANY_NAME=Your Company Name
LEGAL_ADDRESS=Your Company Address
```

#### 3. Database Setup
```bash
# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod

# Run migrations (if any)
npm run migrate

# Seed initial data (optional)
npm run seed
```

#### 4. SSL Certificate Setup
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

#### 5. Nginx Configuration
```bash
# Install Nginx
sudo apt install nginx

# Create Nginx configuration
sudo nano /etc/nginx/sites-available/privacyguard
```

**Nginx Configuration:**
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/auth/login {
        limit_req zone=login burst=5 nodelay;
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static files (if serving static content)
    location /static/ {
        alias /path/to/privacyguard/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/privacyguard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 6. PM2 Process Management
```bash
# Create PM2 ecosystem file
nano ecosystem.config.js
```

**PM2 Configuration:**
```javascript
module.exports = {
  apps: [{
    name: 'privacyguard',
    script: 'src/app.js',
    cwd: '/path/to/privacyguard',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=4096'
  }]
};
```

```bash
# Start application with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
# Follow the instructions provided by the command above
```

### 🔒 Security Hardening

#### Firewall Configuration
```bash
# Setup UFW firewall
sudo ufw enable
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw allow 27017/tcp  # MongoDB (if external access needed)
```

#### MongoDB Security
```bash
# Edit MongoDB configuration
sudo nano /etc/mongod.conf
```

```yaml
# mongod.conf
security:
  authorization: enabled

net:
  port: 27017
  bindIp: 127.0.0.1
```

```bash
# Create MongoDB admin user
mongo
> use admin
> db.createUser({
    user: "admin",
    pwd: "secure_password_here",
    roles: [{ role: "userAdminAnyDatabase", db: "admin" }]
  })
> exit

# Restart MongoDB
sudo systemctl restart mongod
```

#### Application Security
```bash
# Set proper file permissions
sudo chown -R www-data:www-data /path/to/privacyguard
sudo chmod -R 755 /path/to/privacyguard
sudo chmod 600 /path/to/privacyguard/.env

# Create logs directory with proper permissions
sudo mkdir -p /var/log/privacyguard
sudo chown www-data:www-data /var/log/privacyguard
```

### 📊 Monitoring & Logging

#### Log Rotation
```bash
# Create logrotate configuration
sudo nano /etc/logrotate.d/privacyguard
```

```
/path/to/privacyguard/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    copytruncate
    su www-data www-data
}
```

#### System Monitoring
```bash
# Install monitoring tools
sudo apt install htop iotop netstat-nat

# Setup disk usage monitoring
echo "0 */6 * * * df -h | mail -s 'Disk Usage Report' admin@yourdomain.com" | sudo crontab -
```

#### Application Health Checks
```bash
# Create health check script
nano /path/to/privacyguard/scripts/health-check.sh
```

```bash
#!/bin/bash
# Health check script

HEALTH_URL="https://yourdomain.com/health"
EXPECTED_STATUS="200"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ "$STATUS" != "$EXPECTED_STATUS" ]; then
    echo "Health check failed: Status $STATUS"
    # Restart application
    pm2 restart privacyguard
    # Send alert
    echo "PrivacyGuard health check failed at $(date)" | mail -s "PrivacyGuard Alert" admin@yourdomain.com
fi
```

```bash
# Make executable and schedule
chmod +x /path/to/privacyguard/scripts/health-check.sh
echo "*/5 * * * * /path/to/privacyguard/scripts/health-check.sh" | crontab -
```

### 🔄 Backup Strategy

#### Database Backup
```bash
# Create backup script
nano /path/to/privacyguard/scripts/backup-db.sh
```

```bash
#!/bin/bash
# Database backup script

BACKUP_DIR="/backup/privacyguard"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="privacyguard"

mkdir -p $BACKUP_DIR

# Create database backup
mongodump --db $DB_NAME --out $BACKUP_DIR/db_$DATE

# Compress backup
tar -czf $BACKUP_DIR/db_$DATE.tar.gz -C $BACKUP_DIR db_$DATE
rm -rf $BACKUP_DIR/db_$DATE

# Remove backups older than 30 days
find $BACKUP_DIR -name "db_*.tar.gz" -mtime +30 -delete

echo "Database backup completed: db_$DATE.tar.gz"
```

```bash
# Schedule daily backups
chmod +x /path/to/privacyguard/scripts/backup-db.sh
echo "0 2 * * * /path/to/privacyguard/scripts/backup-db.sh" | crontab -
```

#### Application Backup
```bash
# Create application backup script
nano /path/to/privacyguard/scripts/backup-app.sh
```

```bash
#!/bin/bash
# Application backup script

BACKUP_DIR="/backup/privacyguard"
DATE=$(date +%Y%m%d_%H%M%S)
APP_DIR="/path/to/privacyguard"

mkdir -p $BACKUP_DIR

# Backup application files (excluding node_modules and logs)
tar -czf $BACKUP_DIR/app_$DATE.tar.gz \
    --exclude='node_modules' \
    --exclude='logs' \
    --exclude='archives' \
    -C $APP_DIR .

# Remove old application backups
find $BACKUP_DIR -name "app_*.tar.gz" -mtime +7 -delete

echo "Application backup completed: app_$DATE.tar.gz"
```

### 🚀 Scaling & Performance

#### Load Balancer Setup (Optional)
For high-traffic deployments, consider using a load balancer:

```nginx
# /etc/nginx/sites-available/privacyguard-lb
upstream privacyguard_backend {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    # SSL configuration...
    
    location / {
        proxy_pass http://privacyguard_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Database Scaling
For large deployments, consider MongoDB replica sets:

```bash
# MongoDB replica set configuration
# /etc/mongod.conf
replication:
  replSetName: "privacyguard-rs"
```

### 📋 Deployment Checklist

- [ ] Server provisioned with minimum requirements
- [ ] Node.js 18+ installed
- [ ] MongoDB 5.0+ installed and configured
- [ ] Chrome/Chromium installed for Puppeteer
- [ ] SSL certificate obtained and configured
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] Nginx configured and running
- [ ] PM2 configured for process management
- [ ] Firewall rules configured
- [ ] Log rotation configured
- [ ] Backup scripts created and scheduled
- [ ] Health monitoring configured
- [ ] DNS records pointed to server
- [ ] Email delivery configured
- [ ] Payment processing (Stripe) configured
- [ ] Security headers configured
- [ ] Rate limiting enabled
- [ ] Error tracking configured

### 🆘 Troubleshooting

#### Common Issues

**Application won't start:**
```bash
# Check logs
pm2 logs privacyguard

# Check Node.js version
node --version

# Check MongoDB connection
mongo --eval "db.adminCommand('ismaster')"
```

**Puppeteer issues:**
```bash
# Install Chrome dependencies
sudo apt-get install -y gconf-service libasound2 libatk1.0-0 libcairo2 libcups2 libfontconfig1 libgdk-pixbuf2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libxss1 fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils
```

**MongoDB connection issues:**
```bash
# Check MongoDB status
sudo systemctl status mongod

# Check MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log
```

**SSL certificate issues:**
```bash
# Renew certificate
sudo certbot renew

# Test SSL configuration
sudo nginx -t
```

### 📞 Support

For deployment issues:
- Check logs: `pm2 logs privacyguard`
- Monitor resources: `htop`
- Database status: `sudo systemctl status mongod`
- Application health: `curl https://yourdomain.com/health`

For additional support, visit: https://github.com/privacyguard/privacyguard/issues