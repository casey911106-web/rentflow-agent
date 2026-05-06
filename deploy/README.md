# RentFlow Agent — Deployment guide (Supabase + VPS + Vercel)

## Stack

```
┌──────────────────┐         ┌──────────────────┐
│  Vercel          │         │  Supabase        │
│  app.rentalho.com│         │  Postgres        │
│  Next.js web     │         │  (managed)       │
└────────┬─────────┘         └─────────▲────────┘
         │                              │
         │  HTTPS API calls             │  Direct + Pooler URLs
         ▼                              │
┌─────────────────────────────────────────────────┐
│  Your VPS                                       │
│  ┌──────────────┐    ┌─────────────────────┐    │
│  │ Caddy/Nginx  │───▶│ Docker: rentflow-api│    │
│  │ TLS + proxy  │    │ NestJS, port 3001   │    │
│  └──────────────┘    └─────────────────────┘    │
│  api.rentalho.com    /var/lib/rentflow/uploads  │
└─────────────────────────────────────────────────┘
                              ▲
                              │  webhook + outbound
                              ▼
                    ┌─────────────────────┐
                    │ Meta WhatsApp Cloud │
                    │ +971585063316       │
                    └─────────────────────┘
```

## Prerequisites checklist

- [x] Anthropic API key (rotate before going live)
- [x] WhatsApp Business Cloud API credentials (already provisioned)
- [x] Supabase project created (`bysfcjswngunizyfingk`)
- [x] Supabase password set
- [ ] GitHub repo (push code)
- [ ] VPS with Docker + reverse proxy
- [ ] Domain DNS pointing to VPS for `api.<domain>`
- [ ] Vercel account
- [ ] Domain DNS pointing to Vercel for `app.<domain>` (or `<domain>` root)

## Step 1 — Push code to GitHub

```bash
cd "/Users/CARLOS/RentFlow Agent"
git init
git add .
git commit -m "feat: initial deployment setup"
gh repo create rentalho-corp/rentflow-agent --private --source=. --remote=origin --push
```

(Adjust org/name. If you don't have `gh` CLI, create the repo on github.com and `git remote add origin ...` + `git push`.)

## Step 2 — Run the first migration against Supabase

From your Mac (one time):

```bash
# Set ONLY the DIRECT_URL for migrations (in your local .env, not committed):
echo 'DIRECT_URL="postgresql://postgres:Vb_q5v%23uj8%40*C%23d@db.bysfcjswngunizyfingk.supabase.co:5432/postgres"' >> .env
echo 'DATABASE_URL="postgresql://postgres.bysfcjswngunizyfingk:Vb_q5v%23uj8%40*C%23d@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"' >> .env

# Make sure packages/database/.env still symlinks to the root .env
ls -la packages/database/.env

# Apply all migrations to Supabase
pnpm --filter @rentflow/database exec prisma migrate deploy

# Seed (optional — only if you want demo data in prod)
# pnpm --filter @rentflow/database run seed
```

Expected output: list of migrations applied. Subsequent runs say "No pending migrations".

## Step 3 — Provision the VPS

### Install Docker (if not present)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

### Clone the repo on the VPS

```bash
sudo mkdir -p /srv/rentflow
sudo chown $USER:$USER /srv/rentflow
cd /srv/rentflow
git clone git@github.com:rentalho-corp/rentflow-agent.git .
```

### Create the production .env

```bash
cp .env.production.example .env
# Edit with your real values:
#   - DATABASE_URL (Transaction pooler from Supabase)
#   - DIRECT_URL (Direct connection from Supabase)
#   - JWT_SECRET (generate fresh: openssl rand -hex 32)
#   - WHATSAPP_WEBHOOK_VERIFY_TOKEN (generate fresh: openssl rand -hex 16)
#   - All Meta + Anthropic credentials
nano .env
chmod 600 .env
```

### Boot the API

```bash
mkdir -p /var/lib/rentflow/uploads
docker compose -f docker-compose.prod.yml up -d --build
```

Watch the boot:

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

Look for:
```
🚀 RentFlow API listening on http://0.0.0.0:3001
```

Test directly on the VPS:
```bash
curl http://127.0.0.1:3001/health
# {"status":"ok",...}
```

## Step 4 — Reverse proxy + TLS

### Caddy (recommended — automatic SSL)

```bash
# If Caddy is already running, append our block:
sudo cp deploy/Caddyfile.example /etc/caddy/conf.d/rentflow.conf
sudo systemctl reload caddy
```

Edit the domain in `Caddyfile.example` first.

### Or Nginx + Certbot

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/rentflow-api
sudo ln -s /etc/nginx/sites-available/rentflow-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.rentalho.com
```

### DNS

In your DNS provider (Cloudflare, Namecheap, etc.):
```
A  api.rentalho.com → <your VPS IP>
```

After DNS propagates (~5 min), test from anywhere:
```bash
curl https://api.rentalho.com/health
```

## Step 5 — Deploy the web to Vercel

1. **vercel.com** → New Project → Import from GitHub → `rentalho-corp/rentflow-agent`
2. **Configuration**:
   - **Framework Preset**: Next.js
   - **Root Directory**: `apps/web` ← important
   - **Build Command**: leave the one from `vercel.json` (already configured)
   - **Output Directory**: `.next`
3. **Environment variables**:
   ```
   NEXT_PUBLIC_API_URL = https://api.rentalho.com
   ```
4. **Deploy**

Vercel gives you `<project>.vercel.app`. To use your own domain:

5. Vercel → Project → **Settings → Domains** → Add `app.rentalho.com`
6. Vercel shows the DNS records you need:
   ```
   CNAME  app.rentalho.com → cname.vercel-dns.com
   ```
7. Add to your DNS provider, wait 5 min, Vercel auto-provisions the cert.

## Step 6 — Update Meta webhook

1. **developers.facebook.com** → your `RentFlow Agent API` app → WhatsApp → Configuration
2. **Webhook → Edit**:
   - Callback URL: `https://api.rentalho.com/webhooks/whatsapp`
   - Verify token: same as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `.env` on VPS
3. **Verify and save** — Meta hits your endpoint to confirm it's reachable
4. **Subscribe to webhook fields**: `messages` (and `message_status` if you want delivery receipts)

## Step 7 — Smoke test

From any phone (not the operator's), send a WhatsApp to `+971585063316`:

```
Hi, I'm interested in Property RF-001
```

Then in your dashboard at `https://app.rentalho.com`:
1. **Suggestions** inbox should show a new pending suggestion
2. Your operator phone (`+971526608543`) should receive an interactive button message with Approve / Edit / Cancel

If both happen, you're live. 🎉

## Step 8 — Rotate exposed credentials

Anything that was pasted in chat needs rotating:

- **Anthropic API key**: console.anthropic.com → Settings → API Keys → revoke + create new → update `.env` on VPS → `./bin/deploy.sh`
- **WhatsApp System User Token**: business.facebook.com → Business Settings → System Users → `rentflow-api` → Generate New Token → revoke old → update `.env` → redeploy
- **Supabase password**: Supabase dashboard → Settings → Database → Reset password → update DATABASE_URL + DIRECT_URL on VPS + Mac → redeploy
- **Meta App Secret**: developers.facebook.com → Settings → Basic → "Show" + reset → update `.env` → redeploy

## Subsequent deploys

```bash
ssh user@vps
cd /srv/rentflow
./bin/deploy.sh
```

The script: `git pull` → `docker compose build` → recreate container → health check → tail logs. If health fails, exit 1 and dump logs.

For schema changes, the container itself runs `prisma migrate deploy` on every boot — no extra step.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `prisma migrate deploy` fails with auth error | Password wasn't URL-encoded | Re-encode `@`→`%40`, `#`→`%23` |
| `Can't reach database server` from VPS | Pooler URL wrong | Check port is 6543 (not 5432) for DATABASE_URL |
| Webhook returns 401 | Verify token mismatch | Match `.env` to Meta dashboard exactly |
| Capa 2 buttons don't arrive | Operator outside 24h window | Operator sends any text to business number; refreshes window |
| Cron doesn't fire | Container restarted with healthcheck failure | `docker compose logs api` — look for the cron registration line |
