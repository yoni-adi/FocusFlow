
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Settings, Volume2, VolumeX, Clock, Music2, ShoppingBag } from "lucide-react";

const pad = (n) => n.toString().padStart(2, "0");
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const DEFAULTS = {
  workMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  roundsUntilLong: 4,
  volume: 0.2,
  noise: "white",
};

const LS_KEY = "focusflow_settings_v1";

function useNoise(audioCtxRef, type, volume, ready) {
  const nodeRef = useRef(null);
  const gainRef = useRef(null);

  useEffect(() => {
    if (!audioCtxRef.current || !ready) return;
    const ctx = audioCtxRef.current;
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    if (type === "white") {
      for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
    } else if (type === "pink") {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        output[i] *= 0.11;
        b6 = white * 0.115926;
      }
    } else if (type === "brown") {
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5;
      }
    } else {
      for (let i = 0; i < bufferSize; i++) output[i] = 0;
    }

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = clamp(volume, 0, 1);
    source.connect(gain).connect(ctx.destination);
    source.start();
    nodeRef.current = source;
    gainRef.current = gain;

    return () => {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    };
  }, [audioCtxRef, ready, type]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = clamp(volume, 0, 1);
  }, [volume]);
}

function ProgressRing({ size = 220, stroke = 12, progress = 0 }) {
  const normalizedRadius = size / 2 - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;
  return (
    <svg height={size} width={size} className="mx-auto block">
      <circle stroke="currentColor" fill="transparent" strokeWidth={stroke} className="text-gray-200" r={normalizedRadius} cx={size / 2} cy={size / 2} />
      <circle stroke="currentColor" fill="transparent" strokeWidth={stroke} strokeLinecap="round" className="text-blue-500 transition-[stroke-dashoffset] duration-300 ease-linear" strokeDasharray={`${circumference} ${circumference}`} style={{ strokeDashoffset: offset }} r={normalizedRadius} cx={size / 2} cy={size / 2} />
    </svg>
  );
}

export default function App() {
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : DEFAULTS;
    } catch {
      return DEFAULTS;
    }
  });

  const [mode, setMode] = useState("work");
  const [round, setRound] = useState(1);
  const [secondsLeft, setSecondsLeft] = useState(settings.workMin * 60);
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);

  const totalSeconds = useMemo(() => {
    const m = mode === "work" ? settings.workMin : mode === "break" ? settings.breakMin : settings.longBreakMin;
    return m * 60;
  }, [mode, settings]);

  const progress = clamp(((totalSeconds - secondsLeft) / totalSeconds) * 100, 0, 100);

  const audioCtxRef = useRef(null);
  const [audioReady, setAudioReady] = useState(false);

  const initAudio = async () => {
    if (audioCtxRef.current) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    try { if (ctx.state === "suspended") await ctx.resume(); } catch {}
    setAudioReady(true);
  };

  useNoise(audioCtxRef, settings.noise, (muted || settings.noise === "off") ? 0 : settings.volume, audioReady);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (mode === "work") {
            const nextRound = (round % settings.roundsUntilLong) + 1;
            setRound((r) => (r % settings.roundsUntilLong) + 1);
            if (nextRound === 1) { setMode("long"); return settings.longBreakMin * 60; }
            else { setMode("break"); return settings.breakMin * 60; }
          } else {
            setMode("work"); return settings.workMin * 60;
          }
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, mode, settings, round]);

  useEffect(() => {
    const m = mode === "work" ? settings.workMin : mode === "break" ? settings.breakMin : settings.longBreakMin;
    setSecondsLeft(m * 60);
  }, [mode, settings.workMin, settings.breakMin, settings.longBreakMin]);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  }, [settings]);

  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;

  const startStop = () => { if (!audioReady) initAudio(); setRunning((v) => !v); };
  const reset = () => {
    setRunning(false);
    const m = mode === "work" ? settings.workMin : mode === "break" ? settings.breakMin : settings.longBreakMin;
    setSecondsLeft(m * 60);
  };

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
    document.title = 'FocusFlow | ポモドーロ × ノイズ | PWA タイマー';
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      {/* 省略: ヘッダーやメインUI部分はそのまま */}

      <footer className="text-center text-xs text-slate-500 mt-8 mb-6">
        <p>© {new Date().getFullYear()} FocusFlow. 無料ツール / PWA。広告とアフィリエイトで運営。</p>
        <p>
          <a href="/terms.html" className="text-blue-600">利用規約</a>
          {" ｜ "}
          <a href="/privacy.html" className="text-blue-600">プライバシーポリシー</a>
          {" ｜ "}
          <a href="/contact.html" className="text-blue-600">お問い合わせ</a>
        </p>
      </footer>
    </div>
  );
}
