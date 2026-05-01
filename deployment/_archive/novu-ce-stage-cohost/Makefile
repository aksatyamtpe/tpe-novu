# =============================================================================
# Novu CE Stack — Makefile
# -----------------------------------------------------------------------------
# Common operations. Run `make help` for the full list.
# =============================================================================

.DEFAULT_GOAL := help
SHELL := /bin/bash

# Colours
BLUE := \033[0;36m
GREEN := \033[0;32m
RESET := \033[0m

.PHONY: help bootstrap up down logs ps health smoke sync sync-prod backup upgrade clean nuke

help:  ## Show this help
	@printf "$(BLUE)Novu CE Stack$(RESET)\n\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'

bootstrap:  ## Generate secrets and create .env (idempotent)
	@./scripts/bootstrap.sh

up:  ## Start all services (detached)
	@docker compose up -d --build
	@echo ""
	@echo "  Dashboard: $$(grep ^FRONT_BASE_URL .env | cut -d= -f2-)"
	@echo "  API:       $$(grep ^API_ROOT_URL .env | cut -d= -f2-)"
	@echo ""

down:  ## Stop all services (volumes preserved)
	@docker compose down

restart:  ## Restart all services
	@docker compose restart

logs:  ## Tail logs from all services
	@docker compose logs -f --tail=100

logs-api:      ## Tail api logs
	@docker compose logs -f --tail=200 api

logs-worker:   ## Tail worker logs
	@docker compose logs -f --tail=200 worker

logs-ws:       ## Tail websocket logs
	@docker compose logs -f --tail=200 ws

ps:  ## Show service status
	@docker compose ps

health:  ## Run health checks across all services
	@printf "$(BLUE)Health$(RESET)\n"
	@docker compose ps --format '  {{.Name}}\t{{.Status}}'

sync:  ## Sync Bridge workflows to dev environment (STAGE-COHOST: remapped ports)
	@. ./.env && cd bridge && \
	  npx novu@latest sync \
	    --bridge-url http://localhost:14001/api/novu \
	    --api-url    http://localhost:13000 \
	    --secret-key $$NOVU_SECRET_KEY

sync-prod:  ## Sync Bridge workflows to prod environment (requires PROD_API_KEY)
	@cd bridge && \
	  npx novu@latest sync \
	    --bridge-url $(BRIDGE_PUBLIC_URL)/api/novu \
	    --api-url    $(API_ROOT_URL) \
	    --secret-key $(PROD_API_KEY)

smoke:  ## Run end-to-end CE feature smoke tests (requires NOVU_API_KEY)
	@./scripts/smoke-test.sh

backup:  ## Backup Mongo + Redis to ./backups/<timestamp>/
	@./scripts/backup.sh

upgrade:  ## Upgrade Novu version: make upgrade VERSION=2.4.0
	@./scripts/upgrade.sh $(VERSION)

clean:  ## Stop services and remove containers (volumes preserved)
	@docker compose down --remove-orphans

nuke:  ## DESTRUCTIVE: stop services AND delete all data volumes
	@printf "\033[0;31mThis will DELETE all Novu data. Type DELETE to confirm: \033[0m"; \
	read confirm; \
	[ "$$confirm" = "DELETE" ] && docker compose down -v --remove-orphans || echo "Aborted"
