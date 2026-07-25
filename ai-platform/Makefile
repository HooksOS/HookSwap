# ============================================================================
# HookSwap AI Knowledge Platform — Makefile
# Dev/ops entrypoints for the compose stack, k8s, and the VPS deploy.
# Run `make help` for the full list.
# ============================================================================

SHELL       := /bin/bash
.DEFAULT_GOAL := help

# --- config ---------------------------------------------------------------
COMPOSE          ?= docker compose
COMPOSE_FILE     ?= docker-compose.yml
COMPOSE_PROD     ?= docker-compose.production.yml
ENV_FILE         ?= .env
ENV_EXAMPLE      ?= infra/env/.env.example
REGISTRY         ?= ghcr.io/hookswap
IMAGE_TAG        ?= dev
PROD             := $(COMPOSE) -f $(COMPOSE_FILE) -f $(COMPOSE_PROD)

# k8s
KUBECTL          ?= kubectl
KUSTOMIZE_STAGING := infra/k8s/overlays/staging
KUSTOMIZE_PROD    := infra/k8s/overlays/prod

# VPS (matches the DEX's existing host/pattern)
VPS_HOST         ?= 15.204.8.186
VPS_USER         ?= ubuntu
VPS_DIR          ?= /opt/hookswap-ai

# --- meta -----------------------------------------------------------------
.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_.-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

$(ENV_FILE):
	@test -f $(ENV_FILE) || (cp $(ENV_EXAMPLE) $(ENV_FILE) && echo "Created $(ENV_FILE) from $(ENV_EXAMPLE) — edit secrets before deploying.")

.PHONY: env
env: $(ENV_FILE) ## Create .env from the example if missing

# --- local dev stack ------------------------------------------------------
.PHONY: up
up: env ## Start the full dev stack (detached)
	$(COMPOSE) --profile full up -d

.PHONY: up-core
up-core: env ## Start core services only (no dashboards profile)
	$(COMPOSE) up -d

.PHONY: down
down: ## Stop the stack (keep volumes)
	$(COMPOSE) down

.PHONY: nuke
nuke: ## Stop the stack AND delete all volumes (DESTRUCTIVE)
	$(COMPOSE) down -v --remove-orphans

.PHONY: ps
ps: ## List running services
	$(COMPOSE) ps

.PHONY: logs
logs: ## Tail logs for all services (S=svc for one)
	$(COMPOSE) logs -f --tail=200 $(S)

.PHONY: restart
restart: ## Restart a service (S=backend)
	$(COMPOSE) restart $(S)

.PHONY: build
build: env ## Build all service images locally
	$(COMPOSE) build

.PHONY: pull
pull: ## Pull datastore/base images
	$(COMPOSE) pull

# --- app lifecycle --------------------------------------------------------
.PHONY: migrate
migrate: ## Run DB migrations (alembic) inside the backend container
	$(COMPOSE) exec backend alembic upgrade head

.PHONY: migrate-new
migrate-new: ## Create a new migration: make migrate-new M="msg"
	$(COMPOSE) exec backend alembic revision --autogenerate -m "$(M)"

.PHONY: seed
seed: ## Seed baseline data (chains registry, default tenant)
	$(COMPOSE) exec backend python -m app.scripts.seed

.PHONY: ingest
ingest: ## Build the RAG corpus from the repo (docs, CLAUDE.md, deployments, chains)
	@# Runs on the HOST, not in the container: it reads the parent HookSwap repo
	@# (docs/, CLAUDE.md, contracts/deployments/) which is outside the build context,
	@# and writes <ai-platform>/data/corpus.json — the path the backend mounts read-only.
	@# Provider/keys come from backend/.env. With a free-tier Voyage key this is
	@# rate-paced (3 RPM / 10K TPM) and takes ~9 min; adding billing makes it seconds.
	$(or $(PYTHON),backend/.venv/bin/python) ingestion/ingest_docs.py

.PHONY: serve
serve: ## Run the RAG backend LOCALLY on 127.0.0.1:8000 (loopback only, never exposed)
	@# Deliberately binds 127.0.0.1, not 0.0.0.0: this platform is INTERNAL-ONLY
	@# (see CLAUDE.md) and must never be reachable from the network without an
	@# explicit decision. Auth is enforced — set HOOKSWAP_AI_API_KEYS in backend/.env
	@# and send `X-API-Key: <key>`; with no keys configured every request 401s.
	cd backend && ./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port $(or $(PORT),8000) --reload

.PHONY: venv
venv: ## Create the backend virtualenv used by `make ingest` (needs python3.11+)
	$(or $(PY311),python3.11) -m venv backend/.venv
	backend/.venv/bin/pip install -q --upgrade pip
	backend/.venv/bin/pip install -q -r backend/requirements.txt
	@echo "venv ready: backend/.venv"

.PHONY: shell
shell: ## Open a shell in a service (S=backend)
	$(COMPOSE) exec $(or $(S),backend) /bin/sh

.PHONY: psql
psql: ## Open psql against the dev database
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER:-hookswap} -d $${POSTGRES_DB:-hookswap_ai}

.PHONY: redis-cli
redis-cli: ## Open redis-cli
	$(COMPOSE) exec redis redis-cli

# --- quality --------------------------------------------------------------
.PHONY: lint
lint: ## Lint backend (ruff) — CI parity
	$(COMPOSE) run --rm --no-deps backend ruff check app

.PHONY: test
test: ## Run backend tests
	$(COMPOSE) run --rm backend pytest -q

# --- images (CI parity) ---------------------------------------------------
.PHONY: images
images: ## Build+tag all images for the registry (IMAGE_TAG=...)
	docker build -t $(REGISTRY)/ai-backend:$(IMAGE_TAG)            -f backend/Dockerfile backend
	docker build -t $(REGISTRY)/ai-frontend:$(IMAGE_TAG)          -f frontend/Dockerfile frontend
	docker build -t $(REGISTRY)/ai-ingestion-workers:$(IMAGE_TAG) -f ingestion/Dockerfile ingestion
	docker build -t $(REGISTRY)/ai-agents-runtime:$(IMAGE_TAG)    -f agents/Dockerfile agents

.PHONY: push
push: ## Push all images to the registry
	docker push $(REGISTRY)/ai-backend:$(IMAGE_TAG)
	docker push $(REGISTRY)/ai-frontend:$(IMAGE_TAG)
	docker push $(REGISTRY)/ai-ingestion-workers:$(IMAGE_TAG)
	docker push $(REGISTRY)/ai-agents-runtime:$(IMAGE_TAG)

# --- production: single VPS (compose) -------------------------------------
.PHONY: prod-up
prod-up: ## Bring up the production overlay locally/on-host
	$(PROD) up -d

.PHONY: prod-down
prod-down: ## Stop the production overlay
	$(PROD) down

.PHONY: prod-logs
prod-logs: ## Tail production logs (S=svc)
	$(PROD) logs -f --tail=200 $(S)

.PHONY: deploy-vps
deploy-vps: ## Deploy to the VPS over ssh (rsync + compose pull/up)
	rsync -az --delete \
	  --exclude '.env' --exclude '.git' --exclude 'node_modules' \
	  ./ $(VPS_USER)@$(VPS_HOST):$(VPS_DIR)/
	ssh $(VPS_USER)@$(VPS_HOST) "cd $(VPS_DIR) && \
	  $(COMPOSE) -f $(COMPOSE_FILE) -f $(COMPOSE_PROD) pull && \
	  $(COMPOSE) -f $(COMPOSE_FILE) -f $(COMPOSE_PROD) up -d && \
	  $(COMPOSE) -f $(COMPOSE_FILE) -f $(COMPOSE_PROD) exec -T backend alembic upgrade head"

.PHONY: certbot-issue
certbot-issue: ## First-time TLS issuance on the VPS (ai. + api.hookswap.org)
	ssh $(VPS_USER)@$(VPS_HOST) "cd $(VPS_DIR) && \
	  docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v certbot-webroot:/var/www/certbot \
	  certbot/certbot certonly --webroot -w /var/www/certbot \
	  -d ai.hookswap.org -d api.hookswap.org --agree-tos -m ops@hookswap.org --non-interactive"

# --- production: kubernetes ------------------------------------------------
.PHONY: k8s-render-staging
k8s-render-staging: ## Render staging manifests (dry-run)
	$(KUBECTL) kustomize $(KUSTOMIZE_STAGING)

.PHONY: k8s-render-prod
k8s-render-prod: ## Render prod manifests (dry-run)
	$(KUBECTL) kustomize $(KUSTOMIZE_PROD)

.PHONY: k8s-deploy-staging
k8s-deploy-staging: ## Apply staging overlay
	$(KUBECTL) apply -k $(KUSTOMIZE_STAGING)

.PHONY: k8s-deploy-prod
k8s-deploy-prod: ## Apply prod overlay
	$(KUBECTL) apply -k $(KUSTOMIZE_PROD)

.PHONY: k8s-diff-prod
k8s-diff-prod: ## Diff prod overlay against the cluster
	$(KUBECTL) diff -k $(KUSTOMIZE_PROD) || true

# --- terraform ------------------------------------------------------------
.PHONY: tf-init tf-plan tf-apply
tf-init: ## terraform init
	cd infra/terraform && terraform init
tf-plan: ## terraform plan (var-file=terraform.tfvars)
	cd infra/terraform && terraform plan -var-file=terraform.tfvars
tf-apply: ## terraform apply
	cd infra/terraform && terraform apply -var-file=terraform.tfvars

# --- health ---------------------------------------------------------------
.PHONY: health
health: ## Curl the local backend/frontend health endpoints
	@echo "backend:  $$(curl -fsS http://localhost:$${BACKEND_PORT:-8000}/health || echo DOWN)"
	@echo "frontend: $$(curl -fsS -o /dev/null -w '%{http_code}' http://localhost:$${FRONTEND_PORT:-3000} || echo DOWN)"
