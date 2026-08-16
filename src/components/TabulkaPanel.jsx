import { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import { analyzujTabulku, zostavNavrh, popisBunky } from "../tabulkaImport";
import { skDate } from "../dateUtils";

/* Import existujúcej tabuľky (XLSX / CSV).

   Ide to v troch krokoch a v žiadnom z nich sa nič nezapisuje samo:
   1. vyber súbor (a hárok, keď ich je viac),
   2. skontroluj, ktorý stĺpec je kto — appka mená tipne, admin ich opraví,
   3. pozri prehľad zmien a až potom klikni „Zapísať do rozpisu".

   Prázdna bunka v súbore nikdy nič nezmaže a už vyplnená bunka v appke sa
   prepíše iba vtedy, keď sa dole zapne „prepisovať aj vyplnené". */

export default function TabulkaPanel({ crew, cells, dovolene, onZapis, onClose, setStatus, onRegisterCloseGuard }) {
  const [nazovSuboru, setNazovSuboru] = useState("");
  const [harky, setHarky] = useState([]); // { nazov, aoa }
  const [harok, setHarok] = useState(0);
  const [orientacia, setOrientacia] = useState("auto");
  const [priradenie, setPriradenie] = useState({}); // index stĺpca -> crewId
  const [prepisovat, setPrepisovat] = useState(false);
  const [chyba, setChyba] = useState("");

  const nacitaj = async (file) => {
    setChyba("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const zoznam = wb.SheetNames.map((n) => ({
        nazov: n,
        aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }),
      })).filter((h) => h.aoa.length);
      if (!zoznam.length) {
        setChyba("V súbore nie je žiadny vyplnený hárok.");
        return;
      }
      setNazovSuboru(file.name);
      setHarky(zoznam);
      setHarok(0);
      setOrientacia("auto");
      setPriradenie({});
    } catch (e) {
      setChyba("Súbor sa nepodarilo prečítať: " + e.message);
    }
  };

  // Tip appky nesmie sám priradiť stĺpec niekomu z cudzej sekcie.
  const povoleny = useMemo(() => crew.filter((c) => (dovolene || []).includes(c.id)), [crew, dovolene]);

  const rozbor = useMemo(() => {
    const h = harky[harok];
    if (!h) return null;
    return analyzujTabulku(h.aoa, { orientacia, crew: povoleny });
  }, [harky, harok, orientacia, povoleny]);

  /* Tip appky sa použije len ako východisko — čo admin prepne, má prednosť. */
  const aktualnePriradenie = useMemo(() => {
    if (!rozbor) return {};
    const out = {};
    rozbor.osoby.forEach((o) => {
      const rucne = priradenie[o.c];
      out[o.c] = rucne === undefined ? o.crewId : rucne;
    });
    return out;
  }, [rozbor, priradenie]);

  const navrh = useMemo(() => {
    if (!rozbor) return { zmeny: [] };
    return zostavNavrh({
      mriezka: rozbor.mriezka,
      riadky: rozbor.riadky,
      priradenie: aktualnePriradenie,
      cells,
      dovolene,
    });
  }, [rozbor, aktualnePriradenie, cells, dovolene]);

  const nove = navrh.zmeny.filter((z) => z.druh === "nova");
  const zmenene = navrh.zmeny.filter((z) => z.druh === "zmena");
  const rovnake = navrh.zmeny.length - nove.length - zmenene.length;
  const naZapis = prepisovat ? [...nove, ...zmenene] : nove;
  const nepriradene = rozbor ? rozbor.osoby.filter((o) => !aktualnePriradenie[o.c]).length : 0;

  /* Keď sú dva rôzne stĺpce priradené tomu istému človeku (zdvojený stĺpec v
     zdrojovej tabuľke, alebo si to admin pomýlil pri ručnom priraďovaní), obe
     bunky pre ten istý deň mieria na to isté miesto v "cells" — druhá by ticho
     prepísala prvú a "Vyplní sa N buniek" by navyše počítalo obe, hoci napokon
     zostane iba jedna. Bez tohto varovania by o tom admin nemal ako vedieť. */
  const duplicitneOsoby = useMemo(() => {
    if (!rozbor) return [];
    const podlaId = {};
    rozbor.osoby.forEach((o) => {
      const id = aktualnePriradenie[o.c];
      if (id) (podlaId[id] || (podlaId[id] = [])).push(o.hlavicka);
    });
    return Object.entries(podlaId).filter(([, hlavicky]) => hlavicky.length > 1);
  }, [rozbor, aktualnePriradenie]);

  const menoOsoby = (id) => crew.find((c) => c.id === id)?.name || "?";

  const zapis = () => {
    if (!naZapis.length) return;
    onZapis(naZapis, {
      subor: nazovSuboru,
      harok: harky[harok]?.nazov || "",
      nove: nove.length,
      prepisane: prepisovat ? zmenene.length : 0,
    });
    setStatus(`Z tabuľky zapísaných ${naZapis.length} buniek.`);
    onClose();
  };

  // Načítaný súbor a jeho rozobraté priradenie stĺpcov ("harky") je rozostavaná
  // práca — kým sa nezapíše, zavretím sa zahodí a treba súbor nahrať a priradiť
  // znova. Pomenované inak než "zmenene" vyššie (to je pole navrhovaných zmien
  // BUNIEK, nie príznak "má tento panel rozostavané niečo").
  const maNaacitanySubor = harky.length > 0;

  const handleZavriet = () => {
    if (maNaacitanySubor && !confirm("Zavrieť? Zahodí to načítanú tabuľku, ktorú si ešte nezapísal(a) do rozpisu.")) return;
    onClose();
  };

  // Viď zhodný komentár v UsersPanel.jsx — bez tejto registrácie by Escape aj
  // prepnutie na iný panel z menu obišli otázku vyššie.
  useEffect(() => {
    if (!onRegisterCloseGuard) return;
    onRegisterCloseGuard(() => !maNaacitanySubor || confirm("Zavrieť? Zahodí to načítanú tabuľku, ktorú si ešte nezapísal(a) do rozpisu."));
    return () => onRegisterCloseGuard(null);
  }, [maNaacitanySubor, onRegisterCloseGuard]);

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Import tabuľky (XLSX / CSV)</div>
        <div className="grow" />
        <button onClick={handleZavriet} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2 py-1.5 -m-1.5">Zavrieť</button>
      </div>

      <input
        type="file"
        accept=".xlsx,.xls,.csv,text/csv"
        onChange={(e) => e.target.files?.[0] && nacitaj(e.target.files[0])}
        className="text-sm text-f-muted"
      />
      {chyba && <div className="text-sm text-f-accent mt-2">{chyba}</div>}

      {rozbor && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-xs text-f-faint">
            {harky.length > 1 && (
              <label>
                Hárok:{" "}
                <select value={harok} onChange={(e) => { setHarok(Number(e.target.value)); setPriradenie({}); }} className="bg-f-panel2 border border-f-border rounded-lg px-2 py-1 text-f-text">
                  {harky.map((h, i) => <option key={i} value={i}>{h.nazov}</option>)}
                </select>
              </label>
            )}
            <label>
              Tabuľka je otočená:{" "}
              <select value={orientacia} onChange={(e) => { setOrientacia(e.target.value); setPriradenie({}); }} className="bg-f-panel2 border border-f-border rounded-lg px-2 py-1 text-f-text">
                <option value="auto">automaticky ({rozbor.orientacia === "osoby-riadky" ? "ľudia v riadkoch" : "ľudia v stĺpcoch"})</option>
                <option value="osoby-stlpce">ľudia v stĺpcoch, dátumy pod sebou</option>
                <option value="osoby-riadky">ľudia v riadkoch, dátumy vedľa seba</option>
              </select>
            </label>
          </div>

          <div className="text-xs text-f-muted2">
            Našiel som {rozbor.riadky.length} dní zo sezóny a {rozbor.osoby.length} stĺpcov s menami.
            {rozbor.mimoSezonu > 0 && ` ${rozbor.mimoSezonu} dní je mimo sezóny — tie preskakujem.`}
          </div>

          {!rozbor.riadky.length && (
            <div className="text-sm text-f-accent">
              V tomto hárku nevidím dátumy zo sezóny. Skús iný hárok alebo prepni otočenie tabuľky.
            </div>
          )}

          {rozbor.osoby.length > 0 && (
            <div className="space-y-1.5">
              {nepriradene > 0 && <div className="text-xs text-f-r">Pri {nepriradene} stĺpcoch neviem, o koho ide — vyber osobu alebo nechaj nepriradené (preskočí sa).</div>}
              {duplicitneOsoby.length > 0 && (
                <div className="text-xs text-f-r">
                  Viac stĺpcov je priradených tej istej osobe ({duplicitneOsoby.map(([, hlavicky]) => hlavicky.join(" + ")).join(", ")}) —
                  oprav priradenie nižšie, inak by jeden stĺpec ticho prepísal druhý.
                </div>
              )}
              {rozbor.osoby.map((o) => (
                <div key={o.c} className="flex gap-2 items-center flex-wrap border border-f-border rounded-lg px-2 py-1.5 bg-f-panel2">
                  <div className="text-xs grow min-w-32 text-f-text font-semibold">{o.hlavicka}</div>
                  <select
                    value={aktualnePriradenie[o.c] || ""}
                    onChange={(e) => setPriradenie((p) => ({ ...p, [o.c]: e.target.value }))}
                    className={`px-2 py-1 rounded-lg text-sm border ${aktualnePriradenie[o.c] ? "bg-f-panel2 border-f-border text-f-text" : "bg-f-r/20 border-f-r text-f-r"}`}
                  >
                    <option value="">— kto to je? —</option>
                    {povoleny.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {navrh.zmeny.length > 0 && (
            <div className="border border-f-border rounded-lg p-2.5 bg-f-panel2 space-y-2">
              <div className="text-xs text-f-text">
                Vyplní sa <b className="text-f-a">{nove.length}</b> prázdnych buniek.
                {zmenene.length > 0 && <> Iný obsah než v appke má <b className="text-f-r">{zmenene.length}</b> buniek.</>}
                {rovnake > 0 && <> {rovnake} buniek je rovnakých ako teraz.</>}
              </div>

              {zmenene.length > 0 && (
                <label className="flex items-start gap-2 text-xs text-f-muted">
                  <input type="checkbox" checked={prepisovat} onChange={(e) => setPrepisovat(e.target.checked)} className="mt-0.5" />
                  <span>
                    Prepísať aj bunky, ktoré už v appke niečo majú ({zmenene.length}). Bez zaškrtnutia sa vyplnia iba prázdne.
                  </span>
                </label>
              )}

              {prepisovat && zmenene.length > 0 && (
                <div className="max-h-40 overflow-auto text-[11px] font-mono text-f-muted2 space-y-0.5">
                  {zmenene.slice(0, 60).map((z, i) => (
                    <div key={i}>
                      {skDate(z.iso)} {menoOsoby(z.crewId)}: <span className="text-f-r">{popisBunky(z.stara)}</span> → <span className="text-f-a">{popisBunky(z.nova)}</span>
                    </div>
                  ))}
                  {zmenene.length > 60 && <div>… a ďalších {zmenene.length - 60}</div>}
                </div>
              )}

              <button
                onClick={zapis}
                disabled={!naZapis.length || duplicitneOsoby.length > 0}
                title={duplicitneOsoby.length > 0 ? "Najprv oprav priradenie — dva stĺpce mieria na tú istú osobu." : ""}
                className="px-3 py-1.5 rounded-lg text-sm font-bold bg-f-a text-f-ink hover:brightness-110 transition-colors disabled:opacity-40"
              >
                Zapísať do rozpisu ({naZapis.length})
              </button>
            </div>
          )}

          {rozbor.riadky.length > 0 && navrh.zmeny.length === 0 && (
            <div className="text-sm text-f-muted">Zatiaľ niet čo zapísať — priraď stĺpce k ľuďom.</div>
          )}
        </div>
      )}
    </div>
  );
}
