# 🦞 OpenClaw Setup Wizard

Fully automated OpenClaw setup. Zero questions. One command.

```
npx openclaw-setup-wizard
```

## What it does

1. **Detects your GPU** — NVIDIA, AMD, Apple Silicon, or CPU-only
2. **Checks/installs Ollama** — winget on Windows, curl on Linux
3. **Uses your installed models** — never pulls what you already have
4. **Picks the best model** for your VRAM if nothing's installed
5. **Writes `openclaw.json`** — gateway mode local, correct baseUrl, auth token
6. **Warms up your primary model** — 24h keepalive
7. **Kills duplicate gateways** — no more 409 conflicts
8. **Runs diagnostics** — openclaw-doctor-pro if available
9. **Launches the gateway**

## Options

```
npx openclaw-setup-wizard --telegram YOUR_BOT_TOKEN
npx openclaw-setup-wizard --discord YOUR_BOT_TOKEN
npx openclaw-setup-wizard --model qwen2.5:14b
npx openclaw-setup-wizard --no-launch
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

## Companion

- [openclaw-doctor-pro](https://github.com/MetadataKing/openclaw-doctor-pro) — diagnostics + auto-repair

## License

MIT
