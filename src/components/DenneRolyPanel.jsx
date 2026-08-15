import { useEffect, useMemo, useState } from "react";
import { skDate } from "../dateUtils";

/* Denné role (sekcia 4 finálneho briefu).

   Na rozdiel od uzávierok (UzavierkyPanel) toto NIE JE história udalostí — je to
   jeden záznam na deň: kto je v ten deň hlavný režisér a kto sú Story produceri.
   Priradí to admin, admin réžie alebo admin produkcie (caps.denneRoly, viď
   permissions.js) — kamera panel ani nevidí. Druhé uloženie pre ten istý deň
   predchádzajúce priradenie prepíše, presné to isté pravidlo drží aj server
   (ocistiDenneRoly vo worker/src/index.js). */

export default function DenneRolyPanel({ denneRoly, crew, days, canEdit, onUloz, onClose, onRegisterCloseGuard }) {
  const [vybranyIso, setVybranyIso] = useState(days[0]?.iso || "");

  const zaznam = useMemo(
    () => (denneRoly || []).find((d) => d.iso === vybranyIso) || null,
    [denneRoly, vybranyIso],
  );

  // Uložený záznam môže obsahovať id človeka, ktorého medzitým vymazali zo
  // Štábu (CrewPanel maže len "crew", o denných rolách nevie). Bez tohto
  // filtra by taký "mŕtvy" id ostal v "reziser"/"storyProduceri" ticho ležať —
  // <select>/tlačidlá nižšie preň nemajú možnosť/tlačidlo (crew.map), takže by
  // sa v nich nedal ani vidieť, ani zrušiť, a pri hocijakom ďalšom uložení by
  // sa ticho zapísal znova, hoci formulár navonok ukazuje "— nikto —".
  const platnyReziser = (id) => ((id && (crew || []).some((c) => c.id === id)) ? id : "");
  const platniProduceri = (ids) => (ids || []).filter((id) => (crew || []).some((c) => c.id === id));

  const [reziser, setReziser] = useState(platnyReziser(zaznam?.reziser));
  const [storyProduceri, setStoryProduceri] = useState(platniProduceri(zaznam?.storyProduceri));
  const [nacitanyIso, setNacitanyIso] = useState(vybranyIso);

  // pri zmene dňa sa formulár predvyplní z už uloženého záznamu (ak existuje) —
  // robí sa to takto (nie useEffect), nech pri zmene dňa nepríde k zbytočnému
  // prekresleniu formulára ešte pred tým, než sa dá zistiť, čo je vybrané
  if (nacitanyIso !== vybranyIso) {
    setNacitanyIso(vybranyIso);
    setReziser(platnyReziser(zaznam?.reziser));
    setStoryProduceri(platniProduceri(zaznam?.storyProduceri));
  }

  const menoZCrew = (id) => (crew || []).find((c) => c.id === id)?.name || id;

  const prepniStoryProducenta = (id) => {
    setStoryProduceri((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const zmenene = reziser !== (zaznam?.reziser || "")
    || storyProduceri.length !== (zaznam?.storyProduceri || []).length
    || storyProduceri.some((id) => !(zaznam?.storyProduceri || []).includes(id));

  const handleUloz = () => {
    onUloz(vybranyIso, { reziser: reziser || null, storyProduceri });
  };

  const handleZavriet = () => {
    if (zmenene && !confirm("Zavrieť? Zahodí to zmenu, ktorú si ešte neuložil(a).")) return;
    onClose();
  };

  // Viď zhodný komentár v UsersPanel.jsx — bez tejto registrácie by Escape aj
  // prepnutie na iný panel z menu obišli otázku vyššie a rozostavanú zmenu
  // ticho zahodili.
  useEffect(() => {
    if (!onRegisterCloseGuard) return;
    onRegisterCloseGuard(() => !zmenene || confirm("Zavrieť? Zahodí to zmenu, ktorú si ešte neuložil(a)."));
    return () => onRegisterCloseGuard(null);
  }, [zmenene, onRegisterCloseGuard]);

  return (
    <div data-testid="denne-roly-panel" className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Denné role</div>
        <div className="grow" />
        <button onClick={handleZavriet} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2 py-1.5 -m-1.5">Zavrieť</button>
      </div>

      <div className="text-[11px] text-f-faint2 mb-2.5 leading-relaxed">
        Kto je v daný deň hlavný režisér a kto Story produceri — jeden záznam na deň,
        opätovné uloženie predchádzajúce priradenie prepíše.
      </div>

      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <label className="text-[10px] font-bold uppercase tracking-wider text-f-faint">Deň</label>
        <select
          value={vybranyIso}
          onChange={(e) => setVybranyIso(e.target.value)}
          className="bg-f-panel border border-f-border rounded-md px-2 py-1 text-xs text-f-text"
        >
          {days.map((d) => (
            <option key={d.iso} value={d.iso}>{skDate(d.iso)} {d.dow}</option>
          ))}
        </select>
      </div>

      {!vybranyIso && <div className="text-sm text-f-faint">Zatiaľ nie je z čoho vyberať.</div>}

      {vybranyIso && (
        <div className="rounded-md bg-f-panel border border-f-border p-2.5 mb-3">
          <div className="mb-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-f-faint mb-1">Režisér dňa</div>
            {canEdit ? (
              <select
                value={reziser}
                onChange={(e) => setReziser(e.target.value)}
                className="bg-f-panel2 border border-f-border rounded-md px-2 py-1.5 text-xs text-f-text w-full max-w-xs"
              >
                <option value="">— nikto —</option>
                {(crew || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <div className="text-xs text-f-text">{zaznam?.reziser ? menoZCrew(zaznam.reziser) : "— nikto —"}</div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-f-faint">Story produceri dňa</div>
              <span className="text-[10px] text-f-faint2">
                {canEdit ? storyProduceri.length : (zaznam?.storyProduceri || []).length} vybraných
              </span>
            </div>
            {canEdit ? (
              <div className="flex flex-wrap gap-1">
                {(crew || []).map((c) => {
                  const vybrany = storyProduceri.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => prepniStoryProducenta(c.id)}
                      className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium border ${
                        vybrany ? "bg-f-accent text-f-ink border-f-accent" : "bg-f-panel2 text-f-faint2 border-f-border"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-f-text">
                {(zaznam?.storyProduceri || []).length
                  ? (zaznam.storyProduceri || []).map(menoZCrew).join(", ")
                  : "— nikto —"}
              </div>
            )}
          </div>

          {canEdit && (
            <button
              onClick={handleUloz}
              disabled={!zmenene}
              className="mt-2.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-f-a text-f-ink disabled:opacity-40"
            >
              Uložiť
            </button>
          )}
        </div>
      )}

      {!canEdit && (
        <div className="text-[11px] text-f-faint2 mt-2.5">Iba na čítanie — denné role smie prideľovať iba admin, réžia alebo produkcia.</div>
      )}
    </div>
  );
}
