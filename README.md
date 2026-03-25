# SG Bridge Bot

A Telegram Bot to host games of Singaporean (Floating) Bridge built in Python3.

Try it out on Telegram at @singapore_bridge_bot

## Credit

This code is based on the original SG Bridge Bot project (original author: @sg_bridge_bot) and updated by this fork.

## What’s new in this version

- Changed from polling-based telegram bot in older `python-telegram-bot` versions to webhook-based architecture.
- Uses FastAPI and python-telegram-bot webhooks with `/webhook` endpoint in `main.py`.
- Uses environment variable configuration via `.env` (`TELEGRAM_TOKEN`, `WEBHOOK_URL`).

## Setup

1. Install dependencies

```bash
pip install -r requirements.txt
```

2. Create bot and configure token

- Create a Telegram bot via BotFather and get `TELEGRAM_TOKEN`.
- Set `WEBHOOK_URL` to your publicly reachable HTTPS URL.

3. Run locally

```bash
./start_local.sh
```

4. Production

- Deploy on host/server with public URL.
- Start Uvicorn: `uvicorn main:app --host 0.0.0.0 --port 8000`.
- Ensure webhook is reachable and `WEBHOOK_URL` is set properly.

## Notes

- Game logic is in `bridge.py`.
- Command flow is in `handlers.py`.
- Keyboard UI is in `keyboards.py`.

## Legacy note

The older version used polling and `bot.py`, whereas this fork is webhook-first for modern performance and reliability.
