# AREAA Strapi — local development
#
# Quick start:
#   make setup     # one-time: install deps + generate .env with fresh secrets
#   make seed      # populate sample content + grant Public read permissions
#   make dev       # serve admin + REST API at http://localhost:1337
#
# Run `make seed` while `make dev` is stopped — both open the same SQLite file.

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help setup install env dev seed fresh clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

setup: install env ## One-time bootstrap: install deps + generate .env
	@echo "✓ Setup complete. Next: 'make seed', then 'make dev'."

install: ## Install npm dependencies
	npm install

env: ## Generate .env with fresh secrets (no-op if .env already exists)
	@if [ -f .env ]; then \
		echo "✓ .env already exists — leaving it untouched."; \
	else \
		printf '%s\n' \
			"HOST=0.0.0.0" \
			"PORT=1337" \
			"APP_KEYS=$$(openssl rand -base64 32),$$(openssl rand -base64 32)" \
			"API_TOKEN_SALT=$$(openssl rand -base64 32)" \
			"ADMIN_JWT_SECRET=$$(openssl rand -base64 32)" \
			"TRANSFER_TOKEN_SALT=$$(openssl rand -base64 32)" \
			"JWT_SECRET=$$(openssl rand -base64 32)" \
			"ENCRYPTION_KEY=$$(openssl rand -base64 32)" \
			"DATABASE_CLIENT=sqlite" \
			"DATABASE_FILENAME=.tmp/data.db" \
			> .env; \
		echo "✓ Generated .env with fresh secrets (SQLite)."; \
	fi

dev: ## Start Strapi in develop mode (http://localhost:1337/admin)
	npm run dev

seed: ## Seed sample content + grant Public read permissions (idempotent)
	node scripts/seed.js

fresh: clean seed ## Wipe the local SQLite DB and re-seed from scratch

clean: ## Remove the local SQLite DB
	rm -f .tmp/data.db
