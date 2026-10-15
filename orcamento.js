/* =====================================================
   orcamento.js — IA DA OBRA: Raio-X + quantitativo + custo
   -----------------------------------------------------
   Fluxo: PLANTA → IA analisa → RAIO-X → usuário confirma
   → sistema construtivo → QUANTITATIVO (determinístico)
   → CUSTO → salva no aparelho.
   - Cálculos 100% determinísticos a partir de PARÂMETROS
     declarados abaixo (sem número mágico escondido).
   - IA só interpreta a imagem; nunca calcula sozinha.
   - Preço ausente = "Preço não informado" (nunca inventa).
   - Orçamentos salvos no aparelho (localStorage); tabela
     no Supabase fica para a próxima fase (sem rota de DDL).
   ===================================================== */

// ---------- PARÂMETROS (editáveis, documentados) ----------
// Cada coeficiente tem unidade e observação. Ajuste outliers aqui.
const PARAMS_ORC = {
  // % da área total que recebe piso (desconta paredes e áreas externas)
  PISO_PERC_AREA: { valor: 0.85, unidade: "fração", obs: "85% da área; ajuste por obra" },
  PERDA_PISO: { valor: 0.10, unidade: "fração", obs: "recortes e quebras" },
  PRECO_PISO_M2: { valor: null, unidade: "R$/m²", obs: "Ex: 45,00 — preencher por obra/região" },
  // Parede: m² de parede por m² de área (média de casas térreas simples)
  PAREDE_POR_AREA: { valor: 2.8, unidade: "m²/m²", obs: "média; confira na planta" },
  BLOCO_M2: { valor: 12.5, unidade: "un/m²", obs: "bloco 14x19x39 com junta" },
  TIJOLO_M2: { valor: 25, unidade: "un/m²", obs: "tijolo 6 furos deitado" },
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
  // Cobertura: área do telhado sobre a área + telha romana
  TELHADO_FATOR: { valor: 1.3, unidade: "fração", obs: "telhado sobre a área" },
  TELHA_M2: { valor: 16, unidade: "un/m²", obs: "telha romana" },
  PRECO_TELHA_UN: { valor: null, unidade: "R$/un", obs: "telha romana" },
  MADEIRAMENTO_M2: { valor: null, unidade: "R$/m²", obs: "madeiramento instalado" },
};

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
function montarRaioX(dadosIA, obraId) {
  const comodos = (dadosIA && dadosIA.comodos) || [];
  const soma = comodos.reduce((s, c) => s + (Number(c.area_m2) || 0), 0);
  const area = (dadosIA && Number(dadosIA.area_total_m2)) || (soma > 0 ? Math.round(soma * 100) / 100 : null);
  raioXAtual = {
    area, quartos: null, banheiros: null, portas: null, janelas: null,
    origem: { area: area ? "ia" : null },
    obraId: obraId || null,
  };
  const box = elOrc("orcamento-area");
  if (box) box.hidden = false;
  desenharRaioX();
  if (box) box.scrollIntoView({ behavior: "smooth", block: "start" });
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

// ---------- Orçamentos salvos (ver, duplicar, excluir) ----------
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
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">O</span>
        <div class="item-conteudo">
          <strong>${o.area} m² (${o.alvenaria === "bloco" ? "Bloco" : "Tijolo"})</strong>
          <span class="item-meta">${formatarData(o.data)} • Total ${moeda(o.total)}${o._supa ? "" : " • só no aparelho"}</span>
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
function verOrcamentoSalvo(id) {
  const o = lerOrcamentos().find((x) => x.id === id);
  if (!o) return;
  const box = elOrc("orcamento-area");
  box.hidden = false;
  let html = `<div class="card"><h3 class="titulo-secao" style="margin-top:0">Orçamento ${o.area} m² — ${formatarData(o.data)}</h3>`;
  for (const it of o.itens || []) {
    html += `<p><strong>${proteger(it.nome)}</strong>: ${it.qtd ?? "—"} ${proteger(it.unidade || "")} × ` +
      `${it.preco ? moeda(it.preco) : "sem preço"} = <strong>${it.total === null || it.total === undefined ? "—" : moeda(it.total)}</strong></p>`;
  }
  html += `<h3 class="titulo-secao">Total: ${moeda(o.total)}</h3></div>`;
  box.innerHTML = html;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}
function duplicarOrcamento(id) {
  const o = lerOrcamentos().find((x) => x.id === id);
  if (!o) return;
  raioXAtual = { area: o.area, quartos: null, banheiros: null, portas: null, janelas: null, origem: { area: "editado" }, obraId: o.obraId || null };
  const box = elOrc("orcamento-area");
  if (box) box.hidden = false;
  desenharSistema();
  mostrarToast("Ajuste e calcule de novo.");
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
function estimarObra() {
  const area = numeroOuZero((document.getElementById("og-area") || {}).value);
  if (!(area > 0)) { mostrarToast("Informe a área da casa.", false); return; }
  const quartos = Math.max(0, parseInt((document.getElementById("og-quartos") || {}).value || "0", 10));
  const banheiros = Math.max(0, parseInt((document.getElementById("og-banheiros") || {}).value || "0", 10));
  const sist = (document.getElementById("og-sistema") || {}).value || "bloco";
  const P = {};
  document.querySelectorAll("[data-og-preco]").forEach((i) => {
    const v = numeroOuZero(i.value);
    P[i.dataset.ogPreco] = v > 0 ? v : null;
  });
  // Parede: geometria real se informada, senão fator estimado (sinalizado)
  const gv = (id) => String((document.getElementById(id) || {}).value || "").trim().replace(",", ".");
  const gComp = Number(gv("og-par-comp")), gAlt = Number(gv("og-par-alt"));
  const gVaos = gv("og-par-vaos").split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
    const p = s.toLowerCase().split("x");
    return { larg: Number(p[0]), alt: Number(p[1]) };
  });
  const geo = (gComp > 0 && gAlt > 0) ? paredeLiquida(gComp, gAlt, gVaos) : null;
  const areaParede = geo ? geo.liquida : area * PARAMS_ORC.PAREDE_POR_AREA.valor;
  const paredeOrigem = geo
    ? `medido: ${gComp}×${gAlt} − vãos = ${geo.liquida} m²`
    : `estimado: ${area} × ${PARAMS_ORC.PAREDE_POR_AREA.valor}`;
  const qPiso = area * PARAMS_ORC.PISO_PERC_AREA.valor * (1 + PARAMS_ORC.PERDA_PISO.valor);
  const consUn = sist === "bloco" ? PARAMS_ORC.BLOCO_M2.valor : PARAMS_ORC.TIJOLO_M2.valor;
  const qAlv = Math.ceil(areaParede * consUn * (1 + PARAMS_ORC.PERDA_BLOCO.valor));
  const qCim = Math.ceil(areaParede * PARAMS_ORC.CIMENTO_M2_REBOCO.valor);
  const qTinta = Math.ceil((areaParede / PARAMS_ORC.TINTA_REND_M2_L.valor * PARAMS_ORC.TINTA_DEMAOS.valor) * 10) / 10;
  // Medidas editáveis (vazio = estimativa documentada abaixo)
  const perim = numeroOuZero((document.getElementById("og-perimetro") || {}).value) || Math.round(4 * Math.sqrt(area) * 10) / 10;
  const areaTelhado = numeroOuZero((document.getElementById("og-telhado") || {}).value) || Math.round(area * PARAMS_ORC.TELHADO_FATOR.valor * 10) / 10;
  const nPElet = Math.max(0, parseInt((document.getElementById("og-peletricos") || {}).value || "0", 10));
  const nPHidr = Math.max(0, parseInt((document.getElementById("og-phidraulicos") || {}).value || "0", 10));
  const moDias = Math.max(0, parseInt((document.getElementById("og-mo-dias") || {}).value || "0", 10));
  const moDiaria = numeroOuZero((document.getElementById("og-mo-diaria") || {}).value);
  const transporte = numeroOuZero((document.getElementById("og-transporte") || {}).value);
  const outros = numeroOuZero((document.getElementById("og-outros") || {}).value);
  // Fundação (sapata corrida): concreto + aço
  const concFund = perim * PARAMS_ORC.SAPATA_LARG_M.valor * PARAMS_ORC.SAPATA_ALT_M.valor;
  const acoFund = Math.ceil(concFund * PARAMS_ORC.ACO_FUND_KG_M3.valor);
  // Laje: concreto + aço
  const concLaje = area * PARAMS_ORC.LAJE_CONC_M3_M2.valor;
  const acoLaje = Math.ceil(area * PARAMS_ORC.ACO_LAJE_KG_M2.valor);
  const qTelha = Math.ceil(areaTelhado * PARAMS_ORC.TELHA_M2.valor);
  // Portas e janelas estimadas pelos cômodos (estimativa — confirmar no projeto)
  const qPortas = quartos + banheiros + 2;
  const qJanelas = quartos + banheiros + 1;
  const itens = [
    { nome: "Concreto fundação", etapa: "Fundação", unidade: "m³", qtd: Math.round(concFund * 100) / 100, preco: P.concreto, detalhe: [`${perim} m × ${PARAMS_ORC.SAPATA_LARG_M.valor} × ${PARAMS_ORC.SAPATA_ALT_M.valor}`] },
    { nome: "Aço fundação", etapa: "Fundação", unidade: "kg", qtd: acoFund, preco: P.aco, detalhe: [`${concFund.toFixed(2)} m³ × ${PARAMS_ORC.ACO_FUND_KG_M3.valor} kg/m³`] },
    { nome: "Concreto laje", etapa: "Estrutura", unidade: "m³", qtd: Math.round(concLaje * 100) / 100, preco: P.concreto, detalhe: [`${area} m² × ${PARAMS_ORC.LAJE_CONC_M3_M2.valor}`] },
    { nome: "Aço laje", etapa: "Estrutura", unidade: "kg", qtd: acoLaje, preco: P.aco, detalhe: [`${area} m² × ${PARAMS_ORC.ACO_LAJE_KG_M2.valor} kg/m²`] },
    { nome: "Piso cerâmico", etapa: "Pisos", unidade: "m²", qtd: Math.round(qPiso * 10) / 10, preco: P.piso, detalhe: [`${area} m² × ${PARAMS_ORC.PISO_PERC_AREA.valor} × ${(1 + PARAMS_ORC.PERDA_PISO.valor).toFixed(2)}`] },
    { nome: sist === "bloco" ? "Bloco de concreto" : "Tijolo cerâmico", etapa: "Alvenaria", unidade: "un", qtd: qAlv, preco: P.bloco, detalhe: [`${areaParede.toFixed(1)} m² × ${consUn} un/m²`] },
    { nome: "Cimento (reboco)", etapa: "Reboco e revestimentos", unidade: "sacos", qtd: qCim, preco: P.cimento, detalhe: [`${areaParede.toFixed(1)} m² × ${PARAMS_ORC.CIMENTO_M2_REBOCO.valor}`] },
    { nome: "Tinta", etapa: "Pintura", unidade: "L", qtd: qTinta, preco: P.tinta, detalhe: [`${areaParede.toFixed(1)} m² ÷ ${PARAMS_ORC.TINTA_REND_M2_L.valor} × ${PARAMS_ORC.TINTA_DEMAOS.valor}`] },
    { nome: "Portas (estimativa: cômodos + 2)", etapa: "Esquadrias", unidade: "un", qtd: qPortas, preco: P.porta, detalhe: ["Estimativa pelos cômodos — confirmar no projeto"] },
    { nome: "Janelas (estimativa: cômodos + 1)", etapa: "Esquadrias", unidade: "un", qtd: qJanelas, preco: P.janela, detalhe: ["Estimativa pelos cômodos — confirmar no projeto"] },
    { nome: "Telhas", etapa: "Cobertura", unidade: "un", qtd: qTelha, preco: P.telha, detalhe: [`${areaTelhado} m² × ${PARAMS_ORC.TELHA_M2.valor} un/m²`] },
    { nome: "Madeiramento", etapa: "Cobertura", unidade: "m²", qtd: areaTelhado, preco: P.madeiramento, detalhe: [`${areaTelhado} m² de telhado`] },
    { nome: "Pontos elétricos", etapa: "Elétrica", unidade: "pt", qtd: nPElet, preco: P.peletrico, detalhe: [nPElet ? `${nPElet} pontos informados` : "Informe os pontos"] },
    { nome: "Pontos hidráulicos", etapa: "Hidráulica", unidade: "pt", qtd: nPHidr, preco: P.phidraulico, detalhe: [nPHidr ? `${nPHidr} pontos informados` : "Informe os pontos"] },
    { nome: "Mão de obra", etapa: "Mão de obra", unidade: "diárias", qtd: moDias, preco: moDiaria || null, detalhe: [moDias ? `${moDias} dias × ${moeda(moDiaria || 0)}` : "Informe dias e diária"] },
    { nome: "Transporte", etapa: "Outros", unidade: "R$", qtd: transporte ? 1 : 0, preco: transporte || null, detalhe: ["Valor informado"] },
    { nome: "Outros", etapa: "Outros", unidade: "R$", qtd: outros ? 1 : 0, preco: outros || null, detalhe: ["Valor informado"] },
  ];
  for (const it of itens) it.total = it.preco ? it.qtd * it.preco : null;
  const total = itens.reduce((s, it) => s + (it.total || 0), 0);
  const semPreco = itens.filter((it) => it.total === null).length;
  let html = `<div class="card"><p class="texto-suave"><strong>ESTIMATIVA PRELIMINAR</strong> — complete os dados para o detalhado.</p><h3 class="titulo-secao" style="margin-top:0">Vai precisar de cerca de ${moeda(total)}${semPreco ? " (parcial)" : ""}</h3>`;
  html += `<p class="texto-suave">Casa de ${area} m² • ${quartos} quartos • ${banheiros} banheiros • ${sist === "bloco" ? "Bloco" : "Tijolo"} • <strong>${moeda(total / area)}/m²</strong></p>`;
  html += `<p class="texto-suave">Parede: ${paredeOrigem}.</p>`;
  for (const it of itens) {
    html += `<p><strong>${proteger(it.nome)}</strong>: ${it.qtd} ${proteger(it.unidade)} × ` +
      `${it.preco ? moeda(it.preco) : "sem preço"} = <strong>${it.total === null ? "—" : moeda(it.total)}</strong></p>`;
  }
  if (semPreco) html += `<p class="texto-suave">Faltam ${semPreco} preço(s) — preencha no passo 1.</p>`;
  html += `<p class="texto-suave">Estimativa preliminar: portas e janelas chutadas pelos cômodos. Confirme no projeto.</p>`;
  html += `<button class="btn btn-primario btn-grande" id="og-salvar">Salvar orçamento</button></div>`;
  const box = document.getElementById("og-resultado");
  if (!box) return;
  box.innerHTML = html;
  document.getElementById("og-salvar").addEventListener("click", () => {
    const lista = lerOrcamentos();
    lista.unshift({
      id: Date.now().toString(36), data: hojeISO(), obraId: null,
      area, alvenaria: sist, total,
      itens: itens.map((it) => ({ nome: it.nome, etapa: it.etapa, qtd: it.qtd, unidade: it.unidade, preco: it.preco, total: it.total })),
    });
    salvarOrcamentos(lista.slice(0, 30));
    try {
      if (typeof SyncOrc !== "undefined") {
        SyncOrc.empurrarOrcamento(lista[0]).then((r) => {
          if (r && r.ok) salvarOrcamentos(lerOrcamentos());
          mostrarToast(msgSync(r), !!(r && r.ok));
        }).catch(() => mostrarToast(msgSync({ ok: false, status: "rede" }), false));
      } else mostrarToast(msgSync(false), false);
    } catch (e) { mostrarToast(msgSync(false), false); }
  });
  box.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const box = elOrc("orcamento-area");
  if (!box || !linhas) return;
  box.hidden = false;
  let html = `<div class="card"><h3 class="titulo-secao" style="margin-top:0">Versão A × Versão B</h3>`;
  for (const l of linhas) {
    const dif = (l.totalA == null || l.totalB == null)
      ? " (falta dado)" : ` (diferença ${moeda(l.totalB - l.totalA)})`;
    html += `<p><strong>${proteger(l.nome)}</strong>: A ${l.totalA == null ? "—" : moeda(l.totalA)} × B ${l.totalB == null ? "—" : moeda(l.totalB)}${dif}</p>`;
  }
  html += `</div>`;
  box.innerHTML = html;
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
// vaos: [{larg, alt}] em metros. Retorna {bruta, vaos, liquida} ou null se inválido.
function paredeLiquida(comp, alt, vaos) {
  const c = Number(comp), a = Number(alt);
  if (!(c > 0) || !(a > 0)) return null;
  let v = 0;
  for (const x of vaos || []) {
    const l = Number(x.larg), h = Number(x.alt);
    if (!(l > 0) || !(h > 0)) return null;
    v += l * h;
  }
  const bruta = c * a;
  if (v >= bruta) return null;
  const r2 = (n) => Math.round(n * 100) / 100;
  return { bruta: r2(bruta), vaos: r2(v), liquida: r2(bruta - v) };
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
