#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p exported
magick source/generated/earth-quiet-v2.png -quality 90 -define webp:method=6 exported/earth.webp
magick source/generated/forest-quiet-v2.png -quality 90 -define webp:method=6 exported/forest.webp
magick source/generated/wall-mineral-v1.png -quality 90 -define webp:method=6 exported/wall.webp
