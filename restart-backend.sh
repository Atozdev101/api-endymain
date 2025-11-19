#!/bin/bash

# Script to restart the backend after uploading userController.js
# Usage: After uploading userController.js, run: bash restart-backend.sh

echo "🔄 Restarting backend on server..."

ssh root@157.245.218.84 << 'ENDSSH'
cd /var/www/atozemails-backend
pm2 restart atozemails-backend
echo ""
echo "📋 Recent logs:"
pm2 logs atozemails-backend --lines 15 --nostream
ENDSSH

echo ""
echo "✅ Backend restarted!"

