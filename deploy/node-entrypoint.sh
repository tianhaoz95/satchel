#!/bin/sh
# Configures the node from environment variables, then serves.
#   SATCHEL_PASSWORD (required on first start), SATCHEL_NAME, SATCHEL_ROOTS ("home=/vault,nas=/vault2"),
#   SATCHEL_RELAY + SATCHEL_RELAY_TOKEN (optional, from the portal or your own relay)
set -e
CLI="node /app/packages/node/src/cli.ts --data ${SATCHEL_DATA_DIR:-/data}"
ROOT_ARGS=""
for spec in $(echo "${SATCHEL_ROOTS:-home=/vault}" | tr ',' ' '); do ROOT_ARGS="$ROOT_ARGS --root $spec"; done
if [ ! -f "${SATCHEL_DATA_DIR:-/data}/config.json" ] || [ -n "$SATCHEL_PASSWORD" ]; then
  $CLI init $ROOT_ARGS --host 0.0.0.0 ${SATCHEL_NAME:+--name "$SATCHEL_NAME"} ${SATCHEL_PASSWORD:+--password "$SATCHEL_PASSWORD"}
fi
if [ -n "$SATCHEL_RELAY" ] && [ -n "$SATCHEL_RELAY_TOKEN" ]; then
  $CLI connect --relay "$SATCHEL_RELAY" --token "$SATCHEL_RELAY_TOKEN"
fi
exec $CLI serve
