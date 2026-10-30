// Efeitos visuais: esfera de voz, faíscas de acerto, números que sobem e medidor do microfone.
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Cores do painel digital: ciano parado, verde ouvindo, âmbar pensando, magenta falando, vermelho erro.
const ORB_COLORS = {
  idle: [41, 227, 255],
  listening: [61, 255, 160],
  thinking: [255, 197, 61],
  speaking: [255, 61, 203],
  error: [255, 79, 114],
};

export function createOrb(canvas) {
  const ctx = canvas.getContext("2d");
  let state = "idle";
  let levelSource = null;
  let level = 0;
  let t = 0;
  let col = [...ORB_COLORS.idle];
  let W = 0;
  let raf = 0;

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth || 240;
    canvas.width = W * dpr;
    canvas.height = W * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const blob = (cx, cy, R, steps, wobble) => {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const r = R * (1 + wobble(a));
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
  };

  const draw = () => {
    t += 1 / 60;
    let target;
    if (levelSource) target = levelSource();
    else if (state === "speaking") target = 0.3 + 0.35 * Math.abs(Math.sin(t * 6.1) * Math.sin(t * 2.3));
    else if (state === "thinking") target = 0.14;
    else if (state === "listening") target = 0.1 + 0.05 * Math.sin(t * 3);
    else target = 0.04 + 0.02 * Math.sin(t * 1.5);
    level += (target - level) * 0.2;
    const tc = ORB_COLORS[state] || ORB_COLORS.idle;
    col = col.map((c, i) => c + (tc[i] - c) * 0.08);
    const [r, g, b] = col.map(Math.round);
    const rgb = (a) => `rgba(${r},${g},${b},${a})`;
    const cx = W / 2;
    const cy = W / 2;
    const R = W * 0.22 * (1 + level * 0.35);

    ctx.clearRect(0, 0, W, W);
    const halo = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, W * 0.5);
    halo.addColorStop(0, rgb(0.35 + level * 0.35));
    halo.addColorStop(0.55, rgb(0.07));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, W);

    // Anéis que ondulam com a voz
    for (let k = 0; k < 3; k++) {
      const dir = k % 2 ? -1 : 1;
      const rr = R * (1.3 + k * 0.2) + level * W * 0.04 * (k + 1);
      blob(cx, cy, rr, 120, (a) => (Math.sin(a * (4 + k) + t * (1 + k * 0.5) * dir) * (2 + level * 16)) / rr);
      ctx.strokeStyle = rgb(0.55 - k * 0.15);
      ctx.lineWidth = 1.6;
      ctx.shadowColor = rgb(1);
      ctx.shadowBlur = 14;
      ctx.stroke();
    }

    // Núcleo líquido
    const core = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.1);
    core.addColorStop(0, "rgba(255,255,255,0.95)");
    core.addColorStop(0.3, rgb(0.95));
    core.addColorStop(1, `rgba(${Math.round(r * 0.35)},${Math.round(g * 0.25)},${Math.min(255, Math.round(b * 0.5 + 90))},0.95)`);
    blob(cx, cy, R, 80, (a) => Math.sin(a * 3 + t * 1.7) * 0.05 + Math.sin(a * 5 - t * 2.4) * 0.035 * (0.4 + level * 2.5) + Math.sin(a * 2 + t) * 0.03);
    ctx.shadowColor = rgb(1);
    ctx.shadowBlur = 40;
    ctx.fillStyle = core;
    ctx.fill();

    if (state === "thinking") {
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.85, t * 4, t * 4 + 1.4);
      ctx.strokeStyle = rgb(0.95);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.shadowBlur = 18;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  };

  const loop = () => {
    draw();
    raf = requestAnimationFrame(loop);
  };
  const start = () => {
    cancelAnimationFrame(raf);
    if (reduceMotion()) draw();
    else loop();
  };
  document.addEventListener("visibilitychange", () => (document.hidden ? cancelAnimationFrame(raf) : start()));
  start();

  return {
    set(s, source = null) {
      state = s;
      levelSource = source;
      if (reduceMotion()) draw();
    },
  };
}

// Medidor de volume do microfone (só para a animação; não grava nada).
export async function createMicMeter() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaStreamSource(stream);
  const an = ac.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  return {
    level() {
      an.getByteTimeDomainData(buf);
      let s = 0;
      for (const v of buf) {
        const d = (v - 128) / 128;
        s += d * d;
      }
      return Math.min(1, Math.sqrt(s / buf.length) * 6);
    },
    stop() {
      stream.getTracks().forEach((tr) => tr.stop());
      ac.close().catch(() => {});
    },
  };
}

// Faíscas neon saindo de um ponto (comemoração de acerto).
const fxCanvas = document.getElementById("fx");
const fxCtx = fxCanvas?.getContext("2d");
let particles = [];
let fxRaf = 0;
function fxLoop() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (fxCanvas.width !== innerWidth * dpr) {
    fxCanvas.width = innerWidth * dpr;
    fxCanvas.height = innerHeight * dpr;
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fxCtx.clearRect(0, 0, innerWidth, innerHeight);
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12;
    p.vx *= 0.98;
    p.life -= 1;
    fxCtx.globalAlpha = Math.max(0, p.life / p.max);
    fxCtx.fillStyle = p.c;
    fxCtx.shadowColor = p.c;
    fxCtx.shadowBlur = 12;
    fxCtx.beginPath();
    fxCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    fxCtx.fill();
  }
  fxCtx.globalAlpha = 1;
  fxCtx.shadowBlur = 0;
  if (particles.length) fxRaf = requestAnimationFrame(fxLoop);
  else fxCtx.clearRect(0, 0, innerWidth, innerHeight);
}
export function burstAt(el, colors = ["#3dffa0", "#29e3ff", "#ff3dcb", "#ffc53d"]) {
  if (!fxCtx || !el || reduceMotion()) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 2 + Math.random() * 5;
    const max = 40 + Math.random() * 30;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2.5, r: 1.5 + Math.random() * 2.5, c: colors[i % colors.length], life: max, max });
  }
  cancelAnimationFrame(fxRaf);
  fxLoop();
}

// Número que sobe de 0 até o valor.
export function countUp(el, to, ms = 800) {
  if (!el) return;
  if (reduceMotion()) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
