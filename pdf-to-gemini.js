import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";
import readline from "readline";

const gharuandaVillages = [
  "Mahmadpur", "Nabipur", "Khirajpur", "Nali Khurd", "Nasirpur", "Nali Kalan",
  "Nali Paar", "Dabarki Khurd", "Dabarki Kalan", "Dabarki Paar", "Mustafabad",
  "Dhak Wala Rodan", "Dhak Wala Gujran", "Mohidinpur", "Chundipur",
  "Rasulpur Kalan", "Sarafabad", "Subhari", "Kalvehdi", "Phushgarh",
  "Rajivpuram", "Vikas Nagar", "New DC Colony", "Durga Colony", "Uttam Nagar",
  "Chhapra Kheda", "Chhapra Jagir", "Rasulpur Khurd", "Suhana", "Shekhpura",
  "Nagla Farm", "Margen", "Nagla Megha", "Amritpur Khurd", "Manglaura",
  "Dilwara", "Andhera", "Amritpur Kalan", "Karwali", "Ganjogarhi", "Piplwali",
  "Rawar", "Uncha Samana", "Madhuban / Ashok Vihar Colony", "Kambopura",
  "Daha", "Madanpur", "Sirsi", "Bajida Jattan", "Ghoghdipur", "Pingli",
  "Taharpur", "Bhusli", "Samalkha", "Jhivarhedi", "Kharkali", "Kutel",
  "Mubarakabad", "Kalro", "Faizlipur Majra", "Lalupura", "Pir Badoli",
  "Sadarpur", "Tarpur", "Bharatpur", "Bassi Akbarpur", "Malikpur Gadyan",
  "Chaura", "Araipura", "Gyanpura", "Bastada", "Hasanpur", "Rasin", "Bijna",
  "Satodi", "Phurlak", "Upli", "Gharaunda", "Malikpur Phatak Paar", "Panodi",
  "Jamalpur", "Garhi Khajur", "Prem Nagar", "Mundigarhi", "Barsat",
  "Abadi Sanjay Nagar", "Kalhedi", "Digar Majra", "Raipur Jattan",
  "Badshahpur", "Gagsina", "Shahjahanpur", "Khorakhedi", "Begampur",
  "Shekhpura Khalsa", "Gudha", "Abadi Dera Phula Singh", "Kohand", "Kaimla",
  "Garhi Multan", "Alipur Khalsa", "Harisinghpura", "Pundri", "Faridpur",
  "Balheda", "Garhi Bharal", "Abadi Devipur",
];

const EXTRACT_MODE = (process.env.EXTRACT_MODE || "gemini").toLowerCase();
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:latest";
const PDF_DPI = Number(process.env.PDF_DPI || 200);

let apiKey = null;
if (EXTRACT_MODE === "gemini") {
  apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY not set in env");
    process.exit(1);
  }
} else if (EXTRACT_MODE !== "ollama") {
  console.error(`Unknown EXTRACT_MODE: ${EXTRACT_MODE} (expected gemini|ollama)`);
  process.exit(1);
}

const PDF_PATH = process.argv[2];
if (!PDF_PATH) {
  console.error("Usage: node pdf-to-gemini.js <path-to-pdf>");
  process.exit(1);
}
const resolvedPath = path.resolve(PDF_PATH);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}
const fileName = path.basename(resolvedPath);
const pdfId = fileName.replace(/\.pdf$/i, "");

const OUT_DIR = path.resolve("output");
fs.mkdirSync(OUT_DIR, { recursive: true });
const MAPPING_PATH = path.join(OUT_DIR, "village-booth-mapping.json");
const REVIEW_PATH = path.join(OUT_DIR, "pending-review.json");
const CITIZENS_PATH = path.join(OUT_DIR, `citizens-${pdfId}.json`);

const readJson = (p, dflt) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : dflt);
const writeJson = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));

const PAGE1_PROMPT = `
You are reading the FIRST page of an Indian electoral roll PDF (Haryana, Karnal district, Vidhan Sabha 22-Gharaunda).

Return ONLY this JSON, no markdown:

{
  "district": "<English>",
  "constituency": "<number>-<English name>",
  "bhag_sankhya": "<string>",
  "booth": {
    "id": "<number>",
    "name": "<English name of polling station>",
    "building": "<English building name + address>"
  },
  "mukhya_gaav": "<English>",
  "anubhags": [
    {
      "raw": "<exact Devanagari text as it appears>",
      "matched_village": "<canonical English from the list below, or null>",
      "confidence": "high | medium | low"
    }
  ]
}

Canonical village list (matched_village MUST be EXACTLY one of these strings, or null):
${JSON.stringify(gharuandaVillages)}

Rules:
- "anubhags" = every entry from section 2 "भाग में अनुभागों की संख्या व नाम". Put each entry verbatim into "raw".
- An anubhag can be a colony, ward, "ग्राम-X", "X ब्लाक नं.1", etc. Strip the noise and snap to the canonical village.
- "matched_village" is null if no reasonable match exists.
- Transliterate Devanagari → English for English fields (e.g. मोहम्मदपुर → Mahmadpur).
`;

const PAGE_PROMPT = (pageNumber, anubhagMap) => `
Extract voter records from this single PDF page (page ${pageNumber}).

Anubhag map (page 1, user-confirmed):
${JSON.stringify(anubhagMap)}

Return ONLY this JSON, no markdown. Use SHORT keys exactly as shown:

{
  "pa": "<exact anubhag string from page header, or null>",
  "um": "<set ONLY if pa not a key in map above, else omit>",
  "v": [
    {"s":<int serial>,"i":"<voterId top-right e.g. IOX1412089>","n":"<name English>","r":"<relative name English>","l":"F|H|M|O","g":"M|F","a":<int age>,"h":"<house #, '0' if missing>"}
  ]
}

Field key legend (do NOT use long names):
- s=serial, i=voterId, n=name, r=relative_name, l=relation, g=gender, a=age, h=houseNumber
- l: F=Father, H=Husband, M=Mother, O=Other
- g: M=male (पुरुष), F=female (महिला)

Rules:
- Read page header "अनुभागों की संख्या व नाम <X>". <X> applies to every voter on the page.
- If <X> not in map: return {"v":[],"pa":"<X>","um":"<X>"}. Do NOT guess.
- If page has no voter cards (cover, naksha, summary): return {"v":[]}.
- पिता→F, पति→H, माता→M. Transliterate Devanagari names to English.
- Leave the user block which have a DELETED Stamp on it.
`;

async function extractPageAsBase64(pdfBytes, pageIndex) {
  const srcPdf = await PDFDocument.load(pdfBytes);
  const newPdf = await PDFDocument.create();
  const [page] = await newPdf.copyPages(srcPdf, [pageIndex]);
  newPdf.addPage(page);
  const bytes = await newPdf.save();
  return Buffer.from(bytes).toString("base64");
}

async function callGemini(model, base64Pdf, promptText) {
  const result = await model.generateContent([
    { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
    promptText,
  ]);
  return JSON.parse(result.response.text());
}

async function callOllama(base64Png, promptText) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: promptText,
      images: [base64Png],
      format: "json",
      stream: false,
      options: { temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.response);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a.trim()); }));
}

async function main() {
  const pdfBytes = fs.readFileSync(resolvedPath);
  const srcPdf = await PDFDocument.load(pdfBytes);
  const totalPages = srcPdf.getPageCount();
  console.error(`[${pdfId}] ${totalPages} pages  (mode=${EXTRACT_MODE})\n`);

  let prepPage;
  let callModel;

  if (EXTRACT_MODE === "gemini") {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      generationConfig: { responseMimeType: "application/json" },
    });
    prepPage = (i) => extractPageAsBase64(pdfBytes, i);
    callModel = (b64, prompt) => callGemini(model, b64, prompt);
  } else {
    console.error(`Rendering ${totalPages} pages → PNG @ ${PDF_DPI} DPI for Ollama...`);
    const { pdf } = await import("pdf-to-img");
    const doc = await pdf(pdfBytes, { scale: PDF_DPI / 72 });
    const pngs = [];
    for await (const img of doc) pngs.push(img.toString("base64"));
    prepPage = async (i) => pngs[i];
    callModel = (b64, prompt) => callOllama(b64, prompt);
  }

  // ============ PHASE 1: page 1 → anubhag/village/booth ============
  console.error(`=== Phase 1: extracting page 1 ===`);
  const page1Base64 = await prepPage(0);
  const meta = await callModel(page1Base64, PAGE1_PROMPT);

  console.error(`\nDistrict     : ${meta.district}`);
  console.error(`Constituency : ${meta.constituency}`);
  console.error(`Bhag sankhya : ${meta.bhag_sankhya}`);
  console.error(`Booth        : ${meta.booth.id} - ${meta.booth.name}`);
  console.error(`Building     : ${meta.booth.building}`);
  console.error(`Mukhya gaav  : ${meta.mukhya_gaav}`);
  console.error(`\nAnubhag → village mapping:`);
  for (const a of meta.anubhags) {
    const tick = a.matched_village ? "✓" : "✗";
    console.error(`  ${tick} "${a.raw}"  →  ${a.matched_village ?? "UNMATCHED"} [${a.confidence}]`);
  }

  const unmatched = meta.anubhags.filter((a) => !a.matched_village);
  if (unmatched.length > 0) {
    console.error(`\n${unmatched.length} unmatched anubhag(s). Logged to ${REVIEW_PATH}`);
    const review = readJson(REVIEW_PATH, {});
    review[pdfId] = {
      timestamp: new Date().toISOString(),
      booth: meta.booth,
      unmatched: unmatched.map((a) => a.raw),
      all_anubhags: meta.anubhags,
    };
    writeJson(REVIEW_PATH, review);
  }

  const ans = await ask(`\nProceed to phase 2 with this mapping? [y/N] `);
  if (ans.toLowerCase() !== "y") {
    console.error("Aborted before phase 2.");
    return;
  }

  const boothLabel = `${meta.booth.id}-${meta.booth.name}`;
  const anubhagMap = {};
  for (const a of meta.anubhags) {
    if (a.matched_village) anubhagMap[a.raw] = a.matched_village;
  }

  // merge into persistent village → booth map
  const mapping = readJson(MAPPING_PATH, {});
  for (const a of meta.anubhags) {
    if (!a.matched_village) continue;
    const v = a.matched_village;
    if (!mapping[v]) mapping[v] = [];
    let entry = mapping[v].find((e) => e.pdf === pdfId);
    if (!entry) {
      entry = { booth: boothLabel, pdf: pdfId, anubhags: [] };
      mapping[v].push(entry);
    }
    if (!entry.anubhags.includes(a.raw)) entry.anubhags.push(a.raw);
  }
  writeJson(MAPPING_PATH, mapping);
  console.error(`Updated ${MAPPING_PATH}`);

  // ============ PHASE 2: voter pages (skip page 2 = naksha) ============
  console.error(`\n=== Phase 2: extracting voters page-by-page ===`);
  const citizens = {
    pdf: pdfId,
    district: meta.district,
    constituency: meta.constituency,
    booth: boothLabel,
    booth_building: meta.booth.building,
    mukhya_gaav: meta.mukhya_gaav,
    anubhag_to_village: anubhagMap,
    voters: [],
    page_log: [],
  };
  writeJson(CITIZENS_PATH, citizens);

  const REL_MAP = { F: "Father", H: "Husband", M: "Mother", O: "Other" };
  const GEN_MAP = { M: "male", F: "female" };

  for (let i = 2; i < totalPages; i++) {
    const pageNumber = i + 1;
    try {
      const base64 = await prepPage(i);
      const res = await callModel(base64, PAGE_PROMPT(pageNumber, anubhagMap));
      const pageAnubhag = res.pa ?? null;
      const unmatched = res.um ?? null;
      const village = pageAnubhag ? anubhagMap[pageAnubhag] ?? null : null;
      const shortVoters = res.v || [];
      const voters = shortVoters.map((x) => ({
        serial: x.s,
        voterId: x.i,
        name: x.n,
        relative_name: x.r,
        relation: REL_MAP[x.l] ?? x.l,
        gender: GEN_MAP[x.g] ?? x.g,
        age: x.a,
        houseNumber: x.h,
        village,
        anubhag_raw: pageAnubhag,
        pageNumber,
      }));
      citizens.voters.push(...voters);
      citizens.page_log.push({
        page: pageNumber,
        anubhag: pageAnubhag,
        voters: voters.length,
        unmatched,
      });
      const tag = unmatched ? "  UNMATCHED" : "";
      console.error(`  page ${pageNumber}/${totalPages}  anubhag="${pageAnubhag ?? "?"}"  voters=${voters.length}${tag}`);
      writeJson(CITIZENS_PATH, citizens);
    } catch (e) {
      console.error(`  page ${pageNumber}/${totalPages}  ERROR: ${e.message}`);
      citizens.page_log.push({ page: pageNumber, error: e.message });
      writeJson(CITIZENS_PATH, citizens);
    }
  }

  // summary
  const byVillage = {};
  for (const v of citizens.voters) byVillage[v.village] = (byVillage[v.village] || 0) + 1;
  console.error(`\n=== Summary ===`);
  console.error(`Total voters: ${citizens.voters.length}`);
  for (const [k, n] of Object.entries(byVillage)) console.error(`  ${k}: ${n}`);
  console.error(`\nWrote ${CITIZENS_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
