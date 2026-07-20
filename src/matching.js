/* ---------- párovanie mien z chatu ---------- */
// Po NFD normalizácii sa diakritika oddelí ako samostatné "combining mark" znaky
// (Unicode kategória M) — tie tu odstránime cez Unicode property escape,
// nech to nezávisí od konkrétnych kódových bodov.
export const norm = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const phoneKey = (s) => {
  const d = (s || "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : "";
};

export function guessCrew(crew, sender, phone) {
  const pk = phoneKey(phone);
  if (pk) {
    const byPhone = crew.find((c) => c.aliases.some((a) => phoneKey(a) === pk));
    if (byPhone) return byPhone.id;
  }
  const ns = norm(sender);
  if (!ns) return "";
  const exact = crew.find((c) => norm(c.name) === ns || c.aliases.some((a) => norm(a) === ns));
  if (exact) return exact.id;
  const toks = ns.split(" ").filter((t) => t.length > 2);
  if (toks.length) {
    const cand = crew.filter((c) => toks.every((t) => norm(c.name).includes(t)));
    if (cand.length === 1) return cand[0].id;
  }
  return "";
}
