# ☸️ Kubernetes — from zero to deploying Lumen

A hands-on guide that starts at *"what even is Kubernetes"* and ends with **our
Lumen app running on a real cluster**. No prior k8s knowledge assumed. Every
concept comes with the command(s) you'd actually type.

> **How to read this:** Parts 0–2 are concepts (skim if you know them). Part 3
> is the kubectl cheat sheet. Part 4 gets a cluster running on your machine.
> **Part 5 is the project** — deploying Lumen, the manifests live in [`k8s/`](k8s).

---

## Contents

- [Part 0 — What & why](#part-0--what--why)
- [Part 1 — How a cluster is built](#part-1--how-a-cluster-is-built-the-components)
- [Part 2 — The objects you'll actually use](#part-2--the-objects-youll-actually-use)
- [Part 3 — `kubectl`, the remote control](#part-3--kubectl-the-remote-control)
- [Part 4 — Get a cluster on your machine](#part-4--get-a-cluster-on-your-machine)
- [Part 5 — 🚀 Deploy Lumen (the project)](#part-5----deploy-lumen-the-project)
- [Part 6 — 📦 Package it with Helm](#part-6----package-it-with-helm)
- [Part 7 — Where to go next](#part-7--where-to-go-next)
- [Appendix — One-page cheat sheet](#appendix--one-page-cheat-sheet)

---

## Part 0 — What & why

### The problem

You built Lumen. It's two containers: a **web app** and a **Postgres database**.
On one server, `docker compose up` is perfect. But now imagine real life:

- One server isn't enough — you need 5, across 2 data centres.
- A container crashes at 3am. Someone has to restart it.
- Traffic spikes — you need 10 copies of the web app, then back to 2.
- You ship a new version and it's broken — you need to roll back *now*.
- A whole server dies — its containers must move elsewhere automatically.

Doing this by hand across many machines is misery. **Kubernetes (k8s) is the
robot that does it for you.**

### The one-sentence definition

> Kubernetes is a system where you **describe the state you want** ("run 3 copies
> of this image, expose it on port 80, keep it alive"), and it **continuously
> makes reality match** — restarting, rescheduling, and scaling on its own.

That idea — *desired state* vs *actual state*, with controllers always reconciling
the two — is the whole philosophy. You write YAML files saying what you want;
Kubernetes does the work to get there and keep it there.

### Mental model

Think of a shipping port:

| Port                         | Kubernetes               |
|------------------------------|--------------------------|
| The whole port               | **Cluster**              |
| Each dock/crane (a machine)  | **Node**                 |
| The harbor master's office   | **Control plane**        |
| A shipping container         | A **container** (Docker) |
| A crate holding container(s) | A **Pod**                |
| The work order ("keep 3 crates here") | A **Deployment** |
| The front gate + address     | A **Service** / **Ingress** |

---

## Part 1 — How a cluster is built (the components)

A **cluster** = one **control plane** (the brain) + one or more **worker nodes**
(the muscle that runs your containers).

```
        ┌──────────────────────── CONTROL PLANE (the brain) ────────────────────────┐
        │                                                                            │
        │   kube-apiserver  ◀── everything talks through this (the front door)       │
        │        │                                                                   │
        │   ┌────┴─────┬───────────────┬──────────────────────┐                      │
        │   etcd    scheduler   controller-manager   cloud-controller-manager        │
        │ (memory)  (placement)  (the reconcilers)    (talks to AWS/GCP/...)         │
        └────────────────────────────────┬───────────────────────────────────────────┘
                                          │ (API)
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                             ▼                             ▼
     ┌─────────────┐               ┌─────────────┐               ┌─────────────┐
     │   NODE 1    │               │   NODE 2    │               │   NODE 3    │
     │ kubelet     │               │ kubelet     │               │ kubelet     │  ← runs/monitors pods
     │ kube-proxy  │               │ kube-proxy  │               │ kube-proxy  │  ← networking rules
     │ runtime     │               │ runtime     │               │ runtime     │  ← containerd/CRI-O
     │ [ Pods ]    │               │ [ Pods ]    │               │ [ Pods ]    │
     └─────────────┘               └─────────────┘               └─────────────┘
```

### Control plane components

| Component                    | Its job (plain English)                                                      |
|------------------------------|------------------------------------------------------------------------------|
| **kube-apiserver**           | The front door. *Every* command and component goes through it. `kubectl` talks to this. |
| **etcd**                     | The cluster's memory — a key-value database storing the entire desired + actual state. |
| **kube-scheduler**           | Decides **which node** a new pod should run on (based on resources, rules).   |
| **kube-controller-manager**  | Runs the **controllers** — loops that watch state and fix drift ("want 3, have 2 → make 1 more"). |
| **cloud-controller-manager** | Talks to your cloud (creates load balancers, disks) when on AWS/GCP/Azure.   |

### Worker node components

| Component             | Its job                                                                  |
|-----------------------|--------------------------------------------------------------------------|
| **kubelet**           | The node's agent. Starts the containers the control plane assigns, reports health back. |
| **kube-proxy**        | Programs networking so Services route traffic to the right pods.          |
| **container runtime** | Actually runs containers (containerd / CRI-O). The thing Docker used too. |

> **You rarely touch these directly.** Managed clusters (EKS/GKE/AKS) run the
> control plane for you. You mostly write YAML and run `kubectl`.

---

## Part 2 — The objects you'll actually use

These are the building blocks you write in YAML. Each has the same skeleton:

```yaml
apiVersion: <group/version>   # which API
kind: <Object type>           # Pod, Deployment, Service...
metadata:
  name: <name>
  namespace: <namespace>
  labels: { key: value }      # tags used to select/group objects
spec:
  ...                         # the desired state for this object
```

### Pod — the smallest unit

One or more containers that share a network + storage and live/die together.
**You almost never create Pods directly** — a Deployment makes them for you. But
conceptually, a Pod is "a running instance of your container."

```yaml
apiVersion: v1
kind: Pod
metadata: { name: hello }
spec:
  containers:
    - name: web
      image: nginx
```

### ReplicaSet — keep N pods alive

Ensures exactly N copies of a pod exist. Also something you rarely write by hand —
a Deployment manages ReplicaSets for you.

### Deployment — manage stateless apps

The workhorse for stateless apps (like Lumen's web tier). You say "I want N
replicas of this image"; it creates a ReplicaSet, handles **rolling updates** and
**rollbacks**, and replaces dead pods. **This is what you'll use most.**

### StatefulSet — manage stateful apps (databases)

Like a Deployment, but for things that need **stable identity + their own disk** —
databases, queues. Pods get fixed names (`postgres-0`) and keep the same
PersistentVolume across restarts. We use this for Postgres.

### Service — a stable address for pods

Pods are disposable; their IPs change. A Service gives a **fixed name + IP** and
**load-balances** across the matching pods. Three main types:

| Type             | What it does                                                | Use for            |
|------------------|-------------------------------------------------------------|--------------------|
| **ClusterIP** (default) | Reachable only *inside* the cluster.                 | app→db, internal   |
| **NodePort**     | Opens a high port (30000–32767) on every node's IP.         | quick external test |
| **LoadBalancer** | Asks the cloud for a real external load balancer + public IP. | production on cloud |
| *headless* (`clusterIP: None`) | No load balancing — direct pod DNS.           | StatefulSets       |

### Ingress — HTTP routing from outside

One smart entry point that routes by **hostname/path** to Services
(`lumen.local → lumen-web`), and terminates HTTPS. Needs an **ingress controller**
(ingress-nginx, Traefik) running in the cluster.

### ConfigMap — non-secret config

Key/value config (feature flags, URLs) injected as env vars or files. Keeps config
out of your image.

### Secret — sensitive config

Like a ConfigMap but for passwords/tokens/keys. Stored base64-encoded and handled
more carefully. We put the DB credentials here.

### Namespace — a folder for objects

Logical partition of the cluster (`lumen`, `staging`, `monitoring`). Groups
related objects and scopes names. Everything for Lumen goes in the `lumen` namespace.

### Volumes & storage — keeping data

Containers are ephemeral; their filesystem vanishes on restart. To persist data:

| Object                          | Meaning                                                         |
|---------------------------------|-----------------------------------------------------------------|
| **PersistentVolume (PV)**       | A real piece of storage in the cluster (a disk).                |
| **PersistentVolumeClaim (PVC)** | A *request* for storage ("I need 1Gi"). Binds to a PV.          |
| **StorageClass**                | A template that creates PVs on demand ("use AWS EBS / local disk"). |

A StatefulSet's `volumeClaimTemplates` auto-creates a PVC per pod — that's how
Postgres keeps its data.

### Probes — health checks

Kubernetes asks your container "are you OK?" three ways:

| Probe         | Question                              | If it fails        |
|---------------|---------------------------------------|--------------------|
| **readiness** | Ready to receive traffic yet?         | Stop sending traffic (don't kill). |
| **liveness**  | Still alive, or stuck?                | Restart the container. |
| **startup**   | Finished slow startup yet?            | Hold off the other probes. |

Lumen uses `/api/health` for HTTP probes; Postgres uses `pg_isready`.

### Resources — requests & limits

- **requests** = what the pod is *guaranteed* (used by the scheduler to place it, and by the HPA).
- **limits** = the *hard ceiling* (exceed memory → killed; exceed CPU → throttled).

### HorizontalPodAutoscaler (HPA) — auto-scaling

Watches CPU/memory (or custom metrics) and adds/removes pods automatically
between a min and max. Needs **metrics-server** installed.

---

## Part 3 — `kubectl`, the remote control

`kubectl` ("kube-control") is the CLI you use for everything. It talks to the
apiserver. Pattern: **`kubectl <verb> <resource> <name> [flags]`**.

### Install it

```bash
# Linux
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# macOS
brew install kubectl

# verify
kubectl version --client
```

### Contexts — which cluster am I talking to?

```bash
kubectl config get-contexts          # list clusters you can reach
kubectl config current-context       # which one is active
kubectl config use-context <name>    # switch clusters
```

### The verbs you'll use constantly

```bash
# LOOK
kubectl get pods                     # list pods in the current namespace
kubectl get pods -A                  # ...across ALL namespaces
kubectl get pods -o wide             # ...with node + IP
kubectl get pods -w                  # ...and watch live (stream changes)
kubectl get all -n lumen             # everything in the lumen namespace
kubectl describe pod <name>          # full details + recent Events (great for debugging)

# LOGS & SHELL
kubectl logs <pod>                   # print a pod's logs
kubectl logs <pod> -f                # ...follow (tail -f)
kubectl logs deploy/lumen-web        # logs from a deployment's pods
kubectl exec -it <pod> -- sh         # open a shell inside a container

# APPLY / CHANGE  (declarative — the k8s way)
kubectl apply -f file.yaml           # create or update from a file
kubectl apply -f k8s/                # ...every yaml in a folder
kubectl delete -f k8s/               # delete what those files define
kubectl edit deploy/lumen-web        # open live config in your editor

# SCALE / UPDATE / ROLLBACK
kubectl scale deploy/lumen-web --replicas=5
kubectl set image deploy/lumen-web web=youruser/lumen-web:1.1
kubectl rollout status deploy/lumen-web      # watch a rollout finish
kubectl rollout undo deploy/lumen-web        # roll back to the previous version
kubectl rollout history deploy/lumen-web     # see past revisions

# NETWORK ACCESS (for testing)
kubectl port-forward svc/lumen-web 8080:80   # localhost:8080 -> the Service

# RESOURCE USE (needs metrics-server)
kubectl top pods
kubectl top nodes
```

> **Handy flags:** `-n <ns>` namespace · `-A` all namespaces · `-o yaml|json|wide`
> output format · `-w` watch · `-l app=lumen-web` filter by label · `--dry-run=client -o yaml`
> generate YAML without applying.

---

## Part 4 — Get a cluster on your machine

To learn, run a tiny cluster locally. Pick **one**:

| Tool               | Best for                              | Install                                    |
|--------------------|---------------------------------------|--------------------------------------------|
| **minikube**       | Beginners; has add-ons (ingress, dashboard) | `brew install minikube` / [docs](https://minikube.sigs.k8s.io) |
| **kind**           | "Kubernetes IN Docker", fast, CI-friendly | `brew install kind`                    |
| **k3d**            | Lightweight k3s in Docker             | `curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh \| bash` |
| **Docker Desktop** | Already installed? Tick a checkbox    | Settings → Kubernetes → Enable             |

### Start one (minikube example)

```bash
minikube start                        # boots a 1-node cluster
kubectl get nodes                     # should show one "Ready" node

# add-ons we'll use for Lumen:
minikube addons enable ingress         # for the Ingress object
minikube addons enable metrics-server  # for the HPA + `kubectl top`
```

### Or with kind

```bash
kind create cluster --name lumen
kubectl cluster-info --context kind-lumen
```

Confirm you're connected:

```bash
kubectl get nodes      # STATUS should be Ready
```

---

## Part 5 — 🚀 Deploy Lumen (the project)

Now the payoff: **Lumen on Kubernetes.** The manifests live in [`k8s/`](k8s).

### What we're building

```
                          Internet / your browser
                                    │
                              ┌─────▼──────┐
                              │  Ingress    │   lumen.local  (06-web-ingress)
                              └─────┬──────┘
                              ┌─────▼──────────┐
                              │ Service        │   lumen-web :80  (05-web-service)
                              │ (ClusterIP)    │   load-balances ↓
                              └─────┬──────────┘
                        ┌───────────┴───────────┐
                   ┌────▼─────┐            ┌─────▼────┐
                   │ web pod  │            │ web pod  │   Deployment, 2 replicas
                   │ :3000    │            │ :3000    │   (04-web-deployment)
                   └────┬─────┘            └────┬─────┘
                        └───────────┬───────────┘
                              ┌─────▼──────────┐
                              │ Service        │   postgres :5432 (headless)
                              │ (headless)     │   (02-postgres-service)
                              └─────┬──────────┘
                              ┌─────▼──────────┐
                              │ postgres-0     │   StatefulSet (03-postgres-statefulset)
                              │  + PVC (1Gi)   │   data survives restarts
                              └────────────────┘

       Secret `lumen-db` (01) feeds DB credentials to both tiers.
       Everything lives in the `lumen` Namespace (00).
```

### The manifest files

| File | Object | Why it's there |
|------|--------|----------------|
| [`k8s/00-namespace.yaml`](k8s/00-namespace.yaml) | Namespace | A folder for all Lumen objects |
| [`k8s/01-db-secret.yaml`](k8s/01-db-secret.yaml) | Secret | DB user / password / name |
| [`k8s/02-postgres-service.yaml`](k8s/02-postgres-service.yaml) | Service (headless) | Stable name `postgres` for the DB |
| [`k8s/03-postgres-statefulset.yaml`](k8s/03-postgres-statefulset.yaml) | StatefulSet + PVC | Runs Postgres with its own disk |
| [`k8s/04-web-deployment.yaml`](k8s/04-web-deployment.yaml) | Deployment | Runs 2 web pods, probes, env from Secret |
| [`k8s/05-web-service.yaml`](k8s/05-web-service.yaml) | Service (ClusterIP) | Load-balances the web pods |
| [`k8s/06-web-ingress.yaml`](k8s/06-web-ingress.yaml) | Ingress | Public HTTP entry at `lumen.local` |
| [`k8s/07-web-hpa.yaml`](k8s/07-web-hpa.yaml) | HPA | Auto-scales web pods on CPU |

### Step 0 — Prerequisite: your image must be on Docker Hub

Kubernetes pulls the web image from a registry — it can't build from source. So
first publish it (see the main [README](README.md)):

```bash
make release IMAGE=YOUR_DOCKERHUB_USERNAME/lumen-web TAG=1.0
```

Then point the Deployment at it. Edit the one line in
[`k8s/04-web-deployment.yaml`](k8s/04-web-deployment.yaml):

```yaml
image: YOUR_DOCKERHUB_USERNAME/lumen-web:1.0
```

…or do it from the command line after applying (Step 2 shows how).

> **Local-cluster shortcut (no Docker Hub):** load your locally-built image
> straight into the cluster instead of pushing:
> ```bash
> # built locally as lumen-web:1.0 via `make build`
> minikube image load lumen-web:1.0       # minikube
> kind load docker-image lumen-web:1.0 --name lumen   # kind
> ```
> then set the Deployment image to `lumen-web:1.0` and add
> `imagePullPolicy: IfNotPresent`.

### Step 1 — (Recommended) set a real DB password

Edit [`k8s/01-db-secret.yaml`](k8s/01-db-secret.yaml) and change
`POSTGRES_PASSWORD`. (On a real cluster, use a secrets manager — see Part 6.)

### Step 2 — Apply everything

`kubectl apply -f k8s/` applies every file, in name order — that's why they're
numbered (namespace first, then secret, then DB, then web).

```bash
kubectl apply -f k8s/
```

If you didn't edit the image in the file, set it now:

```bash
kubectl -n lumen set image deploy/lumen-web web=YOUR_DOCKERHUB_USERNAME/lumen-web:1.0
```

### Step 3 — Watch it come up

```bash
kubectl -n lumen get pods -w
```

Wait for `postgres-0` and both `lumen-web-...` pods to read `Running` and
`READY 1/1`, then press `Ctrl+C`. See the whole picture:

```bash
kubectl -n lumen get all
kubectl -n lumen get pvc        # the database's 1Gi disk, should be "Bound"
```

> **Pod stuck?** `kubectl -n lumen describe pod <name>` and read the **Events** at
> the bottom — it almost always tells you why (bad image name, can't reach DB, etc.).
> `ImagePullBackOff` = wrong/private image. `CrashLoopBackOff` = app exits; check
> `kubectl -n lumen logs <pod>`.

### Step 4 — Open the app

**Easiest — port-forward (works on any cluster):**

```bash
kubectl -n lumen port-forward svc/lumen-web 8080:80
# now open http://localhost:8080
```

**The real way — via the Ingress:**

```bash
# 1) get the cluster's IP
minikube ip                     # e.g. 192.168.49.2   (kind: use 127.0.0.1)

# 2) map the hostname to it
echo "$(minikube ip) lumen.local" | sudo tee -a /etc/hosts

# 3) open it
#    minikube may need a tunnel running in another terminal:
minikube tunnel
# then browse http://lumen.local
```

You should see Lumen, with its tasks served from Postgres running in the cluster. 🎉

### Step 5 — Operate it like a pro

```bash
# scale the web tier up / down
kubectl -n lumen scale deploy/lumen-web --replicas=4
kubectl -n lumen get pods            # watch new pods appear

# ship a new version (rolling update — zero downtime)
kubectl -n lumen set image deploy/lumen-web web=YOUR_DOCKERHUB_USERNAME/lumen-web:1.1
kubectl -n lumen rollout status deploy/lumen-web

# oops, 1.1 is broken — roll back instantly
kubectl -n lumen rollout undo deploy/lumen-web

# peek at the database from inside the cluster
kubectl -n lumen exec -it postgres-0 -- psql -U lumen -d lumen -c "SELECT count(*) FROM tasks;"

# resource usage (needs metrics-server)
kubectl -n lumen top pods

# auto-scaling status
kubectl -n lumen get hpa
```

### Step 6 — Prove persistence (the StatefulSet payoff)

```bash
# add a task in the UI, then delete the database pod:
kubectl -n lumen delete pod postgres-0

# it comes back as postgres-0, re-attaches the SAME disk...
kubectl -n lumen get pods -w
# ...refresh the app — your tasks are still there. ✅
```

### Step 7 — Clean up

```bash
# remove just the app (keeps nothing)
kubectl delete -f k8s/

# the PVC (database disk) may stick around on purpose — remove it too:
kubectl -n lumen delete pvc --all

# or nuke the whole namespace in one go
kubectl delete namespace lumen

# stop the local cluster entirely
minikube stop          # or: minikube delete   /   kind delete cluster --name lumen
```

---

## Part 6 — 📦 Package it with Helm

In Part 5 you applied eight raw YAML files. That works, but notice the pain:
you edit the image tag **by hand** in a file, there's no clean way to keep
dev/staging/prod variants, and "install / upgrade / roll back / uninstall the
whole app as one thing" doesn't exist. **Helm fixes all of that.**

> **Helm is the package manager for Kubernetes.** It turns your manifests into a
> reusable, configurable **chart**, and manages one installation of it as a
> single versioned **release** you can upgrade and roll back in one command.

### The five words that matter

| Term           | Meaning                                                                 |
|----------------|-------------------------------------------------------------------------|
| **Chart**      | The package — templated manifests + defaults. (Ours: [`helm/lumen/`](helm/lumen).) |
| **Values**     | The knobs. Defaults live in `values.yaml`; you override with `--set` or `-f`. |
| **Template**   | A manifest with `{{ placeholders }}` filled in from values at install time. |
| **Release**    | One install of a chart into a cluster, with a name (e.g. `lumen`) and history. |
| **Revision**   | Every `install`/`upgrade` makes a numbered revision you can `rollback` to. |

### Install Helm

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash   # Linux
brew install helm                                                                 # macOS
helm version
```

### Anatomy of the Lumen chart

```
helm/lumen/
├─ Chart.yaml              # name, chart version, app version
├─ values.yaml            # all the defaults you can override
└─ templates/
   ├─ _helpers.tpl        # reusable name/label snippets
   ├─ secret.yaml         # DB credentials (skipped if you bring your own)
   ├─ postgres-statefulset.yaml  # headless Service + StatefulSet + disk
   ├─ web-deployment.yaml # Deployment + Service for the app
   ├─ ingress.yaml        # only if ingress.enabled=true
   ├─ hpa.yaml            # only if autoscaling.enabled=true
   └─ NOTES.txt           # the help text printed after install
```

It's the same objects as `k8s/`, but every changeable bit is now a value.

### The knobs (most-used values)

| Value                         | Default                       | What it controls                 |
|-------------------------------|-------------------------------|----------------------------------|
| `web.image.repository`        | `YOUR_DOCKERHUB_USERNAME/lumen-web` | the app image               |
| `web.image.tag`               | `1.0`                         | the version to run               |
| `web.replicaCount`            | `2`                           | number of web pods               |
| `db.password`                 | `change-me-in-production`     | Postgres password                |
| `postgres.enabled`            | `true`                        | bundle Postgres, or use your own |
| `postgres.storage`            | `1Gi`                         | size of the DB disk              |
| `ingress.enabled` / `.host`   | `false` / `lumen.local`       | expose via Ingress               |
| `autoscaling.enabled`         | `false`                       | turn on the HPA                  |

### Deploy Lumen with Helm

```bash
# 0) sanity-check before touching the cluster
helm lint ./helm/lumen
helm template lumen ./helm/lumen | less     # see the exact YAML it will apply

# 1) install (creates the namespace, sets your real image)
helm install lumen ./helm/lumen \
  --namespace lumen --create-namespace \
  --set web.image.repository=YOUR_DOCKERHUB_USERNAME/lumen-web \
  --set web.image.tag=1.0 \
  --set db.password="$(openssl rand -hex 16)"

# 2) check the release + pods
helm -n lumen list
helm -n lumen status lumen
kubectl -n lumen get pods -w

# 3) open it
kubectl -n lumen port-forward svc/lumen-web 8080:80     # http://localhost:8080
```

### Upgrade, roll back, uninstall — the lifecycle

```bash
# ship a new image version (only changes what you pass; keeps the rest)
helm -n lumen upgrade lumen ./helm/lumen --reuse-values --set web.image.tag=1.1

# see the revision history
helm -n lumen history lumen

# 1.1 broke? roll the whole release back to revision 1, instantly
helm -n lumen rollback lumen 1

# remove everything this release created
helm -n lumen uninstall lumen
```

### Common variations (just flip values)

```bash
# expose it through an nginx Ingress
helm -n lumen upgrade lumen ./helm/lumen --reuse-values \
  --set ingress.enabled=true --set ingress.className=nginx --set ingress.host=lumen.local

# turn on autoscaling (2–6 pods on CPU)
helm -n lumen upgrade lumen ./helm/lumen --reuse-values --set autoscaling.enabled=true

# use an external database instead of the bundled one (e.g. AWS RDS)
helm install lumen ./helm/lumen -n lumen --create-namespace \
  --set postgres.enabled=false \
  --set postgres.externalHost=my-db.abc123.rds.amazonaws.com \
  --set db.user=lumen --set db.password=SECRET --set db.name=lumen

# keep your settings in a file instead of long --set chains
helm install lumen ./helm/lumen -n lumen --create-namespace -f my-values.yaml
```

> **No registry? (local cluster)** After `minikube image load lumen-web:1.0`, install with
> `--set web.image.repository=lumen-web --set web.image.tag=1.0 --set web.image.pullPolicy=IfNotPresent`.

### Share the chart (optional)

```bash
helm package ./helm/lumen                         # -> lumen-0.1.0.tgz
helm push lumen-0.1.0.tgz oci://registry-1.docker.io/YOUR_DOCKERHUB_USERNAME
helm install lumen oci://registry-1.docker.io/YOUR_DOCKERHUB_USERNAME/lumen --version 0.1.0
```

> ✅ This chart is verified: `helm lint` passes and `helm template` renders valid
> manifests for all combinations (default, ingress+HPA on, external DB).

---

## Part 7 — Where to go next

You now know the core **and** how to package it. The ecosystem from here:

| Topic                    | What it adds                                                        |
|--------------------------|--------------------------------------------------------------------|
| **Kustomize**            | Overlay the same manifests per environment without templating. (`kubectl apply -k`) |
| **Managed clusters**     | EKS (AWS), GKE (Google), AKS (Azure) — they run the control plane.  |
| **Real secrets**         | Sealed Secrets, External Secrets, or Vault instead of plain Secrets.|
| **Ingress + TLS**        | cert-manager for automatic Let's Encrypt HTTPS.                     |
| **Observability**        | Prometheus + Grafana (metrics), Loki (logs).                        |
| **GitOps**               | Argo CD / Flux — the cluster auto-syncs your Git repo (often deploying this Helm chart). |
| **Resilience**           | PodDisruptionBudgets, anti-affinity, replicas spread across nodes.  |

---

## Appendix — One-page cheat sheet

```bash
# ── cluster / context ───────────────────────────────────────────────
kubectl config get-contexts            # clusters you can reach
kubectl config use-context <ctx>       # switch cluster
kubectl get nodes                      # nodes + status

# ── look around ─────────────────────────────────────────────────────
kubectl get all -n lumen               # everything in a namespace
kubectl get pods -A -o wide            # all pods, all namespaces, + node/IP
kubectl describe <kind>/<name> -n lumen# details + Events (debugging)
kubectl get events -n lumen --sort-by=.lastTimestamp

# ── logs / shell ────────────────────────────────────────────────────
kubectl logs -f deploy/lumen-web -n lumen
kubectl exec -it postgres-0 -n lumen -- sh

# ── apply / delete (declarative) ────────────────────────────────────
kubectl apply -f k8s/                  # create/update from folder
kubectl delete -f k8s/                 # remove them
kubectl delete namespace lumen         # remove everything at once

# ── change running workloads ────────────────────────────────────────
kubectl scale deploy/lumen-web --replicas=5 -n lumen
kubectl set image deploy/lumen-web web=IMG:TAG -n lumen
kubectl rollout status  deploy/lumen-web -n lumen
kubectl rollout undo    deploy/lumen-web -n lumen
kubectl rollout history deploy/lumen-web -n lumen

# ── access / metrics ────────────────────────────────────────────────
kubectl port-forward svc/lumen-web 8080:80 -n lumen   # http://localhost:8080
kubectl top pods -n lumen
kubectl get hpa -n lumen

# ── generate YAML without applying ──────────────────────────────────
kubectl create deploy demo --image=nginx --dry-run=client -o yaml
```

> Set a default namespace so you can drop `-n lumen` everywhere:
> ```bash
> kubectl config set-context --current --namespace=lumen
> ```
