export default function Legend({ className, label }) {
  return (
    <span className="flex items-center gap-1.5 text-f-muted2">
      <span className={`inline-block w-3 h-3 rounded ${className}`} />
      {label}
    </span>
  );
}
