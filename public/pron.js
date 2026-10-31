// Avaliação de pronúncia com o Azure Speech: escuta o microfone, transcreve
// e dá nota (0–100) para cada palavra e cada som (fonema).

let sdkPromise = null;
function loadSdk() {
  if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/speech-sdk.js";
    s.onload = () => resolve(window.SpeechSDK);
    s.onerror = () => { sdkPromise = null; reject(new Error("Não foi possível carregar o Azure Speech SDK.")); };
    document.head.append(s);
  });
  return sdkPromise;
}

let tokenCache = null;
async function getToken(password) {
  if (tokenCache && Date.now() - tokenCache.at < 8 * 60 * 1000) return tokenCache;
  const r = await fetch("api/speech-token", { method: "POST", headers: { "x-app-password": password || "" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Falha ao obter o token do Azure.");
  tokenCache = { ...j, at: Date.now() };
  return tokenCache;
}

export function preloadAzure(password) {
  loadSdk().catch(() => {});
  getToken(password).catch(() => {});
}

// Microfone único da chamada, aberto dentro do toque em Chamar. O iPhone só libera
// áudio iniciado por um toque, e a IA fala antes de o aluno responder, então o SDK
// abriria o microfone tarde demais. Assim ele também não reabre a cada fala.
let mic = null;
export async function openSharedMic() {
  if (mic) return;
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("sem getUserMedia"), { name: "NoMediaDevices" });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    mic = { ctx, stream, node, push: null };
    node.onaudioprocess = (ev) => {
      if (mic?.push) mic.push.write(toPcm16k(ev.inputBuffer.getChannelData(0), ctx.sampleRate));
    };
  } catch (e) {
    ctx.close().catch(() => {});
    throw e;
  }
}
export function closeSharedMic() {
  if (!mic) return;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close().catch(() => {});
  mic = null;
}
// O Azure espera PCM de 16 kHz, 16 bits, mono.
function toPcm16k(input, rate) {
  const ratio = rate / 16000;
  const out = new Int16Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio), to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j];
    out[i] = Math.max(-1, Math.min(1, sum / (to - from))) * 0x7fff;
  }
  return out.buffer;
}
function sharedMicAudio(sdk) {
  const push = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1));
  mic.push = push;
  return { audio: sdk.AudioConfig.fromStreamInput(push), detach() {
    if (mic?.push === push) mic.push = null;
    try { push.close(); } catch {}
  } };
}

// Mesmo formato do ouvinte do navegador: { result, stop, cancel }.
// referenceText vazio = fala livre (conversa); preenchido = frase-alvo (treino).
// lang "auto" detecta português ou inglês na fala, sem nota de pronúncia (o Azure só avalia com idioma fixo).
export function createAzureListener({ referenceText = "", onInterim, onReady, manual = false, silenceMs = 800, password = "", lang = "en" } = {}) {
  let rec = null;
  let detach = () => {};
  let finished = false;
  let stopRequested = false;
  let timer = null;
  const segments = [];
  let interim = "";
  let detected = lang === "en" ? "en-US" : "";
  let resolve, reject;
  const result = new Promise((res, rej) => { resolve = res; reject = rej; });

  const text = () => [...segments.map((s) => s.DisplayText || ""), interim].join(" ").replace(/\s+/g, " ").trim();
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const t = segments.map((s) => s.DisplayText || "").join(" ").replace(/\s+/g, " ").trim() || interim.trim();
    const conf = segments.map((s) => s.NBest?.[0]?.Confidence || 0).filter(Boolean);
    const pron = lang === "en" ? mergeAssessment(segments, Boolean(referenceText)) : null;
    resolve({ text: t, confidence: conf.length ? Math.min(...conf) : 0, alternatives: [], pron, detected });
    detach();
    try { rec?.close(); } catch {}
  };
  const fail = (err) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    detach();
    try { rec?.close(); } catch {}
    reject(err);
  };
  const stop = () => {
    if (finished || stopRequested) return;
    stopRequested = true;
    clearTimeout(timer);
    if (!rec) return; // ainda iniciando: para assim que abrir
    rec.stopContinuousRecognitionAsync(() => setTimeout(finish, 50), () => finish());
  };
  const arm = () => {
    if (manual) return;
    clearTimeout(timer);
    if (segments.length) timer = setTimeout(stop, silenceMs);
  };

  (async () => {
    const sdk = await loadSdk();
    const { token, region } = await getToken(password);
    if (finished) return;
    const cfg = sdk.SpeechConfig.fromAuthorizationToken(token, region);
    cfg.outputFormat = sdk.OutputFormat.Detailed;
    let audio;
    if (mic) ({ audio, detach } = sharedMicAudio(sdk));
    else audio = sdk.AudioConfig.fromDefaultMicrophoneInput();
    if (lang === "en") {
      cfg.speechRecognitionLanguage = "en-US";
      rec = new sdk.SpeechRecognizer(cfg, audio);
      const pa = new sdk.PronunciationAssessmentConfig(
        referenceText,
        sdk.PronunciationAssessmentGradingSystem.HundredMark,
        sdk.PronunciationAssessmentGranularity.Phoneme,
        Boolean(referenceText),
      );
      pa.phonemeAlphabet = "IPA";
      pa.nbestPhonemeCount = 5;
      pa.enableProsodyAssessment = true;
      pa.applyTo(rec);
    } else if (lang === "pt") {
      cfg.speechRecognitionLanguage = "pt-BR";
      detected = "pt-BR";
      rec = new sdk.SpeechRecognizer(cfg, audio);
    } else {
      rec = sdk.SpeechRecognizer.FromConfig(cfg, sdk.AutoDetectSourceLanguageConfig.fromLanguages(["pt-BR", "en-US"]), audio);
    }

    rec.recognizing = (_, e) => {
      interim = e.result.text || "";
      onInterim?.(text());
      clearTimeout(timer);
    };
    rec.recognized = (_, e) => {
      if (e.result.reason !== sdk.ResultReason.RecognizedSpeech || !e.result.text) return;
      if (lang === "auto") detected = sdk.AutoDetectSourceLanguageResult.fromResult(e.result).language || detected;
      try {
        segments.push(JSON.parse(e.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult)));
      } catch {
        segments.push({ DisplayText: e.result.text });
      }
      interim = "";
      onInterim?.(text());
      arm();
    };
    rec.canceled = (_, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        const d = e.errorDetails || "";
        fail(new Error(/permission|NotAllowed|microphone/i.test(d)
          ? "O microfone foi bloqueado. Libere o microfone para este site nas configurações do navegador."
          : "Erro no Azure Speech: " + d));
      }
    };
    rec.startContinuousRecognitionAsync(
      () => {
        if (stopRequested) { stopRequested = false; stop(); return; }
        onReady?.();
      },
      (err) => fail(new Error("Não foi possível abrir o microfone: " + err)),
    );
  })().catch(fail);

  return {
    result,
    stop,
    cancel() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      detach();
      try { rec?.stopContinuousRecognitionAsync(() => rec.close(), () => rec.close()); } catch {}
      resolve(null);
    },
  };
}

// Junta os trechos reconhecidos numa avaliação só.
function mergeAssessment(segments, scripted) {
  const words = [];
  const scores = [];
  for (const s of segments) {
    const best = s.NBest?.[0];
    if (!best) continue;
    const pa = best.PronunciationAssessment || {};
    const n = (best.Words || []).filter((w) => w.PronunciationAssessment?.ErrorType !== "Insertion").length || 1;
    scores.push({ n, ...pa });
    for (const w of best.Words || []) {
      const wpa = w.PronunciationAssessment || {};
      words.push({
        word: w.Word,
        score: Math.round(wpa.AccuracyScore ?? 0),
        error: wpa.ErrorType || "None",
        phonemes: (w.Phonemes || []).map((p) => {
          const ppa = p.PronunciationAssessment || {};
          const top = ppa.NBestPhonemes?.[0];
          return {
            ph: p.Phoneme,
            score: Math.round(ppa.AccuracyScore ?? 0),
            heard: top && top.Phoneme !== p.Phoneme ? top.Phoneme : null,
          };
        }),
      });
    }
  }
  if (!words.length) return null;
  const total = scores.reduce((a, s) => a + s.n, 0);
  const avg = (k) => {
    const have = scores.filter((s) => typeof s[k] === "number");
    if (!have.length) return null;
    return Math.round(have.reduce((a, s) => a + s[k] * s.n, 0) / have.reduce((a, s) => a + s.n, 0));
  };
  return {
    scripted,
    words,
    overall: avg("PronScore"),
    accuracy: avg("AccuracyScore"),
    fluency: avg("FluencyScore"),
    prosody: avg("ProsodyScore"),
    completeness: scripted ? avg("CompletenessScore") : null,
    wordCount: total,
  };
}

// Dicas em português para os sons que mais pegam para brasileiros.
const TIPS = {
  "θ": "TH surdo: ponta da língua entre os dentes e solte o ar, sem vibrar a garganta. Não troque por T, F ou S.",
  "ð": "TH sonoro: língua entre os dentes e vibre a garganta. Não troque por D.",
  "h": "H aspirado: só um sopro, como quem embaça um espelho. Não é o R do português.",
  "ɹ": "R americano: enrole a ponta da língua para trás, sem encostar no céu da boca e sem vibrar.",
  "r": "R americano: enrole a ponta da língua para trás, sem encostar no céu da boca e sem vibrar.",
  "ɪ": "I curto e relaxado, quase um 'ê' fechado (ship, live, will).",
  "i": "I longo e tenso: estique os lábios como num sorriso (sheep, leave, speed).",
  "iː": "I longo e tenso: estique os lábios como num sorriso (sheep, leave, speed).",
  "æ": "Boca bem aberta, som entre 'é' e 'á' (cat, map, taxi).",
  "ʌ": "A curto e central, quase 'â' (up, run, one).",
  "ə": "Vogal fraca e neutra (schwa): relaxe a boca e não dê força à sílaba.",
  "ɑ": "A bem aberto, boca aberta e língua baixa (hot, approach, father).",
  "ɔ": "Ó aberto e arredondado (call, short).",
  "ʊ": "U curto e relaxado (good, book, full).",
  "u": "U longo com lábios bem arredondados (two, food, route).",
  "uː": "U longo com lábios bem arredondados (two, food, route).",
  "ɝ": "ER com a língua enrolada para trás (bird, first, turn).",
  "ɚ": "ER fraco com a língua enrolada (water, number, after).",
  "eɪ": "Ditongo 'êi', termine no i (day, way, eight).",
  "oʊ": "Ditongo 'ôu', termine fechando os lábios (go, hold, no).",
  "aɪ": "Ditongo 'ai' (five, nine, right).",
  "aʊ": "Ditongo 'au' (out, now, thousand).",
  "w": "Arredonde bem os lábios, como um 'u' rápido (wind, weather, one).",
  "v": "Dentes de cima encostam no lábio de baixo e a garganta vibra (very, vector).",
  "l": "L com a ponta da língua atrás dos dentes de cima; no fim da palavra não vire 'u' (hold, final).",
  "ŋ": "NG: fundo da língua no céu da boca e o som sai pelo nariz, sem soltar um 'g' (landing).",
  "n": "N final: encoste a língua atrás dos dentes e pare, sem acrescentar vogal.",
  "s": "S sibilante; no começo da palavra não acrescente 'e' antes (speed, not 'espeed').",
  "z": "Z vibrando a garganta (zero, is, runways).",
  "ʃ": "Como o X de 'xícara' (short, check).",
  "tʃ": "TCH curto, sem acrescentar 'i' depois (check, Charlie).",
  "dʒ": "DJ curto (Juliett, change).",
  "t": "T sem virar 'tchi' e sem vogal no final (taxi, flight, eight).",
  "d": "D sem virar 'dji' e sem vogal no final (hold, ground, cleared).",
  "k": "Termine no K, sem acrescentar 'i' (back, check).",
  "p": "Termine no P, sem acrescentar 'i' (stop, up).",
  "g": "G sem vogal no final (fog, flag).",
  "b": "B sem vogal no final (club, cab).",
};
export const tipFor = (ph) => TIPS[ph] || "Ouça devagar, repare na boca e repita imitando o som.";

// Na fonia, "tree" (three) e "tousand" (thousand) são as formas ICAO: não contam como erro.
const ICAO_TH_OK = new Set(["three", "thousand"]);
export function adjustForIcao(w) {
  if (!ICAO_TH_OK.has(w.word.toLowerCase())) return w;
  const bad = w.phonemes.filter((p) => p.score < 60);
  if (bad.length && bad.every((p) => p.ph === "θ")) return { ...w, score: Math.max(w.score, 85), icaoNote: "Na fonia, falar TREE/TOU-SAND é a forma ICAO e está correto." };
  return w;
}

export const scoreClass = (s) => (s >= 80 ? "good" : s >= 60 ? "fair" : "poor");

// Resumo compacto para a IA.
export function summarizeForAI(p) {
  if (!p) return "";
  const head = [`overall ${p.overall}`, `accuracy ${p.accuracy}`, p.fluency != null && `fluency ${p.fluency}`, p.prosody != null && `prosody/intonation ${p.prosody}`].filter(Boolean).join(", ");
  const weak = p.words
    .filter((w) => w.error === "Mispronunciation" || w.score < 70)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((w) => {
      const ph = w.phonemes.filter((x) => x.score < 60).slice(0, 3).map((x) => `/${x.ph}/ ${x.score}${x.heard ? ` sounded like /${x.heard}/` : ""}`).join("; ");
      return `"${w.word}" ${w.score}${ph ? ` (${ph})` : ""}`;
    });
  const breaks = p.words.filter((w) => w.error === "UnexpectedBreak").map((w) => w.word).slice(0, 3);
  return `[ACOUSTIC PRONUNCIATION ASSESSMENT, measured from the audio, 0-100: ${head}. ${weak.length ? "Weak words: " + weak.join(", ") + "." : "No weak words."}${breaks.length ? " Unexpected pauses before: " + breaks.join(", ") + "." : ""}]`;
}
