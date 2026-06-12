#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
need kubectl helm
helm uninstall kps -n monitoring >/dev/null 2>&1 || true
helm uninstall loki -n monitoring >/dev/null 2>&1 || true
kubectl delete namespace monitoring --ignore-not-found
info "done (CRDs from the prometheus stack may remain; that's fine)"
