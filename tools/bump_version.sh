#!/bin/sh
# Stamp a new version on the page's scripts and stylesheet so browsers fetch the new files after a deploy.
cd "$(dirname "$0")/../site" || exit 1
V=$(date +%Y%m%d%H%M)
sed -i -E "s#(href=\"style\.css)(\?v=[0-9]+)?\"#\1?v=$V\"#; s#(src=\"(sfx|game|render3d)\.js)(\?v=[0-9]+)?\"#\1?v=$V\"#g" index.html
sed -i -E "s#new Worker\(\"engine-worker\.js(\?v=[0-9]+)?\"\)#new Worker(\"engine-worker.js?v=$V\")#" game.js
echo "version $V"
