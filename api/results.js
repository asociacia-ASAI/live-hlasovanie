// Serverová funkcia (Vercel): načíta odpovede z Google Sheetu a spočíta ich.
// Nastavenie cez Environment Variables vo Verceli:
//   SHEET_ID   – ID tabuľky s odpoveďami (časť URL medzi /d/ a /edit)
//   SHEET_NAME – (nepovinné) názov hárku, ak nie je prvý v poradí
//   FORM_URL   – odkaz na vyplnenie formulára (z neho sa robí QR kód)
//   TITLE      – (nepovinné) nadpis na stránke
//   PODIUM     – (nepovinné) časť textu bežnej otázky, ktorá sa má zobraziť ako pódium
//                (viac otázok oddeľ čiarkou). Mriežky s poradím (1. miesto, 2. miesto…)
//                sa ako pódium zobrazia automaticky.

const MAX_CHOICES = 12;      // do koľkých rôznych odpovedí berieme otázku ako "výber"
const MAX_TEXT_SHOWN = 30;   // koľko posledných textových odpovedí zobraziť

function cellValue(c) {
  if (!c || c.v === null || c.v === undefined) return "";
  if (typeof c.v === "number") return String(c.v);
  if (typeof c.v === "boolean") return c.v ? "Áno" : "Nie";
  if (typeof c.f === "string" && String(c.v).startsWith("Date(")) return c.f;
  return String(c.v).trim();
}

function count(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  return m;
}

function sortOptions(map) {
  const entries = [...map.entries()];
  const allNumeric = entries.every(([k]) => k !== "" && !isNaN(Number(k)));
  if (allNumeric) entries.sort((a, b) => Number(a[0]) - Number(b[0])); // stupnice 1–5 a pod.
  else entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([label, count]) => ({ label, count }));
}

function podiumMatchers() {
  return (process.env.PODIUM || "")
    .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function markPodium(questions) {
  const m = podiumMatchers();
  questions.forEach((q) => {
    if (q.type !== "text" && m.some((x) => q.title.toLowerCase().includes(x))) q.podium = true;
  });
  return questions;
}

// Jeden stĺpec tabuľky → otázka (výber, zaškrtávanie alebo text)
function analyzeColumn(label, answers) {
  const single = count(answers);
  // Zaškrtávacie políčka: Google ich ukladá ako "A, B, C".
  // Za checkbox považujeme stĺpec, kde sa vyskytujú aspoň 2 rôzne kombinácie s čiarkou,
  // alebo časť kombinácie existuje aj ako samostatná odpoveď.
  const combos = [...single.keys()].filter((k) => k.includes(", "));
  const tokens = (a) => a.split(", ").map((s) => s.trim()).filter(Boolean);
  // Pozor na odpovede, ktoré čiarku obsahujú samy ("Viem, ale nie vždy dodržiavam"):
  // ak časť za čiarkou začína malým písmenom, ide o pokračovanie vety, nie o ďalšiu možnosť.
  const continuesSentence = combos.some((c) => tokens(c).slice(1).some((t) => /^\p{Ll}/u.test(t)));
  // Pri skutočných zaškrtávacích políčkach sa tá istá možnosť objaví vo viacerých odpovediach.
  const seenIn = new Map();
  [...single.keys()].forEach((k) => tokens(k).forEach((t) => seenIn.set(t, (seenIn.get(t) || 0) + 1)));
  const tokenRepeats = [...seenIn.values()].some((n) => n >= 2);
  const standalone = combos.some((c) => tokens(c).some((t) => single.has(t)));
  const looksMulti = !continuesSentence && combos.length > 0 && (standalone || tokenRepeats);
  if (looksMulti) {
    const split = count(answers.flatMap(tokens));
    if (split.size <= MAX_CHOICES + 3) {
      return { title: label, type: "multi", answered: answers.length, options: sortOptions(split) };
    }
  }
  if (single.size <= MAX_CHOICES) {
    return { title: label, type: "choice", answered: answers.length, options: sortOptions(single) };
  }
  return { title: label, type: "text", answered: answers.length, answers: answers.slice(-MAX_TEXT_SHOWN).reverse() };
}

// Poradie z hodnoty bunky: "1.miesto", "1. miesto", "1", "Miesto 2" → 1, 1, 1, 2
const rankOf = (v) => { const m = String(v).match(/\d+/); return m ? Number(m[0]) : null; };

// Mriežka s poradím → body: 1. miesto = najviac bodov (pri 3 miestach 3 / 2 / 1)
function analyzeRanking(title, items, rows) {
  const ranks = items.flatMap((it) => rows.map((r) => rankOf(cellValue(r.c?.[it.i]))).filter((x) => x));
  const maxRank = Math.max(3, ...ranks);
  const options = items.map((it) => {
    let points = 0, firsts = 0, votes = 0;
    rows.forEach((r) => {
      const rk = rankOf(cellValue(r.c?.[it.i]));
      if (!rk) return;
      votes++; points += maxRank + 1 - rk; if (rk === 1) firsts++;
    });
    return { label: it.row, count: points, firsts, votes };
  }).sort((a, b) => b.count - a.count || b.firsts - a.firsts);
  const answered = rows.filter((r) => items.some((it) => cellValue(r.c?.[it.i]) !== "")).length;
  return { title, type: "ranking", podium: true, answered, options };
}

function analyze(cols, rows) {
  // Prvý stĺpec je časová pečiatka formulára – ten nezobrazujeme ako otázku.
  const isTimestamp = (col, i) =>
    i === 0 && (col.type === "datetime" || /pečiatka|timestamp|čas|časové razítko/i.test(col.label || ""));

  // Mriežky: Google ich ukladá ako stĺpce "Otázka [Riadok]" – spojíme ich späť do jednej otázky.
  const groups = [];
  cols.forEach((col, i) => {
    if (isTimestamp(col, i)) return;
    const label = (col.label || "").trim();
    if (!label) return;
    const m = label.match(/^(.*\S)\s*\[([^\]]+)\]\s*$/);
    const last = groups[groups.length - 1];
    if (m && last && last.base === m[1]) last.items.push({ i, row: m[2] });
    else if (m) groups.push({ base: m[1], items: [{ i, row: m[2], label }] });
    else groups.push({ base: null, items: [{ i, label }] });
  });

  const questions = [];
  groups.forEach((g) => {
    const colAnswers = (i) => rows.map((r) => cellValue(r.c?.[i])).filter((v) => v !== "");
    if (g.base && g.items.length >= 2) {
      const values = g.items.flatMap((it) => colAnswers(it.i));
      const isRanking = values.length === 0 || values.every((v) => rankOf(v) !== null && rankOf(v) <= 20);
      if (isRanking) { questions.push(analyzeRanking(g.base, g.items, rows)); return; }
      // Iná mriežka (napr. hodnotenie viacerých vecí) – každý riadok ako samostatný graf
      g.items.forEach((it) => questions.push(analyzeColumn(`${g.base} – ${it.row}`, colAnswers(it.i))));
      return;
    }
    const it = g.items[0];
    questions.push(analyzeColumn(it.label || `${g.base} [${it.row}]`, colAnswers(it.i)));
  });
  return questions;
}

function demoData() {
  const n = 20 + Math.floor((Date.now() / 4000) % 40);
  const pick = (opts) => opts.map((label, i) => ({ label, count: Math.round((n * (opts.length - i)) / (opts.length * 2)) + (i % 2) }));
  return {
    demo: true,
    total: n,
    questions: [
      { title: "Ako sa vám páčila prednáška? (ukážka)", type: "choice", answered: n, options: pick(["5", "4", "3", "2", "1"]).sort((a, b) => Number(a.label) - Number(b.label)) },
      { title: "Používate AI pri učení? (ukážka)", type: "choice", answered: n, options: pick(["Denne", "Raz za týždeň", "Občas", "Nikdy"]) },
      { title: "Ktorý AI nástroj používate najčastejšie? (ukážka)", type: "ranking", answered: n, podium: true,
        options: pick(["ChatGPT", "Claude", "Gemini", "Copilot", "Grok"]).map((o, i) => ({ ...o, count: o.count * 2, firsts: Math.max(0, 9 - i * 3) })) },
      { title: "Ktoré AI nástroje používate? (ukážka)", type: "multi", answered: n, options: pick(["ChatGPT", "Claude", "Gemini", "Copilot", "Iné"]) },
      { title: "Čo si odnášate? (ukážka)", type: "text", answered: 3, answers: ["Že AI nie je strašiak", "Veľa praktických tipov", "Chcem skúsiť vlastného agenta"] },
    ],
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const { SHEET_ID, SHEET_NAME, FORM_URL, TITLE } = process.env;
  const meta = { title: TITLE || "Výsledky hlasovania", formUrl: FORM_URL || "https://docs.google.com/forms/d/1PNP_YbXkEyVMSanOrQ2LeSkm0aPI2YyJ5DByWNWRHyQ/viewform" };

  if (!SHEET_ID) {
    return res.status(200).json({ ...meta, ...demoData(), updatedAt: new Date().toISOString() });
  }

  try {
    let url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEET_ID)}/gviz/tq?tqx=out:json&headers=1`;
    if (SHEET_NAME) url += `&sheet=${encodeURIComponent(SHEET_NAME)}`;
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (!r.ok || start < 0) throw new Error("Tabuľku sa nepodarilo načítať. Je zdieľaná ako „Ktokoľvek s odkazom – Čitateľ“?");
    const data = JSON.parse(text.slice(start, end + 1));
    if (data.status === "error") throw new Error(data.errors?.[0]?.detailed_message || "Chyba pri čítaní tabuľky");

    const cols = data.table.cols || [];
    const rows = (data.table.rows || []).filter((r) => r.c && r.c.some((c) => c && c.v !== null && c.v !== ""));
    return res.status(200).json({
      ...meta,
      total: rows.length,
      questions: markPodium(analyze(cols, rows)),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(200).json({ ...meta, error: e.message, total: 0, questions: [] });
  }
};

module.exports.analyze = analyze;
