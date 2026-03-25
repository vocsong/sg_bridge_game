#!/bin/bash
set -a
source .env
set +a
source venv/bin/activate
echo "Starting SG Bridge Bot locally..."
echo "Webhook: $WEBHOOK_URL"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
