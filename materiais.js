/* =====================================================
   materiais.js — CATÁLOGO DE MATERIAIS E PREÇOS
   -----------------------------------------------------
   - CRUD local (preço, perda, consumo, ativo) com HISTÓRICO
     de preços (anterior, novo, data, fonte) e variação %.
   - Formato pronto para migrar ao Supabase depois
     (materiais, materiais_precos) sem mudar a lógica.
   - O orçamento (orcamento.js) lê daqui primeiro; sem
     preço cadastrado = "Preço não informado" (nunca inventa).
   ===================================================== */

const MAT_SAVE_KEY = "mario_materiais_v1";
const MAT_CATEGORIAS = [
  "Tijolos e blocos", "Cimento", "Areia", "Brita", "Aço", "Argamassa",
  "Pisos e revestimentos", "Tintas", "Materiais elétricos",
  "Materiais hidráulicos", "Telhas e madeiramento", "Portas e janelas",
  "Impermeabilização", "Ferramentas e equipamentos", "Outros",
];

function matSemente() {
  const base = [
    ["Cimento CP-II 50kg", "Cimento", "saco", 0.25, "saco/m² reboco"],
    ["Areia média", "Areia", "m³", null, ""],
    ["Brita 1", "Brita", "m³", null, ""],
    ["Bloco de concreto 14x19x39", "Tijolos e blocos", "un", 12.5, "un/m²"],
    ["Tijolo cerâmico 6 furos", "Tijolos e blocos", "un", 25, "un/m²"],
    ["Aço CA-50 8mm", "Aço", "kg", null, ""],
    ["Piso cerâmico 45x45", "Pisos e revestimentos", "m²", null, ""],
    ["Tinta acrílica 18L", "Tintas", "L", null, "6 m²/L por demão"],
    ["Telha romana", "Telhas e madeiramento", "un", 16, "un/m² telhado"],
    ["Porta pronta 80cm", "Portas e janelas", "un", null, ""],
    ["Janela alumínio 100x120", "Portas e janelas", "un", null, ""],
    ["Argamassa AC-I 20kg", "Argamassa", "saco", null, ""],
  ];
  const hoje = new Date().toISOString().slice(0, 10);
  return base.map((b, i) => ({
    id: "mat-semente-" + i, nome: b[0], categoria: b[1], marca: "",
    unidade: b[2], preco: null, dataPreco: null, fonte: "",
    perda: 0.05, consumo: b[3], consumoObs: b[4], obs: "",
    ativo: true,
    historico: [{ preco: null, data: hoje, fonte: "cadastro inicial" }],
  }));
}
function lerMateriais() {
  try {
    const l = JSON.parse(localStorage.getItem(MAT_SAVE_KEY) || "null");
    if (Array.isArray(l)) return l;
  } catch (e) {}
  const semente = matSemente();
  try { localStorage.setItem(MAT_SAVE_KEY, JSON.stringify(semente)); } catch (e) {}
  return semente;
}
function salvarMateriais(l) {
  try { localStorage.setItem(MAT_SAVE_KEY, JSON.stringify(l)); } catch (e) {}
}
function matPorId(id) {
  return lerMateriais().find((m) => m.id === id);
}
// Para o orçamento: devolve {preco, fonte, data} ou null (sem inventar)
function precoCadastrado(uso) {
  const u = String(uso || "").toLowerCase();
  const l = lerMateriais().filter((m) => m.ativo && m.preco > 0);
  const achou = l.find((m) => m.nome.toLowerCase().includes(u)) ||
    l.find((m) => m.categoria.toLowerCase().includes(u));
  if (!achou) return null;
  return { preco: achou.preco, fonte: `${achou.nome}${achou.fonte ? " (" + achou.fonte + ")" : ""}`, data: achou.dataPreco };
}
function variacaoPreco(m) {
  const h = (m.historico || []).filter((x) => x.preco > 0);
  if (h.length < 2) return null;
  const ant = h[h.length - 2].preco, novo = h[h.length - 1].preco;
  if (!(ant > 0)) return null;
  return ((novo - ant) / ant) * 100;
}

// ---------- Tela (lista por categoria + novo/editar) ----------
function elMat(id) { return document.getElementById(id); }
function desenharMateriais(filtro) {
  const box = elMat("lista-materiais");
  if (!box) return;
  const q = String(filtro || "").trim().toLowerCase();
  const lista = lerMateriais().filter((m) =>
    (!q || m.nome.toLowerCase().includes(q) || m.categoria.toLowerCase().includes(q)));
  box.innerHTML = "";
  if (!lista.length) {
    box.innerHTML = `<div class="lista-vazia">Nenhum material. Toque em + Novo material.</div>`;
    return;
  }
  let cat = "";
  for (const m of lista) {
    if (m.categoria !== cat) {
      cat = m.categoria;
      const h = document.createElement("p");
      h.className = "busca-grupo";
      h.textContent = cat;
      box.appendChild(h);
    }
    const v = variacaoPreco(m);
    const div = document.createElement("div");
    div.className = "item" + (m.ativo ? "" : " encerrado");
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">M</span>
        <div class="item-conteudo">
          <strong>${proteger(m.nome)}${m.ativo ? "" : " (inativo)"}</strong>
          <span class="item-meta">${m.preco > 0 ? formatarMoeda(m.preco) + "/" + proteger(m.unidade) : "Preço não informado"}${v === null ? "" : ` • ${v >= 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%`}</span>
        </div>
      </div>
      <div class="item-acoes"><button data-a="editar">Editar</button><button data-a="hist">Preços</button></div>`;
    div.querySelector('[data-a="editar"]').addEventListener("click", () => abrirFormMaterial(m.id));
    div.querySelector('[data-a="hist"]').addEventListener("click", () => verHistoricoPreco(m.id));
    box.appendChild(div);
  }
}
function abrirFormMaterial(id) {
  const m = id ? matPorId(id) : { nome: "", categoria: "Outros", marca: "", unidade: "un", preco: "", dataPreco: "", fonte: "", perda: 0.05, consumo: "", consumoObs: "", obs: "", ativo: true };
  if (!m) return;
  elMat("mat-id").value = m.id || "";
  elMat("mat-nome").value = m.nome || "";
  elMat("mat-categoria").value = m.categoria || "Outros";
  elMat("mat-marca").value = m.marca || "";
  elMat("mat-unidade").value = m.unidade || "un";
  elMat("mat-preco").value = m.preco || "";
  elMat("mat-fonte").value = m.fonte || "";
  elMat("mat-perda").value = (m.perda ?? 0.05) * 100;
  elMat("mat-consumo").value = m.consumo ?? "";
  elMat("mat-obs").value = m.obs || "";
  elMat("mat-ativo").checked = m.ativo !== false;
  elMat("form-material").hidden = false;
  elMat("form-material").scrollIntoView({ behavior: "smooth", block: "center" });
}
function salvarFormMaterial(e) {
  e.preventDefault();
  const lista = lerMateriais();
  const id = elMat("mat-id").value || ("mat-" + Date.now().toString(36));
  const hoje = new Date().toISOString().slice(0, 10);
  const preco = Number(String(elMat("mat-preco").value).replace(",", ".")) || 0;
  const fonte = elMat("mat-fonte").value.trim();
  let m = lista.find((x) => x.id === id);
  if (!m) {
    m = { id, historico: [] };
    lista.push(m);
  }
  const anterior = Number(m.preco) || 0;
  Object.assign(m, {
    nome: elMat("mat-nome").value.trim(),
    categoria: elMat("mat-categoria").value,
    marca: elMat("mat-marca").value.trim(),
    unidade: elMat("mat-unidade").value.trim() || "un",
    preco: preco > 0 ? preco : null,
    dataPreco: preco > 0 ? hoje : m.dataPreco || null,
    fonte,
    perda: (Number(String(elMat("mat-perda").value).replace(",", ".")) || 0) / 100,
    consumo: elMat("mat-consumo").value.trim() === "" ? null : Number(String(elMat("mat-consumo").value).replace(",", ".")),
    obs: elMat("mat-obs").value.trim(),
    ativo: elMat("mat-ativo").checked,
  });
  if (!m.nome) { mostrarToast("Dê um nome ao material.", false); return; }
  // Histórico: só registra quando o preço mudou de verdade
  if (preco > 0 && preco !== anterior) {
    m.historico = m.historico || [];
    m.historico.push({ preco, data: hoje, fonte: fonte || "manual" });
    m.historico = m.historico.slice(-50);
  }
  salvarMateriais(lista);
  elMat("form-material").hidden = true;
  desenharMateriais((elMat("mat-busca") || {}).value || "");
  // Mensagem honesta: só afirma "nuvem" após confirmação real da gravação.
  try {
    if (typeof SyncOrc !== "undefined") {
      SyncOrc.empurrarMaterial(m).then((r) => {
        const ok = !!(r && r.ok);
        if (ok) salvarMateriais(lista); // grava o _supa (id da nuvem) no aparelho
        const texto = SyncOrc.mensagem ? SyncOrc.mensagem(r, "Material") : (ok ? "Material salvo e sincronizado!" : "Material salvo neste aparelho.");
        mostrarToast(texto, ok);
      }).catch(() => mostrarToast("Material salvo neste aparelho. Falha ao salvar na nuvem.", false));
    } else {
      mostrarToast("Material salvo neste aparelho.", false);
    }
  } catch (e) { mostrarToast("Material salvo neste aparelho.", false); }
}
function verHistoricoPreco(id, dias) {
  const m = matPorId(id);
  if (!m) return;
  let h = (m.historico || []).filter((x) => x.preco > 0);
  if (dias) {
    const limite = new Date();
    limite.setDate(limite.getDate() - dias);
    const lim = limite.toISOString().slice(0, 10);
    h = h.filter((x) => (x.data || "") >= lim);
  }
  let html = `<div class="card"><h3 class="titulo-secao" style="margin-top:0">${proteger(m.nome)}</h3>`;
  html += `<div class="filtros" style="grid-template-columns:repeat(5,1fr)">` +
    [[0, "Tudo"], [30, "30d"], [90, "90d"], [180, "6m"], [365, "12m"]].map(([d, t]) =>
      `<button class="filtro${(dias || 0) === d ? " ativo" : ""}" data-per="${d}">${t}</button>`).join("") + `</div>`;
  if (h.length < 2) {
    html += `<p class="texto-suave">Poucos registros no período — média com baixa confiabilidade.</p>`;
  } else {
    const max = Math.max(...h.map((x) => x.preco));
    html += h.slice(-12).map((x) => {
      const pct = Math.max(4, Math.round((x.preco / max) * 100));
      return `<div class="cat-linha"><div class="cat-topo"><span>${x.data || "—"}${x.fonte ? " • " + proteger(x.fonte) : ""}</span><span>${formatarMoeda(x.preco)}</span></div>` +
        `<div class="barra"><div style="width:${pct}%"></div></div></div>`;
    }).join("");
    const v = variacaoPreco(m);
    if (v !== null) html += `<p class="texto-suave">Variação desde o registro anterior: <strong>${v >= 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%</strong></p>`;
  }
  const media = h.length ? h.reduce((s, x) => s + x.preco, 0) / h.length : 0;
  if (media > 0) html += `<p class="texto-suave">Média dos registros comparáveis: <strong>${formatarMoeda(media)}</strong>${h.length < 3 ? " (baixa confiabilidade)" : ""}</p>`;
  html += `<button class="btn btn-texto" id="mat-hist-voltar">Voltar</button></div>`;
  const box = elMat("mat-historico");
  box.innerHTML = html;
  box.hidden = false;
  box.querySelectorAll("[data-per]").forEach((b) =>
    b.addEventListener("click", () => verHistoricoPreco(id, Number(b.dataset.per)))
  );
  elMat("mat-hist-voltar").addEventListener("click", () => { box.hidden = true; box.innerHTML = ""; });
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}
function ligarMateriais() {
  const ao = (id, fn) => {
    const b = elMat(id);
    if (b && !b.dataset.matLigado) { b.dataset.matLigado = "1"; b.addEventListener("click", fn); }
  };
  ao("btn-novo-material", () => abrirFormMaterial(null));
  ao("mat-cancelar", () => { elMat("form-material").hidden = true; });
  const f = elMat("form-material");
  if (f && !f.dataset.matLigado) {
    f.dataset.matLigado = "1";
    f.addEventListener("submit", salvarFormMaterial);
  }
  const b = elMat("mat-busca");
  if (b && !b.dataset.matLigado) {
    b.dataset.matLigado = "1";
    let t = null;
    b.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => desenharMateriais(b.value), 250); });
  }
  document.querySelectorAll('[data-ir="materiais"]').forEach((x) => {
    if (!x.dataset.matLigado) {
      x.dataset.matLigado = "1";
      x.addEventListener("click", () => setTimeout(() => desenharMateriais(""), 100));
    }
  });
  // Completa com o servidor o que falta no aparelho (só soma, nunca apaga)
  try {
    if (typeof SyncOrc !== "undefined") {
      SyncOrc.puxarMateriais().then((r) => {
        if (!r || !r.ok) return; // falha de rede/permissão NÃO é "lista vazia"
        const remotos = r.dados || [];
        if (!remotos.length) return;
        const lista = lerMateriais();
        const ids = new Set(lista.map((m) => m.id));
        let entrou = 0;
        for (const rm of remotos) {
          if (!ids.has(rm.id)) { lista.push(rm); entrou++; }
        }
        if (entrou) {
          salvarMateriais(lista);
          desenharMateriais((elMat("mat-busca") || {}).value || "");
        }
      });
    }
  } catch (e) {}
}
