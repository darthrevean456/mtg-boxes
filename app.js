// Card box page: reads a ManaBox CSV export and shows every card with its picture and text.
(function () {
  const params = new URLSearchParams(location.search);
  const boxId = (params.get("b") || "").toLowerCase();
  const box = (typeof BOXES !== "undefined" ? BOXES : []).find(b => b.id === boxId);

  const $ = id => document.getElementById(id);
  const grid = $("grid"), msg = $("msg");
  const TYPES = ["Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Land", "Other"];
  let cards = [];               // {key, id, name, qty, foil, price, set, num, sf}
  let activeType = "All";

  if (!box) { $("boxName").textContent = "Box not found"; msg.innerHTML = 'Go back to <a href="index.html">all boxes</a>.'; return; }
  document.title = box.name + " – Card Box";
  $("boxName").textContent = box.name;
  document.documentElement.style.setProperty("--box", box.colour);
  document.documentElement.style.setProperty("--boxText", box.text);

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = [];
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift().map(h => h.trim());
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }

  function fromRows(rows) {
    const map = new Map();
    for (const r of rows) {
      const id = (r["Scryfall ID"] || "").trim();
      const name = r["Name"] || r["Card Name"] || "";
      if (!name) continue;
      const foil = /foil|etched/i.test(r["Foil"] || r["Finish"] || "") && !/^normal$/i.test(r["Foil"] || "");
      const key = id + "|" + foil;
      const qty = parseInt(r["Quantity"] || "1", 10) || 1;
      const price = parseFloat(r["Purchase price"] || "0") || 0;
      if (map.has(key)) map.get(key).qty += qty;
      else map.set(key, { key, id, name, qty, foil, price, set: r["Set name"] || "", num: r["Collector number"] || "", sf: null });
    }
    return [...map.values()];
  }

  // ---------- Scryfall (with a small cache) ----------
  const CACHE_DAYS = 14;
  function cacheGet(id) {
    try { const v = JSON.parse(localStorage.getItem("sf:" + id)); if (v && Date.now() - v.t < CACHE_DAYS * 864e5) return v.d; } catch (e) {}
    return null;
  }
  function cacheSet(id, d) { try { localStorage.setItem("sf:" + id, JSON.stringify({ t: Date.now(), d })); } catch (e) {} }

  function slim(c) {
    const face = f => ({ name: f.name, mana: f.mana_cost || "", type: f.type_line || "", text: f.oracle_text || "", img: f.image_uris ? f.image_uris.normal : null, big: f.image_uris ? f.image_uris.large : null });
    const faces = c.card_faces ? c.card_faces.map(face) : null;
    return {
      name: c.name, mana: c.mana_cost || (faces ? faces[0].mana : ""), type: c.type_line || (faces ? faces[0].type : ""),
      text: c.oracle_text || "", cmc: c.cmc || 0, colors: c.color_identity || [],
      img: c.image_uris ? c.image_uris.normal : (faces && faces[0].img), big: c.image_uris ? c.image_uris.large : (faces && faces[0].big),
      faces, eur: c.prices && (c.prices.eur || c.prices.eur_foil), set: c.set_name, rarity: c.rarity
    };
  }

  async function loadScryfall(list) {
    const need = [];
    for (const c of list) { const hit = c.id && cacheGet(c.id); if (hit) c.sf = hit; else if (c.id) need.push(c); }
    for (let i = 0; i < need.length; i += 75) {
      const chunk = need.slice(i, i + 75);
      msg.textContent = `Loading card pictures… ${Math.min(i + 75, need.length)} / ${need.length}`;
      try {
        const res = await fetch("https://api.scryfall.com/cards/collection", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers: chunk.map(c => ({ id: c.id })) })
        });
        const j = await res.json();
        const byId = new Map((j.data || []).map(d => [d.id, d]));
        for (const c of chunk) { const d = byId.get(c.id); if (d) { c.sf = slim(d); cacheSet(c.id, c.sf); } }
      } catch (e) { console.warn("Scryfall error", e); }
      await new Promise(r => setTimeout(r, 120));
    }
    msg.textContent = "";
  }

  // ---------- helpers ----------
  function mainType(c) {
    const t = (c.sf && c.sf.type) || "";
    if (/Land/.test(t) && !/Creature/.test(t)) return "Land";
    for (const T of ["Creature", "Planeswalker", "Instant", "Sorcery", "Enchantment", "Artifact"]) if (t.includes(T)) return T;
    return "Other";
  }
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  function symbols(s) {
    return esc(s).replace(/\{([^}]+)\}/g, (m, sym) => {
      const f = sym.replace(/\//g, "").toUpperCase();
      return `<img class="sym" src="https://svgs.scryfall.io/card-symbols/${encodeURIComponent(f)}.svg" alt="{${esc(sym)}}" title="{${esc(sym)}}">`;
    });
  }
  function searchText(c) {
    const s = c.sf; if (!s) return c.name.toLowerCase();
    const faces = s.faces ? s.faces.map(f => f.name + " " + f.type + " " + f.text).join(" ") : "";
    return (c.name + " " + s.type + " " + s.text + " " + faces).toLowerCase();
  }

  // ---------- render ----------
  function buildChips() {
    const counts = { All: cards.reduce((a, c) => a + c.qty, 0) };
    for (const c of cards) counts[c.t] = (counts[c.t] || 0) + c.qty;
    $("types").innerHTML = ["All", ...TYPES].filter(t => counts[t]).map(t =>
      `<button class="chip${t === activeType ? " on" : ""}" data-t="${t}">${t}<b>${counts[t]}</b></button>`).join("");
    $("types").querySelectorAll(".chip").forEach(b => b.onclick = () => { activeType = b.dataset.t; buildChips(); render(); });
  }

  function render() {
    const q = $("q").value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const foilOnly = $("foilOnly").checked;
    let list = cards.filter(c =>
      (activeType === "All" || c.t === activeType) && (!foilOnly || c.foil) &&
      (q === "" || c.search.includes(q) || words.every(w => c.search.includes(w))));
    const sort = $("sort").value;
    list.sort((a, b) =>
      sort === "mv" ? ((a.sf ? a.sf.cmc : 99) - (b.sf ? b.sf.cmc : 99)) || a.name.localeCompare(b.name) :
      sort === "type" ? TYPES.indexOf(a.t) - TYPES.indexOf(b.t) || a.name.localeCompare(b.name) :
      sort === "price" ? b.price - a.price || a.name.localeCompare(b.name) :
      a.name.localeCompare(b.name));
    const n = list.reduce((a, c) => a + c.qty, 0);
    $("count").textContent = `${n} card${n === 1 ? "" : "s"} shown`;
    grid.innerHTML = list.map(c => `
      <div class="card${c.foil ? " isfoil" : ""}" data-k="${esc(c.key)}" title="${esc(c.name)}">
        ${c.sf && c.sf.img ? `<img loading="lazy" src="${c.sf.img}" alt="${esc(c.name)}">` : `<div class="ph">${esc(c.name)}</div>`}
        ${c.qty > 1 ? `<span class="badge">×${c.qty}</span>` : ""}
        ${c.foil ? `<span class="foil">FOIL</span>` : ""}
      </div>`).join("");
    if (!list.length && cards.length) msg.textContent = "No cards match.";
    else if (cards.length) msg.textContent = "";
  }

  grid.addEventListener("click", e => {
    const el = e.target.closest(".card"); if (!el) return;
    const c = cards.find(x => x.key === el.dataset.k); if (c) openCard(c);
  });

  let faceIdx = 0, current = null;
  function openCard(c) {
    current = c; faceIdx = 0; showFace(); $("modal").hidden = false; document.body.style.overflow = "hidden";
  }
  function showFace() {
    const c = current, s = c.sf || {};
    const faces = s.faces && s.faces.some(f => f.img) ? s.faces : null;
    const f = faces ? faces[faceIdx] : null;
    $("mImg").src = (f && (f.big || f.img)) || s.big || s.img || "";
    $("mImg").alt = c.name;
    $("flip").hidden = !faces;
    $("mName").innerHTML = esc(s.name || c.name) + (s.mana ? " &nbsp;" + symbols(s.mana) : "");
    $("mType").textContent = s.type || "";
    $("mText").innerHTML = s.faces
      ? s.faces.map(x => `<span class="face">${esc(x.name)} ${symbols(x.mana)}</span>${esc(x.type)}\n${symbols(x.text)}`).join("\n")
      : symbols(s.text || "(no rules text)");
    $("mMeta").innerHTML =
      `In this box: <b>${c.qty}</b>${c.foil ? " &nbsp;✨ Foil" : ""}<br>` +
      `Set: ${esc(c.set || s.set || "")}${c.num ? " #" + esc(c.num) : ""}<br>` +
      (c.price ? `Value (ManaBox): £${c.price.toFixed(2)} each` : "");
  }
  $("flip").onclick = () => { const n = current.sf.faces.length; faceIdx = (faceIdx + 1) % n; showFace(); };
  function closeModal() { $("modal").hidden = true; document.body.style.overflow = ""; }
  $("close").onclick = closeModal;
  $("modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

  $("q").addEventListener("input", render);
  $("sort").addEventListener("change", render);
  $("foilOnly").addEventListener("change", render);

  // ---------- start ----------
  async function start(text) {
    cards = fromRows(parseCSV(text));
    const total = cards.reduce((a, c) => a + c.qty, 0);
    const value = cards.reduce((a, c) => a + c.qty * c.price, 0);
    $("stats").textContent = `${total} cards · ${cards.length} different` + (value ? ` · about £${value.toFixed(2)}` : "");
    for (const c of cards) { c.t = "Other"; c.search = c.name.toLowerCase(); }
    buildChips(); render();
    await loadScryfall(cards);
    for (const c of cards) { c.t = mainType(c); c.search = searchText(c); }
    buildChips(); render();
  }

  fetch(box.file, { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(start)
    .catch(() => {
      // Opening the page straight from your laptop (not online) blocks reading the file, so let you pick it.
      msg.innerHTML = `Couldn't open <b>${esc(box.file)}</b> automatically.<br>` +
        `<button id="pickBtn">Choose the CSV file</button>`;
      $("pickBtn").onclick = () => $("filePick").click();
      $("filePick").onchange = e => { const f = e.target.files[0]; if (f) f.text().then(start); };
    });
})();
