# =============================================================================
# RentFlow Agent — VPS deploy shortcuts
# =============================================================================
# Run from the repo root on the production VPS. Always uses the prod compose
# file so you never accidentally bring up the dev stack (Postgres + Redis
# locally), which collides with the rentalho-ai redis on port 6379.
#
# Usage examples (run on the VPS):
#   make deploy     # pull, rebuild API, restart, tail logs
#   make logs       # tail last 100 lines + follow
#   make ps         # show container status
#   make restart    # restart without rebuild
#   make health     # curl /health
# =============================================================================

COMPOSE := docker compose -f docker-compose.prod.yml

.PHONY: help deploy build up restart down ps logs health sh

help:
	@echo "RentFlow Agent — make targets:"
	@echo "  deploy   pull + build + up + tail logs (the usual one)"
	@echo "  build    rebuild api image without restarting"
	@echo "  up       start api (no pull, no rebuild)"
	@echo "  restart  restart api container"
	@echo "  down     stop api"
	@echo "  ps       show container status"
	@echo "  logs     tail last 100 lines, follow"
	@echo "  health   curl /health on localhost"
	@echo "  sh       open a shell inside the running api container"

deploy:
	git pull origin main
	$(COMPOSE) up -d --build api
	$(COMPOSE) logs api --tail 50

build:
	$(COMPOSE) build api

up:
	$(COMPOSE) up -d api

restart:
	$(COMPOSE) restart api

down:
	$(COMPOSE) down

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs api --tail 100 -f

health:
	@curl -fsS http://127.0.0.1:3001/health && echo "" || echo "API not responding on :3001"

sh:
	$(COMPOSE) exec api sh
