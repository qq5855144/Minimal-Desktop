#!/bin/bash

VITE_TEMP="node_modules/.vite-temp"
if [ -L "$VITE_TEMP" ]; then
    rm "$VITE_TEMP"
    mkdir -p "$VITE_TEMP"
elif [ ! -e "$VITE_TEMP" ]; then
    mkdir -p "$VITE_TEMP"
fi

# 平台预览部署到 /workspace/.dist，base 必须为 /（而非 GitHub Pages 用的 /Minimal-Desktop/）
OUTPUT=$(npx vite build --minify false --logLevel error --base=/ --outDir /workspace/.dist 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "$OUTPUT"
fi

exit $EXIT_CODE
