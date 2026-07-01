# KRNL V3 — Deployment runbook (Oracle Free VM + Vercel)

Target: **backend** (API + Celery worker/beat + Redis) on an Oracle Cloud always-free VM
behind Caddy (auto HTTPS); **frontend** (Vite PWA) on Vercel. Supabase + Qdrant + Gemini stay
as the existing cloud services (the dev migrations are already applied, so we reuse the same
Supabase project to start — split to a separate prod project later if desired).

```
 phone / browser
      │ HTTPS
      ▼
 Vercel  ──(VITE_API_URL)──►  https://api.<you>.duckdns.org  (Caddy :443)
 frontend                          │ reverse_proxy
                                   ▼
                              api (uvicorn :8000) ──┐
                              worker (celery -B)  ──┼──► redis
                                                     └──► Supabase / Qdrant / Gemini (cloud)
```

Repo artifacts already created: `backend/Dockerfile`, `backend/requirements.txt`,
`backend/.dockerignore`, `backend/.env.example`, `docker-compose.prod.yml`, `Caddyfile`,
`frontend/vercel.json`.

---

## A. Oracle Cloud — provision the VM

1. Create an Oracle Cloud account (free; a card is required for identity verification only —
   it is **not charged** on always-free shapes). At signup pick **home region = India West
   (Mumbai)** — lowest latency for IITB users, and **the home region is permanent** (always-free
   resources are locked to it). Hyderabad is the equivalent fallback.
2. **Compute → Instances → Create instance.**
   - Image: **Ubuntu 22.04**.
   - Shape: prefer the **ARM `VM.Standard.A1.Flex`** at **1 OCPU / 6 GB** (always-free, roomy
     for api+worker+redis+caddy, and a modest size places more easily than maxing 4/24).
   - **Capacity note:** the free A1 shape is in high demand and may fail with *"Out of host
     capacity."* Retry over a few hours (or a small retry script) and it usually lands.
   - **Fallback:** `VM.Standard.E2.1.Micro` (AMD, always-free, but only 1 OCPU / **1 GB**).
     It runs the stack but 1 GB is tight — add swap right after first boot:
     ```bash
     sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
     sudo mkswap /swapfile && sudo swapon /swapfile
     echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
     ```
   - Add/download your SSH key.
3. Note the instance's **public IP**.
4. **Open ports 80 and 443 — both layers (this is the classic Oracle gotcha):**
   - **Cloud Security List:** VCN → Subnet → Security List → add Ingress rules for TCP
     **80** and **443** from `0.0.0.0/0`.
   - **Instance firewall** (Ubuntu images ship with iptables rules), over SSH:
     ```bash
     sudo iptables -I INPUT 5 -p tcp --dport 80  -j ACCEPT
     sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```

## B. DNS — free HTTPS domain

HTTPS is required (PWA install + Web Push need a secure context, and Let's Encrypt won't
issue for a raw IP). Easiest free option:

1. Go to <https://www.duckdns.org>, sign in, create a subdomain e.g. `your-name`.
2. Set its IP to the VM's public IP. Backend domain becomes
   **`api.your-name.duckdns.org`** — wait, DuckDNS gives `your-name.duckdns.org`; use that
   directly as `BACKEND_DOMAIN` (a sub-sub like `api.` also works since DuckDNS wildcards).
3. Confirm it resolves: `ping your-name.duckdns.org` → VM IP.

(If you own a real domain, just point an A record at the VM IP and use that instead.)

## C. Backend — install Docker & deploy

SSH into the VM, then:

```bash
# Docker
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker

# Get the code
git clone <your-repo-url> krnl && cd krnl
git checkout redesign

# Root .env for compose variable substitution (the domain Caddy will certify)
echo "BACKEND_DOMAIN=your-name.duckdns.org" > .env

# Backend secrets
cp backend/.env.example backend/.env
nano backend/.env   # fill every value (see notes below)

# Fresh VAPID keys for prod — paste output into backend/.env
python3 backend/scripts/gen_vapid_keys.py   # or run inside the container after build

# Build & run
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f caddy api   # watch cert issue + startup
```

**`backend/.env` notes:**
- **No surrounding quotes** on values (compose `env_file` injects them verbatim — a quoted
  `SUPABASE_URL="https://…"` is read as an invalid URL). Use `KEY=value`, not `KEY="value"`.
- `DEBUG=False`
- `REDIS_URL=redis://redis:6379/0` (compose service name, **not** localhost)
- `ALLOWED_ORIGINS=["https://<your-app>.vercel.app"]` — fill after step D (redeploy/restart
  the api once you know the Vercel URL: `docker compose -f docker-compose.prod.yml up -d`)
- `SUPABASE_*`, `QDRANT_*`, `GEMINI_API_KEY`, `ENCRYPTION_KEY` — copy from your working dev
  `backend/.env`.
- `VAPID_*` — fresh prod pair from `gen_vapid_keys.py`; `VAPID_SUBJECT=mailto:you@…`.

Smoke test once Caddy reports a cert:
```bash
curl https://your-name.duckdns.org/api/v1/notifications/vapid-public-key
```
401 = reached the app through TLS (route is auth-gated); a 502/timeout = api or firewall issue.

## D. Frontend — Vercel

1. <https://vercel.com> → **Add New Project** → import the GitHub repo.
2. **Root Directory: `frontend`**. Framework preset: **Vite** (build `vite build`, output
   `dist`). `frontend/vercel.json` already handles SPA routing.
3. **Environment Variables:**
   - `VITE_API_URL = https://your-name.duckdns.org`
   - `VITE_SUPABASE_URL = https://obscheuqyqkwvaeusfhg.supabase.co`
   - `VITE_SUPABASE_ANON_KEY = <anon key>`
4. Deploy. Note the resulting URL, e.g. `https://krnl.vercel.app`.
5. Go back and put that URL in `backend/.env` `ALLOWED_ORIGINS`, then restart the api
   (step C). Mixed-content/CORS only works when both sides point at each other.

## E. Supabase — auth URLs

Dashboard → **Authentication → URL Configuration**:
- **Site URL:** `https://krnl.vercel.app`
- **Redirect URLs:** add `https://krnl.vercel.app` (and `…/**` if needed) for the Google
  OAuth round-trip. Remove the old dev tunnel/LAN entries.

Migrations: already applied in this Supabase project (interests + notifications). If you
later create a separate **prod** Supabase project, run both files in its SQL editor:
`backend/migrations/interests_priority_migration.sql` and
`backend/migrations/notifications_migration.sql`, and swap the keys above.

## F. Verify

1. Open the Vercel URL on a phone → Google login round-trips and lands back logged in.
2. Install the PWA (Add to Home Screen) → opens standalone.
3. Settings → enable notifications → grant permission. Run a sync; confirm an important-event
   push, and that the hourly/weekly Beat jobs are registered:
   `docker compose -f docker-compose.prod.yml logs worker | grep -i beat`.

---

## Operations cheatsheet

```bash
# update after pushing code
git pull && docker compose -f docker-compose.prod.yml up -d --build
# logs / restart / down
docker compose -f docker-compose.prod.yml logs -f worker
docker compose -f docker-compose.prod.yml restart api worker
docker compose -f docker-compose.prod.yml down
```

DuckDNS IP refresh (only if the VM IP changes): re-save the IP on duckdns.org or add their
cron updater. Caddy renews TLS automatically.

## Cutover checklist (production hygiene — see PRODUCTION_CLEANUP.md)
- [ ] `DEBUG=False`, `ALLOWED_ORIGINS` locked to the Vercel origin only.
- [ ] Fresh VAPID keys (not the dev pair); secrets only in `backend/.env` on the VM, never committed.
- [ ] Worker running with `-B` (compose already does this).
- [ ] Dev tunnel/LAN entries removed from Supabase URL config.
- [ ] Remove demo/fallback lists in `DeadlinesScreen.tsx` / `InboxScreen.tsx` if undesired in prod.
