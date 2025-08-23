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

/**
 * iOS対応版ノイズ生成フック
 * - ready が true（ユーザー操作でAudioContextが解放済み）の時だけノードを作成
 * - type: "white" | "pink" | "brown" | "off"
 * - volume: 0〜1
 */
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
      nodeRef.current = null;
      gainRef.current = null;
    };
  }, [audioCtxRef, ready, type]);

  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value = clamp(volume, 0, 1);
    }
  }, [volume]);
}

function ProgressRing({ size = 220, stroke = 12, progress = 0 }) {
  const normalizedRadius = size / 2 - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;
  return (
    <svg height={size} width={size} className="mx-auto block">
      <circle
        stroke="currentColor"
        fill="transparent"
        strokeWidth={stroke}
        className="text-gray-200"
        r={normalizedRadius}
        cx={size / 2}
        cy={size / 2}
      />
      <circle
        stroke="currentColor"
        fill="transparent"
        strokeWidth={stroke}
        strokeLinecap="round"
        className="text-blue-500 transition-[stroke-dashoffset] duration-300 ease-linear"
        strokeDasharray={`${circumference} ${circumference}`}
        style={{ strokeDashoffset: offset }}
        r={normalizedRadius}
        cx={size / 2}
        cy={size / 2}
      />
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
    const m =
      mode === "work" ? settings.workMin :
      mode === "break" ? settings.breakMin :
      settings.longBreakMin;
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
    try {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = silent;
      src.connect(ctx.destination);
      src.start(0);
    } catch {}
    setAudioReady(true);
  };

  useNoise(
    audioCtxRef,
    settings.noise,
    (muted || settings.noise === "off") ? 0 : settings.volume,
    audioReady
  );

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (mode === "work") {
            const nextRound = (round % settings.roundsUntilLong) + 1;
            setRound((r) => (r % settings.roundsUntilLong) + 1);
            if (nextRound === 1) {
              setMode("long");
              return settings.longBreakMin * 60;
            } else {
              setMode("break");
              return settings.breakMin * 60;
            }
          } else {
            setMode("work");
            return settings.workMin * 60;
          }
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, mode, settings, round]);

  useEffect(() => {
    const m =
      mode === "work" ? settings.workMin :
      mode === "break" ? settings.breakMin :
      settings.longBreakMin;
    setSecondsLeft(m * 60);
  }, [mode, settings.workMin, settings.breakMin, settings.longBreakMin]);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  }, [settings]);

  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;

  const startStop = () => {
    if (!audioReady) initAudio();
    setRunning((v) => !v);
  };

  const reset = () => {
    setRunning(false);
    const m =
      mode === "work" ? settings.workMin :
      mode === "break" ? settings.breakMin :
      settings.longBreakMin;
    setSecondsLeft(m * 60);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <header className="sticky top-0 z-10 bg-white/70 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            <h1 className="font-bold text-lg">FocusFlow</h1>
          </div>
          <div className="flex items-center gap-3">
            <a href="#shop" className="inline-flex items-center gap-1 text-sm text-blue-600"><ShoppingBag className="h-4 w-4"/>おすすめアイテム</a>
            <button
              onClick={() => alert("PWAのインストールはブラウザの共有/インストールから行えます。")}
              className="text-sm text-slate-600"
            >
              インストール
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 rounded-2xl border border-dashed border-slate-300 p-4 text-center text-slate-500">
          広告枠（AdSense 300×250 など）
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-center mb-4">
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">
                {mode === "work" ? "集中" : mode === "break" ? "小休憩" : "長めの休憩"}・ラウンド {round}
              </span>
            </div>
            <div className="flex flex-col items-center gap-4">
              <ProgressRing progress={progress} />
              <div className="text-6xl font-bold tabular-nums leading-none">{pad(mm)}:{pad(ss)}</div>
              <div className="flex items-center gap-3 mt-2">
                <button onClick={startStop} className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-white shadow hover:shadow-md">
                  {running ? <Pause className="h-5 w-5"/> : <Play className="h-5 w-5"/>}
                  {running ? "一時停止" : "スタート"}
                </button>
                <button onClick={reset} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-slate-700 hover:bg-slate-200">
                  <RotateCcw className="h-5 w-5"/> リセット
                </button>
              </div>
            </div>
                        <div className="mt-6 grid grid-cols-3 gap-3">
              <button onClick={() => { setMode("work"); setRunning(false); }} className={`rounded-xl px-3 py-2 border text-sm ${mode === "work" ? "border-blue-500 text-blue-600 bg-blue-50" : "border-slate-200"}`}>集中 {settings.workMin}分</button>
              <button onClick={() => { setMode("break"); setRunning(false); }} className={`rounded-xl px-3 py-2 border text-sm ${mode === "break" ? "border-blue-500 text-blue-600 bg-blue-50" : "border-slate-200"}`}>休憩 {settings.breakMin}分</button>
              <button onClick={() => { setMode("long"); setRunning(false); }} className={`rounded-xl px-3 py-2 border text-sm ${mode === "long" ? "border-blue-500 text-blue-600 bg-blue-50" : "border-slate-200"}`}>長休憩 {settings.longBreakMin}分</button>
            </div>
          </div>

          {/* 設定パネル */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2"><Settings className="h-5 w-5"/> 設定</h2>
              <span className="text-xs text-slate-500">自動保存</span>
            </div>

            <div className="space-y-5">
              {!audioReady && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 flex items-start justify-between gap-3">
                  <p>ブラウザの仕様により、音を再生するには一度ボタン操作が必要です。</p>
                  <button onClick={initAudio} className="shrink-0 rounded-lg bg-amber-600 text-white px-3 py-1.5">
                    音を有効にする
                  </button>
                </div>
              )}

              {/* 入力欄: 集中・休憩時間など */}
              <div>
                <label className="block text-sm text-slate-600 mb-1">集中時間（分）</label>
                <input
                  type="number" min={1} max={120} value={settings.workMin}
                  onChange={(e) => setSettings(s => ({...s, workMin: clamp(parseInt(e.target.value||"0", 10), 1, 120)}))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-600 mb-1">短い休憩（分）</label>
                  <input
                    type="number" min={1} max={60} value={settings.breakMin}
                    onChange={(e) => setSettings(s => ({...s, breakMin: clamp(parseInt(e.target.value||"0", 10), 1, 60)}))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">長い休憩（分）</label>
                  <input
                    type="number" min={1} max={90} value={settings.longBreakMin}
                    onChange={(e) => setSettings(s => ({...s, longBreakMin: clamp(parseInt(e.target.value||"0", 10), 1, 90)}))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              {/* ノイズ選択 */}
              <div>
                <label className="block text-sm text-slate-600 mb-1 flex items-center gap-2"><Music2 className="h-4 w-4"/> ノイズ</label>
                <div className="grid grid-cols-4 gap-2">
                  {["off","white","pink","brown"].map(k => (
                    <button
                      key={k}
                      onClick={() => { if (!audioReady) initAudio(); setSettings(s => ({...s, noise: k})); }}
                      className={`rounded-xl px-3 py-2 border text-sm capitalize ${settings.noise===k?"border-blue-500 bg-blue-50 text-blue-600":"border-slate-200"}`}
                    >
                      {k === "off" ? "オフ" : k}
                    </button>
                  ))}
                </div>
              </div>

              {/* 音量調整 */}
              <div>
                <label className="block text-sm text-slate-600 mb-1 flex items-center gap-2"><Volume2 className="h-4 w-4"/> 音量</label>
                <input
                  type="range" min={0} max={100} value={Math.round(settings.volume*100)}
                  onChange={(e)=> setSettings(s=>({...s, volume: clamp(parseInt(e.target.value,10)/100,0,1)}))}
                  className="w-full"
                />
                <button onClick={()=> setMuted(v=>!v)} className="mt-1 inline-flex items-center gap-2 text-sm text-slate-600">
                  {muted ? <><VolumeX className="h-4 w-4"/>ミュート解除</> : <><Volume2 className="h-4 w-4"/>ミュート</>}
                </button>
              </div>

              {/* ラウンド数 */}
              <div>
                <label className="block text-sm text-slate-600 mb-1">長休憩までのラウンド数</label>
                <input
                  type="number" min={2} max={8} value={settings.roundsUntilLong}
                  onChange={(e) => setSettings(s => ({...s, roundsUntilLong: clamp(parseInt(e.target.value||"0", 10), 2, 8)}))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ショップセクション */}
        <div className="mt-6 mb-10 rounded-2xl border border-dashed border-slate-300 p-4 text-center text-slate-500">
          広告枠（レスポンシブ広告）
        </div>

        <section id="shop" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><ShoppingBag className="h-5 w-5"/> 集中を高めるおすすめ</h2>
          <ul className="grid sm:grid-cols-2 gap-4">
            {[{
              title:"高遮音イヤープラグ",
              desc:"電車やカフェでも集中。装着感の良いタイプ。",
              url:"#",
            },{
              title:"タイムブロッキング用ノート",
              desc:"ポモドーロの記録に。1日1ページで管理しやすい。",
              url:"#",
            }].map((p, i) => (
              <li key={i} className="rounded-xl border border-slate-200 p-4">
                <div className="font-medium">{p.title}</div>
                <p className="text-sm text-slate-600 mt-1">{p.desc}</p>
                <a href={p.url} className="inline-block mt-2 text-blue-600 text-sm">詳細を見る（アフィリンク）</a>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 mt-3">※ 上記リンクはアフィリエイトリンクに差し替え可能です。</p>
        </section>

        {/* フッター */}
        <footer className="text-center text-xs text-slate-500 mt-8 mb-6 space-y-2">
          <p>© {new Date().getFullYear()} FocusFlow. 無料ツール / PWA。広告とアフィリエイトで運営。</p>
          <div className="flex justify-center gap-4">
            <a href="/terms.html" className="text-blue-600 hover:underline">利用規約</a>
            <a href="/privacy.html" className="text-blue-600 hover:underline">プライバシーポリシー</a>
            <a href="/contact.html" className="text-blue-600 hover:underline">お問い合わせ</a>
          </div>
        </footer>
      </main>
    </div>
  );
}

