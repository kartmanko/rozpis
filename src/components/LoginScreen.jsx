import { useState } from "react";
import { authRequest, getApiBase, setApiBase, setBreakGlassPassword } from "../api";

/* Prihlásenie bez hesla: človek zadá svoj e-mail, príde mu odkaz, klikne naň
   a je prihlásený na 90 dní. Žiadne heslá si nikto nepamätá ani nezadáva. */
export default function LoginScreen({ initialError }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError || "");

  // núdzový vstup — keby prihlasovacie maily prestali chodiť; skryté pod odkazom
  const [showRescue, setShowRescue] = useState(false);
  const [rescuePw, setRescuePw] = useState("");
  const [apiBase, setApiBaseInput] = useState(getApiBase());

  const send = async () => {
    const e = email.trim();
    if (!e) return;
    setBusy(true);
    setErr("");
    try {
      await authRequest(e);
      setSent(true);
    } catch (ex) {
      setErr(ex.message || "Odkaz sa nepodarilo poslať.");
    }
    setBusy(false);
  };

  const useRescue = () => {
    if (!rescuePw.trim()) return;
    if (apiBase.trim() && apiBase.trim() !== getApiBase()) setApiBase(apiBase.trim());
    setBreakGlassPassword(rescuePw.trim());
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-f-bg text-f-text font-sans flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="text-2xl font-extrabold tracking-tight uppercase">
            FARMA<span className="text-f-accent">18</span>
          </div>
          <div className="text-[10px] font-mono text-f-faint tracking-wide mt-1">ROZPIS ŠTÁBU · 30.7.–17.10.2026</div>
        </div>

        {sent ? (
          <div className="bg-f-panel3 border border-f-border rounded-xl p-5">
            <div className="text-sm font-bold text-f-a mb-1.5">Odkaz je na ceste</div>
            <p className="text-sm text-f-muted leading-relaxed">
              Ak má tvoja adresa prístup, o chvíľu ti príde mail s prihlasovacím odkazom.
              Otvor ho na tomto zariadení — platí 20 minút.
            </p>
            <p className="text-xs text-f-faint leading-relaxed mt-3">
              Nič neprišlo? Pozri sa aj do spamu. Ak tam nič nie je, prístup ti ešte nepridelil admin.
            </p>
            <button
              onClick={() => { setSent(false); setErr(""); }}
              className="mt-4 w-full px-3 py-2 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors"
            >
              Skúsiť inú adresu
            </button>
          </div>
        ) : (
          <div className="bg-f-panel3 border border-f-border rounded-xl p-5">
            <label className="block text-xs font-bold uppercase tracking-widest text-f-faint mb-2">Tvoj e-mail</label>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="meno@firma.sk"
              className="w-full px-3 py-2.5 rounded-lg bg-f-panel2 text-base border border-f-border text-f-text placeholder:text-f-faint2"
            />
            <button
              onClick={send}
              disabled={busy || !email.trim()}
              className="mt-3 w-full px-3 py-2.5 rounded-lg text-sm font-bold bg-f-accent hover:brightness-110 text-f-ink transition-colors disabled:opacity-40"
            >
              {busy ? "Posielam…" : "Poslať prihlasovací odkaz"}
            </button>
            <p className="text-xs text-f-faint leading-relaxed mt-3">
              Žiadne heslo netreba. Príde ti mail s odkazom — po kliknutí ostaneš prihlásený 90 dní.
            </p>
            {err && <div className="mt-3 text-sm text-f-r">{err}</div>}
          </div>
        )}

        <div className="text-center mt-5">
          <button
            onClick={() => setShowRescue((v) => !v)}
            className="text-[11px] text-f-faint2 hover:text-f-muted underline underline-offset-2"
          >
            Problém s prihlásením?
          </button>
        </div>

        {showRescue && (
          <div className="mt-3 bg-f-panel3 border border-f-border rounded-xl p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-f-faint mb-2">Núdzový vstup (admin)</div>
            <input
              value={apiBase}
              onChange={(e) => setApiBaseInput(e.target.value)}
              placeholder="adresa servera (https://api.kartmanko.cc)"
              className="w-full mb-2 px-2.5 py-2 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2"
            />
            <input
              type="password"
              value={rescuePw}
              onChange={(e) => setRescuePw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && useRescue()}
              placeholder="núdzové admin heslo"
              className="w-full px-2.5 py-2 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2"
            />
            <button
              onClick={useRescue}
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors"
            >
              Vstúpiť
            </button>
            <p className="text-[11px] text-f-faint leading-relaxed mt-2">
              Iba pre hlavného admina, keby prestali chodiť maily. Bežný štáb sem nič zadávať nemusí.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
