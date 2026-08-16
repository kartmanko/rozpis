import { popisPocasia, casNaHHMM } from "../pocasie";
import { todayIso } from "../dateUtils";

/* Sekcia 7 briefu: "Na hlavnej stránke: počasie na daný deň + východ a západ
   slnka." Kompaktný prvok v hlavičke, klik otvorí týždennú predpoveď (panel
   "pocasie"). Kým sa počasie ešte nenačítalo (alebo sa nepodarilo), appka sa
   naň jednoducho nezobrazí — nič nepadá, nič nekričí. */
export default function PocasieWidget({ pocasie, onOpen }) {
  const dnes = (pocasie?.dni || []).find((d) => d.datum === todayIso());
  if (!dnes) return null;
  const p = popisPocasia(dnes.kod);
  return (
    <button
      onClick={onOpen}
      title={`${p.text} · ↑${casNaHHMM(dnes.vychod)} ↓${casNaHHMM(dnes.zapad)}`}
      className="flex items-center gap-1 px-2 h-8 rounded-md border border-f-border bg-f-panel text-f-muted hover:text-f-text text-xs font-mono shrink-0"
    >
      <span className="text-base leading-none">{p.ikona}</span>
      <span className="font-bold text-f-text">{dnes.tMax ?? "—"}°</span>
    </button>
  );
}
