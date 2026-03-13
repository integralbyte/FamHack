#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SOURCE_DIR="$ROOT_DIR/api/_lib/launch-pages"

required_files="
about.html
tracks.html
register.html
join.html
dashboard.html
ctf.html
"

for relative_path in $required_files; do
  if [ ! -f "$SOURCE_DIR/$relative_path" ]; then
    echo "Missing launch file: $SOURCE_DIR/$relative_path" >&2
    exit 1
  fi
done

cp "$SOURCE_DIR/about.html" "$ROOT_DIR/about.html"
cp "$SOURCE_DIR/tracks.html" "$ROOT_DIR/tracks.html"
cp "$SOURCE_DIR/register.html" "$ROOT_DIR/register.html"
cp "$SOURCE_DIR/join.html" "$ROOT_DIR/join.html"
cp "$SOURCE_DIR/dashboard.html" "$ROOT_DIR/dashboard.html"
cp "$SOURCE_DIR/ctf.html" "$ROOT_DIR/ctf.html"

echo "Launch pages promoted from $SOURCE_DIR"
