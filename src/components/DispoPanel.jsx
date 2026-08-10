import { useMemo, useState } from "react";
import { toUTC } from "../dateUtils";
import { SK_DAYS_FULL } from "../constants";
import { telOdkaz } from "../kontakty";

/* Dispo maily (Fáza 5).

   Dispozícia na natáčací deň chodí mailom. Server ju prečíta, ale NIČ neprepíše —
   uloží ju sem ako návrh. Až keď to tu niekto potvrdí, harmonogram sa zapíše ku dňu
   a vybrané zmeny smien do rozpisu. Preto sú tu všade zaškrtávacie políčka: potvrdzuje
   sa iba to, čo je zaškrtnuté, nikdy nie celý mail naslepo.

   Keď server človeka z mailu nevie priradiť ku konkrétnemu členovi štábu (crewId je
   null), zmena sa nedá zaškrtnúť, kým sa v rozbaľovacom zozname nevyberie, o koho ide.
   Zle priradená smena je horšia než žiadna. */

/** "2026-08-15" -> "sobota 15.8.2026" */
function denText(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "bez dňa";
  const d = new Date(toUTC(iso));
  if (Number.isNaN(d.getTime())) return "bez dňa";
  return `${SK_DAYS_FULL[d.getUTCDay()].toLowerCase()} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}

function popisZmeny(z) {
  if (z.nemoze) return "v ten deň nie je";
  if (z.smena) return `smena ${z.smena}`;
  return "neurčité";
}

export default function DispoPanel({ pendingDispo, dispo, crew, canEdit, onPotvrd, onZahod, onZrusPotvrdene, onClose }) {
  const fronta = pendingDispo || [];
  const [otvoreny, setOtvoreny] = useState(fronta[0]?.id || null);
  // id návrhu -> { datum, harmonogram: bool, zmeny: { index: crewId|"" }, vybrane: Set-like objekt }
  const [uprava, setUprava] = useState({});

  const potvrdene = useMemo(
    () => Object.values(dispo || {}).sort((a, b) => String(b.datum).localeCompare(String(a.datum))),
    [dispo],
  );

  /* Má návrh vôbec nejaké info ku dňu — harmonogram, miesto, počasie, poznámky
     alebo kontakty? Bez toho nemá zmysel ponúkať zaškrtávacie políčko. */
  const maInfo = (n) => (n.harmonogram || []).length > 0 || !!n.miesto || !!n.pocasie || !!n.poznamky || (n.kontakty || []).length > 0;

  /* Východzí stav zaškrtnutia pre jeden návrh. Zaškrtnuté je iba to, čomu appka
     rozumie: info ku dňu (keď nejaké je) a tie zmeny, pri ktorých si je istá, o koho
     ide. Zvyšok musí človek doklikať sám. */
  const vychodzi = (n) => ({
    datum: n.datum,
    info: maInfo(n),
    zmeny: Object.fromEntries(
      (n.zmeny || []).map((z, i) => [i, z.crewId ? { vybrane: true, crewId: z.crewId } : { vybrane: false, crewId: "" }]),
    ),
  });

  const stav = (n) => uprava[n.id] || vychodzi(n);
  const uprav = (n, patch) => setUprava((p) => ({ ...p, [n.id]: { ...(p[n.id] || vychodzi(n)), ...patch } }));

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Dispo</div>
        <span className="text-[11px] text-f-faint2 font-mono">{fronta.length}</span>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>

      <div className="text-[11px] text-f-faint2 mb-2.5 leading-relaxed">
        Dispozície chodia mailom. Appka ich iba prečíta a navrhne — do rozpisu sa nič nezapíše,
        kým to tu nepotvrdíš.
      </div>

      {!fronta.length && (
        <div className="text-sm text-f-faint leading-relaxed">Žiadne nepotvrdené dispo.</div>
      )}

      <div className="space-y-1.5">
        {fronta.map((n) => {
          const rozbaleny = otvoreny === n.id;
          const s = stav(n);
          return (
            <div key={n.id} className="border border-f-border rounded-lg bg-f-panel2 overflow-hidden">
              <button onClick={() => setOtvoreny(rozbaleny ? null : n.id)} className="w-full text-left p-2 flex items-start gap-2">
                <div className="min-w-0 grow">
                  <div className="text-xs font-bold text-f-text">
                    {denText(s.datum)}
                    {!n.datumZTextu && <span className="ml-1.5 text-[10px] font-normal text-f-accent">dátum podľa dňa doručenia</span>}
                  </div>
                  <div className="text-[10px] text-f-faint2 truncate">{n.predmet || "(bez predmetu)"} · {n.od || "neznámy odosielateľ"}</div>
                  <div className="text-[10px] text-f-muted2 mt-0.5">
                    {n.precitane
                      ? `${(n.harmonogram || []).length} položiek harmonogramu · ${(n.zmeny || []).length} zmien v obsadení`
                      : "mail sa nepodarilo rozobrať — je tu len text"}
                  </div>
                  {n.precitane && (n.miesto || n.pocasie || (n.kontakty || []).length > 0) && (
                    <div className="text-[10px] text-f-accent mt-0.5">
                      {[n.miesto, n.pocasie, (n.kontakty || []).length ? `${n.kontakty.length} kontaktov` : ""].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <span className="text-f-faint text-xs shrink-0 pt-0.5">{rozbaleny ? "▲" : "▼"}</span>
              </button>

              {rozbaleny && (
                <div className="px-2 pb-2 border-t border-f-hair pt-2">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-f-faint">Deň</label>
                    <input
                      type="date"
                      value={s.datum || ""}
                      disabled={!canEdit}
                      onChange={(e) => uprav(n, { datum: e.target.value })}
                      className="bg-f-panel border border-f-border rounded-md px-2 py-1 text-xs text-f-text"
                    />
                  </div>

                  {maInfo(n) && (
                    <div className="mb-2">
                      <label className="flex items-center gap-2 text-[11px] font-bold text-f-text mb-1">
                        <input
                          type="checkbox"
                          checked={!!s.info}
                          disabled={!canEdit}
                          onChange={(e) => uprav(n, { info: e.target.checked })}
                        />
                        {(n.harmonogram || []).length > 0 ? "Zapísať info ku dňu (aj harmonogram)" : "Zapísať info ku dňu"}
                      </label>

                      {(n.miesto || n.pocasie) && (
                        <div className="rounded-md bg-f-panel border border-f-border p-2 mb-1.5 space-y-0.5">
                          {n.miesto && (
                            <div className="text-[11.5px] text-f-text"><span className="text-f-faint2">Miesto: </span>{n.miesto}</div>
                          )}
                          {n.pocasie && (
                            <div className="text-[11.5px] text-f-text"><span className="text-f-faint2">Počasie: </span>{n.pocasie}</div>
                          )}
                        </div>
                      )}

                      {(n.harmonogram || []).length > 0 && (
                        <div className="rounded-md bg-f-panel border border-f-border p-2 space-y-0.5 mb-1.5">
                          {n.harmonogram.map((h, i) => (
                            <div key={i} className="text-[11.5px] text-f-text flex gap-2">
                              <span className="font-mono text-f-accent shrink-0">{h.cas}</span>
                              <span className="min-w-0">{h.text}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {n.poznamky && (
                        <div className="text-[11.5px] text-f-muted2 mb-1.5 whitespace-pre-wrap">{n.poznamky}</div>
                      )}

                      {(n.kontakty || []).length > 0 && (
                        <div className="rounded-md bg-f-panel border border-f-border p-2 space-y-1">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-f-faint">Kontakty na produkciu</div>
                          {n.kontakty.map((k, i) => {
                            const tel = telOdkaz(k.telefon);
                            return (
                              <div key={i} className="text-[11.5px] text-f-text flex flex-wrap gap-x-1.5">
                                <span className="font-bold">{k.meno}</span>
                                {k.rola && <span className="text-f-faint2">({k.rola})</span>}
                                {tel ? (
                                  <a href={tel} className="text-f-accent font-mono" onClick={(e) => e.stopPropagation()}>{k.telefon}</a>
                                ) : (
                                  k.telefon && <span className="text-f-faint2 font-mono">{k.telefon}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {(n.zmeny || []).length > 0 && (
                    <div className="mb-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-f-faint mb-1">Zmeny v obsadení</div>
                      <div className="space-y-1">
                        {n.zmeny.map((z, i) => {
                          const zs = s.zmeny?.[i] || { vybrane: false, crewId: "" };
                          return (
                            <div key={i} className="flex items-center gap-2 flex-wrap rounded-md bg-f-panel border border-f-border px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={!!zs.vybrane}
                                disabled={!canEdit || !zs.crewId}
                                onChange={(e) => uprav(n, { zmeny: { ...s.zmeny, [i]: { ...zs, vybrane: e.target.checked } } })}
                              />
                              <div className="min-w-0">
                                <div className="text-[11.5px] font-bold text-f-text">{z.meno || "(bez mena)"}</div>
                                <div className="text-[10px] text-f-faint2">{popisZmeny(z)}{z.dovod ? ` — ${z.dovod}` : ""}</div>
                              </div>
                              {!z.crewId && (
                                <select
                                  value={zs.crewId || ""}
                                  disabled={!canEdit}
                                  onChange={(e) => uprav(n, { zmeny: { ...s.zmeny, [i]: { crewId: e.target.value, vybrane: !!e.target.value } } })}
                                  className="ml-auto bg-f-panel2 border border-f-border rounded-md px-1.5 py-1 text-[11px] text-f-text"
                                >
                                  <option value="">kto to je?</option>
                                  {(crew || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <details className="mb-2">
                    <summary className="text-[10px] font-bold uppercase tracking-wider text-f-faint cursor-pointer">Celý mail</summary>
                    <div className="text-[11.5px] text-f-muted2 whitespace-pre-wrap leading-relaxed mt-1">{n.text}</div>
                  </details>

                  {canEdit && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => { onPotvrd(n, s); setOtvoreny(null); setUprava((p) => { const o = { ...p }; delete o[n.id]; return o; }); }}
                        className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-f-a text-f-ink"
                      >
                        Potvrdiť
                      </button>
                      <button
                        onClick={() => { if (confirm("Zahodiť toto dispo?")) { onZahod(n.id); setOtvoreny(null); } }}
                        className="ml-auto px-2.5 py-1 rounded-md text-[11px] font-bold bg-f-panel hover:bg-f-r hover:text-f-ink text-f-muted"
                      >
                        Zahodiť
                      </button>
                    </div>
                  )}
                  {!canEdit && (
                    <div className="text-[11px] text-f-faint2">Iba na čítanie — dispo smú potvrdiť vedúci a hlavný admin.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {potvrdene.length > 0 && (
        <div className="mt-3.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-f-faint mb-1">Potvrdené dispozície</div>
          <div className="space-y-1">
            {potvrdene.map((d) => (
              <div key={d.datum} className="flex items-center gap-2 rounded-md bg-f-panel2 border border-f-border px-2 py-1.5">
                <div className="text-[11.5px] text-f-text">{denText(d.datum)}</div>
                <div className="text-[10px] text-f-faint2">{(d.harmonogram || []).length} položiek{d.miesto ? ` · ${d.miesto}` : ""}</div>
                {canEdit && (
                  <button
                    onClick={() => { if (confirm("Zmazať potvrdenú dispozíciu na tento deň?")) onZrusPotvrdene(d.datum); }}
                    className="ml-auto text-[10px] font-bold uppercase tracking-wider text-f-faint hover:text-f-r"
                  >
                    Zmazať
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
