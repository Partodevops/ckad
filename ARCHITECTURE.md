# 🏛️ Lumen — Architecture

A visual tour of the whole system, from a click in the browser down to a row in
Postgres, and from a `git push` out to a running Kubernetes cluster. Every box is
colored by what it *is* — see the [legend](#-legend) at the bottom.

| Diagram | Shows |
|---------|-------|
| [1. Production topology](#1--production-topology-kubernetes) | How Lumen runs on a Kubernetes cluster |
| [2. Request lifecycle](#2--request-lifecycle) | What happens on load + on "add task" |
| [3. Local development](#3--local-development) | Docker Compose and the no-Docker path |
| [4. Delivery pipeline](#4--delivery-pipeline-cicd) | Code → image → any environment |
| [5. The whole system at a glance](#5--the-whole-system-at-a-glance) | Everything in one map |

---

## 1 · Production topology (Kubernetes)

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}}}%%
flowchart TD
    user(["👤 User<br/>web browser"]):::client

    subgraph cluster["☸️ Kubernetes Cluster — namespace: lumen"]
        direction TB

        ing["🌐 Ingress<br/>host: lumen.local"]:::infra
        websvc["🔀 Service: lumen-web<br/>ClusterIP · :80 → :3000"]:::infra

        subgraph webtier["Web tier · Deployment (2+ replicas)"]
            direction LR
            pod1["📦 lumen-web pod<br/>Express + static UI<br/>:3000"]:::web
            pod2["📦 lumen-web pod<br/>Express + static UI<br/>:3000"]:::web
        end

        hpa["📈 HorizontalPodAutoscaler<br/>CPU 70% · 2–6 pods"]:::infra
        secret["🔑 Secret: lumen-db<br/>user · password · db"]:::config

        pgsvc["🔀 Service: postgres<br/>headless · :5432"]:::infra

        subgraph datatier["Data tier · StatefulSet"]
            direction TB
            pg["🐘 postgres-0<br/>PostgreSQL 16"]:::data
            pvc[("💾 PVC 'data'<br/>1Gi PersistentVolume")]:::data
        end
    end

    user -->|HTTPS| ing
    ing --> websvc
    websvc --> pod1 & pod2
    pod1 -->|SQL| pgsvc
    pod2 -->|SQL| pgsvc
    pgsvc --> pg
    pg --> pvc

    secret -.->|env| pod1
    secret -.->|env| pod2
    secret -.->|env| pg
    hpa -.->|scales| webtier

    classDef client fill:#5cc8ff,stroke:#1f8fc0,color:#06283a;
    classDef web fill:#7c5cff,stroke:#5b3ee0,color:#ffffff;
    classDef data fill:#43c59e,stroke:#2a8e6f,color:#04231a;
    classDef infra fill:#2b2840,stroke:#544f78,color:#e8e6f6;
    classDef config fill:#f0a847,stroke:#c47f24,color:#3a2503;
```

**Read it top-down:** the browser hits the **Ingress**, which forwards to the
**web Service**, which load-balances across stateless **web pods**. Each pod talks
SQL to the **headless Postgres Service**, which points at the single **`postgres-0`**
pod, whose data lives on a **PersistentVolume** that survives restarts. The
**Secret** injects DB credentials into both tiers; the **HPA** adds/removes web
pods based on CPU.

---

## 2 · Request lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant B as Browser · app.js
    participant E as Express · server.js
    participant D as db.js
    participant P as PostgreSQL

    rect rgba(124,92,255,0.08)
    Note over U,P: Loading the board
    U->>B: open Lumen
    B->>E: GET /api/tasks
    E->>D: query("SELECT * FROM tasks …")
    D->>P: SQL over connection pool
    P-->>D: rows
    D-->>E: rows
    E-->>B: 200 · JSON [ tasks ]
    B-->>U: render cards + completion ring
    end

    rect rgba(67,197,158,0.10)
    Note over U,P: Adding a task
    U->>B: type title, click +
    B->>E: POST /api/tasks { title, priority, … }
    E->>E: validate + sanitize input
    E->>D: INSERT … RETURNING *
    D->>P: parameterized SQL
    P-->>D: new row
    D-->>E: row
    E-->>B: 201 Created · { task }
    B-->>U: prepend the new card
    end
```

The same two-step shape (`Browser → Express → db.js → Postgres` and back) covers
every action — toggle, edit, delete, and reorder just swap the verb and SQL.

---

## 3 · Local development

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}}}%%
flowchart LR
    dev(["👩‍💻 Developer<br/>http://localhost:3000"]):::client

    subgraph compose["🐳 docker compose up"]
        direction TB
        webc["📦 web container<br/>node:20-alpine<br/>server.js · :3000"]:::web
        dbc["🐘 db container<br/>postgres:16-alpine · :5432"]:::data
        vol[("💾 volume<br/>lumen_pgdata")]:::data
        webc -->|DATABASE_URL| dbc
        dbc --> vol
    end

    subgraph nodocker["⚡ make dev — no Docker, no Postgres"]
        direction TB
        node["📦 node server.js --mem"]:::web
        mem["🧠 pg-mem<br/>in-memory Postgres"]:::data
        node --> mem
    end

    dev --> webc
    dev -.-> node

    classDef client fill:#5cc8ff,stroke:#1f8fc0,color:#06283a;
    classDef web fill:#7c5cff,stroke:#5b3ee0,color:#ffffff;
    classDef data fill:#43c59e,stroke:#2a8e6f,color:#04231a;
```

Two ways to run it locally: full **Docker Compose** (real Postgres + a persistent
volume), or **`make dev`** which swaps the database layer for an in-memory one —
same code, zero install.

---

## 4 · Delivery pipeline (CI/CD)

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}}}%%
flowchart LR
    dev(["👩‍💻 Developer"]):::client
    repo["🐙 GitHub repo<br/>push to main · tag v*"]:::ext

    subgraph gha["⚙️ GitHub Actions · docker-publish.yml"]
        direction LR
        s1["Checkout"]:::ci --> s2["Buildx"]:::ci --> s3["Login"]:::ci --> s4["Build ./app"]:::ci --> s5["Push tags"]:::ci
    end

    hub["🐳 Docker Hub<br/>youruser/lumen-web:tag"]:::ext

    subgraph targets["🚀 Run the image anywhere"]
        direction TB
        comp["docker compose<br/>deploy.compose.yml"]:::infra
        raw["kubectl apply -f k8s/"]:::infra
        helm["helm install ./helm/lumen"]:::infra
    end

    dev -->|git push| repo --> gha
    s5 --> hub
    hub --> comp & raw & helm

    classDef client fill:#5cc8ff,stroke:#1f8fc0,color:#06283a;
    classDef ci fill:#ff6b81,stroke:#d23c54,color:#ffffff;
    classDef ext fill:#2b2840,stroke:#544f78,color:#e8e6f6;
    classDef infra fill:#7c5cff,stroke:#5b3ee0,color:#ffffff;
```

One push builds one image; that single artifact is what runs in **every**
environment — Compose, raw manifests, or Helm.

---

## 5 · The whole system at a glance

```mermaid
mindmap
  root["☀️ Lumen"]
    Application
      Frontend
        index.html
        styles.css
        app.js
      Backend
        server.js — Express API
        db.js — pg or pg-mem
    Containers
      app/Dockerfile
      docker-compose.yml
      deploy.compose.yml
    Delivery
      GitHub Actions
      Docker Hub image
    Kubernetes
      Raw manifests · k8s/
      Helm chart · helm/lumen
    Tooling
      Makefile
      .env config
```

---

## 🎨 Legend

| Color | Meaning |
|-------|---------|
| 🟦 **Blue** | the user / developer (a human) |
| 🟪 **Violet** | the Lumen application (Express + UI) |
| 🟩 **Green** | data — PostgreSQL, volumes, in-memory store |
| 🟥 **Pink** | CI/CD build steps |
| ⬛ **Slate** | platform/infra — Services, Ingress, Docker Hub, GitHub |
| 🟧 **Amber** | configuration & secrets |

> Solid arrows = request/data flow. Dashed arrows = configuration or control
> (e.g. a Secret injecting env vars, or the HPA scaling a Deployment).

These diagrams render automatically on GitHub and in any Mermaid-aware viewer
(VS Code, Obsidian, Notion). To export an image:
`npx -y @mermaid-js/mermaid-cli -i ARCHITECTURE.md -o architecture.svg`.
