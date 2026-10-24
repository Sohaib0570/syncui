// SyncUI server: static files + streaming LLM proxy. No npm dependencies. Needs Node 18+.
const http = require('http'), fs = require('fs'), path = require('path');
try { // tiny .env loader
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}
const PORT = process.env.PORT || 3000, OA = process.env.OPENAI_API_KEY, AN = process.env.ANTHROPIC_API_KEY;
const OAM = process.env.OPENAI_MODEL || 'gpt-4o-mini', ANM = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const E = process.env, P = (name, base, key, model, json) => ({ base, key, model, json, label: name + ' ' + model });
// OpenAI-compatible providers (first match wins): custom/Ollama, Gemini (free tier), Groq (free tier), OpenAI
const compat = E.LLM_BASE_URL ? P('Custom', E.LLM_BASE_URL.replace(/\/$/, ''), E.LLM_API_KEY || '', E.LLM_MODEL || 'llama3.2')
  : E.GEMINI_API_KEY ? P('Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', E.GEMINI_API_KEY, E.GEMINI_MODEL || 'gemini-2.5-flash')
  : E.GROQ_API_KEY ? P('Groq', 'https://api.groq.com/openai/v1', E.GROQ_API_KEY, E.GROQ_MODEL || 'llama-3.3-70b-versatile')
  : OA ? P('OpenAI', 'https://api.openai.com/v1', OA, OAM, true) : null;
const provider = compat ? compat.label : AN ? 'Anthropic ' + ANM : null;

async function* sse(res) { // parse "data: {...}" lines from an upstream SSE stream
  const dec = new TextDecoder(); let buf = '';
  for await (const ch of res.body) {
    buf += dec.decode(ch, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('data:')) {
        const d = line.slice(5).trim();
        if (d && d !== '[DONE]') try { yield JSON.parse(d); } catch {}
      }
    }
  }
}
async function* llm(prompt, signal) {
  if (compat) {
    const r = await fetch(compat.base + '/chat/completions', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', ...(compat.key ? { authorization: 'Bearer ' + compat.key } : {}) },
      body: JSON.stringify({ model: compat.model, stream: true, temperature: 0.4, ...(compat.json ? { response_format: { type: 'json_object' } } : {}), messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) throw Error(compat.label + ' ' + r.status + ': ' + (await r.text()).slice(0, 300));
    for await (const j of sse(r)) { const t = j.choices?.[0]?.delta?.content; if (t) yield t; }
  } else if (AN) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': AN, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ANM, max_tokens: 4000, stream: true, messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) throw Error('Anthropic ' + r.status + ': ' + (await r.text()).slice(0, 300));
    for await (const j of sse(r)) { if (j.type === 'content_block_delta' && j.delta?.text) yield j.delta.text; }
  } else throw Error('No API key set. Add GEMINI_API_KEY (free), GROQ_API_KEY (free), OPENAI_API_KEY or ANTHROPIC_API_KEY to .env and restart.');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'GET' && req.url === '/api/status') return json(200, { provider });
  if (req.method === 'POST' && req.url === '/api/llm') {
    let body = ''; for await (const c of req) { body += c; if (body.length > 2e5) return json(413, { error: 'Prompt too large' }); }
    const ac = new AbortController(); res.on('close', () => ac.abort());
    try {
      const { prompt } = JSON.parse(body);
      if (typeof prompt !== 'string' || !prompt) return json(400, { error: 'Missing prompt' });
      for await (const t of llm(prompt, ac.signal)) {
        if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
        res.write(t);
      }
      res.headersSent ? res.end() : json(502, { error: 'Model returned no output' });
    } catch (e) { if (!res.headersSent) json(500, { error: String(e.message || e) }); else res.end(); }
    return;
  }
  if (req.method === 'GET') { // static files from ./public
    const p = path.normalize(path.join(__dirname, 'public', req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]));
    if (!p.startsWith(path.join(__dirname, 'public'))) return json(403, { error: 'Forbidden' });
    return fs.readFile(p, (e, d) => e ? json(404, { error: 'Not found' }) : (res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }), res.end(d)));
  }
  json(405, { error: 'Method not allowed' });
}).listen(PORT, () => console.log(`SyncUI running at http://localhost:${PORT}  |  LLM: ${provider || 'NONE (add an API key to .env)'}`));
