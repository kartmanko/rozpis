import { useEffect, useRef, useState } from "react";

/* Sekcia 8 briefu: "Krátke vtipné hlášky, ktoré sa na hlavnej stránke náhodne
   zobrazujú (na pobavenie)." Vyberie sa JEDNA náhodná hláška pri otvorení
   appky a dá sa zavrieť; appka si nič nepamätá naprieč otvoreniami, pri
   ďalšom otvorení príde iná náhodná. Keď zoznam hlášok je prázdny (ešte nikto
   nič nenapísal), appka jednoducho nič nezobrazí — nič nekričí, nič nespadne.

   Pozor: "hlasky" príde z App.jsx najprv ako prázdne pole (kým sa dáta zo
   servera ešte len načítavajú) a doplní sa až po dokončení load() — TENTO
   komponent sa ale zmontuje skôr (hlavička sa vykresľuje hneď po prihlásení,
   nie až po doplnení dát). Výber preto NESMIE byť naviazaný na samotné
   zmontovanie (napr. useMemo s prázdnymi závislosťami by natrvalo zamrzol na
   pôvodnom prázdnom poli) — musí počkať, kým "hlasky" naozaj niečo obsahuje,
   a vybrať PRESNE RAZ (vybraneRef), nech sa neskôr pri každej zmene zoznamu
   (napr. admin niečo pridá v inom paneli) nevyberala nová hláška pod rukami. */
export default function HlaskaWidget({ hlasky }) {
  const [zatvorene, setZatvorene] = useState(false);
  const [hlaska, setHlaska] = useState(null);
  const vybraneRef = useRef(false);

  useEffect(() => {
    if (vybraneRef.current || !hlasky?.length) return;
    vybraneRef.current = true;
    setHlaska(hlasky[Math.floor(Math.random() * hlasky.length)]);
  }, [hlasky]);

  // Server (ocistiHlasky) sem cez appku nikdy nepustí nič iné než reťazec —
  // ale appka priamo dôveruje iba tomu, čo si sama zapísala. Ktokoľvek s
  // priamym prístupom do KV (mimo appky) vie stav upraviť aj obídením
  // servera; keby sa vtedy do "text" dostal napr. objekt, React by na
  // "{hlaska.text}" spadol — a keďže appka je celá pod jedným ErrorBoundary
  // (main.jsx), zhodilo by to appku úplne pre každého. Preto typeof tu, nie
  // dôvera vlastnému tvaru dát.
  if (!hlaska || zatvorene || typeof hlaska.text !== "string") return null;
  const autor = typeof hlaska.autor === "string" ? hlaska.autor : "";
  return (
    <div className="mt-2 p-2 rounded-lg bg-f-panel2 border border-f-border text-xs text-f-text flex items-start gap-2 no-print">
      <span className="text-sm leading-none shrink-0">💬</span>
      <div className="min-w-0 grow">
        <div className="break-words">{hlaska.text}</div>
        {autor && <div className="text-[10px] text-f-faint mt-0.5">— {autor}</div>}
      </div>
      <button
        onClick={() => setZatvorene(true)}
        title="Zavrieť"
        className="shrink-0 text-f-faint hover:text-f-text px-1 -m-1"
      >
        ✕
      </button>
    </div>
  );
}
