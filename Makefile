PYTHON ?= python3

.PHONY: all build open test clean

all: build

# 总是重新生成：costs.jsonl 每轮都在变，按 mtime 判断容易拿到旧数据
build:
	$(PYTHON) build.py

open: build
	open cost-board.html

test:
	$(PYTHON) -m unittest discover -s tests -v
	node tests/test_pricing.js

clean:
	rm -f cost-board.html data.snapshot.json
	rm -rf __pycache__ tests/__pycache__ .ruff_cache
