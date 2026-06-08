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
