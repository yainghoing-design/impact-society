import { useState, useEffect, useRef } from "react";
import { submitScore, fetchTop, enabled as onlineEnabled } from "./leaderboard.js";

// ---- Palette: The Life Aquatic swatches ----
const C = { red: "#BC301A", teal: "#A8BEBC", brown: "#78462D", sand: "#D2B491", cream: "#F3EBDD", ink: "#3A2418" };

// ---- Three-press gauge on a ring ----
const BASE_SPEED = 120, SPEED_STEP = 34, SHOT_STEP = 6, MAX_LEVEL = 12;   // degrees per second
const ARC = 270, OVER = -14, LEVEL_UP_EVERY = 2, ROUND_SHOTS = 18, FEVER_AT = 3, FEVER_MULT = 1.2;
const SNAP = ARC * 0.035; // press anywhere in the Max band and the power locks at a true 100%
const OVERSHOOT = ARC * 1.12; // gauge may run past Max and simply turns back — never an error
const GRADES = [
  { max: 3,  label: "JUST IMPACT", pts: 100, color: C.red },
  { max: 8,  label: "NICE",        pts: 60,  color: C.brown },
  { max: 16, label: "FAIR",        pts: 30,  color: C.teal },
  { max: 999,label: "MISS",        pts: 0,   color: C.ink },
];
const MODES = { free: { name: "Full Swing", desc: "Three presses. The fuller the power, the bigger the score." } };

// ================= audio =================
let actx, noiseBuf;
const ctx = () => {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const n = actx.sampleRate * 0.3, b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = b;
  }
  if (actx.state === "suspended") actx.resume();
  return actx;
};
const beep = (f, d = 0.06, t = "square", g = 0.08) => {
  try {
    const a = ctx(), o = a.createOscillator(), v = a.createGain();
    o.type = t; o.frequency.value = f; v.gain.value = g;
    o.connect(v); v.connect(a.destination); o.start();
    v.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d);
    o.stop(a.currentTime + d);
  } catch {}
};
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
const hit = (f, d, t = "triangle", g = 0.12) => beep(f, d, t, g);
const jingle1 = () => hit(392, 0.12);
const jingle2 = () => { hit(392, 0.1); setTimeout(() => hit(523, 0.14), 110); };
const jingle3 = (up = 1) => { hit(392 * up, 0.1); setTimeout(() => hit(523 * up, 0.1), 110); setTimeout(() => hit(784 * up, 0.35, "triangle", 0.16), 220); };
// the sweet-spot spark off a club face
const spark = (strength = 1) => {
  try {
    const a = ctx(), t = a.currentTime;
    const src = a.createBufferSource(); src.buffer = noiseBuf;
    const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 4200; bp.Q.value = 7;
    const ng = a.createGain(); ng.gain.setValueAtTime(0.2 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(bp); bp.connect(ng); ng.connect(a.destination); src.start(t); src.stop(t + 0.15);
    [2637, 3520, 4699].forEach((f, i) => {
      const o = a.createOscillator(), v = a.createGain();
      o.type = "square"; o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.3);
      v.gain.setValueAtTime((0.06 * strength) / (i + 1), t);
      v.gain.exponentialRampToValueAtTime(0.0001, t + 0.28 + i * 0.06);
      o.connect(v); v.connect(a.destination); o.start(t); o.stop(t + 0.36);
    });
  } catch {}
};
const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.15, "triangle", 0.14), i * 70));

// ---- 8-bit marching boots ----
const MARCH_VOL = 0.32; // quiet bed under the title
const boot = (t, accent) => {
  const a = actx, v = MARCH_VOL;
  const src = a.createBufferSource(); src.buffer = noiseBuf;
  const lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = accent ? 1300 : 950;
  const ng = a.createGain(); ng.gain.setValueAtTime((accent ? 0.13 : 0.07) * v, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  src.connect(lp); lp.connect(ng); ng.connect(a.destination); src.start(t); src.stop(t + 0.08);
  const o = a.createOscillator(), g = a.createGain();
  o.type = "square"; o.frequency.setValueAtTime(accent ? 92 : 76, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.08);
  g.gain.setValueAtTime((accent ? 0.2 : 0.12) * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.11);
};
// one bar = DA-tta / DA-tta / DA-tta / da-da-da   (offsets in seconds, accent flag)
const BEAT = 0.5;
const BAR = [
  [0.00, 1], [0.30, 0],
  [0.50, 1], [0.80, 0],
  [1.00, 1], [1.30, 0],
  [1.50, 1], [1.66, 0], [1.82, 0],
];
const BAR_LEN = BEAT * 4;
let marchTimer = null, marchBar = 0;
const startMarch = () => {
  try {
    const a = ctx();
    if (marchTimer) return;
    marchBar = a.currentTime + 0.15;
    marchTimer = setInterval(() => {
      while (marchBar < actx.currentTime + 0.6) {
        BAR.forEach(([off, acc]) => boot(marchBar + off, acc === 1));
        marchBar += BAR_LEN;
      }
    }, 120);
  } catch {}
};
const stopMarch = () => { if (marchTimer) { clearInterval(marchTimer); marchTimer = null; } };

const initial = () => ({
  screen: "start", phase: "idle", pos: 0, dir: 1, power: 0, level: 1, streak: 0, shots: 0, score: 0, devs: [], total: 0,
  last: null, mode: "free", best: { score: 0, streak: 0, level: 1 }, record: false, confetti: 0, shake: 0, banner: "",
  submitted: false, pendingScore: null, pad: "", topLevel: 1, spark: 0,
});

const lockPower = (pos) => (pos >= ARC - SNAP ? ARC : Math.max(0, pos));

export default function ImpactTrainer() {
  const S = useRef(initial());
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const raf = useRef(0), tPrev = useRef(0), lastPointer = useRef(0);
  const [board, setBoard] = useState(null);
  const [nick, setNick] = useState(() => { try { return localStorage.getItem("nick") || ""; } catch { return ""; } });
  const [sending, setSending] = useState(false);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(true);
  useEffect(() => { soundRef.current = sound; if (!sound) stopMarch(); else if (S.current.screen !== "play") startMarch(); }, [sound]);

  const speed = () => {
    const s = S.current;
    return (BASE_SPEED + (s.level - 1) * SPEED_STEP + s.shots * SHOT_STEP) * (s.streak >= FEVER_AT ? FEVER_MULT : 1);
  };

  useEffect(() => {
    try { const r = localStorage.getItem("circle-shot-best"); if (r) { S.current.best = JSON.parse(r); rerender(); } } catch {}
    const onKey = (e) => { if (e.code === "Space" || e.key === " " || e.key === "Enter") { e.preventDefault(); press(); } };
    window.addEventListener("keydown", onKey);
    const prev = new Map(); let padRaf = 0, hadPad = false;
    const pollPad = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (!gp) continue;
        if (!hadPad) { hadPad = true; S.current.pad = gp.id.slice(0, 24); rerender(); }
        const edge = (i) => { const k = gp.index + ":" + i, was = prev.get(k) || false, now = Boolean(gp.buttons[i] && gp.buttons[i].pressed); prev.set(k, now); return now && !was; };
        if (edge(1)) press();
        if (edge(9)) toggleBoard();
        [0, 2, 3, 4, 5, 7].forEach(edge);
      }
      padRaf = requestAnimationFrame(pollPad);
    };
    padRaf = requestAnimationFrame(pollPad);
    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(raf.current); cancelAnimationFrame(padRaf); stopMarch(); };
  }, []); // eslint-disable-line

  const frame = (now) => {
    const s = S.current, dt = Math.min(0.05, (now - tPrev.current) / 1000);
    tPrev.current = now;
    s.pos += s.dir * speed() * dt;
    if (s.phase === "power" && s.pos >= OVERSHOOT) { s.pos = OVERSHOOT; s.dir = -1; s.power = 0; s.phase = "rewind"; beep(180, 0.18, "square", 0.09); }
    if (s.phase === "rewind") { s.pos -= speed() * dt; if (s.pos <= 0) { s.pos = 0; s.dir = 1; s.phase = "power"; jingle1(); } }
    if (s.phase === "impact" && s.pos <= OVER) { finish(OVER, true); return; }
    if (s.phase === "rewind") { rerender(); raf.current = requestAnimationFrame(frame); return; }
    rerender(); raf.current = requestAnimationFrame(frame);
  };

  const finish = (dev, timeout = false) => {
    cancelAnimationFrame(raf.current);
    const s = S.current;
    const g = timeout ? GRADES[3] : GRADES.find((x) => Math.abs(dev) <= x.max);
    const devMs = Math.round((Math.abs(dev) / speed()) * 1000);
    const pRatio = Math.min(1, s.power / ARC);
    const powerMult = 0.5 + 0.5 * pRatio;
    const powerNote = `Power ${Math.round(pRatio * 100)}% · ×${powerMult.toFixed(2)}`;
    const combo = g.pts >= 60 ? s.streak + 1 : 0, feverNow = combo >= FEVER_AT;
    const pts = Math.max(0, Math.round((g.pts + (g.pts ? combo * 15 : 0)) * powerMult * (feverNow ? 2 : 1)));
    let level = s.level;
    if (combo > 0 && combo % LEVEL_UP_EVERY === 0) level = Math.min(MAX_LEVEL, level + 1);
    if (g.label === "MISS" && s.streak === 0 && level > 1) level--;
    s.last = { ...g, dev, devMs, pts, combo, timeout, levelUp: level > s.level, powerNote };
    s.banner = level > s.level ? `LEVEL ${level}` : combo === FEVER_AT ? "FEVER" : combo > FEVER_AT ? `${combo} IN A ROW` : g.label === "MISS" && s.streak >= FEVER_AT ? "FEVER OVER" : "";
    if (g.pts >= 60) { s.spark = (s.spark || 0) + 1; spark(g.pts === 100 ? 1 : 0.6); }
    if (g.pts === 100) { s.confetti++; s.shake++; }
    if (level > s.level) { s.confetti++; fanfare(); }
    s.streak = combo; s.level = level; s.topLevel = Math.max(s.topLevel, level);
    s.shots++; s.score += pts; s.devs.push(devMs); s.total++; s.phase = "result";
    const up = 1 + Math.min(combo, 8) * 0.06;
    if (g.pts === 100) { jingle3(up); buzz([30, 30, 60]); }
    else if (g.pts === 60) { jingle3(up * 0.94); buzz(40); }
    else if (g.pts === 30) { beep(440, 0.06); buzz(20); }
    else { beep(140, 0.25, "sawtooth", 0.1); buzz(120); }
    if (s.shots >= ROUND_SHOTS) setTimeout(endRound, 900);
    rerender();
  };

  const endRound = () => {
    const s = S.current;
    let rec = false;
    if (s.best.streak < s.bestStreakInRound) rec = true;
    if (s.score > s.best.score) { s.best.score = s.score; rec = true; }
    if (s.topLevel > s.best.level) { s.best.level = s.topLevel; rec = true; }
    if (rec) { try { localStorage.setItem("circle-shot-best", JSON.stringify(s.best)); } catch {} }
    s.record = rec;
    s.pendingScore = { score: s.score, level: s.topLevel, meanMs: Math.round(s.devs.reduce((a, b) => a + b, 0) / Math.max(1, s.devs.length)), mode: s.mode };
    s.submitted = false;
    s.screen = "over"; s.phase = "idle"; s.banner = "";
    fanfare();
    if (soundRef.current) startMarch();
    rerender();
  };

  const beginRound = () => {
    const s = S.current;
    stopMarch();
    s.screen = "play"; s.shots = 0; s.score = 0; s.devs = []; s.level = 1; s.topLevel = 1; s.streak = 0;
    s.bestStreakInRound = 0; s.last = null; s.record = false; s.banner = ""; s.phase = "idle";
    swing();
  };

  const swing = () => {
    const s = S.current;
    s.pos = 0; s.dir = 1; s.power = 0; s.last = null; s.banner = "";
    s.phase = "power"; jingle1();
    tPrev.current = performance.now(); cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(frame);
    rerender();
  };

  const press = () => {
    const s = S.current;
    if (board) { setBoard(null); return; }
    if (s.screen === "start") { beginRound(); return; }
    if (s.screen === "over") { toStart(); return; }
    if (s.phase === "result") { if (s.shots < ROUND_SHOTS) swing(); return; }
    if (s.phase === "rewind") return;
    if (s.phase === "power") { s.power = lockPower(s.pos); s.dir = -1; s.phase = "impact"; jingle2(); if (s.power === ARC) beep(1046, 0.09, "triangle", 0.1); rerender(); return; }
    if (s.phase === "impact") { finish(s.pos); return; }
  };

  const toStart = () => {
    const s = S.current;
    cancelAnimationFrame(raf.current);
    s.screen = "start"; s.phase = "idle"; s.last = null; s.banner = ""; s.streak = 0;
    if (soundRef.current) startMarch();
    rerender();
  };

  const onPointer = (e) => { e.preventDefault(); lastPointer.current = Date.now(); press(); };
  const onClick = () => { if (Date.now() - lastPointer.current > 400) press(); };
  const stopAll = (e) => { e.stopPropagation(); };
  const btn = (e, fn) => { e.stopPropagation(); e.preventDefault(); fn(); };
  const toggleBoard = async () => {
    if (board) { setBoard(null); return; }
    setBoard([]); setBoard(await fetchTop(S.current.mode));
  };
  const send = async (e) => {
    stopAll(e); e.preventDefault();
    const s = S.current; if (!s.pendingScore || sending) return;
    setSending(true);
    try { localStorage.setItem("nick", nick); } catch {}
    const r = await submitScore({ name: nick, ...s.pendingScore });
    setSending(false);
    if (r.ok) { s.submitted = true; setBoard(await fetchTop(s.mode)); }
    rerender();
  };

  const s = S.current;
  if (s.phase !== "idle" && s.streak > (s.bestStreakInRound || 0)) s.bestStreakInRound = s.streak;
  const fever = s.streak >= FEVER_AT && s.screen === "play";
  const fg = fever ? C.cream : C.ink, sub = fever ? C.sand : C.brown;
  const bits = s.confetti ? Array.from({ length: 36 }, (_, i) => i) : [];
  const avg = s.devs.length ? Math.round(s.devs.reduce((a, b) => a + b, 0) / s.devs.length) : null;

  const R = 42, cx = 50, cy = 50;
  const pt = (deg, r = R) => { const a = ((deg + 90 + (360 - ARC) / 2) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const arc = (from, to, r = R) => { const [x1, y1] = pt(from, r), [x2, y2] = pt(to, r); return `M ${x1} ${y1} A ${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} 1 ${x2} ${y2}`; };
  const tick = (deg, len, col, w = 1.4) => { const [a, b] = pt(deg, R - len), [c, d] = pt(deg, R + len); return <line x1={a} y1={b} x2={c} y2={d} stroke={col} strokeWidth={w} />; };
  const [mx, my] = pt(Math.max(OVER, Math.min(OVERSHOOT, s.pos))), [px, py] = pt(s.power);

  const Btn = ({ onPress, children, solid, wide }) => (
    <button onPointerDown={(e) => btn(e, onPress)} onClick={stopAll}
      style={{ padding: wide ? "12px 34px" : "8px 14px", fontSize: wide ? 17 : 14, letterSpacing: 2.5, textTransform: "uppercase",
        fontFamily: "inherit", fontWeight: 700, cursor: "pointer", border: `1px solid ${fg}`,
        background: solid ? fg : "transparent", color: solid ? (fever ? C.red : C.cream) : fg }}>{children}</button>
  );
  const Rule = ({ w = 150 }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, margin: "6px auto 0", width: w, color: sub }}>
      <div style={{ flex: 1, height: 1, background: "currentColor", opacity: .5 }} />
      <div style={{ width: 5, height: 5, background: "currentColor", transform: "rotate(45deg)" }} />
      <div style={{ flex: 1, height: 1, background: "currentColor", opacity: .5 }} />
    </div>
  );
  const Stat = ({ label, value, accent }) => (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div style={{ fontSize: 13, letterSpacing: 3, color: sub }}>{label}</div>
      <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, color: accent || fg }}>{value}</div>
    </div>
  );

  return (
    <div onPointerDown={onPointer} onClick={onClick}
      style={{ fontFamily: "'Jost','Futura','Avenir Next',sans-serif", background: fever ? C.red : C.cream, color: fg,
        minHeight: "100vh", userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation", cursor: "pointer",
        display: "flex", flexDirection: "column", position: "relative", overflow: "hidden", transition: "background .25s", textTransform: "uppercase" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Jost:wght@400;500;700&display=swap');
        @keyframes fall{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:.8}}
        @keyframes shake{0%,100%{transform:none}20%{transform:translate(-6px,3px)}40%{transform:translate(6px,-3px)}60%{transform:translate(-4px,-2px)}80%{transform:translate(4px,2px)}}
        @keyframes banner{0%{transform:scale(.4);opacity:0}15%{transform:scale(1.1);opacity:1}30%{transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:translateY(-30px)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
        @keyframes sparkfx{0%{opacity:1;transform:scale(.25) rotate(0)}70%{opacity:.9}100%{opacity:0;transform:scale(1.5) rotate(22deg)}}
        @keyframes march{0%,100%{transform:translateX(-3px)}50%{transform:translateX(3px)}}
        @media (prefers-reduced-motion:reduce){[style*="animation"]{animation:none!important}}`}</style>

      {bits.map((i) => { const cols = [C.red, C.teal, C.brown, C.sand, C.cream]; return (
        <div key={s.confetti + "-" + i} style={{ position: "absolute", top: -12, left: `${(i * 37) % 100}%`, width: 8 + (i % 3) * 3, height: 12, background: cols[i % 5],
          borderRadius: i % 2 ? "50%" : 2, pointerEvents: "none", animation: `fall ${1.2 + (i % 5) * 0.25}s cubic-bezier(.3,.7,.5,1) ${(i % 7) * 0.05}s forwards`, transform: `rotate(${i * 43}deg)` }} />); })}
      {s.banner && s.phase === "result" && (
        <div key={s.banner + s.total} style={{ position: "absolute", top: "30%", left: 0, right: 0, textAlign: "center", pointerEvents: "none", zIndex: 2,
          fontSize: 46, fontWeight: 700, letterSpacing: 6, color: fever ? C.cream : C.red, animation: "banner 1.4s ease-out forwards" }}>{s.banner}</div>)}

      <div key={"frame" + s.shake} style={{ margin: "14px 14px 0", border: `2px solid ${fg}`, padding: 3, flex: 1, display: "flex", flexDirection: "column", animation: s.shake > 0 ? "shake .35s" : "none" }}>
        <div style={{ border: `1px solid ${fg}`, flex: 1, display: "flex", flexDirection: "column" }}>

          {/* ---------- title ---------- */}
          <div style={{ textAlign: "center", padding: s.screen === "start" ? "20px 10px 0" : "14px 12px 4px" }}>
            <div style={{ fontSize: s.screen === "start" ? 13 : 12, letterSpacing: 5, color: sub }}>Vices of the 2020s</div>
            <Rule />
            {s.screen === "start" ? (
              <div style={{ animation: "march 1s steps(2,end) infinite", lineHeight: 0.92, marginTop: 8 }}>
                <div style={{ fontSize: "clamp(40px,13vw,104px)", fontWeight: 700, letterSpacing: "0.02em" }}>THE</div>
                <div style={{ fontSize: "clamp(40px,13vw,104px)", fontWeight: 700, letterSpacing: "0.02em" }}>IMPACT</div>
                <div style={{ fontSize: "clamp(40px,13vw,104px)", fontWeight: 700, letterSpacing: "0.02em", color: C.red }}>SOCIETY</div>
              </div>
            ) : (
              <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 5, lineHeight: 1.2, marginTop: 4 }}>The Impact Society</div>
            )}
          </div>

          {/* ---------- START SCREEN ---------- */}
          {s.screen === "start" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "10px 20px 18px" }}>
              <div style={{ fontSize: 15, letterSpacing: 4, color: fg, fontWeight: 700, border: `1px solid ${fg}`, padding: "8px 18px" }}>Full Swing</div>
              <div style={{ fontSize: 14, letterSpacing: 1.5, color: sub, textAlign: "center", maxWidth: 460, lineHeight: 1.7 }}>
{MODES[s.mode].desc}<br />{ROUND_SHOTS} shots to a round. Two in a row raises the level.
              </div>
              <Btn onPress={beginRound} solid wide>Start · {ROUND_SHOTS} shots</Btn>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn onPress={toggleBoard}>World ranking</Btn>
                <Btn onPress={() => setSound(!sound)}>{sound ? "Sound on" : "Sound off"}</Btn>
              </div>
              <div style={{ fontSize: 13, letterSpacing: 2, color: sub }}>Best {s.best.score} · Streak {s.best.streak} · Level {s.best.level}</div>
            </div>)}

          {/* ---------- PLAY SCREEN ---------- */}
          {s.screen === "play" && (<>
            <div style={{ display: "flex", padding: "6px 8px 0" }}>
              <Stat label="Level" value={s.level} />
              <Stat label="Streak" value={<span style={{ animation: fever ? "pulse .6s infinite" : "none" }}>{s.streak}</span>} accent={fever ? C.cream : s.streak > 0 ? C.red : fg} />
              <Stat label={`Shot ${s.shots}/${ROUND_SHOTS}`} value={s.score} />
            </div>
            <div style={{ textAlign: "center", fontSize: 11, letterSpacing: 5, color: sub, marginTop: 2 }}>Full Swing</div>
            {fever && <div style={{ textAlign: "center", fontSize: 13, letterSpacing: 4, color: C.sand }}>Fever — Double Points</div>}

            <div style={{ padding: "4px 28px 0", maxWidth: 400, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
              <svg viewBox="0 0 100 100" width="100%" style={{ display: "block" }}>
                <path d={arc(OVER, OVERSHOOT)} stroke={fever ? C.cream : C.teal} strokeWidth="7" fill="none" strokeLinecap="round" opacity=".55" />
                <path d={arc(-16, 16)} stroke={C.sand} strokeWidth="7" fill="none" />
                <path d={arc(-8, 8)} stroke={C.brown} strokeWidth="7" fill="none" opacity=".7" />
                <path d={arc(-3, 3)} stroke={fever ? C.sand : C.red} strokeWidth="9" fill="none" />
                {s.power > 0 && <path d={arc(0, s.power)} stroke={C.brown} strokeWidth="7" fill="none" opacity=".35" />}
                {s.phase === "power" && s.pos > 0.5 && <path d={arc(0, s.pos)} stroke={C.brown} strokeWidth="7" fill="none" />}
                                <path d={arc(ARC - SNAP, OVERSHOOT)} stroke={C.sand} strokeWidth="7" fill="none" />
                {tick(ARC, 9, C.red, 0.7)}
                {tick(0, 9, fg, 0.7)}
                {s.power > 0 && <circle cx={px} cy={py} r="2.2" fill={C.sand} stroke={C.brown} strokeWidth=".5" opacity=".9" />}
                {s.phase === "result" && s.last && s.last.pts >= 60 && (() => { const [ix, iy] = pt(0); return (
                  <g key={"spark" + s.spark} style={{ transformOrigin: `${ix}px ${iy}px`, animation: "sparkfx .45s ease-out forwards" }}>
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => {
                      const r = (d * Math.PI) / 180, x1 = ix + Math.cos(r) * 3.5, y1 = iy + Math.sin(r) * 3.5;
                      const x2 = ix + Math.cos(r) * 9, y2 = iy + Math.sin(r) * 9;
                      return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke={s.last.pts === 100 ? C.red : C.sand} strokeWidth="1.1" strokeLinecap="round" />;
                    })}
                  </g>); })()}
                {s.phase !== "idle" && <circle cx={mx} cy={my} r="4" fill={s.phase === "impact" ? C.red : C.cream} stroke={s.phase === "impact" ? C.sand : C.brown} strokeWidth=".8" />}
                <text x="50" y="45" textAnchor="middle" fontSize="6.4" fontWeight="700" letterSpacing="1" fill={fg} style={{ fontFamily: "inherit" }}>
                  {s.phase === "power" ? "Power" : s.phase === "rewind" ? "Overrun" : s.phase === "impact" ? "Press on red" : s.last && s.last.label}
                </text>
                <text x="50" y="53" textAnchor="middle" fontSize="4.2" letterSpacing=".5" fill={sub} style={{ fontFamily: "inherit" }}>
                  {s.phase === "result" && s.last ? (s.last.timeout ? "No press" : `${s.last.devMs} ms ${s.last.dev > 0 ? "early" : "late"}`) : `${Math.round((lockPower(s.pos) / ARC) * 100)}%`}
                </text>
                <text x="50" y="61" textAnchor="middle" fontSize="4.6" fontWeight="700" fill={fever ? C.cream : C.red} style={{ fontFamily: "inherit" }}>
                  {s.phase === "result" && s.last && s.last.pts > 0 ? `+${s.last.pts}` : ""}
                </text>
              </svg>
            </div>

            <div style={{ flex: 1, textAlign: "center", padding: "6px 20px 12px", minHeight: 70, fontSize: 14, letterSpacing: 1.5, lineHeight: 1.8, color: sub }}>
              {s.phase === "result" && s.last && (<div>
    {s.last.powerNote && <div style={{ color: s.last.pts > 0 ? fg : sub }}>{s.last.powerNote}</div>}
                {s.last.levelUp && <div style={{ color: fg, fontWeight: 700 }}>Gauge now {Math.round(speed())}° per second</div>}
                {s.shots < ROUND_SHOTS ? <div style={{ color: fg, fontWeight: 700 }}>Press ○ for shot {s.shots + 1}</div>
                  : <div style={{ color: fg, fontWeight: 700 }}>Round over…</div>}
              </div>)}
              {s.phase === "power" && <div>Press ○ to lock the power</div>}
              {s.phase === "rewind" && <div style={{ color: C.red, fontWeight: 700 }}>Overrun — the gauge returns, swing again</div>}
              {s.phase === "impact" && <div>Press ○ on the red mark</div>}
            </div>
          </>)}

          {/* ---------- ROUND OVER SCREEN ---------- */}
          {s.screen === "over" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "0 20px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 6, color: C.red }}>Round Complete</div>
              <div style={{ display: "flex", gap: 26 }}>
                <div><div style={{ fontSize: 13, letterSpacing: 3, color: sub }}>Score</div><div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.1 }}>{s.score}</div></div>
                <div><div style={{ fontSize: 13, letterSpacing: 3, color: sub }}>Level</div><div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.1 }}>{s.topLevel}</div></div>
                <div><div style={{ fontSize: 13, letterSpacing: 3, color: sub }}>Mean error</div><div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.1 }}>{avg}<span style={{ fontSize: 16 }}> ms</span></div></div>
              </div>
              {s.record && <div style={{ fontSize: 16, fontWeight: 700, color: C.red, letterSpacing: 2 }}>Personal best</div>}
              {onlineEnabled && !s.submitted && (
                <div onPointerDown={stopAll} onClick={stopAll}
                  style={{ border: `1px solid ${fg}`, padding: "14px 22px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 2 }}>
                  <div style={{ fontSize: 12, letterSpacing: 4, color: sub }}>Enter your initials</div>
                  <div style={{ position: "relative", width: 156, height: 54 }}>
                    <div style={{ position: "absolute", inset: 0, display: "flex", gap: 8, pointerEvents: "none" }}>
                      {[0, 1, 2].map((i) => (
                        <div key={i} style={{ flex: 1, border: `1px solid ${nick.length === i ? C.red : fg}`, display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 30, fontWeight: 700, lineHeight: 1, color: fg, background: nick[i] ? "transparent" : "rgba(120,70,45,.06)" }}>
                          {nick[i] || ""}
                        </div>))}
                    </div>
                    <input value={nick} onChange={(e) => setNick(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3))} maxLength={3} autoFocus
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "text" }} />
                  </div>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: sub }}>3 letters · shown on the world board</div>
                  <button onPointerDown={send} onClick={stopAll} disabled={sending || nick.length === 0}
                    style={{ fontFamily: "inherit", fontSize: 15, letterSpacing: 2.5, textTransform: "uppercase", fontWeight: 700, border: `1px solid ${fg}`,
                      background: nick.length ? fg : "transparent", color: nick.length ? C.cream : sub, padding: "11px 22px", cursor: nick.length ? "pointer" : "default" }}>
                    {sending ? "Sending" : "Submit score"}</button>
                </div>)}
              {s.submitted && <div style={{ fontSize: 15, letterSpacing: 2, color: sub }}>Score submitted</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <Btn onPress={toStart} solid>Back to start</Btn>
                <Btn onPress={toggleBoard}>World ranking</Btn>
              </div>
              {s.total % 30 === 0 && s.total > 0 && <div style={{ fontSize: 14, color: C.red, letterSpacing: 1.5 }}>Thirty shots. Rest one minute. Look far away.</div>}
            </div>)}

          <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", padding: "10px 10px 12px", fontSize: 12, letterSpacing: 2, color: sub, borderTop: `1px solid ${fg}` }}>
            <span>Best {s.best.score}</span><span>Streak {s.best.streak}</span><span>Level {s.best.level}</span>
            <span>{s.screen === "play" ? `${Math.round(speed())}°/s` : "Full Swing"}</span>
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: 11, letterSpacing: 4, padding: "8px 0 12px", color: sub }}>
        {s.pad ? `Controller connected · ${s.pad} · L1/R1 mode · Options ranking` : "Est. 2026 — Tokyo"}</div>

      {board && (
        <div onPointerDown={(e) => { stopAll(e); e.preventDefault(); setBoard(null); }} onClick={stopAll}
          style={{ position: "absolute", inset: 0, background: "rgba(58,36,24,.94)", color: C.cream, zIndex: 5, display: "flex", flexDirection: "column", alignItems: "center", padding: 28, overflowY: "auto" }}>
          <div style={{ fontSize: 12, letterSpacing: 5, color: C.sand }}>{MODES[s.mode].name}</div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 5, marginBottom: 14 }}>World Ranking</div>
          {!onlineEnabled && <div style={{ fontSize: 14, letterSpacing: 1 }}>Offline build — no ranking yet</div>}
          {onlineEnabled && board.length === 0 && <div style={{ fontSize: 14, letterSpacing: 2, color: C.sand }}>No scores yet — be the first</div>}
          {board.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "34px 60px 1fr 66px 70px", width: "100%", maxWidth: 400, fontSize: 15, letterSpacing: 1.5, padding: "7px 0", borderBottom: `1px solid ${C.brown}` }}>
              <span style={{ color: C.sand }}>{i + 1}</span><span style={{ fontWeight: 700 }}>{r.name}</span><span style={{ textAlign: "right" }}>{r.score}</span>
              <span style={{ textAlign: "right", color: C.sand }}>Lv {r.level}</span><span style={{ textAlign: "right", color: C.sand }}>{r.mean_ms} ms</span>
            </div>))}
          <div style={{ marginTop: 18, fontSize: 12, letterSpacing: 3, color: C.sand }}>Tap or Options to close</div>
        </div>)}
    </div>
  );
}
