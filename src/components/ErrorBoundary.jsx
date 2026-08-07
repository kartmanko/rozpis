import { Component } from "react";

/* Poistka pre nečakanú chybu pri vykresľovaní.
   Appka má na každom mieste, kde niečo posiela na server, poriadne ošetrenú
   chybu — človek vždy vidí, čo sa stalo. Ale keď padne samotné vykresľovanie
   (zle tvarované dáta, chyba v komponente), React bez tejto poistky zhodí
   celú stránku a ostane biela obrazovka bez jediného slova. To je presne to
   ticho, ktorému sa tento projekt inde vyhýba — tak nech aspoň tu appka
   povie, že sa niečo pokazilo, a ponúkne cestu von namiesto mŕtveho displeja. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { chyba: null };
  }

  static getDerivedStateFromError(chyba) {
    return { chyba };
  }

  componentDidCatch(chyba, info) {
    // nech je stopa aspoň v konzole prehliadača, keby si to niekto posielal ako report
    console.error("Appka spadla pri vykresľovaní:", chyba, info?.componentStack);
  }

  render() {
    if (!this.state.chyba) return this.props.children;
    return (
      <div className="min-h-screen bg-f-bg text-f-text font-sans flex items-start justify-center px-4 py-16">
        <div className="w-full max-w-sm text-center">
          <div className="text-lg font-extrabold mb-2">Appka narazila na chybu</div>
          <p className="text-sm text-f-faint leading-relaxed mb-5">
            Niečo sa pri zobrazení pokazilo. Rozpis na serveri je v poriadku — skús to
            znova; keby to nepomohlo, daj vedieť adminovi.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-f-accent hover:brightness-110 text-f-ink transition-colors"
          >
            Skúsiť znova
          </button>
          <div className="text-[11px] font-mono text-f-faint2 mt-5 break-words">
            {String(this.state.chyba?.message || this.state.chyba)}
          </div>
        </div>
      </div>
    );
  }
}
