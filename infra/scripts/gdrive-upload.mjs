// ============================================================================
// gdrive-upload.mjs — sobe um arquivo pro Google Drive e aplica retencao.
//
// Sem dependencias (usa fetch nativo do Node 18+). Roda dentro de um container
// node:22-alpine (chamado pelo backup-hot.sh), entao a VPS nem precisa de Node.
//
// Regra de retencao: mantem os ultimos GDRIVE_KEEP (default 4) na pasta do Drive.
// Como roda DEPOIS do upload, ao enviar o 5º arquivo ele apaga o 1º (mais antigo).
//
// Variaveis (OAuth de usuario — funciona com Gmail comum, conta na sua cota):
//   GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN, GDRIVE_FOLDER_ID
//   GDRIVE_KEEP (opcional, default 4)
// ============================================================================
import { readFileSync, statSync } from "node:fs";

const FILE = process.argv[2];
if (!FILE) { console.error("uso: node gdrive-upload.mjs <arquivo>"); process.exit(1); }

const { GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN, GDRIVE_FOLDER_ID } = process.env;
const KEEP = parseInt(process.env.GDRIVE_KEEP || "4", 10);
if (!GDRIVE_CLIENT_ID || !GDRIVE_CLIENT_SECRET || !GDRIVE_REFRESH_TOKEN || !GDRIVE_FOLDER_ID) {
  console.error("Faltam variaveis GDRIVE_* (CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/FOLDER_ID)");
  process.exit(1);
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: GDRIVE_CLIENT_ID, client_secret: GDRIVE_CLIENT_SECRET,
    refresh_token: GDRIVE_REFRESH_TOKEN, grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function upload(token) {
  const name = FILE.split("/").pop();
  const size = statSync(FILE).size;
  // sessao de upload resumable
  const init = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, parents: [GDRIVE_FOLDER_ID] }),
    },
  );
  if (!init.ok) throw new Error(`init ${init.status}: ${await init.text()}`);
  const session = init.headers.get("location");
  const data = readFileSync(FILE);
  const put = await fetch(session, { method: "PUT", body: data });
  if (!put.ok) throw new Error(`upload ${put.status}: ${await put.text()}`);
  console.log(`upload OK: ${name} (${(size / 1048576).toFixed(1)} MB)`);
}

async function retention(token) {
  const q = encodeURIComponent(`'${GDRIVE_FOLDER_ID}' in parents and trashed=false`);
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&orderBy=createdTime&fields=files(id,name,createdTime)&pageSize=1000` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`list ${r.status}: ${await r.text()}`);
  const files = (await r.json()).files || [];
  if (files.length <= KEEP) { console.log(`retencao: ${files.length}/${KEEP} — nada a apagar`); return; }
  const toDelete = files.slice(0, files.length - KEEP); // ordenados do mais antigo
  for (const f of toDelete) {
    const d = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (d.ok || d.status === 204) console.log(`apagado da nuvem: ${f.name}`);
    else console.error(`falha ao apagar ${f.name}: ${d.status}`);
  }
}

const token = await getAccessToken();
await upload(token);
await retention(token);
