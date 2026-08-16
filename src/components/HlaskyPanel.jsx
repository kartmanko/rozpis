import { useState } from "react";

/* Hlášky z natáčania (sekcia 8 finálneho briefu) — krátke vtipné hlášky, ktoré sa
   potom náhodne zobrazujú na hlavnej stránke (viď HlaskaWidget). Zatiaľ ich píše
   iba admin (caps.hlasky) — panel je preto zámerne jednoduchý zoznam s pridaním,
   úpravou textu a zmazaním, žiadne schvaľovanie ani workflow navyše. Keď sa to
   raz otvorí aj iným (brief: "Priprav model tak, aby sa dali neskôr otvoriť aj
   ostatným"), tento panel sa dá znova použiť bez zmeny — mení sa iba caps.hlasky
   v auth.js, kto všetko sem má prístup. */
export default function HlaskyPanel({ hlasky, setHlasky, me, onClose }) {
  const [novyText, setNovyText] = useState("");

  const pridat = () => {
    const text = novyText.trim();
    if (!text) return;
    setHlasky((hs) => [
      ...hs,
      {
        id: "hl" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text,
        autor: me?.name || "",
        ts: new Date().toISOString(),
      },
    ]);
    setNovyText("");
  };

  const patch = (id, p) => setHlasky((hs) => hs.map((h) => (h.id === id ? { ...h, ...p } : h)));
  const zmazat = (id) => {
    if (!window.confirm("Zmazať túto hlášku?")) return;
    setHlasky((hs) => hs.filter((h) => h.id !== id));
  };

  // Server (ocistiHlasky) sem takýto tvar cez appku nikdy nepustí — ale panel
  // nedôveruje priamo vlastnému tvaru dát (rovnaký dôvod ako v HlaskaWidget:
  // priamy zápis do KV mimo appky vie stav upraviť aj obídením servera).
  // Bez tohto filtra by napr. "null" v poli alebo netextové "text"/"autor"
  // zhodili celý panel (a keďže appka je pod jedným ErrorBoundary, celú appku).
  const platne = hlasky.filter((h) => h && typeof h === "object" && typeof h.text === "string" && typeof h.id === "string");
  // najnovšie hore, nech je vidieť, čo sa pridalo naposledy
  const zoznam = [...platne].sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center mb-2.5">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Hlášky z natáčania</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2 py-1.5 -m-1.5">Zavrieť</button>
      </div>

      <p className="text-xs text-f-faint leading-relaxed mb-3">
        Krátke vtipné hlášky, ktoré sa potom náhodne zobrazujú na hlavnej stránke pre pobavenie.
        Zatiaľ ich sem smie pridávať iba admin.
      </p>

      <div className="max-h-96 overflow-y-auto flex flex-col gap-2 mb-3">
        {zoznam.map((h) => (
          <div key={h.id} className="p-2.5 rounded-lg bg-f-panel2 border border-f-border">
            <textarea
              value={h.text}
              onChange={(e) => patch(h.id, { text: e.target.value })}
              rows={2}
              maxLength={300}
              className="w-full px-2 py-1 rounded-lg bg-f-panel3 text-sm border border-f-border text-f-text resize-none"
            />
            <div className="flex items-center gap-2 mt-1.5">
              <input
                value={typeof h.autor === "string" ? h.autor : ""}
                onChange={(e) => patch(h.id, { autor: e.target.value })}
                placeholder="autor (nepovinné)"
                className="px-2 py-1 rounded-lg bg-f-panel3 text-xs border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-24"
              />
              <button onClick={() => zmazat(h.id)} className="text-f-accent px-1 text-sm shrink-0">Zmazať</button>
            </div>
          </div>
        ))}
        {!zoznam.length && <div className="text-sm text-f-faint">Zatiaľ tu nie je žiadna hláška.</div>}
      </div>

      <div className="border-t border-f-hair pt-3 flex gap-2 flex-wrap">
        <textarea
          value={novyText}
          onChange={(e) => setNovyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); pridat(); }
          }}
          placeholder="nová hláška…"
          rows={2}
          maxLength={300}
          className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-40 resize-none"
        />
        <button onClick={pridat} className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors self-start">+ Pridať</button>
      </div>
    </div>
  );
}
