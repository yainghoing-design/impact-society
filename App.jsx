import { useState, useEffect, useRef } from "react";
import { submitScore, fetchTop, enabled as onlineEnabled } from "./leaderboard.js";

// ---- Palette: The Life Aquatic swatches ----
const C = { red: "#BC301A", teal: "#A8BEBC", brown: "#78462D", sand: "#D2B491", cream: "#F3EBDD", ink: "#3A2418" };

// ---- Classic three-press gauge on a ring: up to set power, back down to hit impact ----
const BASE_SPEED = 120, SPEED_STEP = 34, SHOT_STEP = 6, MAX_LEVEL = 12;   // degrees per second
const ARC = 270, OVER = -14, LEVEL_UP_EVERY = 3, ROUND_SHOTS = 10, FEVER_AT = 3, FEVER_MULT = 1.2;
const GRADES = [
  { max: 3,  label: "JUST IMPACT", pts: 100, color: C.red },
  { max: 8,  label: "NICE",        pts: 60,  color: C.brown },
  { max: 16, label: "FAIR",        pts: 30,  color: C.teal },
  { max: 999,label: "MISS",        pts: 0,   color: C.ink },
];
const MODES = {
  free: { name: "Full Swing", desc: "Three presses. You set the power." },
  full: { name: "Max Power",  desc: "Power is set to max. Only the impact counts." },
  half: { name: "Half Shot",  desc: "Stop the gauge at 50%. Power and impact are scored." },
};

let actx;
const beep = (f, d = 0.06, t = "square", g = 0.08) => {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const o = actx.createOscillator(), v = actx.createGain();
    o.type = t; o.frequency.value = f; v.gain.value = g;
    o.connect(v); v.connect(actx.destination); o.start();
    v.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
    o.stop(actx.currentTime + d);
  } catch {}
};
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
// "Jan! Ja-jan! Ja-ja-jaaan!" — one hit per press
const hit = (f, d, t = "triangle", g = 0.12) => beep(f, d, t, g);
const jingle1 = () => hit(392, 0.12);
const jingle2 = () => { hit(392, 0.1); setTimeout(() => hit(523, 0.14), 110); };
const jingle3 = (up = 1) => { hit(392 * up, 0.1); setTimeout(() => hit(523 * up, 0.1), 110); setTimeout(() => hit(784 * up, 0.35, "triangle", 0.16), 220); };
const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.15, "triangle", 0.14), i * 70));

const initial = () => ({
  phase: "idle", pos: 0, dir: 1, power: 0, level: 1, streak: 0, shots: 0, score: 0, devs: [], total: 0,
  last: null, mode: "free", best: { score: 0, streak: 0, level: 1 }, record: false, confetti: 0, shake: 0, banner: "",
  submitted: false, pendingScore: null, pad: "",
});

export default function ImpactTrainer() {
  const S = useRef(initial());
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const raf = useRef(0), tPrev = useRef(0), lastPointer = useRef(0);
  const [board, setBoard] = useState(null);
  const [nick, setNick] = useState(() => { try { return localStorage.getItem("nick") || ""; } catch { return ""; } });
  const [sending, setSending] = useState(false);

  const speed = () => {
    const s = S.current;
    return (BASE_SPEED + (s.level - 1) * SPEED_STEP + s.shots * SHOT_STEP) * (s.streak >= FEVER_AT ? FEVER_MULT : 1);
  };

  useEffect(() => {
    try { const r = localStorage.getItem("circle-shot-best"); if (r) { S.current.best = JSON.parse(r); rerender(); } } catch {}
    const onKey = (e) => { if (e.code === "Space" || e.key === " ") { e.preventDefault(); tap(); } };
    window.addEventListener("keydown", onKey);
    // Gamepad: ○ (button 1) = every press, L1/R1 = mode, OPTIONS = ranking
    const prev = new Map(); let padRaf = 0, hadPad = false;
    const pollPad = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (!gp) continue;
        if (!hadPad) { hadPad = true; S.current.pad = gp.id.slice(0, 24); rerender(); }
        const edge = (i) => { const k = gp.index + ":" + i, was = prev.get(k) || false, now = Boolean(gp.buttons[i] && gp.buttons[i].pressed); prev.set(k, now); return now && !was; };
        if (edge(1)) tap();
        const modes = Object.keys(MODES), cur = modes.indexOf(S.current.mode);
        if (edge(4)) switchMode(modes[(cur + modes.length - 1) % modes.length]);
        if (edge(5)) switchMode(modes[(cur + 1) % modes.length]);
        if (edge(9) && S.current.onOptions) S.current.onOptions();
        // read other buttons so edge state stays current
        [0, 2, 3, 7].forEach(edge);
      }
      padRaf = requestAnimationFrame(pollPad);
    };
    padRaf = requestAnimationFrame(pollPad);
    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(raf.current); cancelAnimationFrame(padRaf); };
  }, []); // eslint-disable-line

  const frame = (now) => {
    const s = S.current, dt = Math.min(0.05, (now - tPrev.current) / 1000);
    tPrev.current = now;
    s.pos += s.dir * speed() * dt;
    // past MAX: no error — the marker simply turns around at full power
    if (s.phase === "power" && s.pos >= ARC) { s.pos = ARC; s.power = ARC; s.dir = -1; s.phase = "impact"; jingle2(); }
    if (s.phase === "impact" && s.pos <= OVER) { finish(OVER, true); return; }
    rerender(); raf.current = requestAnimationFrame(frame);
  };

  const finish = (dev, timeout = false) => {
    cancelAnimationFrame(raf.current);
    const s = S.current;
    const g = timeout ? GRADES[3] : GRADES.find((x) => Math.abs(dev) <= x.max);
    const devMs = Math.round((Math.abs(dev) / speed()) * 1000);
    let penalty = 0, powerNote = "";
    if (s.mode === "half") { penalty = Math.round(Math.abs(s.power / ARC - 0.5) * 200); powerNote = `Power ${Math.round((s.power / ARC) * 100)}%`; }
    const combo = g.pts >= 60 ? s.streak + 1 : 0, feverNow = combo >= FEVER_AT;
    const pts = Math.max(0, (g.pts + (g.pts ? combo * 15 : 0) - penalty) * (feverNow ? 2 : 1));
    let level = s.level;
    if (combo > 0 && combo % LEVEL_UP_EVERY === 0) level = Math.min(MAX_LEVEL, level + 1);
    if (g.label === "MISS" && s.streak === 0 && level > 1) level--;
    s.last = { ...g, dev, devMs, pts, combo, timeout, levelUp: level > s.level, powerNote };
    s.banner = level > s.level ? `LEVEL ${level}` : combo === FEVER_AT ? "FEVER" : combo > FEVER_AT ? `${combo} IN A ROW` : g.label === "MISS" && s.streak >= FEVER_AT ? "FEVER OVER" : "";
    if (g.pts === 100) { s.confetti++; s.shake++; }
    if (level > s.level) { s.confetti++; fanfare(); }
    s.streak = combo; s.level = level; s.shots++; s.score += pts; s.devs.push(devMs); s.total++; s.phase = "result";
    let rec = false;
    if (combo > s.best.streak) { s.best.streak = combo; rec = true; }
    if (level > s.best.level) { s.best.level = level; rec = true; }
    if (s.shots >= ROUND_SHOTS && s.score > s.best.score) { s.best.score = s.score; rec = true; }
    s.record = rec;
    if (rec) { try { localStorage.setItem("circle-shot-best", JSON.stringify(s.best)); } catch {} }
    if (s.shots >= ROUND_SHOTS) { s.submitted = false; s.pendingScore = { score: s.score, level: s.level, meanMs: Math.round(s.devs.reduce((a, b) => a + b, 0) / s.devs.length), mode: s.mode }; }
    const up = 1 + Math.min(combo, 8) * 0.06;
    if (g.pts === 100) { jingle3(up); buzz([30, 30, 60]); }
    else if (g.pts === 60) { jingle3(up * 0.94); buzz(40); }
    else if (g.pts === 30) { beep(440, 0.06); buzz(20); }
    else { beep(140, 0.25, "sawtooth", 0.1); buzz(120); }
    rerender();
  };

  const tap = () => {
    const s = S.current;
    if (board) return;
    if (s.phase === "idle" || s.phase === "result") {
      if (s.shots >= ROUND_SHOTS) { s.shots = 0; s.score = 0; s.devs = []; }
      s.pos = 0; s.dir = 1; s.power = 0; s.last = null; s.record = false; s.banner = "";
      s.phase = "power"; jingle1();
      if (s.mode === "full") { s.pos = ARC; s.power = ARC; s.dir = -1; s.phase = "impact"; }
      tPrev.current = performance.now(); cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(frame);
    } else if (s.phase === "power") { s.power = s.pos; s.dir = -1; s.phase = "impact"; jingle2(); }
    else if (s.phase === "impact") { finish(s.pos); }
    rerender();
  };
  const switchMode = (m) => { S.current.mode = m; S.current.phase = "idle"; cancelAnimationFrame(raf.current); rerender(); };
  const onPointer = (e) => { e.preventDefault(); lastPointer.current = Date.now(); tap(); };
  const onClick = () => { if (Date.now() - lastPointer.current > 400) tap(); };
  const stopAll = (e) => { e.stopPropagation(); };
  const setMode = (e, m) => { stopAll(e); e.preventDefault(); switchMode(m); };
  S.current.onOptions = () => { if (board) setBoard(null); else fetchTop(S.current.mode).then(setBoard); };
  const openBoard = async (e) => { stopAll(e); e.preventDefault(); setBoard([]); setBoard(await fetchTop(S.current.mode)); };
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

  const s = S.current, fever = s.streak >= FEVER_AT;
  const fg = fever ? C.cream : C.ink, sub = fever ? C.sand : C.brown;
  const bits = s.confetti ? Array.from({ length: 36 }, (_, i) => i) : [];
  const avg = s.devs.length ? Math.round(s.devs.reduce((a, b) => a + b, 0) / s.devs.length) : null;
  const roundDone = s.shots >= ROUND_SHOTS && s.phase === "result";
  const tired = s.total > 0 && s.total % 30 === 0 && s.phase === "result";

  const R = 42, cx = 50, cy = 50;
  const pt = (deg, r = R) => { const a = ((deg + 90 + (360 - ARC) / 2) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const arc = (from, to, r = R) => { const [x1, y1] = pt(from, r), [x2, y2] = pt(to, r); return `M ${x1} ${y1} A ${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} 1 ${x2} ${y2}`; };
  const tick = (deg, len, col, w = 1.4) => { const [a, b] = pt(deg, R - len), [c, d] = pt(deg, R + len); return <line x1={a} y1={b} x2={c} y2={d} stroke={col} strokeWidth={w} />; };
  const [mx, my] = pt(Math.max(OVER, Math.min(ARC, s.pos))), [px, py] = pt(s.power);

  const Stat = ({ label, value, accent }) => (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div style={{ fontSize: 11, letterSpacing: 3, color: sub }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1, color: accent || fg }}>{value}</div>
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
        @media (prefers-reduced-motion:reduce){[style*="animation"]{animation:none!important}}`}</style>

      {bits.map((i) => { const cols = [C.red, C.teal, C.brown, C.sand, C.cream]; return (
        <div key={s.confetti + "-" + i} style={{ position: "absolute", top: -12, left: `${(i * 37) % 100}%`, width: 8 + (i % 3) * 3, height: 12, background: cols[i % 5],
          borderRadius: i % 2 ? "50%" : 2, pointerEvents: "none", animation: `fall ${1.2 + (i % 5) * 0.25}s cubic-bezier(.3,.7,.5,1) ${(i % 7) * 0.05}s forwards`, transform: `rotate(${i * 43}deg)` }} />); })}
      {s.banner && s.phase === "result" && (
        <div key={s.banner + s.total} style={{ position: "absolute", top: "30%", left: 0, right: 0, textAlign: "center", pointerEvents: "none", zIndex: 2,
          fontSize: 40, fontWeight: 700, letterSpacing: 6, color: fever ? C.cream : C.red, animation: "banner 1.4s ease-out forwards" }}>{s.banner}</div>)}

      <div key={"frame" + s.shake} style={{ margin: "14px 14px 0", border: `2px solid ${fg}`, padding: 3, flex: 1, display: "flex", flexDirection: "column", animation: s.shake > 0 ? "shake .35s" : "none" }}>
        <div style={{ border: `1px solid ${fg}`, flex: 1, display: "flex", flexDirection: "column" }}>

          <div style={{ textAlign: "center", padding: "16px 12px 6px" }}>
            <div style={{ fontSize: 10, letterSpacing: 5, color: sub }}>A Reflex Programme in Three Presses</div>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4, lineHeight: 1.2, marginTop: 4 }}>The Impact Society</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 10 }}>
              {Object.entries(MODES).map(([k, m]) => (
                <button key={k} onPointerDown={(e) => setMode(e, k)} onClick={stopAll}
                  style={{ padding: "6px 10px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontFamily: "inherit", fontWeight: 500, cursor: "pointer",
                    border: `1px solid ${fg}`, background: s.mode === k ? fg : "transparent", color: s.mode === k ? (fever ? C.red : C.cream) : fg }}>
                  {m.name}
                </button>))}
            </div>
          </div>

          <div style={{ display: "flex", padding: "10px 8px 0" }}>
            <Stat label="Level" value={s.level} />
            <Stat label="Streak" value={<span style={{ animation: fever ? "pulse .6s infinite" : "none" }}>{s.streak}</span>} accent={fever ? C.cream : s.streak > 0 ? C.red : fg} />
            <Stat label={`Shot ${s.shots}/${ROUND_SHOTS}`} value={s.score} />
          </div>
          {fever && <div style={{ textAlign: "center", fontSize: 11, letterSpacing: 4, color: C.sand }}>Fever — Double Points</div>}

          <div style={{ padding: "4px 28px 0", maxWidth: 380, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
            <svg viewBox="0 0 100 100" width="100%" style={{ display: "block" }}>
              <path d={arc(OVER, ARC)} stroke={fever ? C.cream : C.teal} strokeWidth="7" fill="none" strokeLinecap="round" opacity=".55" />
              <path d={arc(-16, 16)} stroke={C.sand} strokeWidth="7" fill="none" />
              <path d={arc(-8, 8)} stroke={C.brown} strokeWidth="7" fill="none" opacity=".7" />
              <path d={arc(-3, 3)} stroke={fever ? C.sand : C.red} strokeWidth="9" fill="none" />
              {s.phase !== "idle" && s.power > 0 && <path d={arc(0, s.power)} stroke={C.brown} strokeWidth="7" fill="none" opacity=".35" />}
              {s.phase === "power" && s.pos > 0.5 && <path d={arc(0, s.pos)} stroke={C.brown} strokeWidth="7" fill="none" />}
              {s.mode === "half" && tick(ARC / 2, 7, C.red, 1.2)}
              {tick(0, 8, fg)}
              {s.power > 0 && s.phase !== "idle" && <circle cx={px} cy={py} r="2.2" fill={C.sand} stroke={C.ink} strokeWidth=".6" />}
              {s.phase !== "idle" && <circle cx={mx} cy={my} r="4.2" fill={s.phase === "impact" ? C.red : C.cream} stroke={C.ink} strokeWidth="1" />}
              <text x="50" y="45" textAnchor="middle" fontSize="5.5" fontWeight="700" letterSpacing="1" fill={fg} style={{ fontFamily: "inherit" }}>
                {s.phase === "idle" ? "Press ○ to begin" : s.phase === "power" ? "Power" : s.phase === "impact" ? "Press on red" : s.last && s.last.label}
              </text>
              <text x="50" y="53" textAnchor="middle" fontSize="3.6" letterSpacing=".5" fill={sub} style={{ fontFamily: "inherit" }}>
                {s.phase === "result" && s.last ? (s.last.timeout ? "No press" : `${s.last.devMs} ms ${s.last.dev > 0 ? "early" : "late"}`) : s.phase === "idle" ? MODES[s.mode].desc : `${Math.round((s.pos / ARC) * 100)}%`}
              </text>
              <text x="50" y="61" textAnchor="middle" fontSize="4" fontWeight="700" fill={fever ? C.cream : C.red} style={{ fontFamily: "inherit" }}>
                {s.phase === "result" && s.last && s.last.pts > 0 ? `+${s.last.pts}` : ""}
              </text>
            </svg>
          </div>

          <div style={{ flex: 1, textAlign: "center", padding: "4px 20px 10px", minHeight: 80, fontSize: 12, letterSpacing: 1.5, lineHeight: 1.8, color: sub }}>
            {s.phase === "result" && s.last && (<div>
              {s.last.powerNote && <div>{s.last.powerNote}</div>}
              {s.last.levelUp && <div style={{ color: fg, fontWeight: 700 }}>Gauge now {Math.round(speed())}° per second</div>}
              {!s.last.levelUp && s.last.combo > 0 && <div>{LEVEL_UP_EVERY - (s.streak % LEVEL_UP_EVERY)} more for next level</div>}
              {s.record && <div style={{ color: fever ? C.cream : C.red, fontWeight: 700 }}>Personal best</div>}
              {roundDone && <div style={{ marginTop: 6, display: "inline-block", border: `1px solid ${fg}`, padding: "6px 14px", color: fg }}>Round complete — {s.score} pts — mean error {avg} ms<br />
                {onlineEnabled && !s.submitted && <div onPointerDown={stopAll} onClick={stopAll} style={{ marginTop: 6, display: "flex", gap: 6, justifyContent: "center" }}>
                  <input value={nick} onChange={(e) => setNick(e.target.value.toUpperCase().slice(0, 3))} placeholder="ABC" maxLength={3}
                    style={{ width: 54, textAlign: "center", fontFamily: "inherit", fontSize: 14, letterSpacing: 3, border: `1px solid ${fg}`, background: "transparent", color: fg, textTransform: "uppercase" }} />
                  <button onPointerDown={send} onClick={stopAll} disabled={sending} style={{ fontFamily: "inherit", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", border: `1px solid ${fg}`, background: fg, color: fever ? C.red : C.cream, padding: "4px 10px", cursor: "pointer" }}>{sending ? "Sending" : "Enter world ranking"}</button>
                </div>}
                {s.submitted && <div style={{ color: sub }}>Score submitted</div>}
                <span style={{ color: sub }}>Press ○ for the next round</span></div>}
              {tired && <div style={{ color: fever ? C.cream : C.red, marginTop: 6 }}>Thirty shots. Rest one minute. Look far away.</div>}
            </div>)}
            {s.phase === "idle" && <div>○ once to start the gauge<br />○ again to set the power<br />○ on red as the marker swings back — past Max it just turns around<br />Three in a row ignites Fever</div>}
          </div>

          <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", padding: "8px 10px 10px", fontSize: 10, letterSpacing: 2, color: sub, borderTop: `1px solid ${fg}` }}>
            <span>Best {s.best.score}</span><span>Streak {s.best.streak}</span><span>Level {s.best.level}</span>
            <button onPointerDown={openBoard} onClick={stopAll} style={{ fontFamily: "inherit", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", border: `1px solid ${fg}`, background: "transparent", color: fg, padding: "2px 8px", cursor: "pointer" }}>World ranking</button>
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: 9, letterSpacing: 4, padding: "8px 0 12px", color: sub }}>{s.pad ? `Controller connected · ${s.pad} · L1/R1 mode · Options ranking` : "Est. 2026 — Tokyo"}</div>

      {board && (
        <div onPointerDown={(e) => { stopAll(e); e.preventDefault(); setBoard(null); }} onClick={stopAll}
          style={{ position: "absolute", inset: 0, background: "rgba(58,36,24,.92)", color: C.cream, zIndex: 5, display: "flex", flexDirection: "column", alignItems: "center", padding: 24, overflowY: "auto" }}>
          <div style={{ fontSize: 10, letterSpacing: 5, color: C.sand }}>{MODES[s.mode].name}</div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, marginBottom: 12 }}>World Ranking</div>
          {!onlineEnabled && <div style={{ fontSize: 12, letterSpacing: 1 }}>Offline build — no ranking yet</div>}
          {board.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 50px 1fr 60px 60px", width: "100%", maxWidth: 360, fontSize: 13, letterSpacing: 1.5, padding: "5px 0", borderBottom: `1px solid ${C.brown}` }}>
              <span style={{ color: C.sand }}>{i + 1}</span><span style={{ fontWeight: 700 }}>{r.name}</span><span style={{ textAlign: "right" }}>{r.score}</span>
              <span style={{ textAlign: "right", color: C.sand }}>Lv {r.level}</span><span style={{ textAlign: "right", color: C.sand }}>{r.mean_ms} ms</span>
            </div>))}
          <div style={{ marginTop: 16, fontSize: 10, letterSpacing: 3, color: C.sand }}>Tap or Options to close</div>
        </div>)}
    </div>
  );
}
