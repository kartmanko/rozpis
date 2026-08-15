import { useState } from "react";
import { telOdkaz, mailOdkaz } from "../kontakty";
import { USER_ROLES } from "../permissions";

/* Databáza kontaktov štábu a externých ľudí (sekcia 1 finálneho briefu).

   Interný kontakt je prepojený s človekom v rozpise (crewId) — meno a rola sa
   preberajú odtiaľ, tu sa dopĺňa iba mail a telefón. Externý kontakt (Jimmy Jib,
   ShowService a podobne) nemá stĺpec v rozpise, je to čisto meno + kontakt na
   napovedanie a mail.

   Tento zoznam JE ZÁROVEŇ zdrojom allowlistu na prihlásenie (sekcia 10 briefu):
   interný kontakt s vyplneným mailom A priradenou "rolou pre prihlásenie" server
   pri každom uložení bezpečne dopíše do "Prístupy" (users_v1, viď
   synchronizujPouzivatelovZKontaktov vo worker/src/auth.js). "Prístupy" ostáva
   ako panel na ručné výnimky (napr. niekto bez kontaktu, alebo mimo štábu) —
   ručne pridaných ľudí táto synchronizácia nikdy neprepíše ani nezmaže. */
export default function KontaktyPanel({ kontakty, setKontakty, crew, onClose }) {
  const [novyInterny, setNovyInterny] = useState(false);
  const [novyMeno, setNovyMeno] = useState("");
  const [novaFunkcia, setNovaFunkcia] = useState("");
  const [novyCrewId, setNovyCrewId] = useState("");

  const patch = (id, p) => setKontakty((ks) => ks.map((k) => (k.id === id ? { ...k, ...p } : k)));
  const zmazat = (id) => {
    if (!window.confirm("Zmazať tento kontakt?")) return;
    setKontakty((ks) => ks.filter((k) => k.id !== id));
  };

  const pridat = () => {
    const meno = novyInterny
      ? crew.find((c) => c.id === novyCrewId)?.name || ""
      : novyMeno.trim();
    if (!meno) return;
    setKontakty((ks) => [
      ...ks,
      {
        id: "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        meno,
        funkcia: novaFunkcia.trim(),
        mail: "",
        telefon: "",
        interny: novyInterny,
        crewId: novyInterny && novyCrewId ? novyCrewId : null,
        aktivny: true,
        rola: "",
      },
    ]);
    setNovyMeno("");
    setNovaFunkcia("");
    setNovyCrewId("");
  };

  // interní hore (podľa mena), potom externí — nech sa v dlhšom zozname dá rýchlo nájsť
  const zoznam = [...kontakty].sort((a, b) => {
    if (!!a.interny !== !!b.interny) return a.interny ? -1 : 1;
    return String(a.meno || "").localeCompare(String(b.meno || ""), "sk");
  });

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center mb-2.5">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Kontakty</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2 py-1.5 -m-1.5">Zavrieť</button>
      </div>

      <p className="text-xs text-f-faint leading-relaxed mb-3">
        Meno, funkcia, mail a telefón na jednom mieste — pre napovedanie pri dispo, pre
        automatický zoznam mailových adries a na klik-na-zavolanie/napísať. Interný kontakt sa
        prepojí s človekom v rozpise; externý (technika, dodávatelia) si sem pridáš ručne.
      </p>

      <div className="max-h-96 overflow-y-auto flex flex-col gap-2 mb-3">
        {zoznam.map((k) => (
          <div key={k.id} className="p-2.5 rounded-lg bg-f-panel2 border border-f-border">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`text-sm font-bold truncate ${k.aktivny === false ? "text-f-faint2 line-through" : "text-f-text"}`}>{k.meno}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${k.interny ? "bg-f-a text-f-ink" : "bg-f-panel3 text-f-muted"}`}>
                {k.interny ? "interný" : "externý"}
              </span>
              <div className="grow" />
              <button
                onClick={() => patch(k.id, { aktivny: k.aktivny === false })}
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-f-panel3 text-f-muted hover:text-f-text"
              >
                {k.aktivny === false ? "Obnoviť" : "Vypnúť"}
              </button>
              <button onClick={() => zmazat(k.id)} className="text-f-accent px-1 text-sm">Zmazať</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={k.funkcia || ""}
                onChange={(e) => patch(k.id, { funkcia: e.target.value })}
                placeholder="funkcia / rola"
                className="px-2 py-1 rounded-lg bg-f-panel3 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-32"
              />
              <div className="flex items-center gap-1 grow min-w-40">
                <input
                  type="email"
                  value={k.mail || ""}
                  onChange={(e) => patch(k.id, { mail: e.target.value })}
                  placeholder="mail"
                  className="px-2 py-1 rounded-lg bg-f-panel3 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-0"
                />
                {mailOdkaz(k.mail) && (
                  <a href={mailOdkaz(k.mail)} title="Napísať mail" className="text-f-accent px-1 shrink-0">✉</a>
                )}
              </div>
              <div className="flex items-center gap-1 grow min-w-32">
                <input
                  value={k.telefon || ""}
                  onChange={(e) => patch(k.id, { telefon: e.target.value })}
                  placeholder="telefón"
                  className="px-2 py-1 rounded-lg bg-f-panel3 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-0"
                />
                {telOdkaz(k.telefon) && (
                  <a href={telOdkaz(k.telefon)} title="Zavolať" className="text-f-accent px-1 shrink-0">☎</a>
                )}
              </div>
              {k.interny && (
                <select
                  value={k.crewId || ""}
                  onChange={(e) => patch(k.id, { crewId: e.target.value || null })}
                  className="px-2 py-1 rounded-lg bg-f-panel3 text-sm border border-f-border text-f-text"
                >
                  <option value="">Patrí k… (nikto)</option>
                  {crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              {k.interny && (
                <select
                  value={k.rola || ""}
                  onChange={(e) => patch(k.id, { rola: e.target.value })}
                  title="Rola pre prihlásenie — s mailom nižšie určuje, či a s akými právami sa človek dostane do appky."
                  className="px-2 py-1 rounded-lg bg-f-panel3 text-sm border border-f-border text-f-text"
                >
                  <option value="">Prihlásenie: vypnuté</option>
                  {USER_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              )}
            </div>
          </div>
        ))}
        {!zoznam.length && <div className="text-sm text-f-faint">Zatiaľ tu nie je žiadny kontakt.</div>}
      </div>

      <div className="border-t border-f-hair pt-3">
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => setNovyInterny(false)}
            className={`flex-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${!novyInterny ? "bg-f-accent text-f-ink" : "bg-f-panel2 text-f-muted hover:bg-f-border"}`}
          >
            Externý
          </button>
          <button
            onClick={() => setNovyInterny(true)}
            className={`flex-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${novyInterny ? "bg-f-accent text-f-ink" : "bg-f-panel2 text-f-muted hover:bg-f-border"}`}
          >
            Interný (zo štábu)
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {novyInterny ? (
            <select
              value={novyCrewId}
              onChange={(e) => setNovyCrewId(e.target.value)}
              className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text grow min-w-40"
            >
              <option value="">Vyber človeka zo štábu…</option>
              {crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <input
              value={novyMeno}
              onChange={(e) => setNovyMeno(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pridat()}
              placeholder="meno"
              className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-32"
            />
          )}
          <input
            value={novaFunkcia}
            onChange={(e) => setNovaFunkcia(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && pridat()}
            placeholder="funkcia / rola"
            className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-32"
          />
          <button onClick={pridat} className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors">+ Pridať</button>
        </div>
      </div>
    </div>
  );
}
