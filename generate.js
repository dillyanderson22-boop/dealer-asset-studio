// Vercel serverless function — generates / edits images via the user's own API key.
// POST /api/generate  { provider, apiKey, mode:'generate'|'edit', prompt, size, image }
export const config = { maxDuration: 60 };

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) { // Vercel may pre-parse JSON
      if (typeof req.body === 'string') { try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve({}); } }
      return resolve(req.body);
    }
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST.' }); return; }

  const body = await readBody(req);
  const { provider = 'openai', apiKey, mode = 'generate', prompt, size = '1024x1024', image } = body || {};
  if (!apiKey) { res.status(400).json({ error: 'Missing API key.' }); return; }
  if (!prompt) { res.status(400).json({ error: 'Missing prompt.' }); return; }

  try {
    let dataUrl;
    if (provider === 'gemini') dataUrl = await gemini({ apiKey, mode, prompt, size });
    else dataUrl = await openai({ apiKey, mode, prompt, size, image });
    res.status(200).json({ image: dataUrl });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e).slice(0, 400) });
  }
}

/* ---------- OpenAI (GPT Image) ---------- */
async function openai({ apiKey, mode, prompt, size, image }) {
  const headersAuth = { Authorization: 'Bearer ' + apiKey };
  if (mode === 'edit') {
    if (!image) throw new Error('No source image provided for editing.');
    const buf = Buffer.from(String(image).split(',').pop(), 'base64');
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', prompt);
    form.append('size', normSize(size));
    form.append('image', new Blob([buf], { type: 'image/png' }), 'image.png');
    const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: headersAuth, body: form });
    return pickOpenAI(await r.json(), r);
  }
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { ...headersAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: normSize(size), n: 1 })
  });
  return pickOpenAI(await r.json(), r);
}
function normSize(s) {
  const ok = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
  return ok.includes(s) ? s : '1024x1024';
}
function pickOpenAI(j, r) {
  if (!r.ok || (j && j.error)) throw new Error((j && j.error && j.error.message) || ('OpenAI HTTP ' + r.status));
  const b64 = j && j.data && j.data[0] && j.data[0].b64_json;
  if (!b64) throw new Error('OpenAI returned no image.');
  return 'data:image/png;base64,' + b64;
}

/* ---------- Google Gemini (Imagen) ---------- */
async function gemini({ apiKey, mode, prompt, size }) {
  if (mode === 'edit') throw new Error('Image editing currently works with OpenAI. Switch the provider in Settings to OpenAI.');
  const [w, h] = String(size).split('x').map(Number);
  const aspect = w && h ? (w > h ? '16:9' : (h > w ? '9:16' : '1:1')) : '1:1';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=' + encodeURIComponent(apiKey);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: aspect } })
  });
  const j = await r.json();
  if (!r.ok || (j && j.error)) throw new Error((j && j.error && j.error.message) || ('Gemini HTTP ' + r.status));
  const b64 = j && j.predictions && j.predictions[0] && (j.predictions[0].bytesBase64Encoded || j.predictions[0].image);
  if (!b64) throw new Error('Gemini returned no image.');
  return 'data:image/png;base64,' + b64;
}
