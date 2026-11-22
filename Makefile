.PHONY: install demo test build
ifeq ($(OS),Windows_NT)
PYTHON = .venv/Scripts/python
else
PYTHON = .venv/bin/python
endif
install:
	python scripts/setup.py
demo:
	python scripts/demo.py
test:
	$(PYTHON) -m pytest
build:
	npm --prefix web run build
