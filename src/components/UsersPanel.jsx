import { useEffect, useMemo, useState } from "react";
import { fetchUsers, saveUsers, ApiError } from "../api";
import { USER_ROLES } from "../permissions";
import { kontrolaPristupov } from "../kontrolaPristupov";

/* Správa prístupov — kto sa smie prihlásiť, akú má rolu a ku ktorému človeku
   v rozpise patrí. Vidí to iba hlavný admin. */
export default function UsersPanel({ crew, onClose, onRegisterCloseGuard }) {
  const [users, setUsers] = useState([]);
  // snímka toho, čo je naposledy naisto uložené na serveri (alebo práve načítané) —
  // porovnaním s "users" sa dá zistiť, či "Zavrieť" práve teraz zahadzuje niečo neuložené.
  const [nacitaniUsers, setNacitaniUsers] = useState([]);
  // odtlačok toho istého snímku — posiela sa na server pri uložení (rovnaká
  // úloha ako baseVersion pri /data), nech server vie zistiť, že medzitým
  // zoznam zmenil niekto iný (typicky automatická synchronizácia s kontaktami)
  // a nemá tú zmenu ticho prepísať tým, čo je práve na obrazovke.
  const [zakladHash, setZakladHash] = useState("");
  const [authLog, setAuthLog] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchUsers();
        if (cancelled) return;
        setUsers(d.users || []);
        setNacitaniUsers(d.users || []);
        setZakladHash(d.hash || "");
        setAuthLog(d.log || []);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
      if (!cancelled) setBusy(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const patch = (id, p) => setUsers((us) => us.map((u) => (u.id === id ? { ...u, ...p } : u)));

  const add = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (users.some((u) => u.email === email)) { setErr("Táto adresa už v zozname je."); return; }
    const guess = crew.find((c) => c.name.toLowerCase() === email.split("@")[0].replace(/[._]/g, " "));
    setUsers((us) => [
      ...us,
      { id: "u_" + Math.random().toString(36).slice(2, 10), email, name: guess?.name || "", role: "stab", crewId: guess?.id || null, active: true },
    ]);
    setNewEmail("");
    setErr("");
  };

  /* Prekontroluje sa to, čo je práve na obrazovke — teda aj neuložené zmeny.
     Admin tak vidí problém hneď, ako ho vyrobí, nie až keď sa niekto neprihlási. */
  const problemy = useMemo(() => kontrolaPristupov(users, crew), [users, crew]);
  const chyby = problemy.filter((p) => p.druh === "chyba");

  const save = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const d = await saveUsers(users, zakladHash);
      const ulozeni = d.users || users;
      setUsers(ulozeni);
      setNacitaniUsers(ulozeni);
      setZakladHash(d.hash || "");
      setMsg("Uložené.");
    } catch (e) {
      /* Stret (409) — medzitým zoznam zmenil niekto iný (najčastejšie
         synchronizácia s kontaktami). NEPREPISUJEME "users" (rozostavané zmeny
         na obrazovke by tak potichu zmizli) — iba sa poznačí čerstvý základ zo
         servera, nech je vidno, čo sa medzitým zmenilo, a prípadné ďalšie
         "Uložiť" už ide s platným odtlačkom. */
      if (e instanceof ApiError && e.status === 409 && e.telo?.users) {
        setNacitaniUsers(e.telo.users);
        setZakladHash(e.telo.hash || "");
      }
      setErr(e.message);
    }
    setBusy(false);
  };

  const zmenene = JSON.stringify(users) !== JSON.stringify(nacitaniUsers);

  const handleZavriet = () => {
    if (zmenene && !confirm("Zavrieť? Zahodí to zmeny v prístupoch, ktoré si ešte neuložil(a).")) return;
    onClose();
  };

  // Zaregistruje sa u rodiča (App.jsx), aby aj Escape a prepnutie na iný panel
  // z menu (obe volajú setPanel(...) priamo, nie handleZavriet vyššie) rešpektovali
  // rovnakú otázku pred zahodením neuloženej zmeny — viď komentár v App.jsx.
  useEffect(() => {
    if (!onRegisterCloseGuard) return;
    onRegisterCloseGuard(() => !zmenene || confirm("Zavrieť? Zahodí to zmeny v prístupoch, ktoré si ešte neuložil(a)."));
    return () => onRegisterCloseGuard(null);
  }, [zmenene, onRegisterCloseGuard]);

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center mb-2.5">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Prístupy</div>
        <div className="grow" />
        <button onClick={handleZavriet} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2 py-1.5 -m-1.5">Zavrieť</button>
      </div>

      <p className="text-xs text-f-faint leading-relaxed mb-3">
        Kto tu nie je, nedostane prihlasovací odkaz a do rozpisu sa nedostane. „Patrí k“ prepojí
        človeka s jeho stĺpcom v rozpise — bez toho si štáb nevie označiť vlastnú nedostupnosť.
      </p>

      {!busy && problemy.length > 0 && (
        <div className="mb-3 p-2.5 rounded-lg bg-f-panel2 border border-f-border" data-kontrola-pristupov>
          <div className="text-[11px] font-bold uppercase tracking-wider text-f-faint mb-1.5">
            {chyby.length ? `Toto treba dorobiť (${chyby.length})` : "Ešte sa pozri na toto"}
          </div>
          <div className="flex flex-col gap-1">
            {problemy.map((p, i) => (
              <div key={i} className={`text-xs leading-relaxed ${p.druh === "chyba" ? "text-f-r" : "text-f-accent"}`}>
                {p.druh === "chyba" ? "✕" : "!"} {p.text}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="nová e-mailová adresa"
          className="px-2 py-1.5 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-52"
        />
        <button onClick={add} className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors">+ Pridať</button>
      </div>

      <div className="max-h-80 overflow-y-auto flex flex-col gap-2">
        {users.map((u) => (
          <div key={u.id} className="p-2.5 rounded-lg bg-f-panel2 border border-f-border">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-sm font-mono truncate ${u.active === false ? "text-f-faint2 line-through" : "text-f-text"}`}>{u.email}</span>
              {u.zdrojKontakt && (
                <span
                  title="Tohto človeka sem doplnila synchronizácia s databázou kontaktov — zmeníš to v paneli Kontakty."
                  className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-f-panel3 text-f-faint2 shrink-0"
                >
                  z kontaktov
                </span>
              )}
              <div className="grow" />
              <button
                onClick={() => patch(u.id, { active: u.active === false })}
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-f-panel3 text-f-muted hover:text-f-text"
              >
                {u.active === false ? "Obnoviť" : "Vypnúť"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={u.name || ""}
                onChange={(e) => patch(u.id, { name: e.target.value })}
                placeholder="meno"
                className="px-2 py-1 rounded-lg bg-f-panel3 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-32"
              />
              <select
                value={u.role}
                onChange={(e) => patch(u.id, { role: e.target.value })}
                className="px-2 py-1 rounded-lg bg-f-panel3 text-sm border border-f-border text-f-text"
              >
                {USER_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <select
                value={u.crewId || ""}
                onChange={(e) => patch(u.id, { crewId: e.target.value || null })}
                className="px-2 py-1 rounded-lg bg-f-panel3 text-sm border border-f-border text-f-text"
              >
                <option value="">Patrí k… (nikto)</option>
                {crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="text-[11px] text-f-faint mt-1.5">{USER_ROLES.find((r) => r.key === u.role)?.hint}</div>
          </div>
        ))}
        {!users.length && !busy && <div className="text-sm text-f-faint">Zatiaľ tu nikto nie je.</div>}
      </div>

      <div className="flex flex-wrap gap-2 items-center mt-3">
        <button
          onClick={save}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-sm font-bold bg-f-accent hover:brightness-110 text-f-ink transition-colors disabled:opacity-40"
        >
          {busy ? "Pracujem…" : "Uložiť prístupy"}
        </button>
        {msg && <span className="text-sm text-f-a">{msg}</span>}
        {err && <span className="text-sm text-f-r">{err}</span>}
      </div>

      {authLog.length > 0 && (
        <details className="mt-3">
          <summary className="text-[11px] font-bold uppercase tracking-wider text-f-faint cursor-pointer">História prihlásení</summary>
          <div className="mt-2 max-h-40 overflow-y-auto flex flex-col gap-1">
            {authLog.map((l, i) => (
              <div key={i} className="text-[11px] font-mono text-f-muted2">
                {new Date(l.t).toLocaleString("sk-SK")} — {l.text}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
