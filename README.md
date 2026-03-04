# 🦞 OpenClaw Setup Wizard

Fully automated OpenClaw setup. Zero questions. One command. Never breaks existing setups.

```
npx openclaw-setup-wizard
```

## What it does

1. **Detects your GPU** — NVIDIA, AMD, Apple Silicon, or CPU-only
2. **Checks/installs Ollama** — winget on Windows, curl on Linux
3. **Preserves your existing config** — tokens, channels, providers all kept
4. **Uses your installed models** — never pulls what you already have
5. **Picks the best model** for your VRAM if nothing's installed
6. **Writes `openclaw.json`** — gateway mode local, correct baseUrl, auth token
7. **Warms up your primary model** — 24h keepalive
8. **Kills duplicate gateways** — no port conflicts
9. **Runs diagnostics** — openclaw-doctor if available
10. **Launches the gateway**

## Options

```
npx openclaw-setup-wizard --telegram YOUR_BOT_TOKEN
npx openclaw-setup-wizard --discord YOUR_BOT_TOKEN
npx openclaw-setup-wizard --model qwen2.5:14b
npx openclaw-setup-wizard --no-launch
npx openclaw-setup-wizard --fresh
```

## Model Selection

| VRAM | Primary | Secondary |
|------|---------|-----------|
| 4GB  | qwen2.5:3b | — |
| 8GB  | qwen3:8b | — |
| 12GB | qwen3:8b | deepseek-r1:7b |
| 16GB | qwen2.5:14b | deepseek-r1:7b |
| 24GB+ | qwen2.5:32b | — |

Already-installed models are always preferred.

## Safe re-runs

Run the wizard as many times as you want. It will:
- Keep your existing gateway token (no more device_token_mismatch)
- Keep your Telegram/Discord channel config
- Keep any extra providers you added
- Back up your config before every change

Use `--fresh` to start from scratch.

## Companion

- [openclaw-doctor-pro](https://github.com/MetadataKing/openclaw-doctor-pro) — diagnostics + auto-repair

## License

MIT
