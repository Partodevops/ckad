#!/usr/bin/env bash
#
# Chapter 4 — Services, Load Balancing & Network Policies.
#   - MetalLB     : gives LoadBalancer services a real IP (Layer 4)
#   - ingress-nginx: routes HTTP by hostname            (Layer 7)
#   - kube-network-policies: enforces NetworkPolicies on kindnet
# Then deploys a sample app and proves each piece works.

set -euo pipefail

source "$(dirname "$0")/../lib.sh"
cd "$(dirname "$0")"

need kubectl docker curl
need_cluster

title "Chapter 4 — Services, Load Balancing & Network Policies"

# Retry helper: webhooks may need a few seconds to become ready
retry() {
  local n=0
  until "$@"; do
    n=$((n+1))
    [ "$n" -ge 6 ] && return 1
    sleep 5
  done
}

# ── MetalLB Layer 4 Load Balancer ─────────────────────────────────────────
step "installing MetalLB"

MLB="$(latest_tag metallb/metallb)"
info "version ${MLB}"

kubectl apply -f "https://raw.githubusercontent.com/metallb/metallb/${MLB}/config/manifests/metallb-native.yaml"

kubectl -n metallb-system rollout status deploy/controller --timeout=180s

step "giving MetalLB an IPv4 range from the kind network"

# Get only IPv4 subnet from Docker kind network.
# This avoids accidentally selecting IPv6 like fc00:f853:ccd:e793::/64.
SUBNET="$(
  docker network inspect kind -f '{{range .IPAM.Config}}{{println .Subnet}}{{end}}' \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/' \
    | head -n1
)"

if [ -z "${SUBNET}" ]; then
  echo "ERROR: No IPv4 subnet found on Docker network 'kind'."
  echo
  echo "Available kind network subnets:"
  docker network inspect kind -f '{{range .IPAM.Config}}{{println .Subnet}}{{end}}'
  echo
  echo "Your kind network may be IPv6-only. Recreate kind with IPv4 enabled."
  exit 1
fi

# Example:
# SUBNET=172.18.0.0/16
# PREFIX=172.18
PREFIX="$(echo "$SUBNET" | awk -F. '{print $1"."$2}')"

POOL_START="${PREFIX}.255.200"
POOL_END="${PREFIX}.255.250"

info "kind subnet ${SUBNET} -> MetalLB pool ${POOL_START}-${POOL_END}"

POOL_FILE="$(mktemp)"

cat > "$POOL_FILE" <<EOF
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: course-pool
  namespace: metallb-system
spec:
  addresses:
    - "${POOL_START}-${POOL_END}"
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: course-l2
  namespace: metallb-system
spec:
  ipAddressPools:
    - course-pool
EOF

# Remove any broken previous attempt, then apply cleanly
kubectl delete ipaddresspool course-pool -n metallb-system --ignore-not-found=true
kubectl delete l2advertisement course-l2 -n metallb-system --ignore-not-found=true

retry kubectl apply -f "$POOL_FILE"

rm -f "$POOL_FILE"

# ── ingress-nginx Layer 7 Ingress Controller ──────────────────────────────
step "installing the NGINX ingress controller"

ING="$(
  curl -fsSL https://api.github.com/repos/kubernetes/ingress-nginx/releases \
    | sed -n 's/.*"tag_name": *"\(controller-[^"]*\)".*/\1/p' \
    | head -1
)"

info "version ${ING}"

kubectl apply -f "https://raw.githubusercontent.com/kubernetes/ingress-nginx/${ING}/deploy/static/provider/kind/deploy.yaml"

kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller --timeout=180s

# ── NetworkPolicy enforcement ─────────────────────────────────────────────
step "installing kube-network-policies so NetworkPolicies are enforced"

kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/kube-network-policies/main/install.yaml

kubectl -n kube-system rollout status ds/kube-network-policies --timeout=180s

# ── Sample app ────────────────────────────────────────────────────────────
step "deploying the sample web app and its Services"

kubectl apply -f manifests/web.yaml
kubectl apply -f manifests/ingress.yaml

kubectl -n ch4 rollout status deploy/web --timeout=120s

# ── Test 1: LoadBalancer ──────────────────────────────────────────────────
step "TEST 1 — LoadBalancer service got an external IP"

LB=""

for i in $(seq 1 20); do
  LB="$(
    kubectl -n ch4 get svc web-lb \
      -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true
  )"

  [ -n "$LB" ] && break

  sleep 3
done

kubectl -n ch4 get svc web-lb

if [ -n "$LB" ]; then
  info "reaching ${LB} from inside the cluster:"

  kubectl -n ch4 run lbtest \
    --image=curlimages/curl:latest \
    --restart=Never \
    -i \
    --rm \
    --quiet \
    -- curl -s -m 5 -o /dev/null -w "  http code: %{http_code}\n" "http://${LB}" \
    2>/dev/null || warn "LB test skipped"
else
  warn "LoadBalancer service did not receive an external IP"
fi

# ── Test 2: Ingress ───────────────────────────────────────────────────────
step "TEST 2 — Ingress routes web.local to the app"

sleep 3

CODE="$(
  curl -s -m 5 -o /dev/null -w '%{http_code}' \
    -H 'Host: web.local' \
    http://localhost || echo '000'
)"

info "curl -H 'Host: web.local' http://localhost -> ${CODE}  200 means success"

# ── Test 3: NetworkPolicy ─────────────────────────────────────────────────
step "TEST 3 — applying NetworkPolicies, then testing who can reach web"

kubectl apply -f manifests/netpol.yaml

sleep 5

ALLOWED="$(
  kubectl -n ch4 run client \
    --image=curlimages/curl:latest \
    --labels='role=client' \
    --restart=Never \
    -i \
    --rm \
    --quiet \
    -- sh -c 'curl -s -m 5 -o /dev/null -w "%{http_code}" http://web-clusterip || echo BLOCKED' \
    2>/dev/null | tail -1
)"

BLOCKED="$(
  kubectl -n ch4 run stranger \
    --image=curlimages/curl:latest \
    --restart=Never \
    -i \
    --rm \
    --quiet \
    -- sh -c 'curl -s -m 5 -o /dev/null -w "%{http_code}" http://web-clusterip || echo BLOCKED' \
    2>/dev/null | tail -1
)"

info "pod labelled role=client -> ${ALLOWED}   expect 200"
info "pod with no label        -> ${BLOCKED}   expect BLOCKED"

title "Done"

info "Open the app in your browser:"
info "curl -H 'Host: web.local' http://localhost"

info "Clean up:"
info "./cleanup.sh"