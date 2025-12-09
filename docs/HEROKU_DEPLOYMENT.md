# Heroku Deployment Guide

This guide covers deploying the Biometric Core Backend to Heroku.

## Prerequisites

- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) installed
- A Heroku account

## Quick Start

### 1. Create Heroku App

```bash
heroku create your-app-name
```

### 2. Add Required Add-ons

```bash
# PostgreSQL database
heroku addons:create heroku-postgresql:essential-0

# Redis (for sessions/caching)
heroku addons:create heroku-redis:mini
```

### 3. Configure Environment Variables

```bash
# Application
heroku config:set NODE_ENV=production
heroku config:set LOG_LEVEL=info

# JWT Secrets (use strong, unique values!)
heroku config:set AUTH_JWT_ACCESS_SECRET="your-strong-access-secret"
heroku config:set AUTH_JWT_REFRESH_SECRET="your-strong-refresh-secret"
heroku config:set AUTH_JWT_ACCESS_TTL=900
heroku config:set AUTH_JWT_REFRESH_TTL=604800

# Email verification & password reset TTLs
heroku config:set EMAIL_VERIFICATION_TTL_MS=86400000
heroku config:set PASSWORD_RESET_TTL_MS=1800000

# WebAuthn (update for your production domain)
heroku config:set WEBAUTHN_RP_ID="your-domain.com"
heroku config:set WEBAUTHN_RP_NAME="Your App Name"
heroku config:set WEBAUTHN_ORIGINS="https://your-domain.com"
heroku config:set WEBAUTHN_CHALLENGE_TTL_MS=180000
heroku config:set WEBAUTHN_SIGNCOUNT_MODE=strict

# Email (optional - uses mock logger if not set)
heroku config:set RESEND_API_KEY="your-resend-api-key"
heroku config:set EMAIL_FROM_ADDRESS="Your App <no-reply@your-domain.com>"
heroku config:set EMAIL_FROM_NAME="Your App"
heroku config:set EMAIL_VERIFICATION_URL="https://your-frontend.com/verify"
heroku config:set PASSWORD_RESET_URL="https://your-frontend.com/reset-password"

# Transfer limits (optional - defaults exist)
heroku config:set TRANSFER_MIN_AMOUNT_MINOR=1000
heroku config:set TRANSFER_MAX_AMOUNT_MINOR=50000000
```

> **Note:** `DATABASE_URL` and `REDIS_URL` are automatically set by Heroku add-ons.

### 4. Deploy

```bash
git push heroku main
```

## How It Works

### Procfile

The `Procfile` defines two processes:

- **web**: Runs the production server (`npm run start:prod`)
- **release**: Runs Prisma migrations before each deployment (`npx prisma migrate deploy`)

### Build Process

Heroku automatically:
1. Detects Node.js via `package.json`
2. Installs dependencies (`npm install`)
3. Runs build script (`npm run build`)
4. Executes release phase (Prisma migrations)
5. Starts the web dyno

## Useful Commands

```bash
# View logs
heroku logs --tail

# Open app
heroku open

# Run Prisma studio (one-off dyno)
heroku run npx prisma studio

# Access database console
heroku pg:psql

# Check dyno status
heroku ps

# Restart dynos
heroku restart
```

## Troubleshooting

### Database Connection Issues

Ensure `DATABASE_URL` is set correctly:
```bash
heroku config:get DATABASE_URL
```

### Prisma Migration Failures

Check release phase logs:
```bash
heroku releases
heroku releases:output v123  # Replace with version number
```

### Application Crashes

Check application logs:
```bash
heroku logs --tail --dyno web
```

## Production Checklist

- [ ] Use strong, unique JWT secrets (32+ characters)
- [ ] Set `NODE_ENV=production`
- [ ] Configure correct WebAuthn origins for your domain
- [ ] Set up email provider (Resend) for production
- [ ] Enable Heroku Postgres SSL (automatic with add-on)
- [ ] Consider upgrading to paid dynos for production workloads
