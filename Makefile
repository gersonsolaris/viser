##################################################################
# HELP
##################################################################
.PHONY: help
help:
	@echo "Available Make Targets:"
	@echo "  Development:"
	@echo "    make install-dev       - Install development dependencies"
	@echo "    make setup-pre-commit   - Setup pre-commit hooks"
	@echo ""
	@echo "  Code Quality:"
	@echo "    make format            - Format code with pre-commit"
	@echo "    make lint              - Lint code with pre-commit (show diffs)"
	@echo "    make format-cpp        - Format C/C++ code (clang-format)"
	@echo "    make clean-cache       - Clean Python cache files (__pycache__, .pyc, etc.)"
	@echo ""
	@echo "  Git/Version Control:"
	@echo "    make commit            - Create conventional commit with commitizen"
	@echo "    make bump              - Bump version and generate changelog"
	@echo "    make bump-dry          - Dry run for version bump"
	@echo "    make changelog         - Generate changelog"
	@echo "    make check-commit      - Check commit message format"
	@echo ""
	@echo "  Docker:"
	@echo "    make build-isaaclab_v220    - Build isaaclab Docker image"
	@echo "    make build-3dgrut-cu118     - Build 3dgrut-cu118 Docker image"
	@echo "    make build-3dgrut-cu128     - Build 3dgrut-cu128 Docker image"
	@echo ""
	@echo "    make build-viser  - Build viser Docker image"
	@echo ""
	@echo "    make start-viser  - Start viser container"
	@echo "    make stop-viser   - Stop viser container"
	@echo ""
	@echo "  Other:"
	@echo "    make pre-build         - Setup build environment"
	@echo "    make help              - Show this help message"

##################################################################
# ENV VARS
##################################################################
export GID := $(shell id -g)
export UID := $(shell id -u)
export CURRENT_USER := $(shell whoami)
export BRANCH := $(shell git rev-parse --abbrev-ref HEAD)
export COMMIT_ID := $(shell git rev-parse --short=9 HEAD)
export BUILD_TIME := $(shell date '+%Y%m%d')
export COMMIT_BODY := $(shell git rev-list --format=%B --max-count=1 HEAD | tail +2)
export USERNAME := $(ACCOUNT_NAME)
export PASSWORD := $(ACCOUNT_PASSWORD)
export DOCKER_CONTAINER_NAME := $(CONTAINER_NAME)
export HOST_VOLUME := $(HOST_VOLUME)
export IS_CUDA := $(shell command -v nvidia-smi >/dev/null 2>&1 && echo "true" || echo "false")
export PROJECT_NAME := viser
export BUILDKIT_PROGRESS := plain

ifeq "$(BRANCH)" "dev"
	DOCKER_NAMESPACE := dev
else ifeq "$(BRANCH)" "develop"
	DOCKER_NAMESPACE := dev
else ifeq "$(BRANCH)" "master"
	DOCKER_NAMESPACE := prod
else
	DOCKER_NAMESPACE := stage
endif
export DOCKER_NAMESPACE := $(DOCKER_NAMESPACE)

# check username and password
ifeq ($(USERNAME),)
$(warning USERNAME is not set)
endif
ifeq ($(PASSWORD),)
$(warning PASSWORD is not set)
endif

.PHONY: pre-build install-dev setup-pre-commit format-py format-cpp lint clean-cache
pre-build:
	@if [ ! -e .venv ]; then echo "Creating virtual environment..." && python3 -m venv .venv; else echo "Virtual environment already exists."; fi
# 	python .devlinks.py
	@echo "DOCKER_NAMESPACE: $(DOCKER_NAMESPACE)"
	@echo "GID: $(GID)"
	@echo "UID: $(UID)"
	@echo "BRANCH: $(BRANCH)"
	@echo "COMMIT_ID: $(COMMIT_ID)"
	@echo "BUILD_TIME: $(BUILD_TIME)"
	@echo "USERNAME: $(USERNAME)"
	@echo "PASSWORD: $(PASSWORD)"
	@echo "container name: $(DOCKER_CONTAINER_NAME)"

pytest:
	LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6 pytest -v $(filter-out $@, $(MAKECMDGOALS))

##################################################################
# PYTHON CODE QUALITY TASKS
##################################################################
install-dev:
	pip install -r requirements/dev.txt

setup-pre-commit: install-dev
	pre-commit install --install-hooks

# Format C/C++ code with clang-format
format-cpp:
	@echo "Formatting C/C++ code with clang-format"
	find src -name "*.cpp" -o -name "*.h" -o -name "*.hpp" -o -name "*.c" -o -name "*.cuh" -o -name "*.cu" -o -name "*.cc" | xargs clang-format -i

# Format Python code with pre-commit (includes ruff, black, isort, etc.)
format-py:
	@echo "Formatting python code with ruff"
	ruff format --config=.ruff.toml .
	ruff check --fix --config=.ruff.toml --output-format=pylint .

format: format-cpp format-py
	@echo "Formatting CMake code with cmakelang"
	find src -type f \( -name "*.cmake" -o -name "CMakeLists.txt" \) | xargs python -m cmakelang.format -i
	@echo "Running pre-commit hooks to format code"
	pre-commit run --all-files --color=always

# Lint code with pre-commit
.PHONY: lint
lint:
	ruff check --config=.ruff.toml --output-format=full .
	pre-commit run --show-diff-on-failure --color=always

# Clean Python cache files
.PHONY: clean-cache
clean-cache:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	find . -type f -name "*.pyo" -delete 2>/dev/null || true
	find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true

##################################################################
# COMMITIZEN TASKS
##################################################################
.PHONY: commit bump bump-dry changelog check-commit
commit:
	cz commit

bump:
	cz bump

bump-dry:
	cz bump --dry-run

changelog:
	cz changelog

check-commit:
	cz check --rev-range HEAD~1..HEAD

dummy:
	@echo "This is a dummy commit"
	git commit -m "chore(.): dummy commit for testing"

##################################################################
# TASKS
##################################################################
.PHONY: build-viser start-viser stop-viser
build-viser: pre-build
	docker compose -p project${UID} -f docker-compose.yml build viser
start-viser: pre-build
	docker compose -p project${UID} -f docker-compose.yml up -d viser
stop-viser: pre-build
	docker compose -p project${UID} -f docker-compose.yml down viser
