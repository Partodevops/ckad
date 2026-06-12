#!/usr/bin/env bash
#
# Chapter 15 — Monitoring & Logging.
#
# Metrics:
#   kube-prometheus-stack:
#     - Prometheus
#     - Grafana
#     - Alertmanager
#
# Logs:
#   Loki + Promtail
#
# Both metrics and logs are viewed from Grafana.

set -euo pipefail

source "$(dirname "$0")/../lib.sh"
cd "$(dirname "$0")"

need kubectl helm
need_cluster

title "Chapter 15 — Monitoring & Logging"

warn "this chapter is resource-heavy."
warn "give Docker Desktop at least 6GB RAM, preferably 8GB."
warn "close other course chapters before running this."

NS="monitoring"

diagnose_grafana() {
  warn "Grafana did not become Ready. Showing diagnostics..."

  echo
  echo "== Pods =="
  kubectl -n "$NS" get pods -o wide || true

  echo
  echo "== Grafana Deployment =="
  kubectl -n "$NS" describe deploy kps-grafana || true

  echo
  echo "== Grafana Pod Description =="
  kubectl -n "$NS" describe pod \
    -l app.kubernetes.io/name=grafana,app.kubernetes.io/instance=kps || true

  echo
  echo "== Grafana Logs =="
  kubectl -n "$NS" logs deploy/kps-grafana -c grafana --tail=120 || true

  echo
  echo "== Recent Events =="
  kubectl -n "$NS" get events --sort-by=.lastTimestamp | tail -60 || true
}

step "adding Helm repositories"

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
helm repo add grafana https://grafana.github.io/helm-charts >/dev/null
helm repo update prometheus-community grafana >/dev/null

step "creating namespace"

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

step "installing Loki + Promtail"

helm upgrade --install loki grafana/loki-stack -n "$NS" \
  --set grafana.enabled=false \
  --set prometheus.enabled=false \
  --set promtail.enabled=true \
  --set loki.persistence.enabled=false \
  --timeout 10m

step "checking Loki service"

kubectl -n "$NS" get svc | grep -E '^loki\s|loki' || true

step "installing Prometheus + Grafana + Alertmanager"

helm upgrade --install kps prometheus-community/kube-prometheus-stack -n "$NS" \
  -f monitoring-values.yaml \
  --timeout 15m

step "waiting for Grafana"

if ! kubectl -n "$NS" rollout status deploy/kps-grafana --timeout=600s; then
  diagnose_grafana
  exit 1
fi

step "checking monitoring pods"

kubectl -n "$NS" get pods -o wide

GRAFANA_PASS="$(
  kubectl -n "$NS" get secret kps-grafana \
    -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d || true
)"

title "Monitoring ready"

info "Grafana:"
info "  kubectl -n monitoring port-forward svc/kps-grafana 3000:80"
info ""
info "Open:"
info "  http://localhost:3000"
info ""
info "Login:"
info "  username: admin"
info "  password: ${GRAFANA_PASS:-admin}"
info ""
info "Metrics:"
info "  Dashboards -> Kubernetes / Compute Resources / Namespace (Pods)"
info ""
info "Logs:"
info "  Explore -> Loki -> query:"
info "  {namespace=\"kube-system\"}"
info ""
info "Alertmanager:"
info "  kubectl -n monitoring port-forward svc/kps-kube-prometheus-stack-alertmanager 9093:9093"
info "  http://localhost:9093"
info ""
info "Clean up:"
info "  ./cleanup.sh"
