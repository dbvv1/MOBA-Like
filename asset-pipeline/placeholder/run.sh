#!/bin/sh
set -eu
asset_task_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export BLENDER_USER_CONFIG="$asset_task_dir/.cache/config"
export BLENDER_USER_EXTENSIONS="$asset_task_dir/.cache/extensions"
mkdir -p "$BLENDER_USER_CONFIG" "$BLENDER_USER_EXTENSIONS"
for asset_task_script in build validate test_revision preview; do
  blender -b --factory-startup --disable-autoexec --python-exit-code 1 --python "$asset_task_dir/$asset_task_script.py"
done
