// Readback — servidor local: entrega o site (pasta public/) e conversa com o Claude.
// Uso: ANTHROPIC_API_KEY=sk-ant-... npm start  →  abra http://localhost:3000 no Chrome
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, SCENARIOS } from "./prompts.js";
import { buildTeacherPrompt, TEACHER_VOICES, UNITS_PUBLIC } from "./teacher.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Lê as chaves do arquivo .env (CHAVE=valor por linha), se ele existir.
try {
  for (const line of fs.readFileSync(path.join(here, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
// Esforço baixo = respostas mais rápidas, ideal para conversa em tempo real.
const EFFORT = process.env.ANTHROPIC_EFFORT || "low";
// Senha opcional para quando o site estiver publicado na internet.
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const MAX_HISTORY = 40;
// Azure Speech: avaliação de pronúncia (nota por som) e vozes neurais.
const AZURE_KEY = process.env.AZURE_SPEECH_KEY || "";
const AZURE_REGION = process.env.AZURE_SPEECH_REGION || "eastus";
const SPEECH_SDK = path.join(here, "node_modules/microsoft-cognitiveservices-speech-sdk/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js");
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

const client = new Anthropic();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Não encontrado");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

function readJson(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) reject(new Error("Requisição muito grande"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

// Mantém só texto, alterna papéis e garante que a conversa começa pelo usuário.
function sanitizeMessages(raw) {
  const out = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const text = String(m.content ?? "").slice(0, 6000).trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + text;
    else out.push({ role: m.role, content: text });
  }
  while (out.length > MAX_HISTORY) out.shift();
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

// Limite simples por IP para evitar gasto por uso abusivo quando publicado.
const hits = new Map();
function rateLimited(req, res, max = 40) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  if (recent.length <= max) return false;
  res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: "Muitas requisições. Espere um minuto." }));
  return true;
}

function checkPassword(req, res) {
  if (APP_PASSWORD && req.headers["x-app-password"] !== APP_PASSWORD) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Senha incorreta." }));
    return false;
  }
  return true;
}

// Token de 10 minutos para o navegador falar direto com o Azure sem expor a chave.
async function handleSpeechToken(req, res) {
  if (!checkPassword(req, res)) return;
  if (!AZURE_KEY) {
    res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "Azure não configurado." }));
    return;
  }
  try {
    const r = await fetch(`https://${AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": AZURE_KEY },
    });
    if (!r.ok) throw new Error(`Azure respondeu ${r.status}. Confira AZURE_SPEECH_KEY e AZURE_SPEECH_REGION.`);
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ token: await r.text(), region: AZURE_REGION }));
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
  }
}

const VOICES = new Set([
  "en-US-AvaNeural", "en-US-AndrewNeural", "en-US-EmmaNeural", "en-US-BrianNeural",
  "en-US-JennyNeural", "en-US-GuyNeural", "en-GB-SoniaNeural", "en-GB-RyanNeural", "en-AU-NatashaNeural",
]);
for (const v of TEACHER_VOICES) VOICES.add(v);
const PT_VOICE = TEACHER_VOICES[0];
const xmlEscape = (s) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

// Voz neural do Azure: devolve MP3 da frase.
async function handleTts(req, res) {
  if (!checkPassword(req, res)) return;
  try {
    const body = await readJson(req, 16 * 1024);
    const text = String(body.text || "").slice(0, 1500).trim();
    if (!AZURE_KEY || !text) throw new Error(AZURE_KEY ? "Texto vazio." : "Azure não configurado.");
    const rate = Math.round((Math.min(1.5, Math.max(0.5, Number(body.rate) || 1)) - 1) * 100);
    // A Professora tenta a voz bilíngue e cai para as próximas se a região não tiver.
    const voices = TEACHER_VOICES.includes(body.voice) ? [body.voice, ...TEACHER_VOICES.filter((v) => v !== body.voice)] : [VOICES.has(body.voice) ? body.voice : "en-US-AvaNeural"];
    let r;
    for (const voice of voices) {
      const lang = voice.startsWith("pt-BR") ? "pt-BR" : "en-US";
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${rate}%">${xmlEscape(text)}</prosody></voice></speak>`;
      r = await fetch(`https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": AZURE_KEY,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "readback",
        },
        body: ssml,
      });
      if (r.ok) break;
    }
    if (!r.ok) throw new Error(`Azure TTS respondeu ${r.status}.`);
    res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store" });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
  }
}

async function handleChat(req, res) {
  if (!checkPassword(req, res)) return;

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
    return;
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "A conversa precisa terminar com uma fala do aluno." }));
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  try {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 4000,
        // Se o modelo recusar, a API tenta de novo em outro modelo automaticamente.
        ...(FALLBACK_MODELS.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
        output_config: { effort: EFFORT },
        cache_control: { type: "ephemeral" },
        system: body.scenario === "teacher"
          ? buildTeacherPrompt({
              unit: body.unit,
              lesson: body.lesson,
              studentName: body.studentName,
              level: body.level,
              voiceCorrections: body.voiceCorrections !== false,
              callsign: body.callsign,
              progress: body.progress,
              humorSeed: body.humorSeed,
            })
          : buildSystemPrompt({
              scenario: body.scenario,
              level: body.level,
              voiceCorrections: body.voiceCorrections !== false,
              callsign: body.callsign,
            }),
        messages,
      },
      { signal: controller.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send({ type: "text", delta: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      send({ type: "error", message: "A IA recusou responder esta mensagem. Tente reformular." });
    }
    send({ type: "done", stop_reason: final.stop_reason, usage: final.usage });
  } catch (err) {
    if (controller.signal.aborted) return;
    let message = "Erro ao falar com a IA.";
    if (/authentication method/i.test(String(err?.message))) message = "Chave da API não configurada. Inicie o servidor com ANTHROPIC_API_KEY definida.";
    else if (err instanceof Anthropic.AuthenticationError) message = "Chave da API inválida. Confira ANTHROPIC_API_KEY.";
    else if (err instanceof Anthropic.RateLimitError) message = "Muitas requisições. Espere alguns segundos.";
    else if (err instanceof Anthropic.APIConnectionError) message = "Sem conexão com a API da Anthropic.";
    else if (err instanceof Anthropic.APIError) message = `Erro da API (${err.status}): ${err.message}`;
    console.error(err);
    send({ type: "error", message });
  } finally {
    res.end();
  }
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  if (req.method === "POST" && pathname === "/api/chat") return rateLimited(req, res, 30) || handleChat(req, res);
  if (req.method === "POST" && pathname === "/api/speech-token") return rateLimited(req, res, 30) || handleSpeechToken(req, res);
  if (req.method === "POST" && pathname === "/api/tts") return rateLimited(req, res, 120) || handleTts(req, res);
  if (req.method === "GET" && pathname === "/vendor/speech-sdk.js") {
    fs.readFile(SPEECH_SDK, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "max-age=86400" }).end(data);
    });
    return;
  }
  if (req.method === "GET" && pathname === "/api/config") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: MODEL, needsPassword: Boolean(APP_PASSWORD), azure: Boolean(AZURE_KEY), voices: [...VOICES].filter((v) => !TEACHER_VOICES.includes(v)), scenarios: SCENARIOS, units: UNITS_PUBLIC, teacherVoice: PT_VOICE }));
    return;
  }
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405).end();
});

server.listen(PORT, () => {
  console.log(`Readback rodando em http://localhost:${PORT}  (modelo: ${MODEL}, esforço: ${EFFORT})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Aviso: ANTHROPIC_API_KEY não definida. O modo Chamada não vai funcionar; o treino de pronúncia funciona sem ela.");
  }
  console.log(AZURE_KEY
    ? `Azure Speech ativo (região ${AZURE_REGION}): nota de pronúncia por som e vozes neurais.`
    : "Aviso: AZURE_SPEECH_KEY não definida. Sem nota de pronúncia por som; usando o reconhecimento do navegador.");
});
