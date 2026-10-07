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

// ---------- Sistema construtivo + quantitativo determinístico ----------
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
      <button class="btn btn-primario btn-grande" id="orc-calcular">Calcular orçamento</button>
    </div></div>
    <div id="orc-resultado"></div>`;
  elOrc("orc-calcular").addEventListener("click", calcularOrcamento);
  box.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // PISO: área × % × (1 + perda)
  const qPiso = area * PARAMS_ORC.PISO_PERC_AREA.valor * (1 + PARAMS_ORC.PERDA_PISO.valor);
  itens.push({
    nome: "Piso cerâmico", unidade: "m²", qtd: Math.round(qPiso * 10) / 10,
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
    nome: alv === "bloco" ? "Bloco de concreto" : "Tijolo cerâmico", unidade: "un",
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
    nome: "Cimento (reboco)", unidade: "sacos",
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
    nome: "Tinta", unidade: "L",
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
      itens.push({ nome: x.nome, unidade: "un", qtd: null, preco: null, total: null,
        detalhe: ["Quantidade não informada no Raio-X."] });
    } else {
      itens.push({ nome: x.nome, unidade: "un", qtd: x.qtd, preco: x.preco,
        total: x.preco ? x.qtd * x.preco : null,
        detalhe: [`Quantidade: ${x.qtd} un`, x.preco ? `Preço: ${moeda(x.preco)}/un` : "Preço não informado."] });
    }
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

  // Render 100% escapado (nada da IA vira HTML)
  let html = `<div class="card"><h3 class="titulo-secao" style="margin-top:0">Orçamento — ${area} m² (${alv === "bloco" ? "Bloco" : "Tijolo"})</h3>`;
  for (const it of itens) {
    html += `<h3 class="titulo-secao">${proteger(it.nome)}</h3>`;
    html += it.detalhe.map((d) => `<p class="texto-suave">${proteger(d)}</p>`).join("");
    html += `<p><strong>Total: ${it.total === null ? "Preço não informado." : moeda(it.total)}</strong></p>`;
    html += `<button class="btn btn-texto" data-orc-ver="${proteger(it.nome)}">Ver como foi calculado</button>`;
    html += `<div class="card" data-orc-calculo="${proteger(it.nome)}" hidden>` +
      it.detalhe.map((d) => `<p class="texto-suave">${proteger(d)}</p>`).join("") + `</div>`;
  }
  html += `<h3 class="titulo-secao">Total estimado: ${moeda(total)}${semPreco ? " (parcial: faltam preços)" : ""}</h3>`;
  if (semPreco) html += `<p class="texto-suave">${semPreco} item(ns) sem preço — informe para completar.</p>`;
  if (avisos.length) html += `<div class="card dica"><p><strong>Atenção, revisar:</strong></p>` +
    avisos.map((a) => `<p class="texto-suave">• ${proteger(a)}</p>`).join("") + `</div>`;
  html += `<div class="modal-botoes"><button class="btn btn-texto" id="orc-editar">Editar dados</button>` +
    `<button class="btn btn-primario btn-grande" id="orc-salvar">Salvar orçamento</button></div></div>`;
  const box = elOrc("orc-resultado");
  box.innerHTML = html;
  box.querySelectorAll("[data-orc-ver]").forEach((b) =>
    b.addEventListener("click", () => {
      const d = box.querySelector(`[data-orc-calculo="${b.dataset.orcVer}"]`);
      if (d) d.hidden = !d.hidden;
    })
  );
  elOrc("orc-editar").addEventListener("click", () => { desenharRaioX(); });
  elOrc("orc-salvar").addEventListener("click", () => {
    const lista = lerOrcamentos();
    lista.unshift({
      id: Date.now().toString(36), data: hojeISO(), obraId: r.obraId,
      area, alvenaria: alv, total,
      itens: itens.map((it) => ({ nome: it.nome, qtd: it.qtd, unidade: it.unidade, preco: it.preco, total: it.total })),
    });
    salvarOrcamentos(lista.slice(0, 30));
    mostrarToast("Orçamento salvo!");
  });
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}
