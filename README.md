# Xedoc Projects

Graph-aware project workspace for AI-assisted software work.

## MVP scope

- Project dashboard with graph health metrics.
- Project creation with Git URL and branch settings.
- Git clone/pull into per-project workspaces.
- Repository file tree and file preview.
- File, directory, dependency, import, symbol, chat, message, and model-run graph nodes.
- Graph Explorer with search, neighborhood traversal depth 1-3, node details, provenance, and graph diffs.
- Project chats with graph-aware context packing simulator.
- Worker registry API and worker dashboard for future Ollama/home-worker runs.
- Chat provider layer with xedoc.ru agent gateway, OpenAI-compatible, xAI/Grok, Gemini API, and local graph fallback.

## Local development

```bash
npm install
npm run dev
```

The Vite UI runs on `http://localhost:5173`; the API runs on `http://localhost:8787`.

## Production

```bash
npm ci
npm run build
PORT=8787 DATA_DIR=/var/www/projects.xedoc.ru/data node dist-server/server/index.js
```

Set `XEDOC_ACCESS_TOKEN` to protect the web UI and API with a bearer token.

## Chat providers

The preferred reuse path is the existing xedoc.ru model gateway:

```bash
XEDOC_MODEL_API_BASE=https://xedoc.ru
XEDOC_MODEL_API_TOKEN=...
XEDOC_MODEL_API_AGENT_ID=...
XEDOC_MODEL_API_REPO_ID=...
```

Direct completion providers are also supported through `OPENAI_API_KEY`, `XAI_API_KEY`, and `GEMINI_API_KEY`/`GOOGLE_API_KEY`.
