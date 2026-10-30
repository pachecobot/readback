import { DRILLS, PHONETIC, NUMBERS } from "./data.js";
import { createAzureListener, preloadAzure, summarizeForAI, tipFor, adjustForIcao, scoreClass } from "./pron.js";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const DAY = 86400000;

/* ---------- Armazenamento local ---------- */
const STORE_KEY = "readback.v1";
const store = (() => {
  let data = { settings: {}, mistakes: [], sessions: [], best: {} };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) data = { ...data, ...JSON.parse(raw) };
  } catch {}
  return {
    data,
    save() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
    },
  };
})();

let serverConfig = { scenarios: [], needsPassword: false, azure: false, voices: [] };

/* ---------- Abas ---------- */
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + name));
  if (name === "review") renderReview();
  if (name === "drill") renderDrillCats();
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ---------- Voz da IA (síntese) ---------- */
const synth = window.speechSynthesis;
let voices = [];
const NEURAL_LABELS = {
  "en-US-AvaNeural": "Ava (EUA, feminina)", "en-US-AndrewNeural": "Andrew (EUA, masculina)",
  "en-US-EmmaNeural": "Emma (EUA, feminina)", "en-US-BrianNeural": "Brian (EUA, masculina)",
  "en-US-JennyNeural": "Jenny (EUA, feminina)", "en-US-GuyNeural": "Guy (EUA, masculina)",
  "en-GB-SoniaNeural": "Sonia (Reino Unido, feminina)", "en-GB-RyanNeural": "Ryan (Reino Unido, masculina)",
  "en-AU-NatashaNeural": "Natasha (Austrália, feminina)",
};
const useAzure = () => Boolean(serverConfig.azure);
function loadVoices() {
  const sel = $("#voice");
  if (useAzure()) {
    sel.innerHTML = "";
    for (const v of serverConfig.voices || []) {
      const o = el("option", null, NEURAL_LABELS[v] || v);
      o.value = v;
      sel.append(o);
    }
    const saved = store.data.settings.neuralVoice;
    if (saved && (serverConfig.voices || []).includes(saved)) sel.value = saved;
    return;
  }
  if (!synth) return;
  voices = synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
  const saved = store.data.settings.voice;
  sel.innerHTML = "";
  const rank = (v) => (/en[-_]US/i.test(v.lang) ? 0 : /en[-_]GB/i.test(v.lang) ? 1 : 2) - (/google|natural|neural|samantha|aria|jenny/i.test(v.name) ? 0.5 : 0);
  voices.sort((a, b) => rank(a) - rank(b));
  for (const v of voices) {
    const o = el("option", null, `${v.name} (${v.lang})`);
    o.value = v.name;
    sel.append(o);
  }
  if (saved && voices.some((v) => v.name === saved)) sel.value = saved;
}
if (synth) {
  loadVoices();
  synth.addEventListener?.("voiceschanged", loadVoices);
}
const currentVoice = () => voices.find((v) => v.name === $("#voice").value) || voices[0];
const currentRate = () => Number($("#rate").value);

function makeUtterance(text, rate) {
  const u = new SpeechSynthesisUtterance(text);
  const v = currentVoice();
  if (v) u.voice = v;
  u.lang = v?.lang || "en-US";
  u.rate = rate ?? currentRate();
  return u;
}
function speakBrowser(text, rate) {
  return new Promise((resolve) => {
    if (!synth || !text.trim()) return resolve();
    const u = makeUtterance(text, rate);
    u.onend = u.onerror = () => resolve();
    synth.speak(u);
  });
}

// Voz neural do Azure: o servidor devolve um MP3 por frase.
const player = new Audio();
player.preload = "auto";
let stopPlayer = null;
async function fetchTts(text, rate) {
  const r = await fetch("api/tts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-app-password": $("#password").value || "" },
    body: JSON.stringify({ text, rate: rate ?? currentRate(), voice: $("#voice").value }),
  });
  if (!r.ok) throw new Error("tts");
  return URL.createObjectURL(await r.blob());
}
function playUrl(url) {
  return new Promise((resolve) => {
    const end = () => { player.onended = player.onerror = null; stopPlayer = null; URL.revokeObjectURL(url); resolve(); };
    stopPlayer = () => { player.pause(); end(); };
    player.onended = player.onerror = end;
    player.src = url;
    player.play().catch(end);
  });
}
function stopAllAudio() {
  synth?.cancel();
  stopPlayer?.();
  activeSpeaker?.cancel();
}
let activeSpeaker = null;
// Destrava o áudio no celular: precisa acontecer dentro de um toque.
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
function unlockAudio() {
  if (synth) { synth.cancel(); synth.speak(new SpeechSynthesisUtterance("")); }
  player.src = SILENT;
  player.play().catch(() => {});
}

async function speak(text, rate) {
  if (!text.trim()) return;
  if (useAzure()) {
    try { return await playUrl(await fetchTts(text, rate)); } catch {}
  }
  return speakBrowser(text, rate);
}

// Fila para falar a resposta frase por frase enquanto ela ainda chega.
// A próxima frase é sintetizada enquanto a anterior toca.
function createSpeaker() {
  let chain = Promise.resolve();
  let cancelled = false;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const sp = {
    say(text) {
      if (!text.trim() || cancelled) return;
      const audio = useAzure() ? fetchTts(text).catch(() => null) : Promise.resolve(null);
      chain = chain.then(async () => {
        if (cancelled) return;
        const url = await audio;
        if (cancelled) return url && URL.revokeObjectURL(url);
        if (url) await playUrl(url);
        else await speakBrowser(text);
      });
    },
    close() { chain.then(() => resolveDone()); },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (activeSpeaker === sp) activeSpeaker = null;
      synth?.cancel();
      stopPlayer?.();
      resolveDone();
    },
    done,
  };
  activeSpeaker = sp;
  done.then(() => { if (activeSpeaker === sp) activeSpeaker = null; });
  return sp;
}

/* ---------- Reconhecimento de fala ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
// O aviso de navegador só aparece se não houver Azure (ver loadConfig).

// Escuta o aluno. Modo automático: encerra após um silêncio. Modo manual (PTT): encerra com stop().
function createListener({ onInterim, onReady, silenceMs = 1400, manual = false } = {}) {
  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  const finals = [];
  let interim = "";
  let timer = null;
  let stopping = false;
  let finished = false;
  let resolve, reject;
  const result = new Promise((res, rej) => { resolve = res; reject = rej; });

  const text = () => [...finals.map((f) => f.text), interim].join(" ").replace(/\s+/g, " ").trim();
  const stop = () => {
    stopping = true;
    clearTimeout(timer);
    try { rec.stop(); } catch {}
  };

  rec.onresult = (ev) => {
    interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) {
        finals.push({
          text: r[0].transcript.trim(),
          confidence: r[0].confidence || 0,
          alternatives: Array.from(r).slice(1).map((a) => a.transcript.trim()).filter(Boolean),
        });
      } else {
        interim += r[0].transcript;
      }
    }
    onInterim?.(text());
    if (!manual) {
      clearTimeout(timer);
      timer = setTimeout(stop, silenceMs);
    }
  };
  rec.onerror = (ev) => {
    if (ev.error === "no-speech" || ev.error === "aborted") return;
    finished = true;
    const msg = ev.error === "not-allowed" || ev.error === "service-not-allowed"
      ? "O microfone foi bloqueado. Libere o microfone para este site nas configurações do navegador."
      : ev.error === "network"
      ? "O reconhecimento de voz precisa de internet."
      : "Erro no reconhecimento de voz: " + ev.error;
    reject(new Error(msg));
  };
  rec.onend = () => {
    if (finished) return;
    const t = text();
    if (stopping || (t && !manual)) {
      finished = true;
      const confs = finals.map((f) => f.confidence).filter((c) => c > 0);
      resolve({
        text: t,
        confidence: confs.length ? Math.min(...confs) : 0,
        alternatives: finals.length === 1 ? finals[0].alternatives : [],
      });
    } else {
      // O navegador encerrou sozinho (silêncio longo): continua ouvindo.
      try { rec.start(); } catch {}
    }
  };
  let started = false;
  rec.onstart = () => { if (!started) { started = true; onReady?.(); } };
  rec.start();
  return {
    result,
    stop,
    cancel() {
      finished = true;
      clearTimeout(timer);
      try { rec.abort(); } catch {}
      resolve(null);
    },
  };
}

// Azure quando configurado (nota por som); senão, o reconhecimento do navegador.
function makeListener(opts) {
  if (useAzure()) return createAzureListener({ ...opts, password: $("#password").value || "" });
  if (!SR) throw new Error("Seu navegador não reconhece voz. Use o Chrome ou o Edge, ou configure o Azure.");
  return createListener(opts);
}

/* ---------- Comparação de palavras (treino de pronúncia) ---------- */
const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const CANON = { tree: "three", fife: "five", niner: "nine", fower: "four", tousand: "thousand", ait: "eight", wun: "one", alpha: "alfa", juliet: "juliett", ok: "okay" };
function numberWords(n) {
  // Altitudes como 3500 → "three thousand five hundred"; outros números dígito a dígito.
  if (n.length >= 3 && /00$/.test(n) && Number(n) < 100000) {
    const v = Number(n);
    const th = Math.floor(v / 1000), hu = Math.floor((v % 1000) / 100);
    const out = [];
    if (th) out.push(...String(th).split("").map((d) => DIGITS[d]), "thousand");
    if (hu) out.push(DIGITS[hu], "hundred");
    return out;
  }
  return n.split("").map((d) => DIGITS[d]);
}
function tokens(s, icao = true) {
  const out = [];
  s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/x-ray/g, "xray")
    .replace(/(\d)[.,](\d)/g, (m, a, b) => (m.includes(".") ? `${a} decimal ${b}` : a + b))
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .forEach((t) => {
      if (/^\d+$/.test(t)) out.push(...numberWords(t));
      else out.push((icao && CANON[t]) || t);
    });
  return out;
}
// Marca quais palavras da frase-alvo foram reconhecidas (maior subsequência comum).
// icao=false (treino de sons): "tree" no lugar de "three" conta como erro.
function compare(target, heard, icao = true) {
  const words = target.split(/\s+/).filter(Boolean);
  const tt = [];
  words.forEach((w, wi) => tokens(w, icao).forEach((t) => tt.push({ t, wi })));
  const ht = tokens(heard, icao);
  const m = tt.length, n = ht.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = tt[i].t === ht[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const matched = new Array(m).fill(false);
  for (let i = 0, j = 0; i < m && j < n; ) {
    if (tt[i].t === ht[j]) { matched[i] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const wordOk = words.map((_, wi) => tt.filter((x) => x.wi === wi).every((x) => matched[tt.indexOf(x)]));
  const score = m ? Math.round((matched.filter(Boolean).length / m) * 100) : 0;
  return { words, wordOk, score };
}

/* ---------- Comunicação com o servidor ---------- */
async function loadConfig() {
  try {
    const r = await fetch("api/config");
    if (r.ok) serverConfig = await r.json();
  } catch {}
  $("#support-warning").hidden = Boolean(SR) || useAzure();
  $("#azure-off").hidden = useAzure();
  loadVoices();
  if (useAzure()) preloadAzure(store.data.settings.password);
  if (serverConfig.needsPassword) {
    $("#password-field").hidden = false;
    $("#password").value = store.data.settings.password || "";
  }
  renderScenarios();
}

async function streamChat(payload, onText, signal) {
  const res = await fetch("api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-app-password": $("#password").value || "" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).replace(/^data: /, "");
      buf = buf.slice(i + 2);
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === "text") { full += ev.delta; onText(full); }
      else if (ev.type === "error") throw new Error(ev.message);
    }
  }
  return full;
}

const MARK = "###FEEDBACK###";
function splitReply(full) {
  const cut = full.indexOf("#");
  const spoken = (cut >= 0 ? full.slice(0, cut) : full).replace(/[*_`]/g, "").trim();
  let feedback = null;
  const m = full.indexOf(MARK);
  if (m >= 0) {
    const rest = full.slice(m + MARK.length);
    const a = rest.indexOf("{"), b = rest.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { feedback = JSON.parse(rest.slice(a, b + 1)); } catch {}
    }
  }
  return { spoken, feedback };
}

/* ---------- Cenários e painel ---------- */
const STATIONS = {
  atc_ground: ["MARTE GND", "121.850"],
  atc_circuit: ["MARTE TWR", "118.700"],
  atc_xc: ["SAO PAULO APP", "119.800"],
  atc_emergency: ["GUARD", "121.500"],
  icao_interview: ["SDEA", "EXAME"],
  travel_airport: ["AEROPORTO", "GATE 12"],
  travel_city: ["CIDADE", "HOTEL"],
  free: ["LIVRE", "CHAT"],
};
let scenario = store.data.settings.scenario || "atc_ground";
function renderScenarios() {
  const list = $("#scenario-list");
  list.innerHTML = "";
  let group = "";
  for (const s of serverConfig.scenarios) {
    if (s.group !== group) {
      group = s.group;
      list.append(el("div", "scen-group", group));
    }
    const b = el("button", "scen");
    b.type = "button";
    b.setAttribute("aria-pressed", String(s.id === scenario));
    b.append(el("b", null, s.title), el("span", null, s.desc));
    b.addEventListener("click", () => {
      if (call.active) return;
      scenario = s.id;
      saveSettings();
      renderScenarios();
    });
    list.append(b);
  }
  const [label, freq] = STATIONS[scenario] || STATIONS.free;
  $("#station-label").textContent = label;
  $("#freq-value").textContent = freq;
}

function saveSettings() {
  Object.assign(store.data.settings, {
    scenario,
    level: $("#level").value,
    callsign: $("#callsign").value,
    ...(useAzure() ? { neuralVoice: $("#voice").value } : { voice: $("#voice").value }),
    rate: $("#rate").value,
    voiceCorrections: $("#voice-corrections").checked,
    ptt: $("#ptt").checked,
    showFeedback: $("#show-feedback").checked,
    password: $("#password").value,
  });
  store.save();
}
(function restoreSettings() {
  const s = store.data.settings;
  if (s.level) $("#level").value = s.level;
  if (s.callsign) $("#callsign").value = s.callsign;
  if (s.rate) $("#rate").value = s.rate;
  if (s.voiceCorrections != null) $("#voice-corrections").checked = s.voiceCorrections;
  if (s.ptt != null) $("#ptt").checked = s.ptt;
  if (s.showFeedback != null) $("#show-feedback").checked = s.showFeedback;
  $("#rate-out").textContent = Number($("#rate").value).toFixed(2) + "×";
})();
["#level", "#callsign", "#voice", "#voice-corrections", "#ptt", "#show-feedback", "#password"].forEach((s) =>
  $(s).addEventListener("change", () => { saveSettings(); updateCallButtons(); }),
);
$("#rate").addEventListener("input", () => {
  $("#rate-out").textContent = Number($("#rate").value).toFixed(2) + "×";
  saveSettings();
});
$("#show-feedback").addEventListener("change", () => {
  document.querySelectorAll("#transcript .fb").forEach((f) => (f.hidden = !$("#show-feedback").checked));
});

/* ---------- ICAO ---------- */
const CRITERIA = [
  ["pronunciation", "Pronúncia"], ["structure", "Estrutura"], ["vocabulary", "Vocabulário"],
  ["fluency", "Fluência"], ["comprehension", "Compreensão"], ["interaction", "Interação"],
];
// Média por critério, ignorando falas em que o critério não pôde ser avaliado (0).
function icaoAverages(turns) {
  const avg = {};
  for (const [k] of CRITERIA) {
    const vals = turns.map((t) => t[k] || 0).filter((v) => v > 0);
    avg[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  const known = CRITERIA.map(([k]) => avg[k]).filter((v) => v != null);
  if (!known.length) return null;
  avg.overall = Math.floor(Math.min(...known));
  return avg;
}
function renderIcao(turns) {
  const avg = icaoAverages(turns);
  const bars = $("#icao-bars");
  bars.innerHTML = "";
  for (const [k, label] of CRITERIA) {
    const v = avg?.[k] ?? null;
    const bar = el("div", "bar");
    const head = el("span");
    head.append(label + " ", el("b", null, v != null ? v.toFixed(1) : "–"));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill" + (v != null && v < 4 ? " low" : ""));
    fill.style.width = ((v || 0) / 6) * 100 + "%";
    track.append(fill);
    bar.append(head, track);
    bars.append(bar);
  }
  $("#icao-overall").textContent = avg ? `Nível ${avg.overall}` : "–";
}
renderIcao([]);

/* ---------- Caderno de erros ---------- */
const INTERVALS = [0, 1, 3, 7, 16, 35];
function addMistake(item) {
  const target = (item.target || "").trim();
  if (!target) return;
  const existing = store.data.mistakes.find((m) => m.target.toLowerCase() === target.toLowerCase());
  if (existing) {
    existing.box = 0;
    existing.due = Date.now();
    existing.why = item.why || existing.why;
  } else {
    store.data.mistakes.unshift({ id: crypto.randomUUID?.() || String(Math.random()), box: 0, due: Date.now(), date: Date.now(), ...item, target });
  }
  store.data.mistakes = store.data.mistakes.slice(0, 400);
  store.save();
}
function gradeMistake(target, ok) {
  const m = store.data.mistakes.find((x) => x.target === target);
  if (!m) return;
  m.box = ok ? Math.min(m.box + 1, INTERVALS.length - 1) : 1;
  m.due = Date.now() + (ok ? INTERVALS[m.box] : 1) * DAY;
  store.save();
}

/* ---------- Chamada ---------- */
const call = { active: false, history: [], icao: [], speaker: null, listener: null, abort: null, ending: false, turns: 0, wakeLock: null, stats: null };
const newStats = () => ({ spoken: 0, clean: 0, corrections: 0, pron: [], weak: new Map(), mistakes: [] });
const statusEl = $("#status");
function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}
function setLive(text) { $("#live").textContent = text || ""; }

function updateCallButtons() {
  const ptt = $("#ptt").checked;
  $("#call-btn").classList.toggle("active", call.active);
  $("#call-btn-text").textContent = call.active ? "Desligar" : "Chamar";
  $("#call-btn").setAttribute("aria-label", call.active ? "Desligar chamada" : "Iniciar chamada");
  $("#ptt-btn").hidden = !(call.active && ptt);
  $("#end-btn").disabled = !call.active;
  document.querySelectorAll(".scen").forEach((b) => (b.disabled = call.active));
}

function addBubble(role, text) {
  $("#transcript-empty")?.remove();
  const wrap = el("div", "msg " + role);
  wrap.append(el("span", "who", role === "me" ? "Você" : (STATIONS[scenario] || STATIONS.free)[0]));
  const bubble = el("div", "bubble", text);
  wrap.append(bubble);
  $("#transcript").append(wrap);
  scrollTranscript();
  return { wrap, bubble };
}
function scrollTranscript() {
  const t = $("#transcript");
  t.scrollTop = t.scrollHeight;
}

function sayButton(text, label = "Ouvir") {
  const b = el("button", "say-btn", label);
  b.type = "button";
  b.addEventListener("click", () => { unlockAudio(); stopAllAudio(); speak(text, Math.max(0.6, currentRate() - 0.25)); });
  return b;
}

function renderFeedback(fb, into) {
  if (!fb) return;
  const box = el("div", "fb");
  box.hidden = !$("#show-feedback").checked;
  let any = false;
  if (fb.corrections?.length) {
    any = true;
    box.append(el("h4", "c-head", "Correções"));
    const ul = el("ul");
    for (const c of fb.corrections) {
      const li = el("li");
      if (c.you_said) li.append(el("s", null, c.you_said), " → ");
      li.append(el("ins", null, c.better || ""), sayButton(c.better || ""));
      if (c.why) li.append(el("span", "why", c.why));
      ul.append(li);
      addMistake({ kind: "correction", said: c.you_said || "", target: c.better || "", why: c.why || "" });
    }
    box.append(ul);
  }
  if (fb.pronunciation?.length) {
    any = true;
    box.append(el("h4", "p-head", "Pronúncia"));
    const ul = el("ul");
    for (const p of fb.pronunciation) {
      const li = el("li");
      li.append(el("b", null, p.word || ""), " ");
      if (p.ipa) li.append(el("span", "ipa", p.ipa));
      li.append(sayButton(p.word || ""));
      if (p.tip) li.append(el("span", "why", p.tip));
      ul.append(li);
      addMistake({ kind: "pron", said: "", target: p.word || "", why: [p.ipa, p.tip].filter(Boolean).join(" · ") });
    }
    box.append(ul);
  }
  if (fb.phraseology?.length) {
    any = true;
    box.append(el("h4", "ph-head", "Fraseologia"));
    const ul = el("ul");
    for (const p of fb.phraseology) {
      const li = el("li");
      li.append(el("b", null, p.item || ""), sayButton(p.item || ""));
      if (p.note) li.append(el("span", "why", p.note));
      ul.append(li);
    }
    box.append(ul);
  }
  if (fb.praise) {
    any = true;
    box.append(el("div", "praise", fb.praise));
  }
  if (any) into.append(box);
  scrollTranscript();
}

// Palavras coloridas pela nota; tocar numa palavra abre os sons dela.
function renderPron(pron, into, { icao = true, replaceText = null } = {}) {
  if (!pron) return null;
  const wrap = el("div", "pron");
  const line = el("div", "pron-words");
  const detail = el("div", "pron-detail");
  detail.hidden = true;
  let openBtn = null;
  for (const raw of pron.words) {
    const w = icao ? adjustForIcao(raw) : raw;
    const cls = w.error === "Omission" ? "omit" : w.error === "Insertion" ? "extra" : scoreClass(w.score);
    const b = el("button", "pw " + cls, w.word);
    b.type = "button";
    b.title = w.error === "Omission" ? "Palavra que faltou" : `${w.score}/100`;
    b.addEventListener("click", () => {
      if (openBtn === b) { detail.hidden = true; openBtn = null; return; }
      openBtn = b;
      showWordDetail(w, detail);
    });
    line.append(b, " ");
  }
  const chips = el("div", "pron-chips");
  const chip = (label, v) => v != null && chips.append(el("span", "chip-s " + scoreClass(v), `${label} ${v}`));
  chip("Pronúncia", pron.overall);
  chip("Exatidão", pron.accuracy);
  chip("Fluência", pron.fluency);
  chip("Entonação", pron.prosody);
  if (pron.scripted) chip("Completude", pron.completeness);
  wrap.append(line, chips, detail);
  if (replaceText) replaceText.replaceWith(wrap);
  else into.append(wrap);
  return wrap;
}
function showWordDetail(w, detail) {
  detail.innerHTML = "";
  detail.hidden = false;
  const head = el("div", "pd-head");
  head.append(el("b", null, w.word), el("span", "chip-s " + scoreClass(w.score), w.error === "Omission" ? "faltou" : `${w.score}/100`));
  head.append(sayButton(w.word, "Ouvir certo"));
  const slow = el("button", "say-btn", "Devagar");
  slow.type = "button";
  slow.addEventListener("click", () => { unlockAudio(); stopAllAudio(); speak(w.word, 0.6); });
  head.append(slow);
  detail.append(head);
  if (w.icaoNote) detail.append(el("p", "pd-note", w.icaoNote));
  if (w.error === "Omission") detail.append(el("p", "pd-note", "Você pulou esta palavra."));
  if (w.error === "UnexpectedBreak") detail.append(el("p", "pd-note", "Houve uma pausa antes desta palavra: tente falar a frase sem parar."));
  const phs = el("div", "pd-phs");
  for (const p of w.phonemes) {
    const c = el("span", "ph " + scoreClass(p.score));
    c.append(el("b", null, `/${p.ph}/`), el("small", null, String(p.score)));
    phs.append(c);
  }
  if (w.phonemes.length) detail.append(phs);
  const bad = w.phonemes.filter((p) => p.score < 70).sort((a, b) => a.score - b.score).slice(0, 3);
  for (const p of bad) {
    const tip = el("p", "pd-tip");
    tip.append(el("b", null, `/${p.ph}/`), p.heard ? ` soou como /${p.heard}/. ` : " ", tipFor(p.ph));
    detail.append(tip);
  }
  if (!bad.length && w.error === "None") detail.append(el("p", "pd-note", "Boa! Todos os sons desta palavra estão bons."));
}
function savePronMistakes(pron) {
  if (!pron) return;
  for (const raw of pron.words) {
    const w = adjustForIcao(raw);
    if (w.error === "Insertion" || w.error === "Omission" || w.score >= 60) continue;
    const bad = w.phonemes.filter((p) => p.score < 60).slice(0, 2);
    addMistake({ kind: "pron", said: "", target: w.word, why: bad.map((p) => `/${p.ph}/${p.heard ? ` soou como /${p.heard}/` : ""}: ${tipFor(p.ph)}`).join(" ") || `Nota ${w.score}/100` });
  }
}

function studentContent(r) {
  let s = r.text;
  const meta = [];
  if (r.confidence) meta.push(`ASR confidence ${r.confidence.toFixed(2)}`);
  if (r.alternatives?.length) meta.push("alternatives: " + r.alternatives.map((a) => `"${a}"`).join(" | "));
  if (meta.length) s += `\n[${meta.join("; ")}]`;
  if (r.pron) s += "\n" + summarizeForAI(r.pron);
  return s;
}

async function aiTurn(userContent, displayText, pron = null) {
  const me = displayText ? addBubble("me", displayText) : null;
  if (me && pron) {
    renderPron(pron, me.wrap, { replaceText: me.bubble });
    savePronMistakes(pron);
    if (pron.overall != null) call.stats.pron.push(pron.overall);
    for (const raw of pron.words) {
      const w = adjustForIcao(raw);
      if (w.error === "Mispronunciation" || (w.error === "None" && w.score < 60)) {
        const k = w.word.toLowerCase();
        call.stats.weak.set(k, Math.min(call.stats.weak.get(k) ?? 100, w.score));
      }
    }
  }
  const userMsg = { role: "user", content: userContent };
  call.history.push(userMsg);
  setStatus("thinking", "Pensando…");
  setLive("");
  const ai = addBubble("ai", "…");
  const speaker = createSpeaker();
  call.speaker = speaker;
  const abort = new AbortController();
  call.abort = abort;
  let spokenUpTo = 0;
  let full = "";
  try {
    full = await streamChat(
      {
        scenario,
        level: $("#level").value,
        callsign: $("#callsign").value,
        voiceCorrections: $("#voice-corrections").checked,
        messages: call.history,
      },
      (text) => {
        const { spoken } = splitReply(text);
        ai.bubble.textContent = spoken || "…";
        const rest = spoken.slice(spokenUpTo);
        const m = rest.match(/^[\s\S]*[.!?](?=\s)/);
        if (m) {
          speaker.say(m[0]);
          spokenUpTo += m[0].length;
          setStatus("speaking", "Falando…");
          $("#interrupt-btn").hidden = false;
        }
        scrollTranscript();
      },
      abort.signal,
    );
  } catch (e) {
    speaker.cancel();
    // Remove só esta fala: outra pode já ter entrado depois dela.
    const i = call.history.indexOf(userMsg);
    if (i >= 0) call.history.splice(i, 1);
    ai.wrap.remove();
    if (abort.signal.aborted) return;
    setStatus("error", "Erro");
    addBubble("ai", e.message).wrap.classList.add("error");
    if (call.ending) finishCall();
    return;
  }
  const { spoken, feedback } = splitReply(full);
  ai.bubble.textContent = spoken;
  speaker.say(spoken.slice(spokenUpTo));
  speaker.close();
  setStatus("speaking", "Falando…");
  $("#interrupt-btn").hidden = false;
  const replay = el("button", "replay", "Ouvir de novo");
  replay.type = "button";
  replay.addEventListener("click", () => { stopAllAudio(); speak(spoken); });
  ai.wrap.append(replay);
  call.history.push({ role: "assistant", content: full });
  call.turns++;
  if (me) {
    call.stats.spoken++;
    const n = (feedback?.corrections?.length || 0) + (feedback?.pronunciation?.length || 0);
    call.stats.corrections += n;
    if (!n) call.stats.clean++;
    for (const c of feedback?.corrections || []) if (c.better) call.stats.mistakes.push(c.better);
    for (const p of feedback?.pronunciation || []) if (p.word) call.stats.mistakes.push(p.word);
  }
  if (feedback) {
    if (me) renderFeedback(feedback, me.wrap);
    else if (call.ending) renderFeedback(feedback, ai.wrap);
    const vals = feedback.icao || {};
    if (CRITERIA.some(([k]) => vals[k] > 0)) {
      call.icao.push(vals);
      renderIcao(call.icao);
    }
  }
  await speaker.done;
  $("#interrupt-btn").hidden = true;
  if (call.speaker === speaker) call.speaker = null;
  if (call.ending) return finishCall();
  if (call.pendingTyped) {
    const t = call.pendingTyped;
    call.pendingTyped = null;
    return sendTyped(t);
  }
  if (call.active) nextListen();
}

function nextListen() {
  if (!call.active) return;
  if ($("#ptt").checked) {
    if (!call.listener) setStatus("idle", "Segure o botão (ou a barra de espaço) para falar");
    return;
  }
  listen(false);
}

async function listen(manual) {
  call.listener?.cancel();
  let listener;
  try {
    setStatus("thinking", "Abrindo o microfone…");
    listener = makeListener({
      manual,
      onInterim: setLive,
      onReady: () => { if (call.listener === listener) setStatus("listening", manual ? "Transmitindo…" : "Ouvindo… fale em inglês"); },
    });
  } catch (e) {
    setStatus("error", e.message);
    return;
  }
  call.listener = listener;
  try {
    const r = await listener.result;
    if (call.listener === listener) call.listener = null;
    if (!r || !call.active) return;
    if (!r.text) return nextListen();
    setLive("");
    await aiTurn(studentContent(r), r.text, r.pron);
  } catch (e) {
    call.listener = null;
    setStatus("error", e.message);
  }
}

async function startCall() {
  saveSettings();
  call.active = true;
  call.history = [];
  call.icao = [];
  call.turns = 0;
  call.stats = newStats();
  call.ending = false;
  call.pendingTyped = call.pendingTyped || null;
  call.startedAt = Date.now();
  $("#transcript").innerHTML = "";
  renderIcao([]);
  updateCallButtons();
  unlockAudio();
  try { call.wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  await aiTurn("[START]", null);
}

function stopAudioAndListening() {
  call.listener?.cancel();
  call.listener = null;
  call.speaker?.cancel();
  call.speaker = null;
  call.abort?.abort();
  stopAllAudio();
}

function finishCall() {
  stopAudioAndListening();
  if (call.turns > 1) {
    const avg = icaoAverages(call.icao);
    const s = serverConfig.scenarios.find((x) => x.id === scenario);
    const st = call.stats;
    const pronAvg = st.pron.length ? Math.round(st.pron.reduce((a, b) => a + b, 0) / st.pron.length) : null;
    const minutes = Math.max(1, Math.round((Date.now() - call.startedAt) / 60000));
    const prev = store.data.sessions.find((x) => x.scenarioId === scenario);
    renderSummary({ title: s?.title || scenario, minutes, avg, pronAvg, st, prev });
    store.data.sessions.unshift({ date: Date.now(), scenario: s?.title || scenario, scenarioId: scenario, turns: call.turns, spoken: st.spoken, clean: st.clean, pron: pronAvg, minutes, icao: avg });
    store.data.sessions = store.data.sessions.slice(0, 200);
    store.save();
  }
  call.active = false;
  call.ending = false;
  try { call.wakeLock?.release(); } catch {}
  setStatus("idle", "Chamada encerrada");
  setLive("");
  $("#interrupt-btn").hidden = true;
  updateCallButtons();
}

// Cartão de encerramento: o que foi bem, o que treinar e atalho para treinar.
function renderSummary({ title, minutes, avg, pronAvg, st, prev }) {
  const card = el("section", "summary");
  card.append(el("h3", null, "Resumo da chamada"), el("p", "muted", `${title} · ${minutes} min · ${st.spoken} falas suas`));
  const grid = el("div", "sum-grid");
  const stat = (label, value, cls = "") => {
    const d = el("div", "sum-stat " + cls);
    d.append(el("b", null, value), el("span", null, label));
    grid.append(d);
  };
  stat("Nível ICAO estimado", avg ? String(avg.overall) : "–", avg ? (avg.overall >= 4 ? "good" : "poor") : "");
  stat("Falas sem correção", `${st.clean}/${st.spoken}`, st.spoken && st.clean / st.spoken >= 0.6 ? "good" : "fair");
  if (pronAvg != null) {
    const delta = prev?.pron != null ? pronAvg - prev.pron : null;
    stat("Pronúncia média" + (delta != null ? ` (${delta >= 0 ? "+" : ""}${delta} vs. última)` : ""), String(pronAvg), scoreClass(pronAvg));
  }
  stat("Correções recebidas", String(st.corrections));
  card.append(grid);
  const weak = [...st.weak.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5);
  if (weak.length) {
    card.append(el("h4", null, "Palavras para treinar"));
    const row = el("div", "sum-words");
    for (const [w, sc] of weak) {
      const b = el("span", "chip-s " + scoreClass(sc), `${w} ${sc}`);
      row.append(b, sayButton(w));
    }
    card.append(row);
  }
  const targets = [...new Set([...weak.map(([w]) => w), ...st.mistakes])];
  if (targets.length) {
    const go = el("button", "primary", `Treinar os ${targets.length} itens desta chamada`);
    go.type = "button";
    go.addEventListener("click", () => {
      showTab("drill");
      drill.reviewMode = true;
      setDrill("mine", targets.map((t) => {
        const m = store.data.mistakes.find((x) => x.target.toLowerCase() === t.toLowerCase());
        return { say: m?.target || t, pt: m?.why || "", mistake: Boolean(m) };
      }));
    });
    card.append(go);
  } else {
    card.append(el("p", "praise", "Nenhuma correção nesta chamada. Tente o nível acima!"));
  }
  $("#transcript").append(card);
  scrollTranscript();
}

$("#call-btn").addEventListener("click", () => (call.active ? finishCall() : startCall()));
$("#interrupt-btn").addEventListener("click", () => {
  call.speaker?.cancel();
  stopAllAudio();
});
$("#end-btn").addEventListener("click", () => {
  if (!call.active || call.ending) return;
  call.ending = true;
  stopAudioAndListening();
  aiTurn("[END]", null);
});
$("#type-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#type-input").value.trim();
  if (!text) return;
  $("#type-input").value = "";
  if (!call.active) {
    call.pendingTyped = text;
    startCall();
    return;
  }
  sendTyped(text);
});
function sendTyped(text) {
  // Se a IA ainda está respondendo, a mensagem entra logo depois.
  if (call.history.length % 2 === 1) {
    call.pendingTyped = text;
    return;
  }
  stopAudioAndListening();
  aiTurn(text + "\n[typed, not spoken]", text);
}

// Modo rádio: segurar para falar (botão ou barra de espaço).
let pttHeld = false;
function pttDown() {
  if (!call.active || pttHeld || call.history.length % 2 === 1) return;
  pttHeld = true;
  $("#ptt-btn").classList.add("down");
  call.speaker?.cancel();
  stopAllAudio();
  listen(true);
}
function pttUp() {
  if (!pttHeld) return;
  pttHeld = false;
  $("#ptt-btn").classList.remove("down");
  call.listener?.stop();
}
$("#ptt-btn").addEventListener("pointerdown", (e) => { e.preventDefault(); pttDown(); });
["pointerup", "pointerleave", "pointercancel"].forEach((t) => $("#ptt-btn").addEventListener(t, pttUp));
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || !$("#ptt").checked || !call.active) return;
  if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement?.tagName)) return;
  e.preventDefault();
  pttDown();
});
document.addEventListener("keyup", (e) => { if (e.code === "Space") pttUp(); });

/* ---------- Treino de pronúncia ---------- */
const drill = { cat: DRILLS[0].id, index: 0, items: DRILLS[0].items, listener: null, lastHeard: "", reviewMode: false };
function drillCategories() {
  const cats = DRILLS.map((d) => ({ id: d.id, title: d.title, items: d.items }));
  const mine = store.data.mistakes.map((m) => ({ say: m.target, pt: m.why || (m.said ? `Você disse: ${m.said}` : ""), mistake: true }));
  cats.push({ id: "mine", title: `Meus erros (${mine.length})`, items: mine });
  return cats;
}
function renderDrillCats() {
  const wrap = $("#drill-cats");
  wrap.innerHTML = "";
  for (const c of drillCategories()) {
    const b = el("button", "chip", c.title);
    b.type = "button";
    b.setAttribute("aria-pressed", String(c.id === drill.cat && !drill.reviewMode));
    b.addEventListener("click", () => {
      drill.reviewMode = false;
      setDrill(c.id, c.items);
    });
    wrap.append(b);
  }
}
function setDrill(cat, items) {
  drill.cat = cat;
  drill.items = items;
  drill.index = 0;
  renderDrillCats();
  renderDrill();
}
function renderDrill() {
  const item = drill.items[drill.index];
  $("#drill-result").hidden = true;
  $("#drill-ai").hidden = true;
  $("#drill-explain").disabled = true;
  if (!item) {
    $("#drill-say").textContent = drill.cat === "mine" ? "Nenhum erro salvo ainda." : "Tudo revisado por hoje.";
    $("#drill-pt").textContent = "Faça uma chamada: as correções da IA aparecem aqui para você treinar.";
    $("#drill-pos").textContent = "";
    $("#drill-best").textContent = "";
    ["#drill-listen", "#drill-slow", "#drill-rec"].forEach((s) => ($(s).disabled = true));
    return;
  }
  ["#drill-listen", "#drill-slow", "#drill-rec"].forEach((s) => ($(s).disabled = false));
  $("#drill-say").textContent = item.say;
  $("#drill-pt").textContent = item.pt || "";
  $("#drill-pos").textContent = `${drill.index + 1} de ${drill.items.length}`;
  const best = store.data.best[item.say];
  $("#drill-best").textContent = best != null ? `Melhor nota: ${best}` : "";
}
$("#drill-listen").addEventListener("click", () => { unlockAudio(); stopAllAudio(); speak(drill.items[drill.index].say); });
$("#drill-slow").addEventListener("click", () => { unlockAudio(); stopAllAudio(); speak(drill.items[drill.index].say, 0.65); });
$("#drill-prev").addEventListener("click", () => { drill.index = Math.max(0, drill.index - 1); renderDrill(); });
$("#drill-next").addEventListener("click", () => { drill.index = Math.min(drill.items.length - 1, drill.index + 1); renderDrill(); });
$("#drill-rec").addEventListener("click", async () => {
  const btn = $("#drill-rec");
  if (drill.listener) { drill.listener.stop(); return; }
  stopAllAudio();
  const item = drill.items[drill.index];
  const icao = drill.cat !== "sounds";
  try {
    btn.textContent = "Abrindo o microfone…";
    drill.listener = makeListener({
      silenceMs: 1100,
      referenceText: item.say,
      onReady: () => { if (drill.listener) btn.textContent = "Pode falar… (toque para parar)"; },
    });
  } catch (e) {
    $("#support-warning").hidden = false;
    return;
  }
  btn.classList.add("drill-rec-on");
  let r = null;
  try {
    r = await drill.listener.result;
  } catch (e) {
    $("#drill-diff").textContent = "";
    $("#drill-heard").textContent = e.message;
    $("#drill-result").hidden = false;
  }
  drill.listener = null;
  btn.classList.remove("drill-rec-on");
  btn.textContent = "Gravar minha voz";
  if (!r || !r.text) return;
  const diff = $("#drill-diff");
  diff.innerHTML = "";
  let score;
  drill.lastPron = r.pron || null;
  if (r.pron) {
    // Nota medida no áudio, som por som.
    renderPron(r.pron, diff, { icao });
    score = r.pron.overall ?? r.pron.accuracy ?? 0;
    drill.lastHeard = r.text;
  } else {
    // Sem Azure: compara as palavras que o navegador entendeu.
    const best = [r.text, ...(r.alternatives || [])].map((h) => ({ h, c: compare(item.say, h, icao) })).sort((a, b) => b.c.score - a.c.score)[0];
    best.c.words.forEach((w, i) => { diff.append(el("span", best.c.wordOk[i] ? "w-ok" : "w-miss", w), " "); });
    score = best.c.score;
    drill.lastHeard = best.h;
  }
  $("#drill-heard").textContent = `"${drill.lastHeard}"`;
  $("#drill-score").textContent = score;
  $("#drill-result").hidden = false;
  $("#drill-explain").disabled = false;
  store.data.best[item.say] = Math.max(store.data.best[item.say] || 0, score);
  if (item.mistake) gradeMistake(item.say, score >= 80);
  store.save();
  $("#drill-best").textContent = `Melhor nota: ${store.data.best[item.say]}`;
});
$("#drill-explain").addEventListener("click", async () => {
  const item = drill.items[drill.index];
  const box = $("#drill-ai");
  box.hidden = false;
  box.textContent = "Analisando…";
  $("#drill-explain").disabled = true;
  try {
    const full = await streamChat(
      {
        scenario: "free",
        level: $("#level").value,
        voiceCorrections: true,
        messages: [{ role: "user", content: `[DRILL] Target phrase: "${item.say}". The speech recognizer understood: "${drill.lastHeard}".` + (drill.lastPron ? "\n" + summarizeForAI(drill.lastPron) : "") }],
      },
      (t) => { box.textContent = splitReply(t).spoken || "Analisando…"; },
    );
    const { spoken, feedback } = splitReply(full);
    box.textContent = spoken;
    box.append(" ", sayButton(spoken, "Ouvir"));
    if (feedback) renderFeedback({ ...feedback, corrections: [], icao: null }, box);
  } catch (e) {
    box.textContent = e.message;
  }
  $("#drill-explain").disabled = false;
});

/* ---------- Revisão ---------- */
function fmtDate(t) {
  return new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
function renderReview() {
  const now = Date.now();
  const due = store.data.mistakes.filter((m) => m.due <= now);
  $("#review-due").textContent = `${due.length} para hoje · ${store.data.mistakes.length} no total`;
  $("#review-practice").disabled = !due.length;
  const ul = $("#mistakes");
  ul.innerHTML = "";
  if (!store.data.mistakes.length) ul.append(el("li", "muted", "Ainda vazio. As correções das chamadas aparecem aqui."));
  for (const m of store.data.mistakes) {
    const li = el("li");
    const body = el("div", "m-body");
    if (m.said) body.append(el("s", null, m.said), " → ");
    body.append(el("ins", null, m.target), sayButton(m.target));
    if (m.why) body.append(el("span", "why", m.why));
    const side = el("div");
    side.append(el("span", "due", m.due <= now ? "hoje" : fmtDate(m.due)));
    const x = el("button", "x", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Remover");
    x.addEventListener("click", () => {
      store.data.mistakes = store.data.mistakes.filter((y) => y !== m);
      store.save();
      renderReview();
    });
    side.append(x);
    li.append(body, side);
    ul.append(li);
  }
  const sl = $("#sessions");
  sl.innerHTML = "";
  if (!store.data.sessions.length) sl.append(el("li", "muted", "Nenhuma chamada registrada."));
  for (const s of store.data.sessions) {
    const li = el("li");
    li.append(el("b", null, `${s.scenario}`), el("span", "muted", `${fmtDate(s.date)} · ${s.minutes || 0} min · ${s.spoken ?? s.turns} falas` + (s.spoken ? ` · ${s.clean} sem correção` : "") + (s.pron != null ? ` · pronúncia ${s.pron}` : "")));
    if (s.icao) li.append(el("span", "s-score", `ICAO ≈ ${s.icao.overall} · ` + CRITERIA.filter(([k]) => s.icao[k] != null).map(([k, l]) => `${l.slice(0, 4)} ${s.icao[k].toFixed(1)}`).join(" · ")));
    sl.append(li);
  }
}
$("#review-practice").addEventListener("click", () => {
  const now = Date.now();
  const items = store.data.mistakes.filter((m) => m.due <= now).map((m) => ({ say: m.target, pt: m.why || "", mistake: true }));
  showTab("drill");
  drill.reviewMode = true;
  setDrill("mine", items);
});
$("#clear-data").addEventListener("click", () => ($("#clear-confirm").hidden = false));
$("#clear-no").addEventListener("click", () => ($("#clear-confirm").hidden = true));
$("#clear-yes").addEventListener("click", () => {
  store.data.mistakes = [];
  store.data.sessions = [];
  store.data.best = {};
  store.save();
  $("#clear-confirm").hidden = true;
  renderReview();
  renderDrillCats();
});

/* ---------- Referência ---------- */
function renderRef(target, rows, speakIdx) {
  const box = $(target);
  for (const r of rows) {
    const b = el("button", "ref-cell");
    b.type = "button";
    b.append(el("span", "k", r[0]), el("span", "w", r[1]), el("span", "s", r[2]));
    b.addEventListener("click", () => { unlockAudio(); stopAllAudio(); speak(r[speakIdx], 0.85); });
    box.append(b);
  }
}
renderRef("#ref-alpha", PHONETIC, 1);
renderRef("#ref-num", NUMBERS.map((n) => [n[0], n[1], n[2]]), 2);

/* ---------- Início ---------- */
renderDrillCats();
renderDrill();
loadConfig();
updateCallButtons();
