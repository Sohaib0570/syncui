# SyncUI: Prompt-to-UI Co-Design Canvas

Standalone web app. Node server (no npm packages) + browser front end. The LLM is called from the server, so your API key never reaches the browser.

## Run locally
1. Install Node 18 or newer (https://nodejs.org).
2. Copy `.env.example` to `.env` and fill in ONE option:
   - FREE: `GEMINI_API_KEY=...` from https://aistudio.google.com/app/apikey (no card needed)
   - FREE: `GROQ_API_KEY=...` from https://console.groq.com
   - FREE and offline: install Ollama, run `ollama pull llama3.1`, then set `LLM_BASE_URL=http://localhost:11434/v1` and `LLM_MODEL=llama3.1`
   - Paid: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
3. Start: `node server.js` (or `npm start`)
4. Open http://localhost:3000

The header badge shows `LLM: live (...)` when the key works. Without a key the app still runs using a rule-based fallback.

## Using it
- **Generate:** the prompt is sent to the LLM with a JSON component-tree schema. Output streams into "Live model output" and the canvas builds while it streams.
- **Direct manipulation (no AI call):** drag, resize, edit in the inspector, drop an element into another container to re-parent.
- **Scoped AI command:** select an element, type an instruction. Only that subtree is sent and replaced.
- **Why this design choice:** every node carries a rationale from the model.
- **Prompt-only baseline:** the checkbox disables direct manipulation and scoped edits (control condition).
- **Metrics:** AI prompts, scoped AI, manual edits, re-parents, undos, plus an event log with LLM latency.

## Deploy (optional, free)
Push this folder to GitHub, create a Web Service on Render.com (build: none, start: `node server.js`), and add the API key as an environment variable.

## Files
- `server.js`: static server + `/api/llm` streaming proxy + `/api/status`
- `public/index.html`: the whole front end (canvas, tree, inspector, metrics)
