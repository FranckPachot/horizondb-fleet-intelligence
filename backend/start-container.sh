#!/bin/sh
set -eu

python -m app.setup_database
exec python -m app.server
