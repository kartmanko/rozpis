import { useEffect, useMemo, useState } from "react";
import { toUTC } from "../dateUtils";
import { SK_DAYS_FULL } from "../constants";
import { dispoOdoslatNahlad, dispoOdoslat, ApiError } from "../api";

/* Builder dispozícií (sekcia 2 finálneho briefu).

   Doteraz appka vedela iba PRIJAŤ dispo mail (DispoPanel vyššie). Toto je opačný
   smer: admin/vedúci tu poskladá dispo na konkrétny deň priamo v appke — harmonogram,
   miesto, počasie, poznámky, a skupiny ľudí (napr. "Kamery", "Réžia"), ktorým sa to
   pošle mailom. Zvýrazniť sa dá, komu treba dať extra pozor (napr. kto má zraz skôr).

   Uložiť do rozpisu (info ku dňu, viditeľné v detaile dňa) a poslať mailom sú DVE
   samostatné akcie — dá sa uložiť bez posielania aj poslať bez uloženia. Odoslanie
   má vždy najprv náhľad: appka nikdy nepošle mail naslepo. */

/** "2026-08-15" -> "sobota 15.8.2026" */
function denText(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "";
  const d = new Date(toUTC(iso));
  if (Number.isNaN(d.getTime())) return "";
  return `${SK_DAYS_FULL[d.getUTCDay()].toLowerCase()} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}

const prazdnyBlok = (datum) => ({
  datum,
  miesto: "",
  pocasie: "",
  poznamky: "",
  harmonogram: [],
  skupiny: [],
  zvyraznene: [],
  dalsiPrijemcovia: "",
});

export default function DispoBuilderPanel({ dispo, crew, cellOf, denneRoly, canEdit, onUloz, onClose }) {
  const [datum, setDatum] = useState("");
  const [blok, setBlok] = useState(prazdnyBlok(""));
  const [nahlad, setNahlad] = useState(null); // null | "nacitava" | {subject, html, text, prijemcovia} | { chyba }
  const [odoslane, setOdoslane] = useState(null); // null | "posiela" | { ok:true, poslaneNa } | { chyba }

  // pri zmene dňa sa predvyplní z už existujúcej (rozostavanej alebo potvrdenej) dispo na ten deň
  useEffect(() => {
    if (!datum) { setBlok(prazdnyBlok("")); return; }
    const existujuca = (dispo || {})[datum];
    setBlok({
      datum,
      miesto: existujuca?.miesto || "",
      pocasie: existujuca?.pocasie || "",
      poznamky: existujuca?.poznamky || "",
      harmonogram: existujuca?.harmonogram || [],
      skupiny: existujuca?.skupiny || [],
      zvyraznene: existujuca?.zvyraznene || [],
      dalsiPrijemcovia: (existujuca?.dalsiPrijemcovia || []).join(", "),
    });
    setNahlad(null);
    setOdoslane(null);
  }, [datum, dispo]);

  const patch = (p) => { setBlok((b) => ({ ...b, ...p })); setNahlad(null); setOdoslane(null); };

  const pridajRiadok = () => patch({ harmonogram: [...blok.harmonogram, { cas: "", text: "" }] });
  const upravRiadok = (i, p) => patch({ harmonogram: blok.harmonogram.map((h, idx) => (idx === i ? { ...h, ...p } : h)) });
  const zmazRiadok = (i) => patch({ harmonogram: blok.harmonogram.filter((_, idx) => idx !== i) });

  const pridajSkupinu = () => patch({ skupiny: [...blok.skupiny, { nazov: "", ludia: [] }] });
  const zmazSkupinu = (i) => patch({ skupiny: blok.skupiny.filter((_, idx) => idx !== i) });
  const nazovSkupiny = (i, nazov) => patch({ skupiny: blok.skupiny.map((s, idx) => (idx === i ? { ...s, nazov } : s)) });
  const prepniVSkupine = (i, crewId) =>
    patch({
      skupiny: blok.skupiny.map((s, idx) => {
        if (idx !== i) return s;
        const ma = s.ludia.includes(crewId);
        return { ...s, ludia: ma ? s.ludia.filter((id) => id !== crewId) : [...s.ludia, crewId] };
      }),
    });

  const prepniZvyraznenie = (crewId) =>
    patch({ zvyraznene: blok.zvyraznene.includes(crewId) ? blok.zvyraznene.filter((id) => id !== crewId) : [...blok.zvyraznene, crewId] });

  // ľudia, ktorí sú aspoň v jednej skupine — na zvýraznenie nemá zmysel ponúkať nikoho iného
  const ludiaVoBloku = useMemo(() => {
    const s = new Set();
    blok.skupiny.forEach((sk) => sk.ludia.forEach((id) => s.add(id)));
    return [...s];
  }, [blok.skupiny]);

  const menoZCrew = (id) => (crew || []).find((c) => String(c.id) === String(id))?.name || id;

  // kto je zapísaný do niektorej skupiny, ale na ten deň má v rozpise "nemôže" (červená) —
  // appka to nikdy nezakáže (dispo a rozpis sú nezávislé), iba na to upozorní.
  const konflikty = useMemo(() => {
    if (!datum || !cellOf) return [];
    return ludiaVoBloku.filter((id) => cellOf(datum, id)?.off);
  }, [datum, cellOf, ludiaVoBloku]);

  const zostavBlok = () => ({
    datum: blok.datum,
    miesto: blok.miesto,
    pocasie: blok.pocasie,
    poznamky: blok.poznamky,
    harmonogram: blok.harmonogram.filter((h) => h.cas || h.text),
    skupiny: blok.skupiny.filter((s) => s.nazov || s.ludia.length),
    zvyraznene: blok.zvyraznene,
    dalsiPrijemcovia: blok.dalsiPrijemcovia.split(",").map((m) => m.trim()).filter(Boolean),
  });

  const handleUlozit = () => {
    onUloz(datum, zostavBlok());
  };

  const handleNahlad = async () => {
    setNahlad("nacitava");
    try {
      const r = await dispoOdoslatNahlad(zostavBlok());
      setNahlad(r);
    } catch (e) {
      setNahlad({ chyba: e instanceof ApiError ? e.message : "Náhľad sa nepodarilo zostaviť." });
    }
  };

  const handleOdoslat = async () => {
    if (!confirm(`Odoslať dispo mailom na ${nahlad?.prijemcovia?.length || 0} adries?`)) return;
    setOdoslane("posiela");
    try {
      const r = await dispoOdoslat(zostavBlok());
      setOdoslane(r);
    } catch (e) {
      setOdoslane({ chyba: e instanceof ApiError ? e.message : "Odoslanie zlyhalo." });
    }
  };

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Zostaviť dispo</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>

      {!canEdit && (
        <div className="text-[11px] text-f-faint2 mb-2">Iba na čítanie — dispo smú zostaviť a poslať vedúci a hlavný admin.</div>
      )}

      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <label className="text-[10px] font-bold uppercase tracking-wider text-f-faint">Deň</label>
        <input
          type="date"
          value={datum}
          disabled={!canEdit}
          onChange={(e) => setDatum(e.target.value)}
          className="bg-f-panel border border-f-border rounded-md px-2 py-1 text-xs text-f-text"
        />
        {datum && <span className="text-[11px] text-f-faint2">{denText(datum)}</span>}
      </div>

      {datum && (() => {
        // Denné role (sekcia 5 briefu) — kto ten deň šéfuje, ide aj do hlavičky mailu (viď worker/src/index.js).
        const dennaRola = (denneRoly || []).find((r) => r.iso === datum);
        const menoZCrew = (id) => (crew || []).find((c) => c.id === id)?.name || null;
        const reziserDna = dennaRola?.reziser ? menoZCrew(dennaRola.reziser) : null;
        const storyDna = (dennaRola?.storyProduceri || []).map(menoZCrew).filter(Boolean);
        if (!reziserDna && !storyDna.length) return null;
        return (
          <div className="text-[11px] text-f-faint2 mb-2.5">
            {reziserDna && <>Režisér dňa: <span className="text-f-text font-semibold">{reziserDna}</span>{storyDna.length ? " · " : ""}</>}
            {storyDna.length > 0 && <>Story dňa: <span className="text-f-text font-semibold">{storyDna.join(", ")}</span></>}
          </div>
        );
      })()}

      {!datum && <div className="text-sm text-f-faint leading-relaxed">Najprv vyber deň.</div>}

      {datum && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2">
            <input
              type="text"
              placeholder="Miesto"
              value={blok.miesto}
              disabled={!canEdit}
              onChange={(e) => patch({ miesto: e.target.value })}
              className="bg-f-panel border border-f-border rounded-md px-2 py-1.5 text-[12px] text-f-text"
            />
            <input
              type="text"
              placeholder="Počasie"
              value={blok.pocasie}
              disabled={!canEdit}
              onChange={(e) => patch({ pocasie: e.target.value })}
              className="bg-f-panel border border-f-border rounded-md px-2 py-1.5 text-[12px] text-f-text"
            />
          </div>

          <div className="mb-2">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-f-faint">Harmonogram</div>
              {canEdit && <button onClick={pridajRiadok} className="ml-auto text-[10px] font-bold text-f-accent">+ pridať</button>}
            </div>
            <div className="space-y-1">
              {blok.harmonogram.map((h, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="čas"
                    value={h.cas}
                    disabled={!canEdit}
                    onChange={(e) => upravRiadok(i, { cas: e.target.value })}
                    className="w-16 shrink-0 bg-f-panel border border-f-border rounded-md px-1.5 py-1 text-[11.5px] text-f-text font-mono"
                  />
                  <input
                    type="text"
                    placeholder="čo sa deje"
                    value={h.text}
                    disabled={!canEdit}
                    onChange={(e) => upravRiadok(i, { text: e.target.value })}
                    className="min-w-0 grow bg-f-panel border border-f-border rounded-md px-2 py-1 text-[11.5px] text-f-text"
                  />
                  {canEdit && <button onClick={() => zmazRiadok(i)} className="shrink-0 text-f-faint hover:text-f-r text-xs">✕</button>}
                </div>
              ))}
            </div>
          </div>

          <textarea
            placeholder="Poznámky"
            value={blok.poznamky}
            disabled={!canEdit}
            onChange={(e) => patch({ poznamky: e.target.value })}
            rows={2}
            className="w-full bg-f-panel border border-f-border rounded-md px-2 py-1.5 text-[12px] text-f-text mb-2.5"
          />

          {konflikty.length > 0 && (
            <div className="mb-2.5 p-2 rounded-md bg-f-r/10 border border-f-r/50 text-[11px] text-f-text">
              ⚠ V rozpise má na {denText(datum)} nastavené „nemôže“: {konflikty.map((id) => menoZCrew(id)).join(", ")}.
              Appka to nezakazuje (dispo a rozpis sú nezávislé), len na to upozorňuje.
            </div>
          )}

          <div className="mb-2.5">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-f-faint">Skupiny (komu sa to pošle)</div>
              {canEdit && <button onClick={pridajSkupinu} className="ml-auto text-[10px] font-bold text-f-accent">+ skupina</button>}
            </div>
            <div className="space-y-1.5">
              {blok.skupiny.map((s, i) => (
                <div key={i} className="rounded-md bg-f-panel border border-f-border p-2">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <input
                      type="text"
                      placeholder="názov skupiny (napr. Kamery)"
                      value={s.nazov}
                      disabled={!canEdit}
                      onChange={(e) => nazovSkupiny(i, e.target.value)}
                      className="min-w-0 grow bg-f-panel2 border border-f-border rounded-md px-2 py-1 text-[11.5px] text-f-text"
                    />
                    {canEdit && <button onClick={() => zmazSkupinu(i)} className="shrink-0 text-f-faint hover:text-f-r text-xs">✕</button>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(crew || []).map((c) => {
                      const vybrany = s.ludia.includes(c.id);
                      const nedostupny = vybrany && datum && cellOf && cellOf(datum, c.id)?.off;
                      return (
                        <button
                          key={c.id}
                          disabled={!canEdit}
                          onClick={() => prepniVSkupine(i, c.id)}
                          title={nedostupny ? "V rozpise má na tento deň nastavené „nemôže“" : ""}
                          className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium border ${
                            nedostupny
                              ? "bg-f-r/20 text-f-r border-f-r"
                              : vybrany
                                ? "bg-f-accent text-f-ink border-f-accent"
                                : "bg-f-panel2 text-f-faint2 border-f-border"
                          }`}
                        >
                          {nedostupny ? "⚠ " : ""}{c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!blok.skupiny.length && <div className="text-[11px] text-f-faint2">Žiadne skupiny — bez nich nie je komu poslať.</div>}
            </div>
          </div>

          {ludiaVoBloku.length > 0 && (
            <div className="mb-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-f-faint mb-1">Zvýrazniť (napr. skorší zraz)</div>
              <div className="flex flex-wrap gap-1">
                {ludiaVoBloku.map((id) => {
                  const vybrany = blok.zvyraznene.includes(id);
                  return (
                    <button
                      key={id}
                      disabled={!canEdit}
                      onClick={() => prepniZvyraznenie(id)}
                      className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium border ${vybrany ? "bg-f-r text-f-ink border-f-r" : "bg-f-panel2 text-f-faint2 border-f-border"}`}
                    >
                      {menoZCrew(id)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mb-2.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-f-faint block mb-1">Ďalší príjemcovia (mimo databázy kontaktov, oddelené čiarkou)</label>
            <input
              type="text"
              placeholder="napr. externy@firma.sk"
              value={blok.dalsiPrijemcovia}
              disabled={!canEdit}
              onChange={(e) => patch({ dalsiPrijemcovia: e.target.value })}
              className="w-full bg-f-panel border border-f-border rounded-md px-2 py-1.5 text-[12px] text-f-text"
            />
          </div>

          {canEdit && (
            <div className="flex items-center gap-2 flex-wrap mb-2.5">
              <button onClick={handleUlozit} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-f-panel2 text-f-text border border-f-border">
                Uložiť do rozpisu
              </button>
              <button onClick={handleNahlad} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-f-panel2 text-f-text border border-f-border">
                Náhľad mailu
              </button>
            </div>
          )}

          {nahlad === "nacitava" && <div className="text-[11px] text-f-faint2 mb-2">Zostavujem náhľad…</div>}
          {nahlad?.chyba && <div className="text-[11px] text-f-r mb-2">{nahlad.chyba}</div>}
          {nahlad && nahlad !== "nacitava" && !nahlad.chyba && (
            <div className="rounded-md bg-f-panel border border-f-border p-2.5 mb-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-f-faint mb-1">Náhľad — presne takto to pôjde von</div>
              <div className="text-[11.5px] font-bold text-f-text mb-1">{nahlad.subject}</div>
              <div className="text-[11px] text-f-muted2 whitespace-pre-wrap leading-relaxed mb-1.5">{nahlad.text}</div>
              <div className="text-[10px] text-f-faint2">
                {nahlad.prijemcovia?.length
                  ? `Pošle sa na: ${nahlad.prijemcovia.join(", ")}`
                  : "Nikto zo skladby dňa nemá mail v databáze kontaktov — pridaj ďalšieho príjemcu alebo dopíš mail do kontaktov."}
              </div>
              {canEdit && !!nahlad.prijemcovia?.length && (
                <button onClick={handleOdoslat} disabled={odoslane === "posiela"} className="mt-2 px-2.5 py-1 rounded-md text-[11px] font-bold bg-f-a text-f-ink disabled:opacity-50">
                  {odoslane === "posiela" ? "Posielam…" : "Naozaj odoslať mailom"}
                </button>
              )}
              {odoslane?.chyba && <div className="text-[11px] text-f-r mt-1.5">{odoslane.chyba}</div>}
              {odoslane?.ok && <div className="text-[11px] text-f-a mt-1.5">Odoslané na {odoslane.poslaneNa.length} adries.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
