import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Expand, ImagePlus, Music2, Pause, Play, RotateCcw, Settings2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { Link } from 'react-router-dom';

type TimerFont = 'mono' | 'serif' | 'sans' | 'rounded' | 'display' | 'classic' | 'notebook' | 'casual' | 'script' | 'marker' | 'typewriter' | 'terminal' | 'elegant' | 'schoolbook' | 'hand';
type Background = { id: string; name: string; url: string };
type FocusSettings = { title: string; minutes: number; color: string; font: TimerFont; backgroundId: string; track: string; muted: boolean; hideButtons: boolean; hideTips: boolean };

const SETTINGS_KEY = 'kryin:focus-settings';
const BACKGROUNDS_KEY = 'kryin:focus-backgrounds';
const fallback: FocusSettings = { title: 'One task. Fully present.', minutes: 25, color: '#050505', font: 'mono', backgroundId: 'black', track: 'ambient', muted: false, hideButtons: false, hideTips: false };
const defaultBackgrounds: Background[] = [
    { id: 'black', name: 'Pure black', url: '' },
    { id: 'midnight', name: 'Midnight blue', url: 'linear-gradient(135deg, #020617 0%, #0f172a 100%)' },
    { id: 'ember', name: 'Warm ember', url: 'linear-gradient(135deg, #100908 0%, #27110d 100%)' },
];
const tracks = [{ id: 'ambient', name: 'Peaceful Ambient', src: '/focus-audio/peaceful-ambient.mp3', credit: 'Orange Free Sounds · CC BY 4.0' }];
const timerFonts: { id: TimerFont; name: string; family: string; className: string }[] = [
    { id: 'mono', name: 'Mono', family: 'ui-monospace, SFMono-Regular, Menlo, monospace', className: 'tracking-[-0.07em]' },
    { id: 'serif', name: 'Serif', family: 'Georgia, serif', className: 'tracking-[-0.05em]' },
    { id: 'sans', name: 'Clean', family: 'ui-sans-serif, system-ui, sans-serif', className: 'tracking-[-0.08em]' },
    { id: 'rounded', name: 'Rounded', family: 'Arial Rounded MT Bold, ui-rounded, sans-serif', className: 'tracking-[-0.06em]' },
    { id: 'display', name: 'Display', family: 'Impact, Haettenschweiler, sans-serif', className: 'tracking-[-0.03em]' },
    { id: 'classic', name: 'Classic', family: 'Palatino Linotype, Book Antiqua, Palatino, serif', className: 'tracking-[-0.05em]' },
    { id: 'notebook', name: 'Notebook', family: 'Segoe Print, Bradley Hand, cursive', className: 'tracking-[-0.05em]' },
    { id: 'casual', name: 'Casual', family: 'Comic Sans MS, Chalkboard SE, cursive', className: 'tracking-[-0.06em]' },
    { id: 'script', name: 'Script', family: 'Brush Script MT, Segoe Script, cursive', className: 'tracking-[-0.04em]' },
    { id: 'marker', name: 'Marker', family: 'Marker Felt, Comic Sans MS, cursive', className: 'tracking-[-0.04em]' },
    { id: 'typewriter', name: 'Typewriter', family: 'Courier New, monospace', className: 'tracking-[-0.07em]' },
    { id: 'terminal', name: 'Terminal', family: 'Lucida Console, Monaco, monospace', className: 'tracking-[-0.08em]' },
    { id: 'elegant', name: 'Elegant', family: 'Baskerville, Times New Roman, serif', className: 'tracking-[-0.05em]' },
    { id: 'schoolbook', name: 'Schoolbook', family: 'Bookman Old Style, Bookman, serif', className: 'tracking-[-0.05em]' },
    { id: 'hand', name: 'Handwritten', family: 'Chalkduster, Segoe Print, cursive', className: 'tracking-[-0.04em]' },
];

function loadSettings(): FocusSettings {
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return fallback; }
}
function loadBackgrounds(): Background[] {
    try { return [...defaultBackgrounds, ...JSON.parse(localStorage.getItem(BACKGROUNDS_KEY) || '[]')]; } catch { return defaultBackgrounds; }
}
function format(seconds: number) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function FocusMode() {
    const [settings, setSettings] = useState<FocusSettings>(loadSettings);
    const [backgrounds, setBackgrounds] = useState<Background[]>(loadBackgrounds);
    const [remaining, setRemaining] = useState(() => loadSettings().minutes * 60);
    const [running, setRunning] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [customAudio, setCustomAudio] = useState<{ name: string; src: string } | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const lastSpacePress = useRef(0);
    const activeBackground = backgrounds.find(item => item.id === settings.backgroundId) ?? defaultBackgrounds[0];
    const activeTrack = settings.track === 'custom' ? customAudio : tracks.find(track => track.id === settings.track);
    const activeFont = timerFonts.find(font => font.id === settings.font) ?? timerFonts[0];
    const isImage = activeBackground.url.startsWith('data:');

    useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
    useEffect(() => {
        if (!running || remaining <= 0) return;
        const interval = window.setInterval(() => setRemaining(value => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(interval);
    }, [running, remaining]);
    useEffect(() => { if (remaining === 0) setRunning(false); }, [remaining]);
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.muted = settings.muted;
        if (activeTrack && !settings.muted) audio.play().catch(() => undefined); else audio.pause();
    }, [activeTrack, settings.muted]);
    useEffect(() => () => { if (customAudio) URL.revokeObjectURL(customAudio.src); }, [customAudio]);
    useEffect(() => {
        const handleSpace = (event: KeyboardEvent) => {
            if (event.code !== 'Space' || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
            event.preventDefault();
            const now = Date.now();
            if (now - lastSpacePress.current < 300) { document.exitFullscreen?.(); lastSpacePress.current = 0; return; }
            lastSpacePress.current = now;
            window.setTimeout(() => { if (lastSpacePress.current === now) setRunning(value => !value); }, 300);
        };
        window.addEventListener('keydown', handleSpace);
        return () => window.removeEventListener('keydown', handleSpace);
    }, []);

    const update = (patch: Partial<FocusSettings>) => setSettings(current => ({ ...current, ...patch }));
    const toggleTimer = () => setRunning(value => !value);
    const reset = (minutes = settings.minutes) => { setRunning(false); setRemaining(Math.max(1, minutes) * 60); };
    const selectMinutes = (value: number) => { update({ minutes: value }); reset(value); };
    const fullscreen = () => document.documentElement.requestFullscreen?.().catch(() => undefined);
    const exitFullscreen = () => document.exitFullscreen?.();
    const addBackground = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !file.type.startsWith('image/') || file.size > 1_500_000) return;
        const reader = new FileReader();
        reader.onload = () => {
            const item = { id: `local-${Date.now()}`, name: file.name.replace(/\.[^.]+$/, ''), url: String(reader.result) };
            const next = [...backgrounds, item]; setBackgrounds(next); update({ backgroundId: item.id });
            localStorage.setItem(BACKGROUNDS_KEY, JSON.stringify(next.filter(background => !defaultBackgrounds.some(defaultItem => defaultItem.id === background.id))));
        };
        reader.readAsDataURL(file); event.target.value = '';
    };
    const addMusic = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]; if (!file?.type.startsWith('audio/')) return;
        if (customAudio) URL.revokeObjectURL(customAudio.src);
        setCustomAudio({ name: file.name.replace(/\.[^.]+$/, ''), src: URL.createObjectURL(file) }); update({ track: 'custom' }); event.target.value = '';
    };
    const backgroundStyle = useMemo(() => isImage ? { backgroundImage: `linear-gradient(rgba(0,0,0,.62), rgba(0,0,0,.84)), url(${activeBackground.url})` } : { background: activeBackground.url || settings.color }, [activeBackground, isImage, settings.color]);

    return <main className="min-h-screen overflow-hidden bg-black text-white" style={backgroundStyle}>
        <audio ref={audioRef} src={activeTrack?.src} loop />
        <div className="min-h-screen bg-black/20 px-5 py-6 sm:px-10 sm:py-8 flex flex-col">
            <header className="flex items-center justify-between gap-4">
                {!settings.hideButtons && <Link to="/dashboard" className="inline-flex h-11 items-center gap-2 rounded-full border border-white/15 bg-black/30 px-4 text-sm font-semibold text-white/80 backdrop-blur transition hover:bg-white/10"><ArrowLeft className="w-4 h-4" /> Exit</Link>}
                <div className="ml-auto flex gap-2"><button onClick={() => setSettingsOpen(true)} className="control" aria-label="Focus settings"><Settings2 className="w-5 h-5" /></button>{!settings.hideButtons && <button onClick={fullscreen} className="control" aria-label="Enter fullscreen"><Expand className="w-5 h-5" /></button>}</div>
            </header>

            <section onClick={(event) => { if (!(event.target as HTMLElement).closest('button')) toggleTimer(); }} onDoubleClick={exitFullscreen} className="flex-1 grid place-items-center text-center py-12" aria-labelledby="focus-title">
                <div className="max-w-3xl"><p className="mb-8 text-xs font-bold uppercase tracking-[0.34em] text-white/45">Kryin · Focus Mode</p><h1 id="focus-title" className="text-balance text-xl font-medium text-white/80 sm:text-2xl">{settings.title}</h1>
                    <div style={{ fontFamily: activeFont.family }} className={`my-8 text-[clamp(5rem,23vw,14rem)] leading-none text-white drop-shadow-2xl ${activeFont.className}`}>{format(remaining)}</div>
                    {!settings.hideButtons && <div className="flex justify-center gap-3"><button onClick={toggleTimer} className="inline-flex min-w-36 items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-extrabold text-black transition hover:scale-[1.02]">{running ? <><Pause className="w-4 h-4 fill-current" /> Pause</> : <><Play className="w-4 h-4 fill-current" /> Start timer</>}</button><button onClick={() => reset()} className="control" aria-label="Reset timer"><RotateCcw className="w-5 h-5" /></button></div>}
                    {!settings.hideTips && <div className="mt-8 flex justify-center gap-2">{[15, 25, 45, 60].map(value => <button key={value} onClick={() => selectMinutes(value)} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${settings.minutes === value ? 'bg-white/20 text-white' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}>{value} min</button>)}</div>}
                </div>
            </section>
        </div>

        {settingsOpen && <aside className="fixed inset-y-0 right-0 z-20 w-full max-w-md overflow-y-auto border-l border-white/10 bg-[#0b0b0c]/95 p-5 shadow-2xl backdrop-blur-xl sm:p-7" aria-label="Focus settings">
            <div className="mb-7 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.22em] text-white/40">Personal controls</p><h2 className="mt-1 text-2xl font-bold">Make it yours</h2></div><button onClick={() => setSettingsOpen(false)} className="control" aria-label="Close settings"><X className="w-5 h-5" /></button></div>
            <div className="space-y-7">
                <label className="setting"><span>Motivation title</span><input value={settings.title} onChange={event => update({ title: event.target.value })} maxLength={80} /></label>
                <label className="setting"><span>Minutes</span><input type="number" min="1" max="180" value={settings.minutes} onChange={event => selectMinutes(Number(event.target.value) || 1)} /></label><label className="setting"><span>Timer font</span><span className="font-select-wrap"><select className="font-select" value={settings.font} onChange={event => update({ font: event.target.value as TimerFont })} style={{ fontFamily: activeFont.family }}>{timerFonts.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 w-4 h-4 -translate-y-1/2 text-white/60" /></span></label>
                <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[.035] p-4"><label className="toggle-row"><span><b>Hide all buttons</b><small>Tap the screen or press Space to start/pause the timer.</small></span><input type="checkbox" checked={settings.hideButtons} onChange={event => update({ hideButtons: event.target.checked })} /></label><label className="toggle-row"><span><b>Turn off timer tips</b><small>Removes the 15, 25, 45 and 60 minute suggestions.</small></span><input type="checkbox" checked={settings.hideTips} onChange={event => update({ hideTips: event.target.checked })} /></label><p className="pt-1 text-[11px] leading-relaxed text-white/40">Double-tap the screen or double-press Space to exit fullscreen.</p></div>
                <div><p className="setting-label">Background</p><div className="grid grid-cols-3 gap-2">{backgrounds.map(background => <button key={background.id} onClick={() => update({ backgroundId: background.id })} className={`h-16 rounded-xl border ${settings.backgroundId === background.id ? 'border-white ring-2 ring-white/30' : 'border-white/10'} bg-cover bg-center`} style={background.url ? (background.url.startsWith('data:') ? { backgroundImage: `url(${background.url})` } : { background: background.url }) : { background: settings.color }} title={background.name} />)}<label className="grid h-16 cursor-pointer place-items-center rounded-xl border border-dashed border-white/20 text-white/60 hover:bg-white/5"><ImagePlus className="w-5 h-5" /><input className="sr-only" type="file" accept="image/*" onChange={addBackground} /></label></div><p className="mt-2 text-[11px] text-white/35">Add an image up to 1.5 MB. It stays in this browser.</p></div>
                <div><p className="setting-label">Choose custom colour</p><label className="color-picker"><input type="color" value={settings.color} onChange={event => update({ color: event.target.value, backgroundId: 'black' })} /><span>{settings.color}</span></label></div>
                <div><p className="setting-label">Calm music</p><button onClick={() => update({ muted: !settings.muted })} className="music-toggle">{settings.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}{settings.muted ? 'Turn music on' : 'Turn music off'}</button><div className="mt-2 space-y-2">{tracks.map(track => <button key={track.id} onClick={() => update({ track: track.id, muted: false })} className={`track ${settings.track === track.id ? 'track-active' : ''}`}><Music2 className="w-4 h-4" />{track.name}</button>)}{customAudio && <button onClick={() => update({ track: 'custom', muted: false })} className={`track ${settings.track === 'custom' ? 'track-active' : ''}`}><Music2 className="w-4 h-4" />{customAudio.name}</button>}<label className="track cursor-pointer"><Upload className="w-4 h-4" /> Add local music<input className="sr-only" type="file" accept="audio/*" onChange={addMusic} /></label></div><p className="mt-2 text-[11px] text-white/35">{tracks[0].credit}</p></div>
            </div>
        </aside>}
        <style>{`.control{display:grid;place-items:center;width:2.75rem;height:2.75rem;border-radius:9999px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3);color:white;transition:.2s}.control:hover{background:rgba(255,255,255,.12)}.setting{display:grid;gap:.45rem;font-size:.75rem;font-weight:700;color:rgba(255,255,255,.55)}.setting input,.setting select{width:100%;border:1px solid rgba(255,255,255,.12);border-radius:.75rem;background:rgba(255,255,255,.06);padding:.7rem .8rem;color:white;outline:none}.setting-label{margin-bottom:.6rem;font-size:.75rem;font-weight:700;color:rgba(255,255,255,.55)}.track{display:flex;width:100%;align-items:center;gap:.65rem;border:1px solid rgba(255,255,255,.1);border-radius:.75rem;padding:.75rem .8rem;text-align:left;font-size:.82rem;font-weight:700;color:rgba(255,255,255,.7);transition:.2s}.track:hover,.track-active{border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.08);color:white}.font-choice{border:1px solid rgba(255,255,255,.1);border-radius:.6rem;padding:.65rem .2rem;font-size:.65rem;color:rgba(255,255,255,.55);transition:.2s}.font-choice:hover,.font-choice-active{border-color:rgba(255,255,255,.55);background:rgba(255,255,255,.1);color:white}.font-select-wrap{position:relative;display:block}.font-select{appearance:none!important;cursor:pointer;border-color:rgba(255,255,255,.22)!important;background:linear-gradient(135deg,rgba(255,255,255,.12),rgba(255,255,255,.05))!important;padding-right:2.5rem!important;box-shadow:inset 0 1px rgba(255,255,255,.08),0 8px 24px rgba(0,0,0,.18);transition:.2s}.font-select:hover,.font-select:focus{border-color:rgba(255,255,255,.65)!important;background:rgba(255,255,255,.14)!important}.font-select option{background:#151516;color:white;font-family:inherit}.toggle-row{display:flex;align-items:center;justify-content:space-between;gap:1rem}.toggle-row span{display:grid;gap:.2rem;font-size:.75rem;color:white}.toggle-row small{font-size:.68rem;font-weight:500;line-height:1.35;color:rgba(255,255,255,.45)}.toggle-row input{appearance:none;width:2.3rem;height:1.3rem;border-radius:9999px;background:rgba(255,255,255,.18);transition:.2s}.toggle-row input:checked{background:white}.toggle-row input:before{content:'';display:block;width:1rem;height:1rem;margin:.15rem;border-radius:9999px;background:#111;transition:.2s}.toggle-row input:checked:before{transform:translateX(1rem)}.color-picker,.music-toggle{display:flex;align-items:center;gap:.7rem;width:100%;border:1px solid rgba(255,255,255,.14);border-radius:.8rem;background:rgba(255,255,255,.07);padding:.7rem .8rem;font-size:.78rem;font-weight:700;color:white;transition:.2s}.color-picker:hover,.music-toggle:hover{background:rgba(255,255,255,.13)}.color-picker input{width:1.5rem;height:1.5rem;border:0;padding:0;background:transparent}.music-toggle{justify-content:center;background:rgba(255,255,255,.13)}`}</style>
    </main>;
}
