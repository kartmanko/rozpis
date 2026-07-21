const OPTIONS = [
  {
    id: "light",
    label: "Svetlý",
    icon: (
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    id: "dark",
    label: "Tmavý",
    icon: (
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
      </svg>
    ),
  },
  {
    id: "system",
    label: "Auto",
    icon: (
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
];

export default function ThemeToggle({ theme, onChange }) {
  return (
    <div className="flex items-center rounded-lg bg-f-panel2 border border-f-border p-0.5 gap-0.5 no-print">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          title={o.label}
          onClick={() => onChange(o.id)}
          className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
            theme === o.id
              ? "bg-f-accent text-f-ink"
              : "text-f-faint hover:text-f-text"
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
