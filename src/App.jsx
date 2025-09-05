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
  chime: true,     // 区切りベル
  notify: false,   // 通知
  vibrate: false,  // バイブ
};

const LS_KEY = "focusflow_settings_v1";

// iOS対応版ノイズ生成フック
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

// 進捗リング
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
  const chimeRef = useRef(null); // 区切りベル音

  // 区切りベル音の音量追従
  useEffect(() => {
    if (!chimeRef.current) return;
    chimeRef.current.volume = clamp((muted ? 0 : settings.volume), 0, 1);
  }, [settings.volume, muted]);

  // iOS/Safari でのオーディオ解放
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
    // 🔔 区切りベルの準備
    if (!chimeRef.current) {
      chimeRef.current = new Audio("/bell.mp3");
      chimeRef.current.preload = "auto";
      chimeRef.current.volume = clamp((muted ? 0 : settings.volume), 0, 1);
    }
    setAudioReady(true);
  };

  // フェーズ切替通知
  function notifyPhase(nextMode) {
    // 🔔 ベル
    if (settings.chime && chimeRef.current) {
      try {
        chimeRef.current.currentTime = 0;
        chimeRef.current.play().catch(() => {});
      } catch {}
    }
    // 📳 バイブ
    if (settings.vibrate && "vibrate" in navigator) {
      navigator.vibrate([80, 40, 80]);
    }
    // 🔔 Web通知
    if (settings.notify && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("FocusFlow", {
          body: nextMode === "work" ? "作業を再開しましょう" : (nextMode === "break" ? "小休憩に入りましょう" : "長めの休憩に入りましょう"),
          icon: "/icon-192.png",
        });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission();
      }
    }
    // 🪩 タイトルを一時的に変更
    const old = document.title;
    const msg = nextMode === "work" ? "▶ 作業再開！" : (nextMode === "break" ? "⏸ 小休憩！" : "⏸ 長めの休憩！");
    document.title = `【${msg}】FocusFlow`;
    setTimeout(() => (document.title = old), 4000);
  }
  // ---- ここまでが Part1 ----

  // ノイズ駆動（オフやミュート時は音量0）
  useNoise(
    audioCtxRef,
    settings.noise,
    (muted || settings.noise === "off") ? 0 : settings.volume,
    audioReady
  );

  // タイマー進行 & フェーズ切替時の通知
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (mode === "work") {
            const nextRound = (round % settings.roundsUntilLong) + 1;
            setRound((r) => (r % settings.roundsUntilLong) + 1);
            const nextMode = (nextRound === 1) ? "long" : "break";
            notifyPhase(nextMode);
            return (nextMode === "long" ? settings.longBreakMin : settings.breakMin) * 60;
          } else {
            const nextMode = "work";
            notifyPhase(nextMode);
            return settings.workMin * 60;
          }
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, mode, settings, round]);

  // モード/設定変更時に残り秒リセット
  useEffect(() => {
    const m =
      mode === "work" ? settings.workMin :
      mode === "break" ? settings.breakMin :
      settings.longBreakMin;
    setSecondsLeft(m * 60);
  }, [mode, settings.workMin, settings.breakMin, settings.longBreakMin]);

  // 設定の永続化
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  }, [settings]);

  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;

  const startStop = () => {
    if (!audioReady) initAudio(); // 初回は必ずユーザー操作内で解放
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

  // 通知の許可リクエスト
  const requestNotifyPermission = async () => {
    if (!("Notification" in window)) return alert("このブラウザは通知に対応していません。");
    try {
      const p = await Notification.requestPermission();
      if (p !== "granted") alert("通知が許可されていません。ブラウザの設定から有効にしてください。");
    } catch {}
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
             <a href="#shop" className="inline-flex items-center gap-1 text-sm text-blue-600">
            <ShoppingBag className="h-4 w-4"/>おすすめアイテム
            </a>
            <a href="#howto" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">使い方</a>
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
        {/*<div className="mb-4 rounded-2xl border border-dashed border-slate-300 p-4 text-center text-slate-500">
          広告枠（AdSense 300×250 など）
        </div>*/}

        <div className="grid md:grid-cols-2 gap-6">
          {/* 左：タイマー */}
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

          {/* 右：設定 */}
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

              {/* 時間設定 */}
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

              {/* ノイズ */}
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

              {/* 音量 & ミュート */}
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

              {/* 長休憩までのラウンド数 */}
              <div>
                <label className="block text-sm text-slate-600 mb-1">長休憩までのラウンド数</label>
                <input
                  type="number" min={2} max={8} value={settings.roundsUntilLong}
                  onChange={(e) => setSettings(s => ({...s, roundsUntilLong: clamp(parseInt(e.target.value||"0", 10), 2, 8)}))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              {/* 区切りベル/通知/バイブ */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!settings.chime}
                    onChange={(e)=> setSettings(s => ({...s, chime: e.target.checked}))}
                  />
                  区切りベル
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!settings.vibrate}
                    onChange={(e)=> setSettings(s => ({...s, vibrate: e.target.checked}))}
                  />
                  バイブ
                </label>
                <div className="flex items-center gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!settings.notify}
                      onChange={(e)=> setSettings(s => ({...s, notify: e.target.checked}))}
                    />
                    通知
                  </label>
                  <button
                    type="button"
                    onClick={requestNotifyPermission}
                    className="ml-auto rounded-md px-2 py-1 border text-xs text-slate-600"
                  >
                    許可をリクエスト
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/*<div className="mt-6 mb-10 rounded-2xl border border-dashed border-slate-300 p-4 text-center text-slate-500">
          広告枠（レスポンシブ広告）
        </div>*/}
        {/* 使い方 & メリット */}
<section id="howto" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
  <h2 className="font-semibold mb-4 flex items-center gap-2">
    <Clock className="h-5 w-5"/> 使い方 & メリット
  </h2>

  {/* 3ステップ（タイムライン風） */}
  <ol className="relative border-slate-200 ml-3">
    {[
      {t:"1. 時間を設定", d:"集中時間・休憩時間・ラウンド数をお好みに調整。設定は自動保存されます。"},
      {t:"2. スタートを押す", d:"画面を見続ける必要はありません。進捗リングで残り時間だけ把握。"},
      {t:"3. 音と通知で切替", d:"終了時にベル音＆通知（許可時）。切替の見逃しを防ぎます。"},
    ].map((s,i)=>(
      <li key={i} className="pl-6 mb-4">
        <div className="absolute -ml-3 mt-1 h-2 w-2 rounded-full bg-blue-500"></div>
        <div className="font-medium">{s.t}</div>
        <p className="text-sm text-slate-600">{s.d}</p>
      </li>
    ))}
  </ol>

  {/* メリット（カード） */}
  <div className="grid sm:grid-cols-2 gap-4 mt-4">
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="font-medium">集中しやすい音（ホワイト/ピンク/ブラウン）</div>
      <p className="text-sm text-slate-600 mt-1">環境ノイズで雑念をカット。iPhoneでも動作するように最適化。</p>
    </div>
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="font-medium">通知 & ベル音で見逃しゼロ</div>
      <p className="text-sm text-slate-600 mt-1">25分見張る必要なし。切替時だけ気づけるから画面は閉じてOK。</p>
    </div>
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="font-medium">PWAで1タップ起動</div>
      <p className="text-sm text-slate-600 mt-1">ホーム画面に追加すればアプリ感覚でサクッと開始。</p>
    </div>
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="font-medium">自動保存 & シンプル操作</div>
      <p className="text-sm text-slate-600 mt-1">設定は保存され、次回すぐ再開。迷わないUI。</p>
    </div>
  </div>

  {/* FAQ（details） */}
  <div className="mt-4">
    <details className="rounded-xl border border-slate-200 p-4">
      <summary className="font-medium cursor-pointer">スマホで音が鳴らない時は？</summary>
      <p className="text-sm text-slate-600 mt-2">
        一度「音を有効にする」や「スタート」ボタンを押すと音が鳴るようになります（ブラウザ仕様のため）。
        また端末のサイレントモード/音量もご確認ください。
      </p>
    </details>
  </div>

  {/* CTA */}
  <div className="mt-6 flex flex-wrap items-center gap-3">
    <a href="#top" onClick={(e)=>{e.preventDefault(); window.scrollTo({top:0,behavior:'smooth'})}}
       className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-white shadow hover:shadow-md">
      いますぐ始める
    </a>
    <a href="#shop" className="text-sm text-blue-600">集中に効くおすすめを見る</a>
  </div>
</section>
{/* --- ポモドーロ解説記事セクション（審査用の有用コンテンツ） --- */}
<section id="guide" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
  <h2 className="font-semibold mb-3 text-xl">ポモドーロ・テクニックの使い方（3分で読める）</h2>
  <p className="text-slate-700">
    ポモドーロ・テクニックは、「<strong>25分集中 + 5分休憩</strong>」を1セットとして繰り返す時間管理術です。短い集中を積み重ねることで
    集中力を保ち、先延ばしを防ぎます。FocusFlow はノイズ再生・自動ラウンド・PWA対応で、学習や仕事の集中をサポートします。
  </p>

  <h3 className="font-semibold mt-5 mb-2">基本ステップ</h3>
  <ol className="list-decimal pl-5 space-y-2 text-slate-700">
    <li>今日やるタスクを1〜3個にしぼる（細かく分解するとなお良い）。</li>
    <li>タイマーを<strong>25分</strong>にセットして「スタート」。画面は見続けなくてOK。</li>
    <li>通知音が鳴ったら<strong>5分休憩</strong>。席を立つ・目を休める・水分補給。</li>
    <li>これで1ポモ（1ラウンド）。<strong>4ポモ</strong>終えたら<strong>15分の長休憩</strong>。</li>
    <li>記録を1行メモ（やったこと/気づき）。次のポモドーロへ！</li>
  </ol>

  <h3 className="font-semibold mt-5 mb-2">コツ（成果が伸びる3ポイント）</h3>
  <ul className="list-disc pl-5 space-y-2 text-slate-700">
    <li><strong>ノイズの使い分け：</strong>ホワイト＝雑音カット、ピンク＝落ち着き、ブラウン＝低音で安定感。自分の合うものを。</li>
    <li><strong>25分に収まる粒度へ分割：</strong>「資料作成」→「図の差し替え」「結論の追記」のように細かく。</li>
    <li><strong>完璧を目指さない：</strong>1ポモで 60〜80% まで作って、次で仕上げる。</li>
  </ul>

  <div className="grid md:grid-cols-3 gap-4 mt-6">
    <div className="rounded-xl border border-slate-200 p-4">
      <h4 className="font-medium mb-1">通知＆音でお知らせ</h4>
      <p className="text-sm text-slate-600">
        切り替え時にベル音＆通知（許可時）。タイマーを見張る必要はありません。
      </p>
    </div>
    <div className="rounded-xl border border-slate-200 p-4">
      <h4 className="font-medium mb-1">ホーム画面から即起動</h4>
      <p className="text-sm text-slate-600">
        PWA対応でスマホのホーム画面に追加できます。アプリ感覚でサクッと開始。
      </p>
    </div>
    <div className="rounded-xl border border-slate-200 p-4">
      <h4 className="font-medium mb-1">記録で上達</h4>
      <p className="text-sm text-slate-600">
        1日最後にポモ数とメモを残すと、見える化されて継続しやすくなります。
      </p>
    </div>
  </div>

  <h3 className="font-semibold mt-6 mb-2">よくある質問</h3>
  <div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
    <details className="p-4">
      <summary className="font-medium cursor-pointer">25-5 以外の比率でもOK？</summary>
      <p className="text-sm text-slate-700 mt-2">
        はい。20-5 や 50-10 など、仕事の性質に合わせて調整してください。設定から自由に変更できます。
      </p>
    </details>
    <details className="p-4">
      <summary className="font-medium cursor-pointer">音が鳴らない・通知が来ない</summary>
      <p className="text-sm text-slate-700 mt-2">
        初回はブラウザの仕様でユーザー操作が必要です。「音を有効にする」を押した後、音量とミュートにご注意ください。
        iPhoneではサイレントモードも要確認です。
      </p>
    </details>
    <details className="p-4">
      <summary className="font-medium cursor-pointer">スマホでの使い勝手は？</summary>
      <p className="text-sm text-slate-700 mt-2">
        PWAとしてホーム画面に追加できます。アプリのように全画面で起動でき、通信量も軽量です。
      </p>
    </details>
  </div>

  <p className="text-xs text-slate-500 mt-4">
    参考：<a href="#guide" className="text-blue-600 underline">このページのガイド</a>／
    <a href="/terms.html" className="text-blue-600 underline">利用規約</a>／
    <a href="/privacy.html" className="text-blue-600 underline">プライバシーポリシー</a>／
    <a href="/contact.html" className="text-blue-600 underline">お問い合わせ</a>
  </p>
</section>



        {/* おすすめ（アフィリエイト欄） */}
        {/* おすすめ（アフィリエイト：PR） */}
<section id="shop" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mt-8">
  <div className="flex items-center justify-between">
    <h2 className="font-semibold mb-4 flex items-center gap-2">
      <ShoppingBag className="h-5 w-5" />
      集中を高めるおすすめ
    </h2>
    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">広告 / PR</span>
  </div>

  <ul className="grid sm:grid-cols-2 gap-4">
    {/* 1) ノイズキャンセリングイヤホン */}
    <li className="rounded-xl border border-slate-200 p-4 flex flex-col">
      <div className="font-medium text-base">ノイズキャンセリングイヤホン</div>
      <p className="text-sm text-slate-600 mt-1">
        カフェや電車でも一瞬で“自分の世界”。音による集中ブーストを手軽に。
      </p>
      <a
        href="https://amzn.to/4nBtyT1"
        target="_blank"
        rel="nofollow sponsored noopener noreferrer"
        className="inline-flex items-center justify-center mt-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2"
        aria-label="ノイズキャンセリングイヤホンをAmazonで見る（アフィリエイト）"
      >
        Amazonで見る
      </a>
      <span className="mt-2 text-[11px] text-slate-500">※ アフィリエイトリンクです</span>
    </li>

    {/* 2) Moldex 高性能耳栓 */}
    <li className="rounded-xl border border-slate-200 p-4 flex flex-col">
      <div className="font-medium text-base">Moldex 高性能耳栓</div>
      <p className="text-sm text-slate-600 mt-1">
        コスパ良し・装着感良し。手軽に雑音をカットして、没入時間をつくる定番。
      </p>
      <a
        href="https://amzn.to/427bMys"
        target="_blank"
        rel="nofollow sponsored noopener noreferrer"
        className="inline-flex items-center justify-center mt-3 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2"
        aria-label="Moldex 耳栓をAmazonで見る（アフィリエイト）"
      >
        Amazonで見る
      </a>
      <span className="mt-2 text-[11px] text-slate-500">※ アフィリエイトリンクです</span>
    </li>
  </ul>

  <p className="text-[11px] text-slate-500 mt-3">
    本ページのリンクはプロモーション（アフィリエイト）を含みます。収益は本サービスの運営・改善に活用します。
  </p>
</section>


         {/* --- 共有ボタン --- */}
        <section className="my-8 text-center">
          <h3 className="font-semibold mb-3">このタイマーをシェアする</h3>
          <div className="flex flex-wrap justify-center gap-4">
            {/* LINE */}
            <a
              href={`https://line.me/R/msg/text/?${encodeURIComponent("FocusFlowで集中！ https://focus-flow-omega-wheat.vercel.app/")}`}
              target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600"
            >
              LINEで送る
            </a>
            {/* X */}
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("FocusFlowで集中！")}&url=${encodeURIComponent("https://focus-flow-omega-wheat.vercel.app/")}`}
              target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-800"
            >
              Xで共有
            </a>
             {/* Facebook */}
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent("https://focus-flow-omega-wheat.vercel.app/")}`}
              target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Facebookでシェア
            </a>
            {/* Instagram */}
            <a
              href="https://www.instagram.com/"
              target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600"
            >
              Instagramでシェア
            </a>
          </div>
        </section>

        {/* フッター（規約/プライバシー/お問い合わせリンク） */}
        <footer className="text-center text-xs text-slate-500 mt-8 mb-6 space-y-2">
          <nav className="flex items-center justify-center gap-4 text-slate-600">
            <a className="hover:text-blue-600 underline-offset-4 hover:underline" href="/terms.html?v=1">利用規約</a>
            <a className="hover:text-blue-600 underline-offset-4 hover:underline" href="/privacy.html?v=1">プライバシーポリシー</a>
            <a className="hover:text-blue-600 underline-offset-4 hover:underline" href="/contact.html?v=1">お問い合わせ</a>
          </nav>
          <p>© {new Date().getFullYear()} FocusFlow. 無料ツール / PWA。広告とアフィリエイトで運営。</p>
        </footer>
      </main>
    </div>
  );
}

