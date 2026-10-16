/* =====================================================
   orcamento.js — Orçamento da obra (estimativa guiada)
   -----------------------------------------------------
   Fluxo: área da obra + PREÇOS cadastrados → QUANTITATIVO
   (determinístico) → CUSTO DIRETO. NÃO aplica BDI/impostos/margem:
   este fluxo guiado entrega uma ESTIMATIVA PRELIMINAR aproximada.
   O valor pode ser salvo no aparelho e sincronizado com o Supabase.
   - Cálculos 100% determinísticos a partir de PARÂMETROS
     declarados abaixo (sem número mágico escondido).
   - Preço ausente = "sem preço" (nunca inventa).
   - O relatório "Auditoria do orçamento" mostra a origem de cada número.
   ===================================================== */

// ---------- PARÂMETROS (editáveis, documentados) ----------
// Cada coeficiente tem unidade e observação. Ajuste outliers aqui.
const PARAMS_ORC = {
  // % da área total que recebe piso (desconta paredes e áreas externas)
  PISO_PERC_AREA: { valor: 0.85, unidade: "fração", obs: "85% da área; ajuste por obra" },
  PERDA_PISO: { valor: 0.10, unidade: "fração", obs: "recortes e quebras" },
  PRECO_PISO_M2: { valor: null, unidade: "R$/m²", obs: "Ex: 45,00 — preencher por obra/região" },
  // Parede: m² de parede por m² de área (média de casas térreas simples)
  PAREDE_POR_AREA: { valor: 2.8, unidade: "m²/m²", obs: "média; ajuste por obra" },
  BLOCO_M2: { valor: 12.5, unidade: "un/m²", obs: "bloco 14x19x39 com junta de 1 cm (1/0,20×0,40)" },
  TIJOLO_M2: { valor: 25, unidade: "un/m²", obs: "tijolo 6 furos — NÃO confere com \"deitado\" (~33 un/m²); conferir peça e assentamento" },
  PERDA_BLOCO: { valor: 0.05, unidade: "fração", obs: "quebras" },
  PRECO_BLOCO_UN: { valor: null, unidade: "R$/un", obs: "Ex: 1,20" },
  PRECO_TIJOLO_UN: { valor: null, unidade: "R$/un", obs: "Ex: 0,90" },
  // Reboco: cimento por m² de parede (chapisco + reboco médio)
  CIMENTO_M2_REBOCO: { valor: 0.25, unidade: "saco/m²", obs: "média; ajuste por obra" },
  PRECO_CIMENTO_SACO: { valor: null, unidade: "R$/saco", obs: "Ex: 42,00" },
  // Tinta: rendimento por demão e nº de demãos
  TINTA_REND_M2_L: { valor: 6, unidade: "m²/L por demão", obs: "parede selada" },
  TINTA_DEMAOS: { valor: 2, unidade: "demãos", obs: "padrão" },
  PRECO_TINTA_L: { valor: null, unidade: "R$/L", obs: "Ex: 28,00" },
  // Portas e janelas: por unidade
  PRECO_PORTA_UN: { valor: null, unidade: "R$/un", obs: "porta pronta instalada" },
  PRECO_JANELA_UN: { valor: null, unidade: "R$/un", obs: "janela padrão" },
  // Fundação (sapata corrida): seção padrão × perímetro
  SAPATA_LARG_M: { valor: 0.4, unidade: "m", obs: "largura da sapata" },
  SAPATA_ALT_M: { valor: 0.4, unidade: "m", obs: "altura da sapata" },
  ACO_FUND_KG_M3: { valor: 80, unidade: "kg/m³", obs: "armação média sapata" },
  PRECO_CONC_M3: { valor: null, unidade: "R$/m³", obs: "concreto usinado" },
  PRECO_ACO_KG: { valor: null, unidade: "R$/kg", obs: "aço CA-50" },
  // Laje maciça: concreto e aço por m²
  LAJE_CONC_M3_M2: { valor: 0.12, unidade: "m³/m²", obs: "laje ~12cm" },
  ACO_LAJE_KG_M2: { valor: 12, unidade: "kg/m²", obs: "armação média laje" },
  // Cobertura: área do telhado sobre a área + telha por m²
  // OBS: 16 un/m² equivale a telha de peça pequena (coloniale/paulista, cobertura
  // efetiva ~0,06 m²). NÃO é telha romana (cerâmica de peça grande, que cobre
  // ~0,10–0,12 m² → 8–10 un/m²). O número NÃO foi alterado; apenas o rótulo
  // estava trocado. Confirme o modelo da telha antes de usar o orçamento.
  TELHADO_FATOR: { valor: 1.3, unidade: "fração", obs: "telhado sobre a área" },
  TELHA_M2: { valor: 16, unidade: "un/m²", obs: "peça pequena (~0,06 m²); NÃO é romana — conferir modelo" },
  PRECO_TELHA_UN: { valor: null, unidade: "R$/un", obs: "telha romana" },
  MADEIRAMENTO_M2: { valor: null, unidade: "R$/m²", obs: "madeiramento instalado" },
  // --- Extensões aditivas (usadas só quando houver medida por parede/ambiente) ---
  // Argamassa de assentamento por m² de alvenaria (média prática de obra).
  ARGAMASSA_ALV_M2: { valor: 0.03, unidade: "m³/m²", obs: "Hipótese de obra (traço médio) — NÃO verificada em norma; confirme com o pedreiro." },
  // Chapisco por m² de parede (consumo de cimento médio).
  CHAPISCO_CIM_M2: { valor: 0.10, unidade: "saco/m²", obs: "Hipótese de obra — confirme o traço do chapisco." },
  // Contrapiso: espessura média e consumo de cimento por m³ de argamassa.
  CONTRAPISO_ESP_M: { valor: 0.03, unidade: "m", obs: "Hipótese (3 cm) — a espessura depende do nivelamento real." },
  CIMENTO_M3_CONTRAPISO: { valor: 7, unidade: "saco/m³", obs: "Hipótese de traço — confirme." },
  // Rejunte/perda de revestimento de parede por face pintada/revestida.
  PERDA_REVEST: { valor: 0.10, unidade: "fração", obs: "recortes em revestimento de parede" },
};

// ---------- FONTE / NATUREZA DE CADA COEFICIENTE (transparência - Seção 1) ----------
// Nenhum coeficiente abaixo foi medido/validado em norma ou fabricante neste app.
// "hipotese"      = valor prático de obra, NÃO verificado (pode estar errado).
// "usuario"       = o próprio usuário informa (não é coeficiente do sistema).
// "norma"         = valor normativo (nenhum até o momento; reservado).
// "fornecedor"    = valor de catálogo/fabricante (nenhum até o momento).
// `conf`: 1 = informado · 2 = coeficiente · 3 = requer projeto/confirmação.
const ORC_FONTES = {
  PISO_PERC_AREA: { tipo: "hipotese", conf: 2, fonte: "Prática de obra (não verificada)" },
  PERDA_PISO: { tipo: "hipotese", conf: 2, fonte: "Prática de obra (não verificada)" },
  PAREDE_POR_AREA: { tipo: "hipotese", conf: 2, fonte: "Média de casas térreas (não verificada)" },
  BLOCO_M2: { tipo: "hipotese", conf: 2, fonte: "Geometria da peça + junta de 1 cm (1/(0,20×0,40))" },
  TIJOLO_M2: { tipo: "hipotese", conf: 3, fonte: "Valor NÃO conferido com a peça real" },
  PERDA_BLOCO: { tipo: "hipotese", conf: 2, fonte: "Prática de obra (não verificada)" },
  CIMENTO_M2_REBOCO: { tipo: "hipotese", conf: 2, fonte: "Consumo médio de reboco (não verificado)" },
  TINTA_REND_M2_L: { tipo: "hipotese", conf: 2, fonte: "Rendimento médio de parede selada" },
  TINTA_DEMAOS: { tipo: "hipotese", conf: 2, fonte: "Padrão de 2 demãos" },
  SAPATA_LARG_M: { tipo: "hipotese", conf: 3, fonte: "Seção padrão — NÃO substitui projeto estrutural" },
  SAPATA_ALT_M: { tipo: "hipotese", conf: 3, fonte: "Seção padrão — NÃO substitui projeto estrutural" },
  ACO_FUND_KG_M3: { tipo: "hipotese", conf: 3, fonte: "Armação média — requer projeto estrutural" },
  LAJE_CONC_M3_M2: { tipo: "hipotese", conf: 3, fonte: "Espessura ~12 cm — requer projeto estrutural" },
  ACO_LAJE_KG_M2: { tipo: "hipotese", conf: 3, fonte: "Armação média — requer projeto estrutural" },
  TELHADO_FATOR: { tipo: "hipotese", conf: 2, fonte: "Fator 1,3 sobre a área (não verificado)" },
  TELHA_M2: { tipo: "hipotese", conf: 3, fonte: "Peça pequena (~0,06 m²) — depende do modelo da telha" },
  ARGAMASSA_ALV_M2: { tipo: "hipotese", conf: 2, fonte: "Traço médio de obra (não verificado)" },
  CHAPISCO_CIM_M2: { tipo: "hipotese", conf: 2, fonte: "Traço médio (não verificado)" },
  CONTRAPISO_ESP_M: { tipo: "hipotese", conf: 2, fonte: "Espessura 3 cm (depende do nivelamento)" },
  CIMENTO_M3_CONTRAPISO: { tipo: "hipotese", conf: 2, fonte: "Traço médio (não verificado)" },
  PERDA_REVEST: { tipo: "hipotese", conf: 2, fonte: "Recortes em revestimento (não verificado)" },
};
// Devolve a natureza/fonte declarada de um parâmetro (nunca inventa fonte).
function fonteCoeficiente(nome) {
  return Object.assign({ tipo: "hipotese", conf: 2, fonte: "Não documentado" }, ORC_FONTES[nome] || {});
}
// Checagem estrutural de unit-safety: cada parâmetro precisa de valor numérico
// (ou null) + unidade + obs. Devolve lista de problemas (vazia = ok).
function verificarUnidadesOrcamento(params) {
  const p = params || PARAMS_ORC;
  const problemas = [];
  for (const k of Object.keys(p)) {
    const c = p[k];
    if (!c || typeof c !== "object") { problemas.push(k + ": parâmetro malformado"); continue; }
    if (c.valor !== null && c.valor !== undefined && !Number.isFinite(Number(c.valor))) problemas.push(k + ": valor não numérico");
    if (!c.unidade) problemas.push(k + ": sem unidade declarada");
    if (!c.obs) problemas.push(k + ": sem observação/origem");
  }
  return problemas;
}

const ORC_SAVE_KEY = "mario_orcamentos_v1";

function elOrc(id) { return document.getElementById(id); }
function lerOrcamentos() {
  try { return JSON.parse(localStorage.getItem(ORC_SAVE_KEY)) || []; } catch (e) { return []; }
}
function salvarOrcamentos(l) {
  try { localStorage.setItem(ORC_SAVE_KEY, JSON.stringify(l)); } catch (e) {}
}

// ---------- RAIO-X (confiança + correção) ----------
let raioXAtual = null; // {area, quartos, banheiros, portas, janelas, origem:{}, obraId}
function confiancaDe(campo) {
  if (!raioXAtual) return "nao";
  const v = raioXAtual[campo];
  if (v === null || v === undefined || v === "") return "nao";
  return (raioXAtual.origem && raioXAtual.origem[campo] === "editado") ? "alta" : "revisar";
}
function chipConf(nivel) {
  if (nivel === "alta") return `<span class="parcela-status pago">Alta confiança</span>`;
  if (nivel === "revisar") return `<span class="parcela-status pendente">Confira</span>`;
  return `<span class="parcela-status vencido">Não identificado</span>`;
}
function desenharRaioX() {
  const box = elOrc("raiox-corpo");
  if (!box || !raioXAtual) return;
  const r = raioXAtual;
  const linhaNum = (rotulo, campo) => `
    <div class="ajustes-linha"><span>${rotulo}${r[campo] ? `: <strong>${r[campo]}</strong>` : ": —"}</span>
    <span>${chipConf(confiancaDe(campo))}</span></div>
    <div class="form" style="margin:6px 0 4px">
      <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center">
        <button class="btn-pequeno" data-rx-menos="${campo}">−</button>
        <input type="number" id="rx-${campo}" value="${r[campo] ?? ""}" min="0" step="1" inputmode="numeric" placeholder="—" />
        <button class="btn-pequeno" data-rx-mais="${campo}">+</button>
      </div>
    </div>`;
  box.innerHTML = `
    <h3 class="titulo-secao" style="margin-top:0">O que encontramos</h3>
    <div class="ajustes-linha"><span>Área: <strong>${r.area ? Number(r.area) + " m²" : "—"}</strong></span>
    <span>${chipConf(confiancaDe("area"))}</span></div>
    <label class="campo"><span>Corrigir área (m²)</span>
      <input type="number" id="rx-area" value="${r.area ?? ""}" min="0" step="0.01" inputmode="decimal" /></label>
    ${linhaNum("Quartos", "quartos")}
    ${linhaNum("Banheiros", "banheiros")}
    ${linhaNum("Portas", "portas")}
    ${linhaNum("Janelas", "janelas")}
    <div class="modal-botoes">
      <button class="btn btn-texto" id="rx-voltar">Voltar</button>
      <button class="btn btn-primario btn-grande" id="rx-confirmar">Confirmar e continuar</button>
    </div>`;
  box.querySelectorAll("[data-rx-mais]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = document.getElementById("rx-" + b.dataset.rxMais);
      c.value = (Number(c.value) || 0) + 1;
    })
  );
  box.querySelectorAll("[data-rx-menos]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = document.getElementById("rx-" + b.dataset.rxMenos);
      c.value = Math.max(0, (Number(c.value) || 0) - 1);
    })
  );
  elOrc("rx-voltar").addEventListener("click", () => { elOrc("orcamento-area").hidden = true; });
  elOrc("rx-confirmar").addEventListener("click", () => {
    const ler = (c) => {
      const v = document.getElementById("rx-" + c).value;
      return v === "" ? null : Number(v);
    };
    const areaNova = document.getElementById("rx-area").value;
    raioXAtual.area = areaNova === "" ? null : Number(areaNova);
    ["quartos", "banheiros", "portas", "janelas"].forEach((c) => {
      const v = ler(c);
      if (v !== null) { raioXAtual[c] = v; raioXAtual.origem[c] = "editado"; }
    });
    if (areaNova !== "") raioXAtual.origem.area = "editado";
    desenharSistema();
  });
}

// ---------- Orçamentos salvos (ver, duplicar, comparar, excluir) ----------
function elOrcDetalhe() { return document.getElementById("orcamento-detalhe"); }
function nomeObraOrc(obraId) {
  try {
    if (obraId && typeof pegarObra === "function") {
      const o = pegarObra(obraId);
      if (o && o.nome) return o.nome;
    }
  } catch (e) {}
  return null;
}
// Preenche o seletor de obras da tela com as obras cadastradas.
function atualizarObrasOrcamento() {
  const sel = document.getElementById("og-obra");
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = `<option value="">Sem vínculo</option>`;
  for (const o of obras || []) {
    const op = document.createElement("option");
    op.value = o.id;
    op.textContent = o.nome;
    sel.appendChild(op);
  }
  if (atual) sel.value = atual;
}
async function renderOrcamentosSalvos() {
  const lista = document.getElementById("lista-orcamentos");
  if (!lista) return;
  // Completa com o servidor o que falta no aparelho (só soma)
  try {
    if (typeof SyncOrc !== "undefined") {
      const res = await SyncOrc.puxarOrcamentos().catch(() => ({ ok: false, dados: [] }));
      if (res && res.ok && res.dados && res.dados.length) {
        const locais = lerOrcamentos();
        const ids = new Set(locais.map((o) => o.id));
        let entrou = false;
        for (const r of res.dados) {
          if (!ids.has(r.id)) { locais.unshift(r); entrou = true; }
        }
        if (entrou) salvarOrcamentos(locais.slice(0, 30));
      }
    }
  } catch (e) {}
  const salvos = lerOrcamentos();
  lista.innerHTML = "";
  if (!salvos.length) {
    lista.innerHTML = `<div class="lista-vazia">Nenhum orçamento salvo.</div>`;
    return;
  }
  for (const o of salvos) {
    const div = document.createElement("div");
    div.className = "item";
    const obra = nomeObraOrc(o.obraId);
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">O</span>
        <div class="item-conteudo">
          <strong>${o.area} m² (${o.alvenaria === "bloco" ? "Bloco" : "Tijolo"})</strong>
          <span class="item-meta">${formatarData(o.data)} • Total ${moeda(o.total)}${obra ? " • " + proteger(obra) : ""}${o._supa ? "" : " • só no aparelho"}</span>
        </div>
      </div>
      <div class="item-acoes"><button data-a="ver">Ver</button><button data-a="dup">Duplicar</button><button data-a="cmp">Comparar</button><button data-a="excluir" class="excluir">Excluir</button></div>`;
    div.querySelector('[data-a="ver"]').addEventListener("click", () => verOrcamentoSalvo(o.id));
    div.querySelector('[data-a="dup"]').addEventListener("click", () => duplicarOrcamento(o.id));
    div.querySelector('[data-a="cmp"]').addEventListener("click", () => marcarComparar(o.id, div));
    div.querySelector('[data-a="excluir"]').addEventListener("click", async () => {
      const ok = await pedirConfirmacao("Excluir orçamento?", "Apaga este orçamento salvo.", "Excluir");
      if (!ok) return;
      salvarOrcamentos(lerOrcamentos().filter((x) => x.id !== o.id));
      try { if (typeof SyncOrc !== "undefined") SyncOrc.apagarOrcamentoRemoto(o); } catch (e) {}
      renderOrcamentosSalvos();
      mostrarToast("Orçamento excluído.");
    });
    lista.appendChild(div);
  }
}
// Mostra um orçamento salvo (com etapa, memória de cálculo e encargos).
function verOrcamentoSalvo(id) {
  const o = lerOrcamentos().find((x) => x.id === id);
  if (!o) return;
  const box = elOrcDetalhe();
  if (!box) return;
  const obra = nomeObraOrc(o.obraId);
  let html = `<div class="card"><h3 class="titulo-secao" style="margin-top:0">Orçamento ${o.area} m² — ${formatarData(o.data)}</h3>`;
  if (obra) html += `<p class="texto-suave">Obra: <strong>${proteger(obra)}</strong></p>`;
  html += `<p class="texto-suave">${o.alvenaria === "bloco" ? "Bloco de concreto" : "Tijolo cerâmico"}`;
  if (o.parametros && o.parametros.versao) html += ` • parâmetros v${o.parametros.versao}`;
  html += `</p>`;
  html += `<p class="texto-suave">Estimativa salva (coeficientes são hipóteses). NÃO é orçamento executivo — confira os quantitativos antes de comprar.</p>`;
  // Agrupa por etapa, preservando a ordem salva.
  const etapas = [];
  for (const it of o.itens || []) {
    const et = it.etapa || "Itens";
    let g = etapas.find((x) => x.nome === et);
    if (!g) { g = { nome: et, itens: [] }; etapas.push(g); }
    g.itens.push(it);
  }
  for (const g of etapas) {
    const sub = g.itens.reduce((s, it) => s + (it.total || 0), 0);
    html += `<h3 class="titulo-secao">${proteger(g.nome)} — ${moeda(sub)}</h3>`;
    for (const it of g.itens) {
      html += `<p><strong>${proteger(it.nome)}</strong>: ${it.qtd ?? "—"} ${proteger(it.unidade || "")} × ` +
        `${it.preco ? moeda(it.preco) : "sem preço"} = <strong>${it.total === null || it.total === undefined ? "—" : moeda(it.total)}</strong></p>`;
      if (it.detalhe && it.detalhe.length) {
        html += it.detalhe.map((d) => `<p class="texto-suave">${proteger(String(d))}</p>`).join("");
      }
    }
  }
  const bdi = o.bdi;
  if (bdi && (bdi.imp || bdi.trib || bdi.lucro)) {
    html += `<p class="texto-suave">Encargos: imprevistos ${(Number(bdi.imp || 0) * 100).toFixed(1)}%, ` +
      `impostos ${(Number(bdi.trib || 0) * 100).toFixed(1)}%, margem ${(Number(bdi.lucro || 0) * 100).toFixed(1)}% ` +
      `→ venda ${moeda(bdi.venda)}</p>`;
  }
  html += `<h3 class="titulo-secao">Total: ${moeda(o.total)}</h3>`;
  html += `<button class="btn btn-texto" id="orc-det-fechar">Fechar</button></div>`;
  box.innerHTML = html;
  const f = document.getElementById("orc-det-fechar");
  if (f) f.addEventListener("click", () => { box.innerHTML = ""; });
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}
// Recarrega um orçamento salvo nos campos da tela (para ajustar e recalcular).
function duplicarOrcamento(id) {
  const o = lerOrcamentos().find((x) => x.id === id);
  if (!o) return;
  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v; };
  const p = (o.parametros && o.parametros.entradas) || {};
  set("og-area", o.area || "");
  set("og-quartos", p.quartos ?? "");
  set("og-banheiros", p.banheiros ?? "");
  set("og-sistema", o.alvenaria || "bloco");
  set("og-perimetro", p.perimetro || "");
  set("og-telhado", p.telhado || "");
  set("og-par-comp", p.parComp || "");
  set("og-par-alt", p.parAlt || "");
  set("og-par-vaos", p.parVaos || "");
  set("og-peletricos", p.peletricos || "");
  set("og-phidraulicos", p.phidraulicos || "");
  set("og-mo-dias", p.moDias || "");
  set("og-mo-diaria", p.moDiaria || "");
  set("og-transporte", p.transporte || "");
  set("og-outros", p.outros || "");
  // Repõe os preços-base usados (quando foram salvos).
  const precos = (o.parametros && o.parametros.precos) || {};
  document.querySelectorAll("[data-og-preco]").forEach((i) => {
    const v = precos[i.dataset.ogPreco];
    if (v !== undefined && v !== null) i.value = v;
  });
  // Dados técnicos (Seções 2,4,5,6): repõe a tela para o recálculo bater com o salvo.
  const tec = (o.parametros && o.parametros.tecnicos) || {};
  set("og-pintura-faces", tec.pinturaFaces || 1);
  set("og-pintura-teto", tec.pinturaTeto || "");
  set("og-telha-modelo", tec.telhaModelo || "");
  set("og-telha-un", tec.telhaUnM2 || "");
  const escopo = Array.isArray(tec.moEscopo) ? tec.moEscopo : [];
  document.querySelectorAll(".og-mo-escopo").forEach((c) => { c.checked = escopo.indexOf(c.value) >= 0; });
  // Fundação e medição ficam no aparelho; repõe para ESTE orçamento (evita misturar obras).
  try {
    if (o.parametros && o.parametros.fundacao && typeof OrcPro !== "undefined" && typeof OrcPro.salvarFundacao === "function") {
      OrcPro.salvarFundacao(o.parametros.fundacao);
      const aco = o.parametros.fundacao.acoKgM3;
      set("og-acofund-kgm3", aco > 0 ? aco : "");
    }
    if (o.parametros && o.parametros.medicao && typeof OrcPro !== "undefined" && typeof OrcPro.salvarMedicaoAtual === "function") {
      OrcPro.salvarMedicaoAtual(o.parametros.medicao);
    }
    if (typeof OrcProUI !== "undefined" && typeof OrcProUI.render === "function") OrcProUI.render();
  } catch (err) {}
  const sel = document.getElementById("og-obra");
  if (sel && o.obraId) sel.value = o.obraId;
  mostrarToast("Dados carregados. Toque em Calcular para atualizar.");
  const calc = document.getElementById("og-calcular");
  if (calc) calc.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- ORÇAMENTO GUIADO (preços + medidas = estimativa) ----------
const OG_ITENS = [
  ["piso", "Piso (R$/m²)", "Piso cerâmico"],
  ["bloco", "Bloco/tijolo (R$/un)", "Bloco de concreto"],
  ["cimento", "Cimento (R$/saco)", "Cimento CP-II 50kg"],
  ["tinta", "Tinta (R$/L)", "Tinta acrílica 18L"],
  ["porta", "Porta (R$/un)", "Porta pronta 80cm"],
  ["janela", "Janela (R$/un)", "Janela alumínio 100x120"],
  ["concreto", "Concreto (R$/m³)", null],
  ["aco", "Aço (R$/kg)", "Aço CA-50 8mm"],
  ["telha", "Telha (R$/un)", "Telha romana"],
  ["madeiramento", "Madeiramento (R$/m²)", null],
  ["peletrico", "Ponto elétrico (R$)", null],
  ["phidraulico", "Ponto hidráulico (R$)", null],
  ["modiaria", "Diária MO (R$)", null],
  ["argamassa", "Argamassa assent. (R$/m³)", null],
  ["contrapiso", "Contrapiso (R$/m³)", null],
  ["revestimento", "Revest. faces extra (R$/m²)", null],
];
function ogPrecos() {
  try { return JSON.parse(localStorage.getItem("mario_orc_precos_v1")) || {}; } catch (e) { return {}; }
}
function ogSalvarPrecos(p) {
  try { localStorage.setItem("mario_orc_precos_v1", JSON.stringify(p)); } catch (e) {}
}
function desenharPrecosOG() {
  const box = document.getElementById("orc-precos-lista");
  if (!box) return;
  const salvos = ogPrecos();
  let catalogo = {};
  try {
    if (typeof lerMateriais === "function") {
      for (const m of lerMateriais()) {
        if (m.ativo && m.preco > 0) {
          const k = m.nome.toLowerCase();
          if (/piso/.test(k)) catalogo.piso = m.preco;
          else if (/bloco/.test(k)) catalogo.bloco = m.preco;
          else if (/tijolo/.test(k)) catalogo.tijolo = m.preco;
          else if (/cimento/.test(k)) catalogo.cimento = m.preco;
          else if (/tinta/.test(k)) catalogo.tinta = m.preco;
          else if (/porta/.test(k)) catalogo.porta = m.preco;
          else if (/janela/.test(k)) catalogo.janela = m.preco;
          else if (/aço|aco/.test(k)) catalogo.aco = m.preco;
          else if (/telha/.test(k)) catalogo.telha = m.preco;
          else if (/concreto/.test(k)) catalogo.concreto = m.preco;
        }
      }
    }
  } catch (e) {}
  box.innerHTML = "";
  for (const [chave, rotulo] of OG_ITENS) {
    let v = salvos[chave];
    if ((v === undefined || v === null || v === "") && catalogo[chave] !== undefined) v = catalogo[chave];
    if (chave === "bloco") {
      const sist = (document.getElementById("og-sistema") || {}).value || "bloco";
      if ((v === undefined || v === null || v === "") && sist === "tijolo" && catalogo.tijolo !== undefined) v = catalogo.tijolo;
    }
    box.innerHTML += `<label class="campo"><span>${rotulo}</span>` +
      `<input type="number" data-og-preco="${chave}" value="${v ?? ""}" min="0" step="0.01" inputmode="decimal" placeholder="—" /></label>`;
  }
}
// ---------- Motor determinístico do orçamento guiado (PURO / testável) ----------
// Recebe um objeto `e` com as medidas e preços e devolve os quantitativos.
// Nenhuma IA aqui: só a fórmula, com os coeficientes de PARAMS_ORC.
// `e` = { area, quartos, banheiros, sistema, perimetro, telhado,
//         parComp, parAlt, parVaos, peletricos, phidraulicos,
//         moDias, moDiaria, transporte, outros, precos:{piso,bloco,...} }
// ---------- Fundação por ELEMENTO (pura - Seção 2) ----------
// O usuário informa dimensões/quantidades POR ELEMENTO. O sistema NÃO dimensiona
// estrutura nem transforma perímetro em seção: só multiplica o que foi informado.
// Sem dados → marca "pendente de dimensionamento/confirmação técnica".
// Formato: fund = {
//   sapatas:[{comp,larg,alt,qtd}], baldrames:[...], pilares:[...], vigas:[...],
//   laje:{area,espessura}, acoKgM3 }   (qualquer subconjunto; nomes alternativos ok)
function calcularFundacaoPorElementos(fund) {
  const f = fund || {};
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const elementos = [], faltando = [];
  let volume = 0, incompletos = 0, informados = 0;
  const grupos = [["sapatas", "Sapatas"], ["baldrames", "Baldrames"], ["pilares", "Pilares"], ["vigas", "Vigas"]];
  for (const [chave, rotulo] of grupos) {
    const arr = Array.isArray(f[chave]) ? f[chave] : [];
    let vol = 0, nOk = 0, nInc = 0;
    for (const el of arr) {
      const comp = num(el && (el.comp != null ? el.comp : el.comprimento));
      const larg = num(el && (el.larg != null ? el.larg : el.seccaoLarg));
      const alt = num(el && (el.alt != null ? el.alt : el.seccaoAlt));
      const qtd = num(el && el.qtd) || 1;
      if (!(comp > 0) || !(larg > 0) || !(alt > 0)) { nInc++; incompletos++; continue; }
      vol += comp * larg * alt * qtd; nOk++;
    }
    if (nOk > 0) { elementos.push({ tipo: chave, nome: rotulo, volume: r3(vol), qtd: nOk }); volume += vol; informados++; }
    else if (nInc > 0) faltando.push(rotulo + ": " + nInc + " elemento(s) com dimensão incompleta");
  }
  const laje = f.laje || null;
  if (laje) {
    const areaL = num(laje.area), esp = num(laje.espessura != null ? laje.espessura : laje.esp);
    if (areaL > 0 && esp > 0) { const v = areaL * esp; elementos.push({ tipo: "laje", nome: "Laje (fundo/piso)", volume: r3(v), qtd: 1 }); volume += v; informados++; }
    else faltando.push("Laje: informe área e espessura");
  }
  const acoKgM3 = num(f.acoKgM3);
  const volumeConcreto = r3(volume);
  const acoKg = acoKgM3 > 0 ? Math.ceil(volumeConcreto * acoKgM3) : null;
  return {
    ok: informados > 0, elementos, volumeConcreto, acoKg,
    acoKgM3: acoKgM3 > 0 ? acoKgM3 : null, faltando, incompletos,
    pendenteDimensionamento: informados === 0,
    ausentes: grupos.filter(([c]) => !(Array.isArray(f[c]) && f[c].length)).map((x) => x[1]),
    origem: "dimensões e quantidades informadas por elemento", hipotese: false, conf: 1,
  };
}

function calcularOrcamentoGuiado(e) {
  const area = Number(e.area) || 0;
  const quartos = Math.max(0, parseInt(e.quartos || "0", 10));
  const banheiros = Math.max(0, parseInt(e.banheiros || "0", 10));
  const sist = e.sistema || "bloco";
  const P = e.precos || {};
  // Parede: geometria real se informada, senão fator estimado (sinalizado)
  const gv = (v) => String(v == null ? "" : v).trim().replace(/,/g, ".");
  const gComp = Number(gv(e.parComp)), gAlt = Number(gv(e.parAlt));
  const gVaos = gv(e.parVaos).split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
    const p = s.toLowerCase().split("x");
    return { larg: Number(p[0]), alt: Number(p[1]) };
  });
  // Fase 2: medição por VÁRIAS paredes (opcional e aditivo). Se `e.paredes` tiver
  // uma lista válida de paredes medidas, a área de parede é a soma exata das
  // áreas líquidas; caso contrário mantém-se o comportamento anterior (parede
  // única ou fator estimado). Ausente → nada muda (compatibilidade total).
  const geoLista = (Array.isArray(e.paredes) && e.paredes.length) ? areaParedesPorLista(e.paredes) : null;
  let geo = null, geoModo = null;
  if (geoLista && geoLista.ok) {
    geo = { bruta: geoLista.bruta, vaos: geoLista.vaos, liquida: geoLista.liquida, invalidos: geoLista.vaosInvalidos };
    geoModo = "lista";
  } else if (gComp > 0 && gAlt > 0) {
    geo = paredeLiquida(gComp, gAlt, gVaos);
    geoModo = geo ? "unica" : null;
  }
  const areaParede = geo ? geo.liquida : area * PARAMS_ORC.PAREDE_POR_AREA.valor;
  const paredeOrigem = geo
    ? (geoModo === "lista"
        ? `medido por ${e.paredes.length} parede(s): líquida = ${geo.liquida} m²`
        : `medido: ${gComp}×${gAlt} − vãos = ${geo.liquida} m²`)
    : `estimado: ${area} × ${PARAMS_ORC.PAREDE_POR_AREA.valor}`;
  // Flags de transparência: o que veio do usuário e o que o sistema estimou.
  const geoMedida = !!geo;
  const vaosInvalidos = geo ? (geo.invalidos || 0) : 0;
  const qPiso = area * PARAMS_ORC.PISO_PERC_AREA.valor * (1 + PARAMS_ORC.PERDA_PISO.valor);
  const consUn = sist === "bloco" ? PARAMS_ORC.BLOCO_M2.valor : PARAMS_ORC.TIJOLO_M2.valor;
  const qAlv = Math.ceil(areaParede * consUn * (1 + PARAMS_ORC.PERDA_BLOCO.valor));
  const qCim = Math.ceil(areaParede * PARAMS_ORC.CIMENTO_M2_REBOCO.valor);
  // Pintura por FACES (Seção 4). Default 1 face (comportamento anterior preservado).
  // `e.pinturaFaces` = 1 ou 2; `e.pinturaTeto` = área de teto a pintar (m², opcional).
  const pinturaFaces = Math.max(1, Math.min(2, parseInt(e.pinturaFaces || "1", 10) || 1));
  const pinturaTeto = numeroOuZero(e.pinturaTeto);
  // Quando há MEDIÇÃO real, as faces EXTRAS já viram item próprio ("Reboco e pintura
  // de faces extras"). A base cobre 1 face — forçar 2 aqui contaria a 2ª face duas vezes.
  const medRealFaces = !!(e.medicao && e.medicao.temMedidaReal);
  const facesBase = medRealFaces ? 1 : pinturaFaces;
  const areaPintavel = areaParede * facesBase + pinturaTeto;
  const qTinta = Math.ceil((areaPintavel / PARAMS_ORC.TINTA_REND_M2_L.valor * PARAMS_ORC.TINTA_DEMAOS.valor) * 10) / 10;
  // Medidas editáveis (vazio = estimativa documentada abaixo)
  const perimetroInformado = numeroOuZero(e.perimetro) > 0;
  const telhadoInformado = numeroOuZero(e.telhado) > 0;
  const perim = numeroOuZero(e.perimetro) || Math.round(4 * Math.sqrt(area) * 10) / 10;
  const areaTelhado = numeroOuZero(e.telhado) || Math.round(area * PARAMS_ORC.TELHADO_FATOR.valor * 10) / 10;
  const nPElet = Math.max(0, parseInt(e.peletricos || "0", 10));
  const nPHidr = Math.max(0, parseInt(e.phidraulicos || "0", 10));
  const moDias = Math.max(0, parseInt(e.moDias || "0", 10));
  const moDiaria = numeroOuZero(e.moDiaria);
  const transporte = numeroOuZero(e.transporte);
  const outros = numeroOuZero(e.outros);
  // Escopo da mão de obra (Seção 6): serviços que as diárias JÁ incluem. Serve para
  // AVISAR sobreposição com itens que já têm preço próprio (sem bloquear nada).
  const MO_SERVICOS = {
    alvenaria: { rotulo: "Alvenaria", item: "Bloco de concreto" },
    reboco: { rotulo: "Reboco", item: "Cimento (reboco)" },
    pintura: { rotulo: "Pintura", item: "Tinta" },
    eletrica: { rotulo: "Elétrica", item: "Pontos elétricos" },
    hidraulica: { rotulo: "Hidráulica", item: "Pontos hidráulicos" },
    cobertura: { rotulo: "Cobertura", item: "Telhas" },
    pisos: { rotulo: "Pisos", item: "Piso cerâmico" },
    esquadrias: { rotulo: "Esquadrias", item: "Portas (estimativa: cômodos + 2)" },
    fundacao: { rotulo: "Fundação", item: "Concreto fundação" },
    estrutura: { rotulo: "Estrutura", item: "Concreto laje" },
  };
  const moEscopo = Array.isArray(e.moEscopo) ? e.moEscopo.filter((s) => MO_SERVICOS[s]) : [];
  const moSobreposicoes = moEscopo.map((s) => MO_SERVICOS[s].item);
  // Fundação (sapata corrida): concreto + aço — ESTIMATIVA por perímetro.
  // Só é usada quando NÃO há dados por elemento (e.fundacao). Se houver, o item
  // por elemento substitui este (Seção 2). Sem dados → fica marcada como pendente.
  const concFund = perim * PARAMS_ORC.SAPATA_LARG_M.valor * PARAMS_ORC.SAPATA_ALT_M.valor;
  const acoFund = Math.ceil(concFund * PARAMS_ORC.ACO_FUND_KG_M3.valor);
  // Fundação por elemento (opcional): substitui a estimativa por perímetro.
  const fundElem = (e.fundacao && typeof e.fundacao === "object") ? calcularFundacaoPorElementos(e.fundacao) : null;
  // Laje: concreto + aço
  const concLaje = area * PARAMS_ORC.LAJE_CONC_M3_M2.valor;
  const acoLaje = Math.ceil(area * PARAMS_ORC.ACO_LAJE_KG_M2.valor);
  // Telha: consumo por m² pode ser informado pelo modelo/fabricante (Seção 5).
  // Sem informação → mantém a hipótese 16 un/m² (peça pequena), sinalizada.
  const telhaModelo = (e.telhaModelo != null && String(e.telhaModelo).trim()) ? String(e.telhaModelo).trim() : null;
  const telhaUnM2Informado = numeroOuZero(e.telhaUnM2);
  const telhaUnM2 = telhaUnM2Informado > 0 ? telhaUnM2Informado : PARAMS_ORC.TELHA_M2.valor;
  const qTelha = Math.ceil(areaTelhado * telhaUnM2);
  // Portas e janelas estimadas pelos cômodos (estimativa — confirmar no projeto)
  const qPortas = quartos + banheiros + 2;
  const qJanelas = quartos + banheiros + 1;
  const itens = [
    { nome: "Concreto fundação", etapa: "Fundação", unidade: "m³", qtd: Math.round(concFund * 100) / 100, preco: P.concreto, detalhe: [`${perim} m × ${PARAMS_ORC.SAPATA_LARG_M.valor} × ${PARAMS_ORC.SAPATA_ALT_M.valor}`],
      coef: `sapata ${PARAMS_ORC.SAPATA_LARG_M.valor}×${PARAMS_ORC.SAPATA_ALT_M.valor} m`,
      formula: "perímetro × largura × altura da sapata",
      origem: perimetroInformado ? "perímetro informado + seção padrão" : "perímetro estimado da área + seção padrão",
      conf: 3, limitacao: "Sem projeto estrutural: não considera tipo de solo, escavação, baldrame, pilares ou vigas." },
    { nome: "Aço fundação", etapa: "Fundação", unidade: "kg", qtd: acoFund, preco: P.aco, detalhe: [`${concFund.toFixed(2)} m³ × ${PARAMS_ORC.ACO_FUND_KG_M3.valor} kg/m³`],
      coef: `${PARAMS_ORC.ACO_FUND_KG_M3.valor} kg/m³`,
      formula: "volume de concreto × aço por m³",
      origem: "coeficiente médio de armação (sem projeto)",
      conf: 3, limitacao: "Armação genérica: não substitui memória de cálculo estrutural." },
    { nome: "Concreto laje", etapa: "Estrutura", unidade: "m³", qtd: Math.round(concLaje * 100) / 100, preco: P.concreto, detalhe: [`${area} m² × ${PARAMS_ORC.LAJE_CONC_M3_M2.valor}`],
      coef: `${PARAMS_ORC.LAJE_CONC_M3_M2.valor} m³/m² (~12 cm)`,
      formula: "área construída × espessura por m²",
      origem: "área informada + espessura padrão",
      conf: 3, limitacao: "Assume laje maciça em toda a área: pode ser premoldada, ter sobrado ou não existir." },
    { nome: "Aço laje", etapa: "Estrutura", unidade: "kg", qtd: acoLaje, preco: P.aco, detalhe: [`${area} m² × ${PARAMS_ORC.ACO_LAJE_KG_M2.valor} kg/m²`],
      coef: `${PARAMS_ORC.ACO_LAJE_KG_M2.valor} kg/m²`,
      formula: "área construída × aço por m²",
      origem: "coeficiente médio de armação (sem projeto)",
      conf: 3, limitacao: "Armação genérica: não substitui memória de cálculo estrutural." },
    { nome: "Piso cerâmico", etapa: "Pisos", unidade: "m²", qtd: Math.round(qPiso * 10) / 10, preco: P.piso, detalhe: [`${area} m² × ${PARAMS_ORC.PISO_PERC_AREA.valor} × ${(1 + PARAMS_ORC.PERDA_PISO.valor).toFixed(2)}`],
      coef: `${PARAMS_ORC.PISO_PERC_AREA.valor} da área + ${PARAMS_ORC.PERDA_PISO.valor * 100}% perda`,
      formula: "área construída × fração piso × (1 + perda)",
      origem: "área informada + fração e perda padrão",
      conf: 2, limitacao: "Não desconta paredes nem separa áreas externas (varanda, calçada, quintal)." },
    { nome: sist === "bloco" ? "Bloco de concreto" : "Tijolo cerâmico", etapa: "Alvenaria", unidade: "un", qtd: qAlv, preco: P.bloco, detalhe: [`${areaParede.toFixed(1)} m² × ${consUn} un/m²`],
      coef: `${consUn} un/m² + ${PARAMS_ORC.PERDA_BLOCO.valor * 100}% perda`,
      formula: geoMedida
        ? "parede medida (comprimento × altura − vãos) × consumo/m² × (1 + perda)"
        : "área × fator de parede × consumo/m² × (1 + perda)",
      origem: geoMedida ? "medidas de parede e vãos informados" : "estimativa por fator de parede por área",
      conf: 2, limitacao: geoMedida
        ? "Não diferencia espessura nem paredes internas/externas; vergas e peitoris não descontados."
        : "Parede NÃO medida: quantidade vem de fator médio por área — informe comprimento, altura e vãos para melhorar." },
    { nome: "Cimento (reboco)", etapa: "Reboco e revestimentos", unidade: "sacos", qtd: qCim, preco: P.cimento, detalhe: [`${areaParede.toFixed(1)} m² × ${PARAMS_ORC.CIMENTO_M2_REBOCO.valor}`],
      coef: `${PARAMS_ORC.CIMENTO_M2_REBOCO.valor} saco/m² de parede`,
      formula: "área de parede × cimento por m² de reboco",
      origem: geoMedida ? "parede medida + consumo padrão de reboco" : "parede estimada + consumo padrão de reboco",
      conf: 2, limitacao: "SOMENTE reboco de parede: NÃO é o cimento da obra. Não inclui assentamento de alvenaria, chapisco, contrapiso, baldrame, pilar nem perda." },
    { nome: "Tinta", etapa: "Pintura", unidade: "L", qtd: qTinta, preco: P.tinta, detalhe: [`${areaPintavel.toFixed(1)} m² ÷ ${PARAMS_ORC.TINTA_REND_M2_L.valor} × ${PARAMS_ORC.TINTA_DEMAOS.valor}`, `Área pintável: ${facesBase} face(s) de parede${pinturaTeto ? " + teto " + pinturaTeto + " m²" : " (teto não incluído)"}${medRealFaces ? " — faces extras em item separado" : ""}`],
      coef: `${PARAMS_ORC.TINTA_REND_M2_L.valor} m²/L por demão × ${PARAMS_ORC.TINTA_DEMAOS.valor} demãos`,
      formula: "(área de parede × faces + área de teto) ÷ rendimento × demãos",
      origem: geoMedida ? "parede medida + rendimento padrão" : "parede estimada + rendimento padrão",
      conf: 2, limitacao: medRealFaces
        ? "Medição real: a 1ª face entra aqui e as faces EXTRAS entram no item próprio. O teto só entra se a área for informada."
        : (pinturaFaces >= 2
          ? "Pintura nas 2 faces informada por você. Confira se não há sobreposição com o item de faces extras; tetos só entram se a área for informada."
          : "Pinta UMA face das paredes: paredes internas têm DUAS faces. Informe as faces e a área de teto na medição para não subestimar.") },
    { nome: "Portas (estimativa: cômodos + 2)", etapa: "Esquadrias", unidade: "un", qtd: qPortas, preco: P.porta, detalhe: ["Estimativa pelos cômodos — confirmar no projeto"],
      coef: "quartos + banheiros + 2",
      formula: "número de cômodos + 2",
      origem: "estimativa automática pelos cômodos informados",
      conf: 2, limitacao: "PROVISÓRIO: não usa o projeto. Não confere portas com os vãos informados nem com sala/cozinha." },
    { nome: "Janelas (estimativa: cômodos + 1)", etapa: "Esquadrias", unidade: "un", qtd: qJanelas, preco: P.janela, detalhe: ["Estimativa pelos cômodos — confirmar no projeto"],
      coef: "quartos + banheiros + 1",
      formula: "número de cômodos + 1",
      origem: "estimativa automática pelos cômodos informados",
      conf: 2, limitacao: "PROVISÓRIO: não usa o projeto. Não confere janelas com os vãos informados." },
    { nome: "Telhas", etapa: "Cobertura", unidade: "un", qtd: qTelha, preco: P.telha, detalhe: [`${areaTelhado} m² × ${telhaUnM2} un/m²${telhaModelo ? " (" + telhaModelo + ")" : ""}`],
      coef: telhaUnM2Informado > 0 ? `${telhaUnM2} un/m² (informado)` : `${telhaUnM2} un/m² (hipótese)`,
      formula: "área de telhado × consumo de telha por m²",
      origem: telhaUnM2Informado > 0 ? "consumo/m² informado pelo usuário" : (telhadoInformado ? "área informada + consumo padrão" : "área ESTIMADA + consumo padrão"),
      conf: telhaUnM2Informado > 0 ? 1 : 2, limitacao: telhaUnM2Informado > 0
        ? "Consumo/m² informado pelo usuário. Não inclui inclinação real, cumeeira, calha, rufo ou beiral."
        : `Consumo de ${PARAMS_ORC.TELHA_M2.valor} un/m² é de peça pequena, NÃO de telha romana (8–10 un/m²). Informe o modelo/fabricante ou o consumo/m². Não inclui inclinação, cumeeira, calha ou rufo.` },
    { nome: "Madeiramento", etapa: "Cobertura", unidade: "m²", qtd: areaTelhado, preco: P.madeiramento, detalhe: [`${areaTelhado} m² de telhado`],
      coef: "1 m² de madeiramento por m² de telhado",
      formula: "área de telhado × 1",
      origem: telhadoInformado ? "área de telhado informada" : "área de telhado estimada",
      conf: 2, limitacao: "Não detalha terças, cumeeira, ferragens nem impermeabilização." },
    { nome: "Pontos elétricos", etapa: "Elétrica", unidade: "pt", qtd: nPElet, preco: P.peletrico, detalhe: [nPElet ? `${nPElet} pontos informados` : "Informe os pontos"],
      coef: "1 ponto informado", formula: "soma dos pontos elétricos informados",
      origem: nPElet ? "pontos informados pelo usuário" : "NÃO INFORMADO",
      conf: nPElet ? 1 : 3, limitacao: "Só o ponto: não inclui fiação, quadro, disjuntores, aterramento nem mão de obra elétrica." },
    { nome: "Pontos hidráulicos", etapa: "Hidráulica", unidade: "pt", qtd: nPHidr, preco: P.phidraulico, detalhe: [nPHidr ? `${nPHidr} pontos informados` : "Informe os pontos"],
      coef: "1 ponto informado", formula: "soma dos pontos hidráulicos informados",
      origem: nPHidr ? "pontos informados pelo usuário" : "NÃO INFORMADO",
      conf: nPHidr ? 1 : 3, limitacao: "Só o ponto: não inclui tubos, conexões, louças, metais, aquecedor nem mão de obra hidráulica." },
    { nome: "Mão de obra", etapa: "Mão de obra", unidade: "diárias", qtd: moDias, preco: moDiaria || null, detalhe: [moDias ? `${moDias} dias × ${moeda(moDiaria || 0)}` : "Informe dias e diária", moEscopo.length ? `Escopo informado: ${moEscopo.map((s) => MO_SERVICOS[s].rotulo).join(", ")}` : "Escopo NÃO informado (não sabemos o que as diárias cobrem)"],
      coef: `${moDias} diárias × ${moeda(moDiaria)}`,
      formula: "número de diárias × valor da diária",
      origem: (moDias && moDiaria) ? "dias e diária informados pelo usuário" : "NÃO INFORMADO",
      conf: (moDias && moDiaria) ? 1 : 3, limitacao: moSobreposicoes.length
        ? `ATENÇÃO: o escopo das diárias inclui ${moEscopo.map((s) => MO_SERVICOS[s].rotulo).join(", ")}, que TAMBÉM têm item com preço próprio. Risco de COBRANÇA DUPLA: confira se esses materiais/serviços não estão sendo somados duas vezes.`
        : "ESCOPO NÃO DEFINIDO: se as diárias já incluírem pintura, elétrica ou hidráulica, esses serviços podem estar cobrados DUAS VEZES." },
    { nome: "Transporte", etapa: "Outros", unidade: "R$", qtd: transporte ? 1 : 0, preco: transporte || null, detalhe: ["Valor informado"],
      coef: "valor fixo", formula: "valor informado pelo usuário",
      origem: transporte ? "valor informado pelo usuário" : "NÃO INFORMADO",
      conf: transporte ? 1 : 3, limitacao: "Não é calculado pelo sistema: confira se cobre todas as entregas de material." },
    { nome: "Outros", etapa: "Outros", unidade: "R$", qtd: outros ? 1 : 0, preco: outros || null, detalhe: ["Valor informado"],
      coef: "valor fixo", formula: "valor informado pelo usuário",
      origem: outros ? "valor informado pelo usuário" : "NÃO INFORMADO",
      conf: outros ? 1 : 3, limitacao: "Rubrica genérica: não substitui os serviços ausentes listados na auditoria." },
  ];
  // --- Extensões (só entram quando há MEDIÇÃO real por parede/ambiente) ---
  // São itens NOVOS, adicionados ao MESMO motor. Hipóteses marcadas conf 2.
  // Não alteram os itens base: só somam serviços que faltavam e ficavam na
  // lista "ausentes" da auditoria (assentamento, chapisco, contrapiso).
  const med = e.medicao || null;
  let facesExtras = 0, pisoMedido = 0;
  if (med && med.temMedidaReal) {
    facesExtras = Math.round(Math.max(0, (med.revestimentoFaces || 0) - (med.liquida || 0)) * 100) / 100;
    pisoMedido = med.pisoTotal || 0;
    const qArg = Math.round(areaParede * PARAMS_ORC.ARGAMASSA_ALV_M2.valor * 1000) / 1000;
    itens.push({
      nome: "Argamassa de assentamento", etapa: "Alvenaria", unidade: "m³", qtd: qArg, preco: P.argamassa || null,
      detalhe: [`${areaParede.toFixed(2)} m² × ${PARAMS_ORC.ARGAMASSA_ALV_M2.valor} m³/m²`],
      coef: `${PARAMS_ORC.ARGAMASSA_ALV_M2.valor} m³/m² (hipótese de obra)`,
      formula: "área de parede × argamassa por m² de alvenaria",
      origem: "estimativa por coeficiente de obra (NÃO verificado em norma)",
      conf: 2, limitacao: "Coeficiente NÃO validado: o consumo real depende do traço e da espessura da parede. Confirme com o pedreiro." });
    const qChap = Math.ceil(areaParede * PARAMS_ORC.CHAPISCO_CIM_M2.valor);
    itens.push({
      nome: "Chapisco (cimento)", etapa: "Reboco e revestimentos", unidade: "sacos", qtd: qChap, preco: P.cimento || null,
      detalhe: [`${areaParede.toFixed(2)} m² × ${PARAMS_ORC.CHAPISCO_CIM_M2.valor} saco/m²`],
      coef: `${PARAMS_ORC.CHAPISCO_CIM_M2.valor} saco/m² (hipótese de obra)`,
      formula: "área de parede × cimento por m² de chapisco",
      origem: "estimativa por coeficiente de obra (NÃO verificado)",
      conf: 2, limitacao: "Traço do chapisco NÃO confirmado. Reutiliza o preço do cimento informado." });
    if (facesExtras > 0) {
      itens.push({
        nome: "Reboco e pintura de faces extras", etapa: "Reboco e revestimentos", unidade: "m²", qtd: facesExtras, preco: P.revestimento || null,
        detalhe: [`${med.liquida} m² líquido × (${(facesExtras / med.liquida).toFixed(2)} face(s) extra(s))`],
        coef: "faces 2 − 1 face já coberta pelo reboco/tinta base",
        formula: "Σ(área líquida × (faces − 1))",
        origem: "paredes internas medidas com 2 faces",
        limitacao: "Só as faces EXTRAS (parede interna). A primeira face já entra em Cimento (reboco) e Tinta. NÃO duplica.",
        conf: 1 });
    }
    if (pisoMedido > 0) {
      const volContra = Math.round(pisoMedido * PARAMS_ORC.CONTRAPISO_ESP_M.valor * 1000) / 1000;
      itens.push({
        nome: "Contrapiso (argamassa)", etapa: "Pisos", unidade: "m³", qtd: volContra, preco: P.contrapiso || null,
        detalhe: [`${pisoMedido} m² × ${PARAMS_ORC.CONTRAPISO_ESP_M.valor} m`],
        coef: `espessura ${PARAMS_ORC.CONTRAPISO_ESP_M.valor} m (hipótese)`,
        formula: "área de piso medida × espessura do contrapiso",
        origem: "ambientes medidos + espessura hipotética",
        conf: 2, limitacao: "Espessura do contrapiso NÃO confirmada: depende do nivelamento real do piso." });
      const cimContra = Math.ceil(volContra * PARAMS_ORC.CIMENTO_M3_CONTRAPISO.valor);
      itens.push({
        nome: "Cimento do contrapiso", etapa: "Pisos", unidade: "sacos", qtd: cimContra, preco: P.cimento || null,
        detalhe: [`${volContra} m³ × ${PARAMS_ORC.CIMENTO_M3_CONTRAPISO.valor} saco/m³`],
        coef: `${PARAMS_ORC.CIMENTO_M3_CONTRAPISO.valor} saco/m³ (hipótese de traço)`,
        formula: "volume de contrapiso × cimento por m³ de argamassa",
        origem: "estimativa por traço hipotético",
        conf: 2, limitacao: "Traço NÃO confirmado. Reutiliza o preço do cimento informado." });
    }
  }
  // --- Fundação por ELEMENTO substitui a estimativa por perímetro (Seção 2) ---
  // Com dados informados, cada elemento vira um item (conf 1). Sem dados, a
  // estimativa por perímetro PERMANECE, mas marcada como pendente de dimensionamento.
  let fundacaoPendente = true;
  let fundacaoElementos = [];
  if (fundElem && fundElem.ok) {
    for (let i = itens.length - 1; i >= 0; i--) if (itens[i].etapa === "Fundação") itens.splice(i, 1);
    fundacaoElementos = fundElem.elementos;
    for (const el of fundElem.elementos) {
      itens.push({
        nome: "Concreto " + el.nome, etapa: "Fundação", unidade: "m³", qtd: el.volume, preco: P.concreto,
        detalhe: [`${el.qtd} elemento(s) — volume informado`],
        coef: "comprimento × largura × altura × quantidade (informado)",
        formula: "comprimento × seção (larg × alt) × quantidade",
        origem: "dimensões/quantidades informadas pelo usuário por elemento",
        conf: 1, limitacao: "Calculado com as dimensões informadas; a verificação estrutural é do responsável técnico." });
    }
    if (fundElem.acoKg != null) {
      itens.push({
        nome: "Aço fundação", etapa: "Fundação", unidade: "kg", qtd: fundElem.acoKg, preco: P.aco,
        detalhe: [`${fundElem.volumeConcreto} m³ × ${fundElem.acoKgM3} kg/m³`],
        coef: `${fundElem.acoKgM3} kg/m³ (informado)`,
        formula: "volume de concreto × consumo de aço informado",
        origem: "consumo de aço informado pelo usuário",
        conf: 1, limitacao: "Consumo informado; não substitui a memória de cálculo estrutural." });
      fundacaoPendente = false;
    } else {
      fundacaoPendente = true; // concreto informado, mas AÇO permanece pendente de projeto
    }
  }
  for (const it of itens) it.total = it.preco ? it.qtd * it.preco : null;
  const total = itens.reduce((s, it) => s + (it.total || 0), 0);
  const semPreco = itens.filter((it) => it.total === null).length;
  // Divergência entre vãos informados e esquadrias estimadas (aviso de transparência).
  const esquadriasEstimadas = qPortas + qJanelas;
  const vaosTotais = geoModo === "lista"
    ? e.paredes.reduce((s, p) => s + ((p.vaos || []).filter((x) => Number(x.larg) > 0 && Number(x.alt) > 0).length), 0)
    : gVaos.length;
  const vaosInformados = geoMedida ? vaosTotais - vaosInvalidos : 0;
  const vaosDivergem = geoMedida && vaosInformados > 0 && esquadriasEstimadas !== vaosInformados;
  return { area, quartos, banheiros, sist, itens, total, semPreco, areaParede, paredeOrigem, perim, areaTelhado,
    geoMedida, vaosInvalidos, vaosInformados, esquadriasEstimadas, vaosDivergem,
    perimetroInformado, telhadoInformado, medicao: med || null, facesExtras, pisoMedido,
    pinturaFaces, pinturaTeto, areaPintavel, telhaUnM2, telhaUnM2Informado, telhaModelo,
    moEscopo, moSobreposicoes, fundacaoPendente, fundacaoElementos,
    fundacaoIncompletos: fundElem ? fundElem.incompletos : 0,
    fundacaoFaltando: fundElem ? fundElem.faltando : [],
    fundacaoAusentes: fundElem ? fundElem.ausentes : ["Sapatas", "Baldrames", "Pilares", "Vigas"] };
}

// ---------- Lista de pendências classificada (pura - Seção 8) ----------
// Classifica o que falta em: bloqueante (impede confiar no número),
// importante (muda bastante o custo) e opcional (melhora a precisão).
// Não esconde pendência estrutural. Devolve [{ nvel, oque, porque, resolver }].
function montarPendenciasClassificadas(r) {
  const pend = [];
  const add = (nvel, oque, porque, resolver) => pend.push({ nvel, oque, porque, resolver });
  if (!(r.area > 0)) add("bloqueante", "Área da obra", "é a base de todos os quantitativos", "Informe a área no Raio-X");
  // Fundação: pendência estrutural NUNCA deve ser escondida.
  if (r.fundacaoPendente) {
    add("bloqueante", "Fundação (concreto e aço)",
      "sem dimensões por elemento, a fundação é uma ESTIMATIVA por perímetro — pode divergir muito do real",
      "Informe sapatas/baldrames/pilares/vigas (dimensões e quantidades) ou aguarde o projeto estrutural");
  }
  if (r.fundacaoAusentes && r.fundacaoAusentes.length && !r.fundacaoPendente) {
    add("importante", "Elementos de fundação não informados: " + r.fundacaoAusentes.join(", "),
      "podem existir e não estão no orçamento", "Confirme no projeto estrutural quais elementos existem");
  }
  // Elementos com dimensão incompleta são DESCARTADOS do volume — não podem ficar silenciosos.
  if (r.fundacaoIncompletos > 0) {
    add("importante", "Fundação com dimensão incompleta (" + r.fundacaoIncompletos + " elemento(s))",
      "elemento(s) sem comprimento/largura/altura foram IGNORADOS — o volume de concreto está incompleto",
      "Complete comprimento, largura, altura e quantidade de cada elemento");
  }
  if (!r.geoMedida) add("importante", "Paredes não medidas", "alvenaria, cimento e tinta usam fator médio por área", "Informe comprimento, altura e vãos das paredes");
  if (!r.telhadoInformado) add("importante", "Área de telhado", "telhas e madeiramento usam estimativa pela área", "Informe a área do telhado");
  if (r.telhaUnM2Informado === 0) add("importante", "Consumo de telha por m²", "depende do MODELO da telha (o padrão é de peça pequena)", "Informe o modelo/fabricante ou o consumo por m²");
  if (!r.perimetroInformado) add("opcional", "Perímetro", "a fundação estimada usa um perímetro aproximado", "Informe o perímetro real");
  if (r.pinturaFaces < 2) add("opcional", "Pintura por face", "por padrão pinta 1 face; paredes internas têm 2", "Informe as faces a pintar e a área de teto");
  if (r.moSobreposicoes && r.moSobreposicoes.length) add("importante", "Sobreposição de mão de obra", "o escopo das diárias inclui serviços que já têm item próprio", "Confirme que não há cobrança dupla");
  if (!(r.quartos > 0)) add("opcional", "Quartos", "afeta portas e esquadrias", "Informe no Raio-X");
  if (!(r.banheiros > 0)) add("opcional", "Banheiros", "afeta louças e hidráulica", "Informe no Raio-X");
  for (const it of (r.itens || [])) {
    if (it.total === null) add("importante", "Preço ausente: " + it.nome, "sem preço o total fica parcial", "Cadastre em Materiais ou digite o preço");
  }
  return pend;
}

// ---------- Custos diretos / indiretos / preço de venda (pura - Seção 7) ----------
// Separa o que é CUSTO DIRETO (informado vs. estimado), o que é INDIRETO e o
// que é encargo (impostos, contingência, BDI/margem) até o PREÇO DE VENDA.
// NUNCA apresenta o custo direto como preço final.
function resumoCustosOrcamento(r, cfg) {
  const c = cfg || {};
  const itens = (r && r.itens) || [];
  const comPreco = itens.filter((it) => it.total !== null);
  const semPreco = itens.filter((it) => it.total === null);
  const soma = (l) => l.reduce((s, it) => s + (it.total || 0), 0);
  const diretoInformado = soma(comPreco.filter((it) => (it.conf || 2) === 1));
  const diretoEstimado = soma(comPreco.filter((it) => (it.conf || 2) >= 2));
  const diretoConhecido = diretoInformado + diretoEstimado;
  const indiretos = numeroOuZero(c.indiretos);
  const impostosPerc = numeroOuZero(c.impostosPerc) / 100;
  const contingenciaPerc = numeroOuZero(c.contingenciaPerc) / 100;
  const bdiPerc = numeroOuZero(c.bdiPerc) / 100;
  const base = diretoConhecido + indiretos;
  const imposto = base * impostosPerc;
  const contingencia = base * contingenciaPerc;
  const bdi = base * bdiPerc;
  const venda = base + imposto + contingencia + bdi;
  return {
    diretoInformado, diretoEstimado, diretoConhecido, indiretos, base,
    imposto, contingencia, bdi, venda,
    qtdSemPreco: semPreco.length, semPreco,
    // Transparência: sem todos os preços, o preço de venda é PARCIAL.
    vendaParcial: semPreco.length > 0,
    observacao: "Custo direto NÃO é preço final. Impostos/contingência/BDI incidem sobre (direto + indiretos).",
  };
}

// ---------- Relatório de auditoria (puro / testável) ----------
// Classificação de confiança por item. NÃO é garantia de segurança estrutural
// nem de precisão do orçamento — só indica de onde o número veio.
const ORC_CONF = {
  1: "Calculado com dados informados",
  2: "Estimativa por coeficiente",
  3: "Requer projeto ou confirmação técnica",
};
// Serviços que o orçamento NÃO calcula. Lista documental: sem valores fictícios.
const ORC_AUSENTES = [
  { item: "Cimento de assentamento da alvenaria", etapa: "Alvenaria", dado: "consumo de argamassa por m² de parede e espessura da parede" },
  { item: "Chapisco / emboço", etapa: "Reboco e revestimentos", dado: "área a chapiscar e espessura" },
  { item: "Concretos secundários (baldrame, pilares, vigas, escada)", etapa: "Estrutura", dado: "projeto estrutural" },
  { item: "Escavação, contenção e impermeabilização da fundação", etapa: "Fundação", dado: "tipo de solo e projeto" },
  { item: "Contrapiso (regularização do piso)", etapa: "Pisos", dado: "área e espessura do contrapiso" },
  { item: "Impermeabilização de laje, cozinha e área de serviço", etapa: "Impermeabilização", dado: "área a impermeabilizar" },
  { item: "Forro (gesso, PVC, madeira)", etapa: "Forros", dado: "área de forro e tipo" },
  { item: "Cumeeira, calhas, rufo e beiral", etapa: "Cobertura", dado: "perímetro e tipo de telhado" },
  { item: "Fiação, quadro de distribuição e disjuntores", etapa: "Elétrica", dado: "projeto elétrico (nº de circuitos)" },
  { item: "Tubos, conexões, louças e metais hidráulicos", etapa: "Hidráulica", dado: "projeto hidráulico" },
  { item: "Ferragens, vidros e mosquiteiras das esquadrias", etapa: "Esquadrias", dado: "projeto de esquadrias" },
  { item: "Revestimento de bancadas e áreas molhadas", etapa: "Revestimentos", dado: "área de bancadas e tipo de revestimento" },
  { item: "Pintura de teto e demais superfícies", etapa: "Pintura", dado: "área de teto e de outras superfícies" },
  { item: "Louças e metais (vasos, torneiras, chuveiros)", etapa: "Hidráulica", dado: "quantidade e padrão dos itens" },
  { item: "Pintura de esquadrias, madeiras e metais", etapa: "Pintura", dado: "quantidade de esquadrias e madeiramento" },
  { item: "Projeto técnico, ART e taxas de licença", etapa: "Administrativo", dado: "orçamento do profissional responsável" },
  { item: "BDI, impostos, contingência e margem", etapa: "Comercial", dado: "percentuais de encargos desejados" },
];
function montarAuditoriaOrcamento(r) {
  const linhas = r.itens.map((it) => ({
    nome: it.nome, etapa: it.etapa, qtd: it.qtd, unidade: it.unidade,
    coef: it.coef || "—", formula: it.formula || "—", preco: it.preco,
    total: it.total, origem: it.origem || "—",
    conf: it.conf || 2, confRotulo: ORC_CONF[it.conf || 2],
    limitacao: it.limitacao || null,
  }));
  const porConf = { 1: [], 2: [], 3: [] };
  for (const l of linhas) porConf[l.conf].push(l.nome);
  return {
    linhas, porConf,
    ausentes: ORC_AUSENTES,
    // Campos que o usuário informou e que o sistema ESTIMOU sozinho.
    informados: {
      area: r.area > 0, quartos: r.quartos > 0, banheiros: r.banheiros > 0,
      paredesMedidas: r.geoMedida, perimetro: r.perimetroInformado,
      telhado: r.telhadoInformado, pontosEletricos: r.itens.some((i) => i.nome === "Pontos elétricos" && i.qtd > 0),
      pontosHidraulicos: r.itens.some((i) => i.nome === "Pontos hidráulicos" && i.qtd > 0),
      maoDeObra: r.itens.some((i) => i.nome === "Mão de obra" && i.qtd > 0 && i.preco),
    },
    estimados: {
      paredes: !r.geoMedida, perimetro: !r.perimetroInformado,
      telhado: !r.telhadoInformado, portasJanelas: true,
      fundacaoLaje: true,
    },
    pendencias: montarPendenciasClassificadas(r),
  };
}

// Lê os campos da tela (DOM) para o objeto de entrada do motor puro.
function lerEntradaOrcamentoGuiado() {
  const val = (id) => String((document.getElementById(id) || {}).value || "");
  const precos = {};
  document.querySelectorAll("[data-og-preco]").forEach((i) => {
    const v = numeroOuZero(i.value);
    precos[i.dataset.ogPreco] = v > 0 ? v : null;
  });
  const e = {
    area: numeroOuZero(val("og-area")),
    quartos: val("og-quartos"), banheiros: val("og-banheiros"),
    sistema: val("og-sistema") || "bloco",
    perimetro: numeroOuZero(val("og-perimetro")), telhado: numeroOuZero(val("og-telhado")),
    parComp: val("og-par-comp"), parAlt: val("og-par-alt"), parVaos: val("og-par-vaos"),
    peletricos: val("og-peletricos"), phidraulicos: val("og-phidraulicos"),
    moDias: val("og-mo-dias"), moDiaria: numeroOuZero(val("og-mo-diaria")),
    transporte: numeroOuZero(val("og-transporte")), outros: numeroOuZero(val("og-outros")),
    precos,
  };
  // --- Dados técnicos opcionais (Seções 2,4,5,6) ---
  e.pinturaFaces = parseInt(val("og-pintura-faces") || "1", 10) || 1;
  e.pinturaTeto = numeroOuZero(val("og-pintura-teto"));
  e.telhaModelo = val("og-telha-modelo");
  e.telhaUnM2 = numeroOuZero(val("og-telha-un"));
  e.moEscopo = Array.prototype.slice
    .call(document.querySelectorAll(".og-mo-escopo:checked"))
    .map((i) => i.value);
  // Fundação por elemento (vem do painel profissional, se houver).
  try {
    if (typeof OrcProUI !== "undefined" && typeof OrcProUI.fundacaoParaMotor === "function") {
      const f = OrcProUI.fundacaoParaMotor();
      const temElemento = f && ((f.sapatas && f.sapatas.length) || (f.baldrames && f.baldrames.length) ||
        (f.pilares && f.pilares.length) || (f.vigas && f.vigas.length) || f.laje);
      const acoGuiado = numeroOuZero(val("og-acofund-kgm3"));
      const acoFinal = acoGuiado > 0 ? acoGuiado : (f && Number(f.acoKgM3) > 0 ? Number(f.acoKgM3) : 0);
      if (temElemento || acoFinal > 0) {
        e.fundacao = Object.assign({}, f || {});
        e.fundacao.acoKgM3 = acoFinal > 0 ? acoFinal : null;
      }
    }
  } catch (err) {}
  // Fase 2: se houver medição por ambiente/parede (modo detalhado), traduz para o
  // MESMO motor via OrcPro (não recalcula nada aqui). Sem medição → nada muda.
  // No modo rápido (A) a medição é ignorada de propósito.
  try {
    let modo = "A";
    try { modo = localStorage.getItem("mario_orc_modo_v1") || "A"; } catch (err) {}
    if (modo !== "A" && typeof OrcPro !== "undefined" && typeof OrcPro.lerMedicaoAtual === "function") {
      const m = OrcPro.lerMedicaoAtual();
      if (m && ((m.paredes && m.paredes.length) || (m.ambientes && m.ambientes.length))) {
        return OrcPro.montarEntradaMotor(m, e, precos);
      }
    }
  } catch (err) {}
  return e;
}

// Retrato dos parâmetros/medidas/preços usados (para persistir e auditar depois).
function snapshotParametrosOrcamento(e) {
  const coef = {};
  for (const k of Object.keys(PARAMS_ORC)) coef[k] = PARAMS_ORC[k].valor;
  return {
    versao: 1,
    coeficientes: coef,
    entradas: {
      quartos: Math.max(0, parseInt(e.quartos || "0", 10)),
      banheiros: Math.max(0, parseInt(e.banheiros || "0", 10)),
      sistema: e.sistema || "bloco",
      perimetro: numeroOuZero(e.perimetro), telhado: numeroOuZero(e.telhado),
      parComp: e.parComp || null, parAlt: e.parAlt || null, parVaos: e.parVaos || null,
      peletricos: e.peletricos || null, phidraulicos: e.phidraulicos || null,
      moDias: e.moDias || null, moDiaria: e.moDiaria || null,
      transporte: e.transporte || null, outros: e.outros || null,
    },
    // Dados técnicos opcionais (Seções 2,4,5,6): ficam registrados para o orçamento
    // salvo não depender do estado global do aparelho.
    tecnicos: {
      pinturaFaces: e.pinturaFaces || 1, pinturaTeto: numeroOuZero(e.pinturaTeto),
      telhaModelo: e.telhaModelo || null, telhaUnM2: numeroOuZero(e.telhaUnM2),
      moEscopo: Array.isArray(e.moEscopo) ? e.moEscopo.slice() : [],
    },
    fundacao: e.fundacao || null,
    medicao: e.medicao || null,
    precos: e.precos || {},
  };
}

function estimarObra() {
  const e = lerEntradaOrcamentoGuiado();
  const area = Number(e.area) || 0;
  if (!(area > 0)) { mostrarToast("Informe a área da casa.", false); return; }
  const r = calcularOrcamentoGuiado(e);
  const { quartos, banheiros, sist, itens, total, semPreco, paredeOrigem } = r;
  const aud = montarAuditoriaOrcamento(r);
  const parcial = semPreco > 0;
  let html = `<div class="card"><p class="texto-suave"><strong>ESTIMATIVA PRELIMINAR</strong> — valor APROXIMADO para planejamento. Não use como orçamento de obra.</p><h3 class="titulo-secao" style="margin-top:0">Cerca de ${moeda(total)}${parcial ? " (parcial — falta preço de " + semPreco + " item(ns))" : ""}</h3>`;
  html += `<p class="texto-suave">Custo DIRETO (sem BDI, impostos, margem nem contingência). ${area} m² • ${quartos} quartos • ${banheiros} banheiros • ${sist === "bloco" ? "Bloco" : "Tijolo"} • <strong>${moeda(total / area)}/m²</strong>${parcial ? " — este /m² é parcial" : ""}</p>`;
  html += `<p class="texto-suave">Parede: ${paredeOrigem}.</p>`;
  for (const it of itens) {
    const qtdTxt = it.unidade === "R$" ? "valor fixo" : `${it.qtd} ${proteger(it.unidade)}`;
    html += `<p><strong>${proteger(it.nome)}</strong>: ${qtdTxt} × ` +
      `${it.preco ? moeda(it.preco) : "sem preço"} = <strong>${it.total === null ? "—" : moeda(it.total)}</strong></p>`;
  }
  if (semPreco) html += `<p class="texto-suave">Faltam ${semPreco} preço(s) — preencha no passo 1.</p>`;
  html += `<p class="texto-suave">Estimativa preliminar: portas e janelas chutadas pelos cômodos. Confirme no projeto.</p>`;
  html += `<button class="btn btn-primario btn-grande" id="og-salvar">Salvar orçamento</button></div>`;
  html += desenharAuditoriaOrcamento(r, aud);
  const box = document.getElementById("og-resultado");
  if (!box) return;
  box.innerHTML = html;
  document.getElementById("og-salvar").addEventListener("click", () => {
    const lista = lerOrcamentos();
    const obraSel = (document.getElementById("og-obra") || {}).value || null;
    lista.unshift({
      id: Date.now().toString(36), data: hojeISO(), obraId: obraSel,
      area, alvenaria: sist, total,
      parametros: snapshotParametrosOrcamento(e),
      itens: itens.map((it, i) => ({
        nome: it.nome, etapa: it.etapa, qtd: it.qtd, unidade: it.unidade,
        preco: it.preco, total: it.total, detalhe: it.detalhe, posicao: i,
      })),
    });
    salvarOrcamentos(lista.slice(0, 30));
    try {
      if (typeof SyncOrc !== "undefined") {
        SyncOrc.empurrarOrcamento(lista[0]).then((res) => {
          if (res && res.ok) salvarOrcamentos(lerOrcamentos());
          mostrarToast(msgSync(res), !!(res && res.ok));
        }).catch(() => mostrarToast(msgSync({ ok: false, status: "rede" }), false));
      } else mostrarToast(msgSync(false), false);
    } catch (err) { mostrarToast(msgSync(false), false); }
    try { if (typeof renderOrcamentosSalvos === "function") renderOrcamentosSalvos(); } catch (err) {}
  });
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Painel "Auditoria do orçamento" (só apresentação) ----------
// Mostra, item a item, de onde veio cada número. NÃO altera cálculo nenhum.
function desenharAuditoriaOrcamento(r, aud) {
  const chip = (conf) => {
    const cls = conf === 1 ? "aud-ok" : conf === 2 ? "aud-medio" : "aud-alerta";
    return `<span class="aud-chip ${cls}">${ORC_CONF[conf]}</span>`;
  };
  // Avisos de transparência derivados dos dados reais do cálculo.
  const avisos = [];
  if (!r.geoMedida) avisos.push("Paredes NÃO medidas: alvenaria, cimento e tinta usam um fator médio por área (2,8 m² de parede por m² de casa). Informe comprimento, altura e vãos para melhorar.");
  if (r.vaosInvalidos) avisos.push(`${r.vaosInvalidos} vau(s) com formato inválido foram ignorados. Use o formato 0,80x2,10 separados por ponto e vírgula.`);
  if (r.vaosDivergem) avisos.push(`Foram informados ${r.vaosInformados} vau(s), mas a regra de cômodos estima ${r.esquadriasEstimadas} portas+janelas. Confira no projeto — pode haver porta ou janela não prevista.`);
  if (!r.perimetroInformado) avisos.push("Perímetro não informado: a fundação usa um perímetro estimado pela área.");
  if (!r.telhadoInformado) avisos.push("Área de telhado não informada: telhas e madeiramento usam um valor estimado pela área construída.");
  const mo = r.itens.find((i) => i.nome === "Mão de obra");
  if (mo && mo.qtd > 0 && mo.preco) avisos.push("A Mão de obra não tem escopo definido: se as diárias já incluírem pintura, elétrica ou hidráulica, esses serviços aparecem cobrados DUAS VEZES.");
  avisos.push("Este total NÃO é um orçamento fechado: revise com responsável técnico antes de contratar.");

  let h = `<div class="card aud-card"><h3 class="titulo-secao" style="margin-top:0">Auditoria do orçamento</h3>`;
  h += `<p class="texto-suave">Cada linha abaixo mostra como o número foi obtido. A classificação indica a ORIGEM do dado — não é garantia de segurança estrutural nem de precisão do orçamento.</p>`;
  if (avisos.length) {
    h += `<div class="aud-avisos"><strong>Pontos de atenção</strong><ul>`;
    for (const a of avisos) h += `<li>${a}</li>`;
    h += `</ul></div>`;
  }
  h += `<div class="aud-resumo">`;
  h += `<div><strong>Informado por você</strong><ul>${Object.keys(aud.informados).filter((k) => aud.informados[k]).map((k) => `<li>${k}</li>`).join("") || "<li class='texto-suave'>nenhum</li>"}</ul></div>`;
  h += `<div><strong>Estimado pelo sistema</strong><ul>${Object.keys(aud.estimados).filter((k) => aud.estimados[k]).map((k) => `<li>${k}</li>`).join("") || "<li class='texto-suave'>nenhum</li>"}</ul></div>`;
  h += `</div>`;
  h += `<p class="texto-suave"><strong>Itens por nível:</strong> informado: ${aud.porConf[1].length} • coeficiente: ${aud.porConf[2].length} • requer projeto: ${aud.porConf[3].length}</p>`;
  h += `<table class="aud-tabela"><thead><tr><th>Material / serviço</th><th>Qtd.</th><th>Un.</th><th>Coeficiente</th><th>Fórmula</th><th>Preço unit.</th><th>Subtotal</th><th>Origem</th><th>Confiança</th><th>Limitações</th></tr></thead><tbody>`;
  for (const l of aud.linhas) {
    h += `<tr><td data-l="Material">${proteger(l.nome)}</td>` +
      `<td data-l="Qtd.">${l.qtd}</td>` +
      `<td data-l="Un.">${proteger(l.unidade)}</td>` +
      `<td data-l="Coeficiente">${l.coef}</td>` +
      `<td data-l="Fórmula">${l.formula}</td>` +
      `<td data-l="Preço unit.">${l.preco ? moeda(l.preco) : "sem preço"}</td>` +
      `<td data-l="Subtotal"><strong>${l.total === null ? "—" : moeda(l.total)}</strong></td>` +
      `<td data-l="Origem">${l.origem}</td>` +
      `<td data-l="Confiança">${chip(l.conf)}</td>` +
      `<td data-l="Limitações" class="aud-limitacao">${l.limitacao || "—"}</td></tr>`;
  }
  h += `</tbody></table>`;
  // Lista de pendências CLASSIFICADA (Seção 8): nunca esconde pendência estrutural.
  const pend = (aud.pendencias || montarPendenciasClassificadas(r));
  if (pend.length) {
    const rot = { bloqueante: "Bloqueante (impede confiar no número)", importante: "Importante (muda bastante o custo)", opcional: "Opcional (melhora a precisão)" };
    h += `<h4 class="aud-subtitulo">Pendências (${pend.length})</h4>`;
    for (const nvel of ["bloqueante", "importante", "opcional"]) {
      const doNivel = pend.filter((p) => p.nvel === nvel);
      if (!doNivel.length) continue;
      const cls = nvel === "bloqueante" ? "aud-alerta" : nvel === "importante" ? "aud-medio" : "aud-ok";
      h += `<p><span class="aud-chip ${cls}">${rot[nvel]}</span></p><ul class="aud-ausentes">`;
      for (const p of doNivel) h += `<li><strong>${proteger(p.oque)}</strong> — ${proteger(p.porque)}. <span class="texto-suave">Resolver: ${proteger(p.resolver)}</span></li>`;
      h += `</ul>`;
    }
  }
  h += `<h4 class="aud-subtitulo">O que NÃO está neste orçamento</h4>`;
  h += `<p class="texto-suave">Serviços e materiais ausentes — sem valor porque os dados necessários não foram informados:</p><ul class="aud-ausentes">`;
  for (const a of aud.ausentes) h += `<li><strong>${a.item}</strong> <span class="texto-suave">(${a.etapa}) — falta: ${a.dado}</span></li>`;
  h += `</ul>`;
  h += `<p class="texto-suave">O total acima é <strong>custo direto aproximado</strong>. Não inclui os itens desta lista, nem BDI, impostos ou margem. Confirme com responsável técnico antes de usar na obra.</p>`;
  h += `</div>`;
  return h;
}
// ---------- Preenchimento automático para testes ----------
// Casa fictícia de 100 m². NÃO é uma obra do banco: o seletor fica "sem vínculo".
// Os valores são apenas colocados nos CAMPOS da tela; o cálculo só roda quando o
// usuário tocar em "Calcular". Os preços de teste NÃO são salvos (use "Salvar preços"
// se quiser torná-los permanentes).
const DADOS_TESTE_OG = {
  campos: {
    "og-area": 100, "og-quartos": 3, "og-banheiros": 2, "og-sistema": "bloco",
    "og-perimetro": 40, "og-telhado": 120,
    "og-par-comp": 80, "og-par-alt": 2.8,
    "og-par-vaos": "0,80x2,10;0,80x2,10;0,80x2,10;1,20x1,00;1,20x1,00;1,50x1,00",
    "og-peletricos": 30, "og-phidraulicos": 12,
    "og-mo-dias": 120, "og-mo-diaria": 180,
    "og-transporte": 2000, "og-outros": 1500,
  },
  precos: {
    piso: 45, bloco: 3.5, cimento: 40, tinta: 35, porta: 450, janela: 350,
    concreto: 450, aco: 8.5, telha: 5, madeiramento: 65,
    peletrico: 120, phidraulico: 180, modiaria: 180,
    argamassa: 320, contrapiso: 280, revestimento: 55,
  },
};
function preencherDadosTesteOG() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  for (const id of Object.keys(DADOS_TESTE_OG.campos)) set(id, DADOS_TESTE_OG.campos[id]);
  // Não vincula a nenhuma obra real do banco.
  set("og-obra", "");
  // Preenche os preços nos campos (sem salvar em localStorage).
  document.querySelectorAll("[data-og-preco]").forEach((i) => {
    const v = DADOS_TESTE_OG.precos[i.dataset.ogPreco];
    if (v !== undefined) i.value = v;
  });
  mostrarToast("Dados de teste preenchidos. Toque em Calcular para ver o resultado.");
  const calc = document.getElementById("og-calcular");
  if (calc) calc.scrollIntoView({ behavior: "smooth", block: "center" });
}

function ligarOrcamentoGuiado() {
  const b = document.getElementById("og-calcular");
  if (b && !b.dataset.ligado) {
    b.dataset.ligado = "1";
    b.addEventListener("click", estimarObra);
  }
  const s = document.getElementById("orc-precos-salvar");
  if (s && !s.dataset.ligado) {
    s.dataset.ligado = "1";
    s.addEventListener("click", () => {
      const p = {};
      document.querySelectorAll("[data-og-preco]").forEach((i) => {
        const v = numeroOuZero(i.value);
        p[i.dataset.ogPreco] = v > 0 ? v : null;
      });
      ogSalvarPrecos(p);
      mostrarToast("Preços salvos!");
    });
  }
  const sist = document.getElementById("og-sistema");
  if (sist && !sist.dataset.ligado) {
    sist.dataset.ligado = "1";
    sist.addEventListener("change", desenharPrecosOG);
  }
  const bt = document.getElementById("og-preencher-teste");
  if (bt && !bt.dataset.ligado) {
    bt.dataset.ligado = "1";
    bt.addEventListener("click", preencherDadosTesteOG);
  }
  // Obras no seletor + lista de salvos; atualiza ao abrir a tela.
  const atualizar = () => {
    try { atualizarObrasOrcamento(); } catch (e) {}
    try { renderOrcamentosSalvos(); } catch (e) {}
  };
  atualizar();
  document.querySelectorAll('[data-ir="orcamento"]').forEach((b) => {
    if (!b.dataset.orcLigado) {
      b.dataset.orcLigado = "1";
      b.addEventListener("click", () => setTimeout(atualizar, 150));
    }
  });
  const qo = document.getElementById("qa-orc-ia");
  if (qo && !qo.dataset.orcLigado) {
    qo.dataset.orcLigado = "1";
    qo.addEventListener("click", () => setTimeout(atualizar, 150));
  }
  desenharPrecosOG();
}

// ---------- Comparar duas versões salvas ----------
let cmpSel = [];
function marcarComparar(id, div) {
  if (cmpSel.includes(id)) cmpSel = cmpSel.filter((x) => x !== id);
  else { cmpSel.push(id); cmpSel = cmpSel.slice(-2); }
  document.querySelectorAll("#lista-orcamentos .item").forEach((el) => el.classList.remove("selecionado"));
  if (cmpSel.length === 2) {
    desenharComparacao(cmpSel[0], cmpSel[1]);
    cmpSel = [];
  } else {
    if (div) div.classList.add("selecionado");
    mostrarToast("Toque em outro orçamento para comparar.");
  }
}
function desenharComparacao(idA, idB) {
  const linhas = compararOrcamentos(idA, idB);
  const box = elOrcDetalhe();
  if (!box || !linhas) return;
  let html = `<div class="card"><h3 class="titulo-secao" style="margin-top:0">Versão A × Versão B</h3>`;
  for (const l of linhas) {
    const dif = (l.totalA == null || l.totalB == null)
      ? " (falta dado)" : ` (diferença ${moeda(l.totalB - l.totalA)})`;
    html += `<p><strong>${proteger(l.nome)}</strong>: A ${l.totalA == null ? "—" : moeda(l.totalA)} × B ${l.totalB == null ? "—" : moeda(l.totalB)}${dif}</p>`;
  }
  html += `<button class="btn btn-texto" id="orc-det-fechar">Fechar</button></div>`;
  box.innerHTML = html;
  const f = document.getElementById("orc-det-fechar");
  if (f) f.addEventListener("click", () => { box.innerHTML = ""; });
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}
function compararOrcamentos(idA, idB) {
  const a = lerOrcamentos().find((x) => x.id === idA);
  const b = lerOrcamentos().find((x) => x.id === idB);
  if (!a || !b) return null;
  const mapa = {};
  for (const it of a.itens || []) mapa[it.nome] = { a: it };
  for (const it of b.itens || []) {
    mapa[it.nome] = mapa[it.nome] || {};
    mapa[it.nome].b = it;
  }
  return Object.entries(mapa).map(([nome, v]) => ({
    nome,
    totalA: v.a && v.a.total != null ? v.a.total : null,
    totalB: v.b && v.b.total != null ? v.b.total : null,
  }));
}
function desenharSistema() {
  const box = elOrc("orcamento-area");
  box.hidden = false;
  box.innerHTML = `
    <div class="card"><h3 class="titulo-secao" style="margin-top:0">Como será a construção?</h3>
    <div class="forma-pagto">
      <label><input type="radio" name="orc-alv" value="bloco" checked /> Bloco de concreto</label>
      <label><input type="radio" name="orc-alv" value="tijolo" /> Tijolo cerâmico</label>
    </div>
    <div class="form">
      <label class="campo"><span>Preço do piso (R$/m²) — vazio = não informado</span>
        <input type="number" id="orc-preco-piso" min="0" step="0.01" inputmode="decimal" placeholder="Ex: 45" /></label>
      <label class="campo"><span>Preço bloco/tijolo (R$/un)</span>
        <input type="number" id="orc-preco-bloco" min="0" step="0.01" inputmode="decimal" placeholder="Ex: 1,20" /></label>
      <label class="campo"><span>Preço cimento (R$/saco)</span>
        <input type="number" id="orc-preco-cimento" min="0" step="0.01" inputmode="decimal" placeholder="Ex: 42" /></label>
      <label class="campo"><span>Preço tinta (R$/L)</span>
        <input type="number" id="orc-preco-tinta" min="0" step="0.01" inputmode="decimal" placeholder="Ex: 28" /></label>
      <label class="campo"><span>Preço porta (R$/un)</span>
        <input type="number" id="orc-preco-porta" min="0" step="0.01" inputmode="decimal" /></label>
      <label class="campo"><span>Preço janela (R$/un)</span>
        <input type="number" id="orc-preco-janela" min="0" step="0.01" inputmode="decimal" /></label>
      <div class="linha-2">
        <label class="campo"><span>Dias de obra (MO)</span>
          <input type="number" id="orc-mo-dias" min="0" step="1" inputmode="numeric" /></label>
        <label class="campo"><span>Diária média (R$)</span>
          <input type="number" id="orc-mo-diaria" min="0" step="0.01" inputmode="decimal" /></label>
      </div>
      <div class="linha-2">
        <label class="campo"><span>Transporte/frete (R$)</span>
          <input type="number" id="orc-transporte" min="0" step="0.01" inputmode="decimal" /></label>
        <label class="campo"><span>Outros (R$)</span>
          <input type="number" id="orc-outros" min="0" step="0.01" inputmode="decimal" /></label>
      </div>
      <button class="btn btn-primario btn-grande" id="orc-calcular">Calcular orçamento</button>
    </div></div>
    <div id="orc-resultado"></div>`;
  elOrc("orc-calcular").addEventListener("click", calcularOrcamento);
  // Preenche preços do catálogo quando existirem (sem inventar)
  try {
    if (typeof precoCadastrado === "function") {
      const mapa = [
        ["orc-preco-piso", "piso"], ["orc-preco-bloco", "bloco"],
        ["orc-preco-cimento", "cimento"], ["orc-preco-tinta", "tinta"],
        ["orc-preco-porta", "porta"], ["orc-preco-janela", "janela"],
      ];
      for (const [id, uso] of mapa) {
        const ach = precoCadastrado(uso);
        const campo = document.getElementById(id);
        if (ach && campo && !campo.value) {
          campo.value = ach.preco;
          campo.placeholder = `${ach.fonte}${ach.data ? " • " + ach.data : ""}`;
        }
      }
    }
  } catch (e) {}
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Geometria real de paredes (pura, testável) ----------
// vaos: [{larg, alt}] em metros. Retorna {bruta, vaos, liquida, invalidos} ou null
// se as dimensões da parede forem inválidas ou se os vãos couberem na parede toda.
// Vãos MAL FORMADOS não invalidam mais a medição inteira: são ignorados e
// contabilizados em `invalidos` para o sistema avisar o usuário (antes, UM vau
// com erro de digitação fazia o sistema descartar a parede medida e cair na
// estimativa genérica sem aviso).
function paredeLiquida(comp, alt, vaos) {
  const c = Number(comp), a = Number(alt);
  if (!(c > 0) || !(a > 0)) return null;
  let v = 0, invalidos = 0;
  for (const x of vaos || []) {
    const l = Number(x.larg), h = Number(x.alt);
    if (!(l > 0) || !(h > 0)) { invalidos++; continue; }
    const q = Number(x.qtd) > 0 ? Number(x.qtd) : 1;
    v += l * h * q;
  }
  const bruta = c * a;
  if (v >= bruta) return null;
  const r2 = (n) => Math.round(n * 100) / 100;
  return { bruta: r2(bruta), vaos: r2(v), liquida: r2(bruta - v), invalidos };
}

// ---------- Medição por parede e por ambiente (Fase 2, pura, testável) ----------
// Helpers que NÃO alteram o motor atual (calcularOrcamentoGuiado). São expostos
// para testes de precisão e uso futuro. Convenção: dimensões em metros, áreas em m².
// Formato de vão: {larg, alt}. Classificação de confiança (ORC_CONF):
//   1 = calculado com dados informados; 2 = estimativa por coeficiente;
//   3 = requer projeto ou confirmação técnica.

// Parede a partir de medidas reais. Retorna objeto detalhado com origem/limitações.
function calcularParedeMedida(p) {
  const comp = Number(p && p.comp), alt = Number(p && p.alt);
  if (!(comp > 0) || !(alt > 0)) {
    return { ok: false, motivo: "comprimento ou altura da parede inválidos" };
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const bruta = comp * alt;
  let vaosArea = 0, invalidos = 0;
  for (const x of (p.vaos || [])) {
    const l = Number(x.larg), h = Number(x.alt);
    if (!(l > 0) || !(h > 0)) { invalidos++; continue; }
    const q = Number(x.qtd) > 0 ? Number(x.qtd) : 1;
    vaosArea += l * h * q;
  }
  if (vaosArea >= bruta) {
    return { ok: false, motivo: "soma dos vãos maior ou igual à área da parede",
             bruta: r2(bruta), vaos: r2(vaosArea), vaosInvalidos: invalidos };
  }
  return {
    ok: true,
    comp: r2(comp), alt: r2(alt),
    bruta: r2(bruta), vaos: r2(vaosArea), liquida: r2(bruta - vaosArea),
    vaosInvalidos: invalidos,
    origem: "medidas reais da parede (comprimento × altura − vãos)",
    conf: 1,
  };
}

// Wrapper compatível com paredeLiquida (deliberadamente equivalente em números).
// Mantido separado para deixar explícito o contrato usado em testes de regressão.
function paredeLiquidaPorLista(comp, alt, vaos) {
  const res = calcularParedeMedida({ comp, alt, vaos });
  if (!res.ok) return null;
  return { bruta: res.bruta, vaos: res.vaos, liquida: res.liquida, invalidos: res.vaosInvalidos };
}

// Ambiente simples a partir de largura×comprimento. NÃO deduz vãos: a área de
// parede é o perímetro × altura (sem descontar portas/janelas), então é uma
// ESTIMATIVA (conf 2) até que os vãos sejam informados parede a parede.
function calcularAmbiente(a) {
  const larg = Number(a && a.larg), comp = Number(a && a.comp);
  const alt = Number(a && a.alt);
  if (!(larg > 0) || !(comp > 0)) {
    return { ok: false, motivo: "largura ou comprimento do ambiente inválidos" };
  }
  if (!(alt > 0)) {
    return { ok: false, motivo: "altura do ambiente não informada (não é um coeficiente: é medida essencial)" };
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const perimetro = 2 * (larg + comp);
  return {
    ok: true,
    piso: r2(larg * comp),
    perimetro: r2(perimetro),
    parede: r2(perimetro * alt),
    alt: r2(alt),
    origem: "medidas do ambiente; parede = perímetro × altura, SEM descontar vãos",
    limitacao: "portas e janelas não foram descontadas; use a medição por parede para área líquida",
    conf: 2,
  };
}

// Área total de paredes (líquida) a partir de uma lista de paredes medidas.
// Cada item: {comp, alt, vaos:[{larg,alt}]}. Retorna agregado e lista por parede.
function areaParedesPorLista(paredes) {
  const itens = [];
  let bruta = 0, vaos = 0, liquida = 0, invalidas = 0, vaosInvalidos = 0;
  for (const p of (paredes || [])) {
    const r = calcularParedeMedida(p);
    if (!r.ok) { invalidas++; itens.push({ ok: false, motivo: r.motivo }); continue; }
    bruta += r.bruta; vaos += r.vaos; liquida += r.liquida; vaosInvalidos += r.vaosInvalidos;
    itens.push(r);
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return { ok: itens.length > 0 && invalidas < itens.length, bruta: r2(bruta), vaos: r2(vaos), liquida: r2(liquida), invalidas, vaosInvalidos, paredes: itens };
}

// Mensagem de salvamento conforme o RESULTADO REAL (sem mentir).
// Aceita objeto {ok,status} OU boolean (compatibilidade com chamadas antigas).
function msgSync(r, oQue) {
  if (typeof SyncOrc !== "undefined" && SyncOrc.mensagem) return SyncOrc.mensagem(r, oQue || "Orçamento");
  const ok = typeof r === "object" && r ? r.ok : !!r;
  return ok ? (oQue || "Orçamento") + " salvo e sincronizado!" : "Salvo neste aparelho. Sincroniza sozinho com internet.";
}
function moeda(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function calcularOrcamento() {
  const r = raioXAtual;
  const area = Number(r.area) || 0;
  if (!(area > 0)) { mostrarToast("Informe a área no Raio-X.", false); return; }
  const alv = (document.querySelector('input[name="orc-alv"]:checked') || {}).value || "bloco";
  const P = (id) => {
    const el = document.getElementById(id);
    const v = el ? Number(el.value) || 0 : 0;
    return v > 0 ? v : null;
  };
  const precos = {
    piso: P("orc-preco-piso"), bloco: P("orc-preco-bloco"), cimento: P("orc-preco-cimento"),
    tinta: P("orc-preco-tinta"), porta: P("orc-preco-porta"), janela: P("orc-preco-janela"),
  };
  const itens = []; // {nome, detalhe:[], qtd, unidade, preco, total|null}
  const areaParede = area * PARAMS_ORC.PAREDE_POR_AREA.valor;

  // PISO: área × % × (1 + perda) — total usa a MESMA qtd exibida (arredondada)
  const qPiso = Math.round(area * PARAMS_ORC.PISO_PERC_AREA.valor * (1 + PARAMS_ORC.PERDA_PISO.valor) * 10) / 10;
  itens.push({
    nome: "Piso cerâmico", etapa: "Pisos", unidade: "m²", qtd: qPiso,
    preco: precos.piso, total: precos.piso ? qPiso * precos.piso : null,
    detalhe: [
      `Área da casa: ${area} m²`,
      `Área considerada: ${area} × ${PARAMS_ORC.PISO_PERC_AREA.valor} = ${(area * PARAMS_ORC.PISO_PERC_AREA.valor).toFixed(1)} m²`,
      `Perda: ${(PARAMS_ORC.PERDA_PISO.valor * 100).toFixed(0)}%`,
      `Quantidade: ${(area * PARAMS_ORC.PISO_PERC_AREA.valor).toFixed(1)} × ${(1 + PARAMS_ORC.PERDA_PISO.valor).toFixed(2)} = ${qPiso.toFixed(1)} m²`,
      precos.piso ? `Preço: ${moeda(precos.piso)}/m²` : "Preço não informado.",
    ],
  });

  // ALVENARIA: parede × consumo + perda (um sistema por vez, nunca os dois)
  const consUn = alv === "bloco" ? PARAMS_ORC.BLOCO_M2.valor : PARAMS_ORC.TIJOLO_M2.valor;
  const qAlv = Math.ceil(areaParede * consUn * (1 + PARAMS_ORC.PERDA_BLOCO.valor));
  itens.push({
    nome: alv === "bloco" ? "Bloco de concreto" : "Tijolo cerâmico", etapa: "Alvenaria", unidade: "un",
    qtd: qAlv, preco: precos.bloco,
    total: precos.bloco ? qAlv * precos.bloco : null,
    detalhe: [
      `Área de parede: ${area} × ${PARAMS_ORC.PAREDE_POR_AREA.valor} = ${areaParede.toFixed(1)} m²`,
      `Consumo: ${consUn} un/m²`,
      `Perda: ${(PARAMS_ORC.PERDA_BLOCO.valor * 100).toFixed(0)}%`,
      `Quantidade: ${qAlv} un`,
      precos.bloco ? `Preço: ${moeda(precos.bloco)}/un` : "Preço não informado.",
    ],
  });

  // CIMENTO (reboco) — consolidado aqui; outras etapas somariam junto
  const qCim = Math.ceil(areaParede * PARAMS_ORC.CIMENTO_M2_REBOCO.valor);
  itens.push({
    nome: "Cimento (reboco)", etapa: "Reboco e revestimentos", unidade: "sacos",
    qtd: qCim, preco: precos.cimento,
    total: precos.cimento ? qCim * precos.cimento : null,
    detalhe: [
      `Reboco: ${areaParede.toFixed(1)} m² × ${PARAMS_ORC.CIMENTO_M2_REBOCO.valor} saco/m² = ${(areaParede * PARAMS_ORC.CIMENTO_M2_REBOCO.valor).toFixed(1)} sacos`,
      `Total: ${qCim} sacos (Reboco: ${qCim})`,
      precos.cimento ? `Preço: ${moeda(precos.cimento)}/saco` : "Preço não informado.",
    ],
  });

  // TINTA: área ÷ rendimento × demãos
  const litros = (areaParede / PARAMS_ORC.TINTA_REND_M2_L.valor) * PARAMS_ORC.TINTA_DEMAOS.valor;
  const qTinta = Math.ceil(litros * 10) / 10;
  itens.push({
    nome: "Tinta", etapa: "Pintura", unidade: "L",
    qtd: qTinta, preco: precos.tinta,
    total: precos.tinta ? qTinta * precos.tinta : null,
    detalhe: [
      `Área pintável: ${areaParede.toFixed(1)} m² ÷ ${PARAMS_ORC.TINTA_REND_M2_L.valor} m²/L = ${(areaParede / PARAMS_ORC.TINTA_REND_M2_L.valor).toFixed(1)} L por demão`,
      `Demãos: ${PARAMS_ORC.TINTA_DEMAOS.valor} → ${litros.toFixed(1)} L`,
      precos.tinta ? `Preço: ${moeda(precos.tinta)}/L` : "Preço não informado.",
    ],
  });

  // PORTAS e JANELAS (unidades confirmadas no Raio-X)
  const pj = [
    { nome: "Portas", qtd: r.portas, preco: precos.porta },
    { nome: "Janelas", qtd: r.janelas, preco: precos.janela },
  ];
  for (const x of pj) {
    if (x.qtd === null || x.qtd === undefined) {
      itens.push({ nome: x.nome, etapa: "Esquadrias", unidade: "un", qtd: null, preco: null, total: null,
        detalhe: ["Quantidade não informada no Raio-X."] });
    } else {
      itens.push({ nome: x.nome, etapa: "Esquadrias", unidade: "un", qtd: x.qtd, preco: x.preco,
        total: x.preco ? x.qtd * x.preco : null,
        detalhe: [`Quantidade: ${x.qtd} un`, x.preco ? `Preço: ${moeda(x.preco)}/un` : "Preço não informado."] });
    }
  }

  // MO + transporte + outros (valores informados, separados dos materiais)
  const moDias = Math.max(0, parseInt(((document.getElementById("orc-mo-dias") || {}).value || "0"), 10));
  const moDiaria = P("orc-mo-diaria");
  const vTransp = P("orc-transporte");
  const vOutros = P("orc-outros");
  if (moDias > 0) {
    itens.push({ nome: "Mão de obra", etapa: "Mão de obra", unidade: "diárias",
      qtd: moDias, preco: moDiaria,
      total: moDiaria ? moDias * moDiaria : null,
      detalhe: [`${moDias} diárias${moDiaria ? ` × ${moeda(moDiaria)}` : " (diária não informada)"}`] });
  }
  if ((vTransp || 0) > 0) {
    itens.push({ nome: "Transporte/frete", etapa: "Outros", unidade: "R$", qtd: 1, preco: vTransp,
      total: vTransp, detalhe: ["Valor informado"] });
  }
  if ((vOutros || 0) > 0) {
    itens.push({ nome: "Outros", etapa: "Outros", unidade: "R$", qtd: 1, preco: vOutros,
      total: vOutros, detalhe: ["Valor informado"] });
  }

  // Validações anti-absurdo (apontam a origem, sem chutar correção)
  const avisos = [];
  for (const it of itens) {
    if (it.qtd !== null && !(it.qtd >= 0 && it.qtd < 1000000))
      avisos.push(`${it.nome}: quantidade estranha (${it.qtd}). Confira a área.`);
    if (it.preco !== null && !(it.preco > 0 && it.preco < 1000000))
      avisos.push(`${it.nome}: preço estranho. Confira.`);
  }
  const total = itens.reduce((s, it) => s + (it.total || 0), 0);
  const semPreco = itens.filter((it) => it.total === null).length;

  // Render por etapa, com subtotal cada (sem somar nada duas vezes)
  let html = `<div class="card"><h3 class="titulo-secao" style="margin-top:0">Orçamento — ${area} m² (${alv === "bloco" ? "Bloco" : "Tijolo"})</h3>`;
  const ordemEtapas = ["Pisos", "Alvenaria", "Reboco e revestimentos", "Pintura", "Esquadrias", "Mão de obra", "Outros"];
  for (const etapa of ordemEtapas) {
    const doEtapa = itens.filter((it) => it.etapa === etapa);
    if (!doEtapa.length) continue;
    const sub = doEtapa.reduce((s, it) => s + (it.total || 0), 0);
    const parcial = doEtapa.some((it) => it.total === null);
    html += `<h3 class="titulo-secao">${proteger(etapa)} — ${moeda(sub)}${parcial ? " (parcial)" : ""}</h3>`;
    for (const it of doEtapa) {
      html += `<p><strong>${proteger(it.nome)}</strong>: ${it.qtd ?? "—"} ${proteger(it.unidade || "")} × ` +
        `${it.preco ? moeda(it.preco) : "sem preço"} = <strong>${it.total === null ? "—" : moeda(it.total)}</strong></p>`;
      html += `<button class="btn btn-texto" data-orc-ver="${proteger(it.nome)}">Ver como foi calculado</button>`;
      html += `<div class="card" data-orc-calculo="${proteger(it.nome)}" hidden>` +
        it.detalhe.map((d) => `<p class="texto-suave">${proteger(d)}</p>`).join("") + `</div>`;
    }
  }
  // Resumo: data-base, premissas, confiabilidade
  const conf = semPreco === 0 && r.origem && r.origem.area ? "Alta" : semPreco <= 2 ? "Média" : "Baixa";
  const pendencias = [];
  if (!r.area) pendencias.push({ oque: "Área da obra", porque: "base de todos os quantitativos", resolver: "Informe no Raio-X" });
  if (r.quartos == null) pendencias.push({ oque: "Quartos", porque: "afeta portas e esquadrias", resolver: "Informe no Raio-X" });
  if (r.banheiros == null) pendencias.push({ oque: "Banheiros", porque: "afeta louças e hidráulica", resolver: "Informe no Raio-X" });
  if (r.portas == null) pendencias.push({ oque: "Portas", porque: "quantidade estimada", resolver: "Confirme no projeto" });
  if (r.janelas == null) pendencias.push({ oque: "Janelas", porque: "quantidade estimada", resolver: "Confirme no projeto" });
  for (const it of itens) {
    if (it.total === null) pendencias.push({ oque: `Preço: ${it.nome}`, porque: "sem ele o total fica parcial", resolver: "Cadastre em Materiais ou digite" });
  }
  const completude = Math.max(0, Math.round(((itens.length * 2 - pendencias.length) / (itens.length * 2)) * 100));
  html += `<h3 class="titulo-secao">Total estimado: ${moeda(total)}${semPreco ? " (parcial: faltam preços)" : ""}</h3>`;
  html += `<p class="texto-suave">Data-base dos preços: ${formatarData(hojeISO())} (preços digitados ou do catálogo).</p>`;
  html += `<p class="texto-suave">Premissas: ${area} m², ${alv === "bloco" ? "bloco de concreto" : "tijolo cerâmico"}, coeficientes dos parâmetros do app.</p>`;
  html += `<p class="texto-suave">Confiabilidade: <strong>${conf}</strong> • Completude: <strong>${completude}%</strong>${semPreco ? ` • ${semPreco} item(ns) sem preço` : ""}.</p>`;
  if (pendencias.length) {
    html += `<h3 class="titulo-secao">Pendências (${pendencias.length})</h3>` +
      pendencias.map((p) => `<p class="texto-suave">• <strong>${proteger(p.oque)}</strong> — ${proteger(p.porque)}. Resolver: ${proteger(p.resolver)}.</p>`).join("");
  }
  // BDI, impostos e contingência: separados, nunca embutidos (0 = não aplica)
  html += `<h3 class="titulo-secao">Encargos sobre o custo</h3>
  <div class="form">
    <div class="linha-2">
      <label class="campo"><span>Imprevistos (%)</span><input type="number" id="orc-bdi-imp" value="5" min="0" step="0.1" inputmode="decimal" /></label>
      <label class="campo"><span>Impostos (%)</span><input type="number" id="orc-bdi-trib" value="0" min="0" step="0.1" inputmode="decimal" /></label>
    </div>
    <label class="campo"><span>Margem/lucro (%)</span><input type="number" id="orc-bdi-lucro" value="0" min="0" step="0.1" inputmode="decimal" /></label>
    <p class="texto-suave" id="orc-bdi-total">Custo direto: ${moeda(total)}</p>
  </div>`;
  const recalcBDI = () => {
    const pi = numeroOuZero((document.getElementById("orc-bdi-imp") || {}).value) / 100;
    const pt = numeroOuZero((document.getElementById("orc-bdi-trib") || {}).value) / 100;
    const pl = numeroOuZero((document.getElementById("orc-bdi-lucro") || {}).value) / 100;
    const vImp = total * pi, vTrib = total * pt, vLucro = total * pl;
    const el = document.getElementById("orc-bdi-total");
    if (el) el.innerHTML = `Custo direto: ${moeda(total)}<br>Imprevistos: ${moeda(vImp)}<br>Impostos: ${moeda(vTrib)}<br>Margem: ${moeda(vLucro)}<br><strong>Preço de venda: ${moeda(total + vImp + vTrib + vLucro)}</strong>`;
    return { pi, pt, pl, vImp, vTrib, vLucro, venda: total + vImp + vTrib + vLucro };
  };
  // Previsto x realizado da obra vinculada
  try {
    const obraReal = r.obraId && typeof pegarObra === "function" ? pegarObra(r.obraId) : null;
    if (obraReal && typeof calcularTotais === "function") {
      const t = calcularTotais(obraReal);
      const real = t.totalGasto + t.totalMO;
      const dif = total - real;
      html += `<h3 class="titulo-secao">Previsto x realizado</h3>` +
        `<p class="texto-suave">Orçado: <strong>${moeda(total)}</strong> • Gasto até agora: <strong>${moeda(real)}</strong> • ` +
        `Diferença: <strong>${moeda(dif)}</strong> ${dif >= 0 ? "(dentro do previsto)" : "(acima do previsto)"}.</p>`;
    }
  } catch (e) {}
  if (avisos.length) html += `<div class="card dica"><p><strong>Atenção, revisar:</strong></p>` +
    avisos.map((a) => `<p class="texto-suave">• ${proteger(a)}</p>`).join("") + `</div>`;
  html += `<div class="modal-botoes"><button class="btn btn-texto" id="orc-editar">Editar dados</button>` +
    `<button class="btn btn-primario btn-grande" id="orc-salvar">Salvar orçamento</button></div>`;
  html += `<button class="btn btn-texto" id="orc-imprimir">Imprimir / PDF</button></div>`;
  const box = elOrc("orc-resultado");
  box.innerHTML = html;
  box.querySelectorAll("[data-orc-ver]").forEach((b) =>
    b.addEventListener("click", () => {
      const d = box.querySelector(`[data-orc-calculo="${b.dataset.orcVer}"]`);
      if (d) d.hidden = !d.hidden;
    })
  );
  elOrc("orc-editar").addEventListener("click", () => { desenharRaioX(); });
  elOrc("orc-imprimir").addEventListener("click", () => window.print());
  ["orc-bdi-imp", "orc-bdi-trib", "orc-bdi-lucro"].forEach((id) => {
    const c = elOrc(id);
    if (c) c.addEventListener("input", recalcBDI);
  });
  recalcBDI();
  elOrc("orc-salvar").addEventListener("click", () => {
    const lista = lerOrcamentos();
    const bdi = recalcBDI();
    const novo = {
      id: Date.now().toString(36), data: hojeISO(), obraId: r.obraId,
      area, alvenaria: alv, total, bdi: { imp: bdi.pi, trib: bdi.pt, lucro: bdi.pl, venda: bdi.venda },
      itens: itens.map((it) => ({ nome: it.nome, qtd: it.qtd, unidade: it.unidade, preco: it.preco, total: it.total })),
    };
    lista.unshift(novo);
    salvarOrcamentos(lista.slice(0, 30));
    try {
      if (typeof SyncOrc !== "undefined") {
        SyncOrc.empurrarOrcamento(novo).then((r) => {
          if (r && r.ok) salvarOrcamentos(lerOrcamentos());
          mostrarToast(msgSync(r), !!(r && r.ok));
        }).catch(() => mostrarToast(msgSync({ ok: false, status: "rede" }), false));
      } else mostrarToast(msgSync(false), false);
    } catch (e) { mostrarToast(msgSync(false), false); }
    try { renderOrcamentosSalvos(); } catch (e) {}
  });
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}
