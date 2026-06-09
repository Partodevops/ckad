# Lumen — common tasks. Run `make` (or `make help`) to see everything.
#
# Override the image on any command, e.g.
#   make release IMAGE=myname/lumen-web TAG=1.0

IMAGE ?= youruser/lumen-web
TAG   ?= latest
WEB_IMAGE := $(IMAGE):$(TAG)
export WEB_IMAGE

.DEFAULT_GOAL := help

# ---- Local (Docker) ----

up: ## Build + start app and Postgres -> http://localhost:3000
	docker compose up --build

down: ## Stop everything (keeps the database)
	docker compose down

clean: ## Stop everything AND wipe the database volume
	docker compose down -v

logs: ## Follow logs from all services
	docker compose logs -f

ps: ## Show running containers
	docker compose ps

psql: ## Open a psql shell in the database container
	docker compose exec db psql -U lumen -d lumen

# ---- Local (no Docker) ----

dev: ## Run with in-memory storage, no Docker needed -> http://localhost:3000
	cd app && npm install && npm run dev

# ---- Publish & deploy ----

build: ## Build the web image (set IMAGE / TAG to name it)
	docker build -t $(WEB_IMAGE) ./app

push: ## Push the image to the registry (run `docker login` first)
	docker push $(WEB_IMAGE)

release: build push ## Build then push the web image

deploy: ## Run from the published image (deploy.compose.yml)
	docker compose -f deploy.compose.yml up -d

# ---- Kubernetes (see KUBERNETES.md) ----

k8s-up: ## Deploy to Kubernetes (apply k8s/ manifests)
	kubectl apply -f k8s/

k8s-status: ## Show all Lumen objects in the cluster
	kubectl -n lumen get all

k8s-open: ## Forward the app to http://localhost:8080
	kubectl -n lumen port-forward svc/lumen-web 8080:80

k8s-down: ## Remove Lumen from Kubernetes
	kubectl delete -f k8s/

# ---- Helm (see KUBERNETES.md, Part 6) ----

helm-lint: ## Lint + render the Helm chart (no cluster needed)
	helm lint ./helm/lumen && helm template lumen ./helm/lumen

helm-up: ## Install/upgrade Lumen via Helm (set IMAGE / TAG)
	helm upgrade --install lumen ./helm/lumen -n lumen --create-namespace \
		--set web.image.repository=$(IMAGE) --set web.image.tag=$(TAG)

helm-down: ## Uninstall the Helm release
	helm uninstall lumen -n lumen

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}'

.PHONY: up down clean logs ps psql dev build push release deploy \
	k8s-up k8s-status k8s-open k8s-down helm-lint helm-up helm-down help
