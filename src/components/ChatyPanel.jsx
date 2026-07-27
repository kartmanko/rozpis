import { useEffect, useState } from "react";
import { fetchBridges, fetchBridgeToken, noveBridgeToken } from "../api";

/* Sledované WhatsApp chaty a stav čítačiek (Fáza 3).

   Ako to funguje: bridge je malá služba mimo Cloudflare, ktorá je prihlásená
   do WhatsAppu tým istým číslom ako eSIM v telefóne. Iba číta — nikdy nič
   nikam nenapíše. Bridge sa raz za minútu ohlási serveru a pošle zoznam skupín,
   ktoré vidí. Nová skupina sa sem zapíše VYPNUTÁ. Kým ju tu niekto nezapne,
   z tej skupiny sa nečíta vôbec nič. */

function odvtedy(iso) {
  if (!iso) return "nikdy";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return "pred chvíľou";
  if (s < 3600) return `pred ${Math.round(s / 60)} min`;
  if (s < 86400) return `pred ${Math.round(s / 3600)} h`;
  return `pred ${Math.round(s / 86400)} dňami`;
}

// bridge, ktorý sa neozval 5 minút, považujeme za spadnutý (hlási sa každú minútu)
const ZIVY_LIMIT_MS = 5 * 60 * 1000;

function StavBridgeov({ bridges, chyba }) {
  if (chyba) return <div className="text-[11px] text-f-accent mb-3">Stav čítačiek sa nepodarilo načítať: {chyba}</div>;

  if (!bridges.length) {
    return (
      <div className="border border-f-border rounded-lg p-2.5 mb-3 bg-f-panel2">
        <div className="text-xs font-bold text-f-text mb-1">Žiadna čítačka nebeží</div>
        <div className="text-[11px] text-f-faint2 leading-relaxed">
          Zatiaľ sa neozvala ani jedna čítačka WhatsAppu, takže sa nič nenačítava.
          Návod na spustenie je v repozitári v priečinku <span className="font-mono">bridge</span>.
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="text-[10px] font-extrabold uppercase tracking-widest text-f-faint mb-1.5">Čítačky WhatsAppu</div>
      <div className="space-y-1.5">
        {bridges.map((b) => {
          const zivy = b.poslednyKrat && Date.now() - new Date(b.poslednyKrat).getTime() < ZIVY_LIMIT_MS;
          return (
            <div key={b.id} className="flex items-center gap-2 border border-f-border rounded-lg p-2 bg-f-panel2">
              {/* zelená = číta, žltá = žije, ale ešte nie je prepojená s WhatsAppom */}
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  !zivy ? "bg-f-r" : b.stav === "beží" ? "bg-f-a" : "bg-f-c"
                }`}
              />
              <span className="text-xs font-bold text-f-text">{b.id}</span>
              {b.cislo && <span className="text-[11px] font-mono text-f-muted2">{b.cislo}</span>}
              <span className="ml-auto text-[11px] text-f-faint2">
                {!zivy ? "neozvala sa" : b.stav === "beží" ? "beží" : b.stav || "beží"} ·{" "}
                {odvtedy(b.poslednyKrat)}
              </span>
            </div>
          );
        })}
      </div>
      {bridges.length === 1 && (
        <div className="text-[11px] text-f-faint2 mt-1.5">
          Beží iba jedna čítačka. Druhá (napríklad na naske) je záloha — keď jedna vypadne,
          správy sa nestratia. Nie je povinná.
        </div>
      )}
    </div>
  );
}

/* Prepojenie čítačky s WhatsAppom priamo odtiaľto.

   Načo to je: čítačka sa musí raz prihlásiť do WhatsAppu a WhatsApp na to chce
   buď osemznakový kód, alebo QR. Oboje si doteraz vypisovala iba do svojich logov —
   čo znamenalo liezť do Dockeru na naske a čítať log kontajnera. Teraz to isté
   posiela serveru a je to vidieť tu. QR býva spoľahlivejšie než prepisovanie kódu:
   túto stránku otvor na počítači a naskenuj ju telefónom, v ktorom je eSIM.

   Vidieť to smie iba admin a vedúci — kto má QR, prepojí si vlastné zariadenie.
   Server to ostatným ani neposiela. */
function QrObrazok({ text }) {
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let zive = true;
    if (!text) { setSvg(""); return undefined; }
    // knižnicu ťaháme až keď je naozaj treba — pri bežnom používaní appky nikdy
    import("qrcode-generator")
      .then(({ default: qrcode }) => {
        if (!zive) return;
        const q = qrcode(0, "L");
        q.addData(text);
        q.make();
        setSvg(q.createSvgTag({ cellSize: 5, margin: 2 }));
      })
      .catch(() => { if (zive) setSvg(""); });
    return () => { zive = false; };
  }, [text]);

  if (!svg) return null;
  return (
    <div
      className="bg-white p-2 rounded-md inline-block [&>svg]:block"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function Parovanie({ bridges, canEdit }) {
  if (!canEdit) return null;

  // zaujímajú nás iba čítačky, ktoré sa ozvali a ešte nie sú prepojené
  const caka = bridges.filter(
    (b) => b.stav !== "beží" && (b.qr || b.kodParovania || b.chyba || b.waVerzia),
  );
  if (!caka.length) return null;

  return (
    <div className="border border-f-accent rounded-lg p-2.5 mb-3 bg-f-panel2">
      <div className="text-[10px] font-extrabold uppercase tracking-widest text-f-accent mb-1.5">
        Prepojenie s WhatsAppom
      </div>
      {caka.map((b) => (
        <div key={b.id} className="mb-2 last:mb-0">
          <div className="text-xs font-bold text-f-text mb-1">
            Čítačka <span className="font-mono">{b.id}</span> čaká na prepojenie
          </div>

          {b.kodParovania && (
            <div className="mb-2">
              <div className="text-[11px] text-f-faint2 mb-1 leading-relaxed">
                Prepíš tento kód v telefóne: WhatsApp → Nastavenia → Prepojené zariadenia
                → Prepojiť zariadenie → <b>Prepojiť pomocou telefónneho čísla</b>.
              </div>
              <div className="font-mono text-lg font-extrabold tracking-widest text-f-text select-all">
                {b.kodParovania}
              </div>
              <div className="text-[11px] text-f-faint2">
                Platí necelé tri minúty. Keď vyprší, o chvíľu sa tu sám objaví nový.
              </div>
            </div>
          )}

          {b.qr && (
            <div className="mb-2">
              <div className="text-[11px] text-f-faint2 mb-1 leading-relaxed">
                Alebo to naskenuj telefónom (WhatsApp → Prepojené zariadenia →
                Prepojiť zariadenie). Keď kód neberie, QR býva spoľahlivejšie.
              </div>
              <QrObrazok text={b.qr} />
            </div>
          )}

          {b.chyba && <div className="text-[11px] text-f-accent">{b.chyba}</div>}
          {b.waVerzia && (
            <div className="text-[11px] text-f-faint2">
              verzia WhatsApp Webu: <span className="font-mono">{b.waVerzia}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* Kód pre čítačku. Je to tajomstvo, tak sa nezobrazuje samo od seba — treba naň
   kliknúť. Zámerne je tu aj tlačidlo na výmenu: keby sa kód niekam zatúlal,
   nech sa dá vymeniť z appky a nie cez wrangler alebo dashboard. */
function KodCitacky({ canEdit }) {
  const [kod, setKod] = useState("");
  const [ajSecret, setAjSecret] = useState(false);
  const [otvorene, setOtvorene] = useState(false);
  const [pracuje, setPracuje] = useState(false);
  const [hlaska, setHlaska] = useState("");

  if (!canEdit) return null;

  const nacitaj = async () => {
    setPracuje(true);
    setHlaska("");
    try {
      const d = await fetchBridgeToken();
      setKod(d.kod || "");
      setAjSecret(!!d.aj_secret);
      setOtvorene(true);
    } catch (e) {
      setHlaska(e.message);
    }
    setPracuje(false);
  };

  const vymen = async () => {
    if (!window.confirm("Vyrobiť nový kód? Čítačky, ktoré bežia so starým, sa hneď prestanú ozývať a treba im vpísať nový.")) return;
    setPracuje(true);
    setHlaska("");
    try {
      const d = await noveBridgeToken();
      setKod(d.kod || "");
      setHlaska("Nový kód je hotový — vpíš ho čítačkám.");
    } catch (e) {
      setHlaska(e.message);
    }
    setPracuje(false);
  };

  const skopiruj = async () => {
    try {
      await navigator.clipboard.writeText(kod);
      setHlaska("Skopírované.");
    } catch {
      setHlaska("Skopírovať sa nepodarilo — označ to prstom a skopíruj ručne.");
    }
  };

  return (
    <div className="border border-f-border rounded-lg p-2.5 mb-3 bg-f-panel2">
      <div className="text-[10px] font-extrabold uppercase tracking-widest text-f-faint mb-1.5">Kód pre čítačku</div>
      {!otvorene ? (
        <>
          <div className="text-[11px] text-f-faint2 leading-relaxed mb-2">
            Týmto kódom sa čítačka preukazuje serveru. Vpíše sa jej raz pri spustení
            (premenná <span className="font-mono">HOOK_SECRET</span>).
          </div>
          <button
            onClick={nacitaj}
            disabled={pracuje}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-f-panel hover:bg-f-border text-f-muted disabled:opacity-60"
          >
            {pracuje ? "Načítavam…" : "Ukázať kód"}
          </button>
        </>
      ) : (
        <>
          <div className="font-mono text-[11px] break-all bg-f-panel border border-f-border rounded-md p-2 mb-2 text-f-text select-all">
            {kod}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={skopiruj} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-f-a text-f-ink">Skopírovať</button>
            <button onClick={() => setOtvorene(false)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-f-panel hover:bg-f-border text-f-muted">Skryť</button>
            <button onClick={vymen} disabled={pracuje} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-f-panel hover:bg-f-border text-f-muted disabled:opacity-60">
              Vymeniť za nový
            </button>
          </div>
          {ajSecret && (
            <div className="text-[11px] text-f-faint2 mt-2 leading-relaxed">
              Pozor: na serveri je nastavené aj staré tajomstvo cez Cloudflare
              (<span className="font-mono">HOOK_SECRET</span>). Platí súčasne s týmto kódom, takže
              čítačke stačí ktorékoľvek z nich.
            </div>
          )}
        </>
      )}
      {hlaska && <div className="text-[11px] text-f-accent mt-2">{hlaska}</div>}
    </div>
  );
}

export default function ChatyPanel({ chaty, canEdit, onSetChat, onClose }) {
  const [bridges, setBridges] = useState([]);
  const [chyba, setChyba] = useState("");

  /* Kým sa niektorá čítačka páruje, pýtame sa servera každých päť sekúnd —
     QR sa vo WhatsAppe točí a párovací kód platí necelé tri minúty, takže na
     polminútovom obnovovaní by sa ukazovalo niečo, čo už neplatí. Keď je všetko
     prepojené, stačí raz za pol minúty. */
  const caka = bridges.some((b) => b.stav !== "beží");

  useEffect(() => {
    let zive = true;
    const nacitaj = async () => {
      try {
        const d = await fetchBridges();
        if (zive) { setBridges(d.bridges || []); setChyba(""); }
      } catch (e) {
        if (zive) setChyba(e.message);
      }
    };
    nacitaj();
    const t = setInterval(nacitaj, caka ? 5000 : 30000);
    return () => { zive = false; clearInterval(t); };
  }, [caka]);

  const zoznam = Object.values(chaty || {}).sort((a, b) => {
    if (!!a.povoleny !== !!b.povoleny) return a.povoleny ? -1 : 1;
    return String(a.nazov || "").localeCompare(String(b.nazov || ""), "sk");
  });

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">WhatsApp — chaty a čítačky</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>

      <StavBridgeov bridges={bridges} chyba={chyba} />

      <Parovanie bridges={bridges} canEdit={canEdit} />

      <KodCitacky canEdit={canEdit} />

      <div className="text-[10px] font-extrabold uppercase tracking-widest text-f-faint mb-1.5">Skupiny</div>
      <div className="text-[11px] text-f-faint2 mb-2 leading-relaxed">
        Zapni iba tie skupiny, z ktorých sa má čítať. Z vypnutých sa nečíta nič.
        Pri zapnutej skupine sa dá vybrať, čo sa v nej hľadá:
        <b> Dostupnosť</b> — kto ktorý deň nemôže (smeny sa z WhatsAppu nikdy nedopĺňajú, iba červená), alebo
        <b> Reporty</b> — denné reporty réžie, kde sa text vôbec nerozoberá a hľadá sa v ňom iba deň.
      </div>

      {!zoznam.length && (
        <div className="text-sm text-f-faint">
          Zatiaľ tu nie je žiadna skupina. Objavia sa samy, keď sa čítačka pripojí k WhatsAppu.
        </div>
      )}

      <div className="space-y-1.5">
        {zoznam.map((c) => (
          <div key={c.id} className="flex items-center gap-2 border border-f-border rounded-lg p-2 bg-f-panel2 flex-wrap">
            <div className="min-w-0 grow">
              <div className="text-xs font-bold text-f-text truncate">{c.nazov || "(bez názvu)"}</div>
              <div className="text-[10px] text-f-faint2 font-mono truncate">{c.id}</div>
              {c.poslednaSprava && (
                <div className="text-[10px] text-f-faint2">posledná správa {odvtedy(c.poslednaSprava)}</div>
              )}
            </div>
            {canEdit ? (
              <button
                /* "rozhodnute" = niekto sa k skupine vedome vyjadril. Kým sa nikto
                   nevyjadrí, skupina svieti v menu ako nová a čaká na rozhodnutie. */
                onClick={() => onSetChat(c.id, { povoleny: !c.povoleny, rozhodnute: true })}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shrink-0 ${
                  c.povoleny ? "bg-f-a text-f-ink" : "bg-f-panel hover:bg-f-border text-f-muted"
                }`}
              >
                {c.povoleny ? "Číta sa" : "Vypnuté"}
              </button>
            ) : (
              <span className={`px-2 py-1 rounded-lg text-[11px] font-bold shrink-0 ${c.povoleny ? "text-f-a" : "text-f-faint2"}`}>
                {c.povoleny ? "Číta sa" : "Vypnuté"}
              </span>
            )}

            {/* Druh skupiny (Fáza 4). Má zmysel iba pri zapnutej skupine — pri vypnutej
                sa aj tak nečíta nič, tak by prepínač len mátol. */}
            {c.povoleny && (
              <div className="w-full flex gap-1">
                {[
                  { k: "dostupnost", l: "Dostupnosť" },
                  { k: "report", l: "Reporty" },
                ].map((d) => {
                  const aktivny = (c.druh || "dostupnost") === d.k;
                  return (
                    <button
                      key={d.k}
                      disabled={!canEdit}
                      onClick={() => onSetChat(c.id, { druh: d.k })}
                      className={`flex-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors disabled:opacity-60 ${
                        aktivny ? "bg-f-accent text-f-ink" : "bg-f-panel text-f-muted hover:bg-f-border"
                      }`}
                    >
                      {d.l}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {!canEdit && (
        <div className="text-[11px] text-f-faint2 mt-2">Iba na prezeranie — zapínať chaty smú vedúci a hlavný admin.</div>
      )}
    </div>
  );
}
