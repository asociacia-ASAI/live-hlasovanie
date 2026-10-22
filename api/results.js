// Serverová funkcia (Vercel): načíta odpovede z Google Sheetu a spočíta ich.
// Nastavenie cez Environment Variables vo Verceli:
//   SHEET_ID   – ID tabuľky s odpoveďami (časť URL medzi /d/ a /edit)
//   SHEET_NAME – (nepovinné) názov hárku, ak nie je prvý v poradí
//   FORM_URL   – odkaz na vyplnenie formulára (z neho sa robí QR kód)
//   TITLE      – (nepovinné) nadpis na stránke

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

function analyze(cols, rows) {
  // Prvý stĺpec je časová pečiatka formulára – ten nezobrazujeme ako otázku.
  const isTimestamp = (col, i) =>
    i === 0 && (col.type === "datetime" || /pečiatka|timestamp|čas|časové razítko/i.test(col.label || ""));

  const questions = [];
  cols.forEach((col, i) => {
    if (isTimestamp(col, i)) return;
    const label = (col.label || `Otázka ${i}`).trim();
    if (!label) return;
    const answers = rows.map((r) => cellValue(r.c?.[i])).filter((v) => v !== "");

    const single = count(answers);
    // Zaškrtávacie políčka: Google ich ukladá ako "A, B, C".
    // Za checkbox považujeme stĺpec, kde sa vyskytujú aspoň 2 rôzne kombinácie s čiarkou,
    // alebo časť kombinácie existuje aj ako samostatná odpoveď.
    const combos = [...single.keys()].filter((k) => k.includes(", "));
    const tokens = (a) => a.split(", ").map((s) => s.trim()).filter(Boolean);
    const looksMulti = combos.length >= 2 || combos.some((c) => tokens(c).some((t) => single.has(t)));
    if (looksMulti) {
      const split = count(answers.flatMap(tokens));
      if (split.size <= MAX_CHOICES + 3) {
        questions.push({ title: label, type: "multi", answered: answers.length, options: sortOptions(split) });
        return;
      }
    }
    if (single.size <= MAX_CHOICES) {
      questions.push({ title: label, type: "choice", answered: answers.length, options: sortOptions(single) });
      return;
    }
    questions.push({
      title: label,
      type: "text",
      answered: answers.length,
      answers: answers.slice(-MAX_TEXT_SHOWN).reverse(),
    });
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
      questions: analyze(cols, rows),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(200).json({ ...meta, error: e.message, total: 0, questions: [] });
  }
};

module.exports.analyze = analyze;
