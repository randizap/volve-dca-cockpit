// team.js — data & kartu tim (dipakai di landing/Ringkasan dan halaman Tim).
import { esc } from "./ui.js";
let cache = null;
export async function getTeam() {
  if (cache) return cache;
  try { cache = await (await fetch("team.json")).json(); } catch { cache = []; }
  return cache;
}
export const initials = (n) => n.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
const hasPhoto = (m) => m.foto && !/TODO/i.test(m.foto);
const hasLink = (m) => /^https?:/.test(m.linkedin || "");
const img = (m) => hasPhoto(m)
  ? `<img src="${esc(m.foto)}" alt="Foto ${esc(m.nama)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ini',textContent:'${initials(m.nama)}'}))">`
  : `<div class="ini">${initials(m.nama)}</div>`;
export function teamCards(team) {
  return team.map((m) => `<div class="tm ${m.ketua ? "ketua" : ""}">
    <div class="ph-wrap">${m.ketua ? `<span class="rib">Ketua</span>` : ""}${img(m)}</div>
    <div class="body"><div class="nm">${esc(m.nama.trim())}</div><div class="small muted">${esc(m.nim)}</div><div class="small">${esc(m.peran)}</div>
    ${hasLink(m) ? `<a class="li" href="${esc(m.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>` : `<span class="li off">LinkedIn belum tersedia</span>`}</div></div>`).join("");
}
export function teamStrip(team) {
  return `<div class="strip">${team.map((m) => `<div class="mini ${m.ketua ? "ketua" : ""}"><div class="av">${img(m)}</div><div><div class="nm">${esc(m.nama.trim())}${m.ketua ? ` <span class="kb">Ketua</span>` : ""}</div><div class="tiny muted">${esc(m.peran)}</div></div></div>`).join("")}</div>`;
}