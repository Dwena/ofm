#!/usr/bin/env sh
# Compatibilité : le script est désormais en Node (scripts/dev-up.mjs) pour marcher aussi sous Windows.
exec node "$(dirname "$0")/dev-up.mjs" "$@"
