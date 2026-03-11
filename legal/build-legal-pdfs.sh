#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
tectonic legal/FH-Privacy-Policy.tex --outdir "$ROOT_DIR"
tectonic legal/FH-Code-of-Conduct.tex --outdir "$ROOT_DIR"
