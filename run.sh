#!/usr/bin/env bash
#
# Chapter 5 — External DNS
#
# ExternalDNS watches Kubernetes Services and Ingresses and creates DNS records
# for them in a DNS provider such as Route53, Cloudflare, Google Cloud DNS, etc.
#
# For this local lab, we use the "inmemory" provider.
# It does NOT call a real DNS API. Instead, it logs the DNS records it WOULD create.
#
# This is useful for learning ExternalDNS behavior without needing a cloud account
# or real DNS provider credentials.

set -euo pipefail

source "$(dirname "$0")/../lib.sh"
cd "$(dirname "$0")"

need kubectl
need_cluster

title "Chapter 5 — External DNS"

NS="ch5"
APP="external-dns"

step "creating namespace ${NS}"
kubectl create namespace "${NS}" --dry-run=client -o yaml | kubectl apply -f -

step "deploying ExternalDNS using inmemory provider"
ED="$(latest_tag kubernetes-sigs/external-dns)"
info "ExternalDNS version: ${ED}"

kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${APP}
  namespace: ${NS}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ${APP}-${NS}
rules:
  # Core Kubernetes resources watched by ExternalDNS
  - apiGroups: [""]
    resources:
      - services
      - endpoints
      - pods
      - nodes
    verbs:
      - get
      - list
      - watch

  # Required by newer Kubernetes / ExternalDNS versions
  # Without this, ExternalDNS may crash with:
  # endpointslices.discovery.k8s.io is forbidden
  - apiGroups: ["discovery.k8s.io"]
    resources:
      - endpointslices
    verbs:
      - get
      - list
      - watch

  # Required when using --source=ingress
  - apiGroups: ["networking.k8s.io"]
    resources:
      - ingresses
    verbs:
      - get
      - list
      - watch
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${APP}-${NS}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${APP}-${NS}
subjects:
  - kind: ServiceAccount
    name: ${APP}
    namespace: ${NS}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${APP}
  template:
    metadata:
      labels:
        app: ${APP}
    spec:
      serviceAccountName: ${APP}
      containers:
        - name: ${APP}
          image: registry.k8s.io/external-dns/external-dns:${ED}
          imagePullPolicy: IfNotPresent
          args:
            - --source=service
            - --source=ingress
            - --provider=inmemory
            - --registry=noop
            - --policy=upsert-only
            - --log-level=debug
            - --interval=10s
EOF

step "verifying ExternalDNS RBAC permissions"
kubectl auth can-i list endpointslices.discovery.k8s.io \
  --as="system:serviceaccount:${NS}:${APP}" \
  --all-namespaces

step "waiting for ExternalDNS rollout"
kubectl -n "${NS}" rollout status deployment/"${APP}" --timeout=120s

step "deploying a sample app/service that requests the DNS name shop.example.com"
kubectl -n "${NS}" apply -f manifests/sample.yaml

step "showing deployed resources"
kubectl -n "${NS}" get pods,svc,ingress

step "waiting for ExternalDNS to detect the service/ingress"
sleep 20

step "RESULT — DNS records ExternalDNS decided to create"
kubectl -n "${NS}" logs deployment/"${APP}" -c "${APP}" \
  | grep -iE "shop.example.com|CREATE|record|endpoint" \
  | tail -n 20 \
  || warn "No matching ExternalDNS log lines yet. Re-check with: kubectl -n ${NS} logs -f deploy/${APP} -c ${APP}"

title "Done"

info "ExternalDNS is running with the inmemory provider."
info "It will log DNS records it WOULD create, but it will not update real DNS."
info "In production, replace --provider=inmemory with aws/cloudflare/google/etc. and provide credentials."
info "For global load balancing across clusters, see the K8GB section in the README."
info "Clean up: ./cleanup.sh"
