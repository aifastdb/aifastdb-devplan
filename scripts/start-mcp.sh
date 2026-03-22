#!/usr/bin/env bash
node "$(cd "$(dirname "$0")/.." && pwd)/dist/mcp-server/index.js" "$@"
