#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Explicit transactional rename before schema introspection can mistake it for
# a drop/add. Failure leaves the old schema and all historical values intact.
pnpm --filter @workspace/api-server run migrate:quote-codes
pnpm --filter db push
