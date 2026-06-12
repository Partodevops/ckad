# Chapter 15 — Monitoring & Logging

## The idea (plain English)

Two questions you always need to answer about a running cluster:

- **Is it healthy?** → **metrics** (CPU, memory, request rates). **Prometheus**
  collects them; **Grafana** draws the graphs; **Alertmanager** pages you when
  something's wrong.
- **What happened?** → **logs**. We use **Loki** + **Promtail**: Promtail ships
  every pod's logs to Loki, and you read them in the *same* Grafana.

> We use **Loki** instead of Elasticsearch/OpenSearch on purpose: Loki indexes
> only labels (not full text), so it's **much lighter** — perfect for a laptop —
> while still giving you searchable logs.

## Run it

```bash
./run.sh
```

> ⚠️ This is the heaviest chapter. Give Docker about **6 GB RAM** and clean up
> other chapters first. The Prometheus stack takes a few minutes to settle.

It installs Loki + Promtail, then the Prometheus stack with Grafana, and wires
Loki in as a Grafana data source.

## Try it yourself

```bash
kubectl -n monitoring port-forward svc/kps-grafana 3000:80
# open http://localhost:3000  (admin / admin)
```

- **Metrics:** open a built-in dashboard (e.g. *Compute Resources / Namespace*).
- **Logs:** **Explore** → data source **Loki** → query `{namespace="kube-system"}`.

## Clean up

```bash
./cleanup.sh
```

➡️ **Next:** [Chapter 16 — An Introduction to Istio](../16-istio-intro).
