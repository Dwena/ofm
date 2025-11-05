#!/bin/bash

# Initialize Let's Encrypt SSL certificates for OFM Platform

set -e

# Configuration
DOMAIN=${DOMAIN:-"example.com"}
EMAIL=${SSL_CERT_EMAIL:-"admin@example.com"}
STAGING=${STAGING:-0}

# Paths
CERTBOT_DIR="./certbot"

echo "🔐 Initializing Let's Encrypt SSL certificates"
echo "Domain: $DOMAIN"
echo "Email: $EMAIL"
echo ""

# Create directories
mkdir -p "$CERTBOT_DIR/conf"
mkdir -p "$CERTBOT_DIR/www"

# Download TLS parameters
if [ ! -e "$CERTBOT_DIR/conf/options-ssl-nginx.conf" ]; then
  echo "📥 Downloading TLS parameters..."
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$CERTBOT_DIR/conf/options-ssl-nginx.conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$CERTBOT_DIR/conf/ssl-dhparams.pem"
fi

# Create dummy certificate
if [ ! -d "$CERTBOT_DIR/conf/live/$DOMAIN" ]; then
  echo "🔨 Creating dummy certificate..."
  mkdir -p "$CERTBOT_DIR/conf/live/$DOMAIN"
  docker-compose run --rm --entrypoint "openssl req -x509 -nodes -newkey rsa:4096 -days 1 -keyout '/etc/letsencrypt/live/$DOMAIN/privkey.pem' -out '/etc/letsencrypt/live/$DOMAIN/fullchain.pem' -subj '/CN=localhost'" certbot
fi

# Start nginx
docker-compose up -d nginx

# Request certificate
echo "📜 Requesting certificate..."
if [ $STAGING != "0" ]; then
  staging_arg="--staging"
else
  staging_arg=""
fi

docker-compose run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot $staging_arg -d $DOMAIN -d www.$DOMAIN --email $EMAIL --rsa-key-size 4096 --agree-tos --force-renewal" certbot

# Reload nginx
docker-compose exec nginx nginx -s reload

echo "✅ SSL initialized!"
