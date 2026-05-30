# Company Brain

Local folder-backed company brain. Upload text documents, then ask questions. Backend retrieves relevant snippets from `data/uploads` and calls local Codex CLI for the final answer.

Uploads also trigger a Codex pass that turns fragmented file content into a structured documentation hub at `data/documentation-hub.json`. Chat can also edit a small live CAD model saved at `data/cad-state.json`; documentation hub constraints are included in CAD chat prompts and validated server-side.

## Run

```bash
go run ./cmd/company-brain
```

In another terminal:

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173`.

## Config

- `ADDR`: backend address, default `:8080`
- `BRAIN_STORE`: upload folder, default `data/uploads`
- `DOCUMENTATION_HUB_PATH`: structured documentation hub JSON path, default `data/documentation-hub.json`
- `CAD_STATE_PATH`: live CAD model JSON path, default `data/cad-state.json`
- `CODEX_BIN`: Codex CLI path, default `codex`
- `CORS_ORIGIN`: frontend origin, default `http://localhost:5173`
