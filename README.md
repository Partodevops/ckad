# Lumen — a beautiful task manager

A calm task app backed by **PostgreSQL**, shipped with **Docker**. Priorities,
tags, due dates, drag-to-reorder, a live completion ring, and a light/dark theme.

![stack](https://img.shields.io/badge/stack-Node%20·%20Express%20·%20Postgres%20·%20Docker-7c5cff)

📐 **See the system visually:** [ARCHITECTURE.md](ARCHITECTURE.md) — Mermaid
diagrams of the runtime, request flow, CI/CD, and Kubernetes topology.

---

## Quick start (Docker)

From the `lumen/` folder:

```bash
docker compose up --build
```

Open **http://localhost:3000**. Stop with `Ctrl+C`. To stop and wipe the
database too: `docker compose down -v`.

## Quick start (no Docker)

No Docker or Postgres installed? Run with built-in in-memory storage:

```bash
cd app
npm install
npm run dev
```

Open **http://localhost:3000**. Data resets when you stop it.

---

## `make` shortcuts

`make` on its own lists everything. The common ones:

| Command        | What it does                                            |
|----------------|---------------------------------------------------------|
| `make up`      | Build + start app and Postgres at http://localhost:3000 |
| `make down`    | Stop everything (keeps the database)                    |
| `make clean`   | Stop everything **and** wipe the database               |
| `make logs`    | Follow logs from all services                           |
| `make dev`     | Run with in-memory storage, no Docker                   |
| `make psql`    | Open a `psql` shell in the database                     |
| `make build`   | Build the web image                                     |
| `make push`    | Push the image to the registry                          |
| `make release` | Build **and** push                                      |
| `make deploy`  | Run from the published image                            |

Set your image name once on the command line:

```bash
make release IMAGE=YOUR_DOCKERHUB_USERNAME/lumen-web TAG=1.0
```

---

## Publish the image to Docker Hub (manual)

```bash
# 1. log in (once)
docker login

# 2. build, tag, push
docker build -t YOUR_DOCKERHUB_USERNAME/lumen-web:1.0 ./app
docker push YOUR_DOCKERHUB_USERNAME/lumen-web:1.0
```

Or in one step: `make release IMAGE=YOUR_DOCKERHUB_USERNAME/lumen-web TAG=1.0`.

## Publish automatically (GitHub Actions)

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
builds and pushes the image for you on every push to `main`.

**One-time setup** — add two repository secrets in
**Settings → Secrets and variables → Actions**:

| Secret               | Value                                             |
|----------------------|---------------------------------------------------|
| `DOCKERHUB_USERNAME` | your Docker Hub username                           |
| `DOCKERHUB_TOKEN`    | a Docker Hub access token (Account → Security)     |

Then it runs automatically:

```bash
git push origin main          # -> pushes  :latest  and  :sha-xxxxxxx

git tag v1.0.0                 # cut a versioned release
git push origin v1.0.0        # -> pushes  :1.0.0  and  :1.0
```

---

## Deploy on a Linux server

Runs the **published image** — no source code on the server. Replace the two
placeholders.

```bash
# 1. install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh

# 2. create a folder and grab the deploy compose file
mkdir lumen && cd lumen
curl -O https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/lumen/main/deploy.compose.yml

# 3. set the image + a real DB password
echo "WEB_IMAGE=YOUR_DOCKERHUB_USERNAME/lumen-web:1.0" >  .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"        >> .env

# 4. pull the image and start (Postgres starts alongside it)
docker compose -f deploy.compose.yml up -d
```

The app is now on port **3000**. Check it:

```bash
docker compose -f deploy.compose.yml ps
curl localhost:3000/api/health     # -> {"ok":true,"storage":"PostgreSQL"}
```

**Update to a newer image later:**

```bash
docker compose -f deploy.compose.yml pull
docker compose -f deploy.compose.yml up -d
```

> No GitHub repo to `curl` from? Copy the file over instead:
> `scp deploy.compose.yml user@server:~/lumen/`.
> To put Lumen on a public domain with HTTPS, run a reverse proxy (Caddy,
> Nginx, or Traefik) in front of port 3000.

## Deploy on Kubernetes

Want to run Lumen on a cluster instead? There's a full, beginner-friendly guide
that starts from the basics and ends with Lumen live on Kubernetes —
**[KUBERNETES.md](KUBERNETES.md)** — with ready-to-apply manifests in
[`k8s/`](k8s). The short version:

```bash
make release IMAGE=YOUR_DOCKERHUB_USERNAME/lumen-web TAG=1.0  # publish the image

# raw manifests: edit the image line in k8s/04-web-deployment.yaml, then:
kubectl apply -f k8s/
kubectl -n lumen port-forward svc/lumen-web 8080:80          # http://localhost:8080

# ...or with Helm (templated + configurable):
helm install lumen ./helm/lumen -n lumen --create-namespace \
  --set web.image.repository=YOUR_DOCKERHUB_USERNAME/lumen-web --set web.image.tag=1.0
```

---

## Configuration

Set these in a `.env` file (see [`.env.example`](.env.example)). Defaults work
out of the box for local use — **change `POSTGRES_PASSWORD` for production.**

| Variable            | Default              | Purpose                              |
|---------------------|----------------------|--------------------------------------|
| `POSTGRES_USER`     | `lumen`              | Database user                        |
| `POSTGRES_PASSWORD` | `lumen`              | Database password                    |
| `POSTGRES_DB`       | `lumen`              | Database name                        |
| `WEB_PORT`          | `3000`               | Host port for the app                |
| `DB_PORT`           | `5432`               | Host port for Postgres               |
| `WEB_IMAGE`         | `lumen-web:latest`   | Image name for build / push / deploy |

---

## Project layout

```
lumen/
├─ Makefile                 # common commands (make help)
├─ docker-compose.yml       # local: builds the web image from source
├─ deploy.compose.yml       # server: runs a published image
├─ .env.example             # configuration template
├─ ARCHITECTURE.md          # visual system diagrams (Mermaid)
├─ KUBERNETES.md            # full guide: Kubernetes basics → Helm → deploying Lumen
├─ k8s/                     # ready-to-apply Kubernetes manifests
│  └─ 00…07-*.yaml          # namespace, secret, postgres, web, ingress, hpa
├─ helm/lumen/              # Helm chart (templated, configurable, verified)
│  ├─ Chart.yaml · values.yaml
│  └─ templates/            # secret, postgres, web, ingress, hpa, NOTES
├─ .github/workflows/
│  └─ docker-publish.yml     # CI: build + push to Docker Hub
├─ db/
│  └─ init.sql              # schema, applied on first Postgres boot
└─ app/
   ├─ Dockerfile            # web image (node:20-alpine)
   ├─ server.js             # Express API
   ├─ db.js                 # storage layer (real Postgres ⇆ in-memory)
   └─ public/               # index.html · styles.css · app.js (no build step)
```

## API

| Method | Route                | Purpose                                   |
|--------|----------------------|-------------------------------------------|
| GET    | `/api/health`        | liveness + active storage backend         |
| GET    | `/api/tasks`         | list tasks (active first, then by order)  |
| POST   | `/api/tasks`         | create `{title, priority, tag, due_date}` |
| PATCH  | `/api/tasks/:id`     | update any field (incl. `completed`)      |
| POST   | `/api/tasks/reorder` | persist drag order `{order:[ids…]}`        |
| DELETE | `/api/tasks/:id`     | delete a task                             |

## Data model

```sql
tasks(
  id, title, notes, priority('low'|'medium'|'high'),
  tag, due_date, completed, position, created_at
)
```

## Features

- ⚡ Add tasks with priority, `#tag`, and due date from one bar
- ✅ One-click complete with an animated check + live progress ring
- 🔎 Instant search and All / Active / Completed filters
- ↕️ Drag-to-reorder (in the unfiltered "All" view)
- ✏️ Full edit dialog (title, notes, priority, tag, due)
- 🌗 Light / dark theme, remembered across visits
- 🗓️ Friendly due dates (Today / Tomorrow / weekday) with overdue highlighting
