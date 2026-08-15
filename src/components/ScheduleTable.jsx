import React, { useEffect, useRef, useState } from "react";
import { cycleInfo, todayIso } from "../dateUtils";
import { REHEARSALS, SK_MONTHS } from "../constants";

const SHIFT_BADGE = {
  A: "bg-f-a",
  B: "bg-f-b",
  C: "bg-f-c",
  R: "bg-f-r",
};

export default function ScheduleTable({ days, crew, cells, cellOf, canEdit, bulkMode, selectedKeys, onCellClick, onDragSelect, onSelectColumn, onSelectRow, onMoveCrew, onDayClick, openDayIso }) {
  const today = todayIso();

  // Mesačný "divider" riadok sa musí prilepiť presne pod hlavičku (mená štábu), ktorej
  // výška nie je pevná (mená sa zalamujú na viac riadkov podľa dĺžky) — preto ju meriame.
  const theadRef = useRef(null);
  const [theadH, setTheadH] = useState(41);
  useEffect(() => {
    const el = theadRef.current;
    if (!el) return;
    const update = () => setTheadH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [crew]);

  /* Prilepený stĺpec "Deň" (112px, w-28) je širší než jeden stĺpec štábu
     (76px, w-[76px]) — bez zarovnania mohol vodorovný scroll (prstom aj
     kolieskom) skončiť kdekoľvek, aj uprostred stĺpca. Taký stĺpec potom bol
     napoly schovaný POD prilepeným stĺpcom: časť mena odrezaná uprostred slova
     a tlačidlo "◀" úplne neviditeľné. Skúšané najprv cez čisté CSS
     (scroll-snap-align na <td>/<th>) — v tabuľke so "border-collapse" sa to
     spoľahlivo nesprávalo (overené priamo v prehliadači), preto ide ručne:
     po tom, čo sa scroll na chvíľu zastaví, sa vodorovná pozícia doskočí na
     najbližšiu hranicu stĺpca. Šírka stĺpca sa meria z DOM-u (nie natvrdo
     zapísané číslo), nech to nepokazí zmena CSS niekde inde. */
  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer = null;
    const doskocNaHranicu = () => {
      const dataTh = el.querySelector("thead th:not(.left-0)");
      const colW = dataTh?.getBoundingClientRect().width;
      if (!colW) return;
      const cielene = Math.min(
        Math.max(Math.round(el.scrollLeft / colW) * colW, 0),
        el.scrollWidth - el.clientWidth
      );
      if (Math.abs(cielene - el.scrollLeft) > 1) el.scrollTo({ left: cielene, behavior: "smooth" });
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(doskocNaHranicu, 120);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [crew]);

  /* --- ťahanie myšou/prstom pre hromadný výber (ako v Exceli) ---
     Myš: ťahanie sa spustí hneď pri stlačení (neruší sa so skrolovaním, to ide cez koliesko).
     Dotyk: ťahanie sa spustí až po PODRŽANÍ (~450ms) bez väčšieho pohybu, nech bežné
     prstové skrolovanie tabuľky nezačne omylom označovať bunky. Pozícia sa počas ťahania
     hľadá cez document.elementFromPoint (nie cez pointerenter) — na dotyk totiž prehliadač
     posiela ďalšie pointermove udalosti stále na pôvodný element, nie na ten pod prstom. */
  const dragRef = useRef({ active: false, startPos: null });
  const longPressRef = useRef(null);
  const suppressClickRef = useRef(false);

  const cellPosFromPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const cellEl = el && el.closest ? el.closest("[data-cell-key]") : null;
    if (!cellEl) return null;
    const [iso, crewId] = cellEl.getAttribute("data-cell-key").split("|");
    return { iso, crewId };
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.active) return;
      e.preventDefault();
      const pos = cellPosFromPoint(e.clientX, e.clientY);
      if (!pos) return;
      dragRef.current.moved = true;
      onDragSelect && onDragSelect(dragRef.current.startPos, pos);
    };
    const onUp = () => {
      if (dragRef.current.active && dragRef.current.moved) {
        suppressClickRef.current = true;
        setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
      dragRef.current = { active: false, startPos: null };
      clearTimeout(longPressRef.current);
    };
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDragSelect]);

  const handleCellPointerDown = (pos, e) => {
    if (!bulkMode || !canEdit) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) return; // tie rieši bežný klik (rozsah / pridanie)
    clearTimeout(longPressRef.current);
    if (e.pointerType === "touch") {
      const startX = e.clientX, startY = e.clientY;
      const armDrag = () => {
        dragRef.current = { active: true, startPos: pos, moved: false };
        onDragSelect && onDragSelect(pos, pos);
        if (navigator.vibrate) navigator.vibrate(12);
        document.removeEventListener("pointermove", cancelIfMoved);
      };
      const cancelIfMoved = (ev) => {
        if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) {
          clearTimeout(longPressRef.current);
          document.removeEventListener("pointermove", cancelIfMoved);
        }
      };
      longPressRef.current = setTimeout(armDrag, 450);
      document.addEventListener("pointermove", cancelIfMoved, { passive: true });
    } else {
      dragRef.current = { active: true, startPos: pos, moved: false };
    }
  };

  const handleCellClick = (pos, e) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    canEdit && onCellClick(pos, e);
  };

  return (
    // Skutočne ohraničená výška (.schedule-scroll, pozri index.css) — bez nej by tento
    // div nikdy sám neskroloval (obsah by ho len naťahoval) a "position: sticky" hlavička
    // by sa vizuálne strácala mimo obrazovky namiesto toho, aby zostala prilepená navrchu.
    <div ref={scrollRef} className="schedule-scroll overflow-auto bg-f-bg">
      <table className="border-collapse text-sm w-full font-sans table-fixed">
        {/* Poznámka: "position: sticky" sa dáva priamo na <th> bunky, nie na <thead> —
            sticky na table-header-group nefunguje spoľahlivo vo všetkých prehliadačoch. */}
        <thead ref={theadRef}>
          <tr>
            {/* Stĺpec s dátumom ostáva prilepený vľavo aj pri rolovaní do strán.
                Čiara vpravo je tam schválne — bez nej sa mená štábu pri rolovaní
                „zalamovali“ tesne k dátumu a vyzeralo to ako rozbitá tabuľka. */}
            {/* Čiara vpravo je samostatný prúžok, nie border ani tieň — v tabuľke so
                zlúčenými okrajmi (border-collapse) prehliadač okraj ani tieň prilepenej
                bunky nevykreslí. Bez tej čiary sa pri rolovaní do strán mená štábu
                zarezávali tesne k dátumu a vyzeralo to ako rozsypaná tabuľka. */}
            <th className="sticky top-0 left-0 z-40 bg-f-bg border-b border-f-border2 px-2 py-2.5 text-left w-28 text-[10px] font-bold uppercase tracking-wider text-f-muted2">
              Deň
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-f-border2" />
            </th>
            {crew.map((c, i) => (
              <th
                key={c.id}
                onClick={bulkMode && canEdit ? (e) => onSelectColumn && onSelectColumn(c.id, e) : undefined}
                title={bulkMode && canEdit ? "Klik označí celý stĺpec (Shift/Ctrl = pridať k výberu)" : undefined}
                className={`sticky top-0 z-30 bg-f-bg border-b border-f-border2 px-1 py-2.5 w-[76px] align-bottom text-[10px] font-bold uppercase tracking-wider text-f-muted2 ${bulkMode && canEdit ? "cursor-pointer hover:brightness-125" : ""}`}
              >
                <div className="leading-tight break-words normal-case tracking-normal">{c.name}</div>
                {canEdit && !bulkMode && (
                  <div className="flex justify-center gap-1 mt-1 no-print">
                    <button onClick={() => onMoveCrew(c.id, -1)} className="text-f-faint hover:text-f-text px-1">◀</button>
                    <button onClick={() => onMoveCrew(c.id, 1)} className="text-f-faint hover:text-f-text px-1">▶</button>
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d, idx) => {
            const ci = cycleInfo(d.iso);
            const reh = REHEARSALS.includes(d.iso);
            const newMonth = idx === 0 || days[idx - 1].month !== d.month;
            const isToday = d.iso === today;
            const isOpenDay = d.iso === openDayIso;
            return (
              <React.Fragment key={d.iso}>
                {newMonth && (
                  <tr className="sticky z-20" style={{ top: theadH }}>
                    <td colSpan={crew.length + 1} className="bg-f-panel border-b border-f-hair px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-f-faint">
                      {/* Názov mesiaca drží pri ľavom okraji — inak by pri rolovaní
                          do strán odišiel mimo obrazovky a z pásu ostal prázdny prúžok. */}
                      <span className="sticky left-3.5 inline-block">{SK_MONTHS[d.month]} 2026</span>
                    </td>
                  </tr>
                )}
                <tr
                  data-iso={d.iso}
                  className={isToday ? "bg-f-today" : ci.fifth ? "bg-f-fifthbg" : ""}
                >
                  <td
                    onClick={(e) => {
                      if (bulkMode && canEdit) { onSelectRow && onSelectRow(d.iso, e); return; }
                      onDayClick && onDayClick(d.iso);
                    }}
                    // Bez tabIndex/onKeyDown sa k tomuto riadku (a k celej tabuľke nižšie)
                    // nedalo dostať iba klávesnicou — Tab preskočil rovno z hlavičky na
                    // "DNES" a deň sa nedal otvoriť ani označiť bez myši/dotyku.
                    tabIndex={onDayClick || bulkMode ? 0 : undefined}
                    role={onDayClick || bulkMode ? "button" : undefined}
                    aria-label={onDayClick || bulkMode ? `${d.day}.${d.month + 1}. ${d.dow}` : undefined}
                    onKeyDown={(e) => {
                      if (!(onDayClick || bulkMode)) return;
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      if (bulkMode && canEdit) { onSelectRow && onSelectRow(d.iso, e); return; }
                      onDayClick && onDayClick(d.iso);
                    }}
                    title={bulkMode && canEdit ? "Klik označí celý riadok (Shift/Ctrl = pridať k výberu)" : undefined}
                    className={`sticky left-0 z-10 border-b border-f-hair px-2 h-8 font-mono text-[11px] whitespace-nowrap ${onDayClick || bulkMode ? "cursor-pointer hover:brightness-125" : ""} ${isToday ? "bg-f-today" : ci.fifth ? "bg-f-fifthbg" : "bg-f-bg"}`}
                  >
                    {/* oranžový prúžok vľavo = práve otvorený deň */}
                    {isOpenDay && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-f-accent" />}
                    <span className={reh ? "text-f-reh" : isToday ? "text-f-a font-bold" : ci.fifth ? "text-f-r font-semibold" : "text-f-text/90"}>
                      {d.day}.{d.month + 1}. {d.dow}
                    </span>
                    <span className="ml-1 text-[9.5px] text-f-faint2">{reh ? "SKÚŠKY" : ci.n ? `${ci.n}/${ci.pos}` : ""}</span>
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-f-border2" />
                  </td>
                  {crew.map((c) => {
                    const x = cellOf(d.iso, c.id);
                    const bad = x.off && (x.shift || x.duel);
                    const k = d.iso + "|" + c.id;
                    const selected = bulkMode && selectedKeys?.has(k);
                    return (
                      <td
                        key={c.id}
                        data-cell-key={k}
                        onPointerDown={(e) => handleCellPointerDown({ iso: d.iso, crewId: c.id }, e)}
                        onClick={(e) => handleCellClick({ iso: d.iso, crewId: c.id }, e)}
                        // Rovnaká poistka ako pri bunke "Deň" vyššie — bez tabIndex/onKeyDown sa
                        // do tejto bunky (hlavná plocha na úpravu rozpisu) nedalo dostať iba
                        // klávesnicou vôbec. Enter/Medzera otvoria to isté, čo bežný klik —
                        // ťahanie/hromadný výber myšou/dotykom (onPointerDown vyššie) tým nie je
                        // nahradené, iba jednoduché otvorenie editora bunky.
                        tabIndex={canEdit ? 0 : undefined}
                        role={canEdit ? "button" : undefined}
                        aria-label={canEdit ? `${c.name}, ${d.day}.${d.month + 1}. ${d.dow}${x.off ? ", nemôže" : ""}${x.shift ? `, smena ${x.shift}` : ""}${x.duel ? ", Duel" : ""}` : undefined}
                        onKeyDown={(e) => {
                          if (!canEdit) return;
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          handleCellClick({ iso: d.iso, crewId: c.id }, e);
                        }}
                        className={`relative border-b border-f-hair h-8 text-center select-none ${canEdit ? "cursor-pointer hover:brightness-125" : ""} ${isToday ? "bg-f-today" : ci.fifth ? "bg-f-fifthbg" : ""} ${bad ? "ring-2 ring-inset ring-red-500/70" : ""} ${selected ? "ring-2 ring-inset ring-f-accent bg-f-accent/10" : ""}`}
                      >
                        {selected && <span className="absolute top-0 right-0 text-[9px] leading-none bg-f-accent text-f-ink font-bold px-1 rounded-bl">✓</span>}
                        <div className="flex flex-col items-center justify-center gap-0.5 leading-none">
                          {x.shift && (
                            <span className={`inline-block min-w-[22px] font-mono text-xs font-bold text-f-ink rounded px-1 py-0.5 ${SHIFT_BADGE[x.shift] || "bg-f-a"}`}>{x.shift}</span>
                          )}
                          {x.duel && (
                            <span className="inline-block min-w-[34px] font-mono text-[9px] font-bold text-f-ink bg-f-duel rounded px-1 py-0.5 tracking-wide">DUEL</span>
                          )}
                          {x.off && !x.shift && !x.duel && <span className="text-f-accent text-base font-bold leading-none">×</span>}
                          {Number(x.nadcas) > 0 && (
                            <span title="Nahlásený nadčas" className="inline-block font-mono text-[9px] font-bold text-f-muted2 border border-f-border rounded px-1 py-0.5">
                              +{Number(x.nadcas)}h
                            </span>
                          )}
                          {x.note && <span className="text-[10px] text-f-muted truncate max-w-[70px]">{x.note}</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="sticky left-0 bg-f-panel border-t border-f-border2 px-2 py-1.5 text-[10px] uppercase tracking-wide text-f-faint">
              Počet smien
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-f-border2" />
            </td>
            {crew.map((c) => {
              const n = Object.entries(cells).filter(([k, v]) => k.endsWith("|" + c.id) && v.shift).length;
              return <td key={c.id} className="bg-f-panel border-t border-f-border2 px-1 py-1.5 text-center font-mono text-xs text-f-muted">{n}</td>;
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
