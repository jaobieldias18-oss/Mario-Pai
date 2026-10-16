/* =====================================================
   orcamento_pro.js — MOTOR ESTENDIDO DO ORÇAMENTO (aditivo)
   -----------------------------------------------------
   Este módulo NÃO cria um segundo motor de cálculo. Ele:
     - fornece DADOS (catálogo técnico, fornecedores, preços,
       histórico de obras reais) com origem/limitação declaradas;
     - oferece FUNÇÕES PURAS E TESTÁVEIS para medições por
       ambiente/parede, conversões de unidade, cenários e
       auditoria estendida;
     - monta a entrada `e` do MOTOR ÚNICO já existente
       (`calcularOrcamentoGuiado`, em orcamento.js).

   Nada aqui inventa preço, coeficiente ou referência. Quando um
   dado não existe, ele é marcado como ausente/pendente.
   ===================================================== */

const ORC_PRO = {
  CATALOGO_KEY: "mario_catalogo_tecnico_v1",
  FORNECEDORES_KEY: "mario_fornecedores_v1",
  COTACOES_KEY: "mario_cotacoes_v1",
  OBRAS_REAIS_KEY: "mario_obras_reais_v1",
  MEDICOES_KEY: "mario_medicoes_v1",
  FUNDACAO_KEY: "mario_fundacao_v1",
  VERSAO: 1,
};

// Data de referência das hipóteses iniciais (não é data de verificação
// de fabricante — serve para rastrear QUANDO a hipótese foi registrada).
const ORC_HIPOTESE_DATA = "2026-10-16";

// ---------- Unidades e conversões (puras) ----------
// Unidades aceitas. Código → rótulo. Não inclui fator de conversão
// implícito: conversões vêm do catálogo (por material).
const ORC_UNIDADES = {
  un: "unidade", m: "metro", m2: "m²", m3: "m³", kg: "kg", g: "g",
  L: "litro", saco: "saco", peca: "peça", pt: "ponto", dia: "diária",
  h: "hora", vb: "verba", gl: "galão", lat: "lata", rolo: "rolo",
  barra: "barra", milheiro: "milheiro", t: "tonelada",
};

// Converte um valor entre unidades usando a lista de conversões do item.
// `conversoes`: [{de, para, fator}] — fator = quantas `para` há em 1 `de`.
// Retorna {ok:true, valor, unidade} ou {ok:false, motivo}.
function converterUnidade(valor, de, para, conversoes) {
  const v = Number(valor);
  if (!(v >= 0)) return { ok: false, motivo: "valor inválido" };
  if (de === para) return { ok: true, valor: v, unidade: para };
  const r2 = (n) => Math.round(n * 1e6) / 1e6;
  // Busca direta e reversa (com caminho de 1 passo).
  for (const c of (conversoes || [])) {
    if (!(Number(c.fator) > 0)) continue;
    if (c.de === de && c.para === para) return { ok: true, valor: r2(v * c.fator), unidade: para };
    if (c.de === para && c.para === de) return { ok: true, valor: r2(v / c.fator), unidade: para };
  }
  return { ok: false, motivo: `sem conversão de ${de} para ${para} no catálogo` };
}

// Arredondamento de compra: sobe para o múltiplo inteiro da unidade comercial.
function arredondarCompra(consumo, unidadeCompra) {
  const c = Number(consumo);
  if (!(c >= 0)) return null;
  const inteiro = unidadeCompra !== "m2" && unidadeCompra !== "m3" && unidadeCompra !== "kg" && unidadeCompra !== "L" && unidadeCompra !== "t";
  return inteiro ? Math.ceil(c) : Math.round(c * 100) / 100;
}

// ---------- Catálogo técnico (dados com origem e limitação) ----------
// Semente: itens com metadados. Preço SEMPRE null (não inventamos preço).
// `conf`: 1 informado · 2 coeficiente (hipótese) · 3 requer validação técnica.
function catalogoSemente() {
  const h = ORC_HIPOTESE_DATA;
  const hip = "Hipótese inicial do sistema — NÃO verificada em fabricante nem norma.";
  const base = [
    { codigo: "ALV-01", nome: "Bloco de concreto 14x19x39", categoria: "Tijolos e blocos",
      unidadeCompra: "un", unidadeConsumo: "un", conversoes: [], dimensoes: "14×19×39 cm",
      rendimento: { valor: 12.5, unidade: "un/m²", obs: "junta de 1 cm; 1/(0,20×0,40)" },
      perda: 0.05, composicao: "Alvenaria de vedação", fonte: hip, dataRef: h, conf: 2,
      limitacao: "Rendimento depende da espessura e da junta; conferir peça real." },
    { codigo: "ALV-02", nome: "Tijolo cerâmico 6 furos", categoria: "Tijolos e blocos",
      unidadeCompra: "un", unidadeConsumo: "un", conversoes: [], dimensoes: "9×19×39 cm (típico)",
      rendimento: { valor: 25, unidade: "un/m²", obs: "NÃO confere com 'deitado' (~33 un/m²)" },
      perda: 0.05, composicao: "Alvenaria de vedação", fonte: hip, dataRef: h, conf: 3,
      limitacao: "Valor não confirmado; depende da peça e do assentamento." },
    { codigo: "CIM-01", nome: "Cimento CP-II 50kg", categoria: "Cimento",
      unidadeCompra: "saco", unidadeConsumo: "kg", conversoes: [{ de: "saco", para: "kg", fator: 50 }],
      dimensoes: "saco 50 kg",
      rendimento: { valor: 0.25, unidade: "saco/m²", obs: "reboco médio (chapisco + emboço)" },
      perda: 0.05, composicao: "REB-01", fonte: hip, dataRef: h, conf: 2,
      limitacao: "Só reboco: não é o cimento total da obra." },
    { codigo: "ARE-01", nome: "Areia média", categoria: "Areia",
      unidadeCompra: "m3", unidadeConsumo: "m3", conversoes: [], dimensoes: "",
      rendimento: { valor: null, unidade: "m³/m²", obs: "" }, perda: 0.05,
      composicao: "REB-01", fonte: hip, dataRef: h, conf: 3, limitacao: "Sem rendimento confirmado." },
    { codigo: "ACO-01", nome: "Aço CA-50", categoria: "Aço",
      unidadeCompra: "barra", unidadeConsumo: "kg",
      conversoes: [{ de: "barra", para: "kg", fator: null }], dimensoes: "varia por bitola",
      rendimento: { valor: null, unidade: "kg/m³", obs: "" }, perda: 0.10,
      composicao: null, fonte: hip, dataRef: h, conf: 3,
      limitacao: "Peso por barra depende da bitola; requer projeto estrutural." },
    { codigo: "PIS-01", nome: "Piso cerâmico 45x45", categoria: "Pisos e revestimentos",
      unidadeCompra: "m2", unidadeConsumo: "m2", conversoes: [], dimensoes: "45×45 cm",
      rendimento: { valor: null, unidade: "m²/m²", obs: "" }, perda: 0.10,
      composicao: "PIS-01", fonte: hip, dataRef: h, conf: 2,
      limitacao: "Perda real depende do recorte do ambiente." },
    { codigo: "TIN-01", nome: "Tinta acrílica", categoria: "Tintas",
      unidadeCompra: "L", unidadeConsumo: "L", conversoes: [], dimensoes: "",
      rendimento: { valor: 6, unidade: "m²/L por demão", obs: "parede selada" }, perda: 0.03,
      composicao: null, fonte: hip, dataRef: h, conf: 2,
      limitacao: "Rendimento depende da superfície e da demão." },
    { codigo: "TEL-01", nome: "Telha cerâmica", categoria: "Telhas e madeiramento",
      unidadeCompra: "un", unidadeConsumo: "un", conversoes: [], dimensoes: "varia por modelo",
      rendimento: { valor: 16, unidade: "un/m²", obs: "peça pequena (~0,06 m²); NÃO é romana" },
      perda: 0.05, composicao: null, fonte: hip, dataRef: h, conf: 3,
      limitacao: "Modelo muda o consumo (romana 8–10 un/m²). Confirmar a telha." },
    { codigo: "CIM-02", nome: "Argamassa AC-I 20kg", categoria: "Argamassa",
      unidadeCompra: "saco", unidadeConsumo: "saco", conversoes: [], dimensoes: "saco 20 kg",
      rendimento: { valor: null, unidade: "saco/m²", obs: "" }, perda: 0.05,
      composicao: "PIS-01", fonte: hip, dataRef: h, conf: 3, limitacao: "Sem rendimento confirmado." },
  ];
  return base.map((b, i) => Object.assign({
    id: "cat-" + String(i + 1).padStart(3, "0"), ativo: true, obs: "",
  }, b));
}
function lerCatalogo() {
  try {
    const l = JSON.parse(localStorage.getItem(ORC_PRO.CATALOGO_KEY) || "null");
    if (Array.isArray(l) && l.length) return l;
  } catch (e) {}
  const s = catalogoSemente();
  try { localStorage.setItem(ORC_PRO.CATALOGO_KEY, JSON.stringify(s)); } catch (e) {}
  return s;
}
function salvarCatalogo(l) {
  try { localStorage.setItem(ORC_PRO.CATALOGO_KEY, JSON.stringify(l)); } catch (e) {}
}
function buscarCatalogo(termo) {
  const t = String(termo || "").toLowerCase().trim();
  const l = lerCatalogo();
  if (!t) return l.filter((x) => x.ativo !== false);
  return l.filter((x) => x.ativo !== false &&
    ((x.nome || "").toLowerCase().includes(t) ||
     (x.codigo || "").toLowerCase().includes(t) ||
     (x.categoria || "").toLowerCase().includes(t)));
}
function catalogoPorCodigo(cod) {
  return lerCatalogo().find((x) => x.codigo === cod) || null;
}

// ---------- Preços e fornecedores (histórico, sem atualização silenciosa) ----------
// Cotação: { id, codigo, fornecedor, preco, unidade, data, localidade, obraId, obs, tipo }
// tipo: "confirmado" (nota/cotação real) · "historico" (registro antigo) ·
//       "estimativa" (informado como estimativa). NUNCA é inferido.
const ORC_TIPO_PRECO = {
  confirmado: "Preço confirmado",
  historico: "Preço histórico",
  estimativa: "Estimativa (não confirmada)",
};
function lerCotacoes() {
  try { return JSON.parse(localStorage.getItem(ORC_PRO.COTACOES_KEY)) || []; } catch (e) { return []; }
}
function salvarCotacoes(l) {
  try { localStorage.setItem(ORC_PRO.COTACOES_KEY, JSON.stringify(l.slice(0, 500))); } catch (e) {}
}
function adicionarCotacao(c) {
  const preco = Number(c && c.preco);
  if (!(preco > 0)) return { ok: false, motivo: "preço deve ser maior que zero" };
  const codigo = String((c && c.codigo) || "").trim();
  if (!codigo) return { ok: false, motivo: "informe o material/serviço (código do catálogo)" };
  const lista = lerCotacoes();
  const novo = {
    id: "cot-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    codigo, fornecedor: (c.fornecedor || "").trim(), preco,
    unidade: c.unidade || "", data: c.data || hojeISO(),
    localidade: (c.localidade || "").trim(), obraId: c.obraId || null,
    obs: (c.obs || "").trim(), tipo: ["confirmado", "historico", "estimativa"].includes(c.tipo) ? c.tipo : "estimativa",
  };
  lista.unshift(novo);
  salvarCotacoes(lista);
  return { ok: true, cotacao: novo };
}
// Preço "vigente" de um item: o mais recente por data; empate → maior id.
// Devolve a cotação inteira (com tipo) para NÃO confundir confirmado/estimado.
function precoVigente(codigo, filtro) {
  const f = filtro || {};
  let lista = lerCotacoes().filter((x) => x.codigo === codigo);
  if (f.fornecedor) lista = lista.filter((x) => x.fornecedor === f.fornecedor);
  if (f.obraId) lista = lista.filter((x) => x.obraId === f.obraId);
  if (!lista.length) return null;
  lista = lista.slice().sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (a.id < b.id ? 1 : -1)));
  return lista[0];
}
// Preço desatualizado? Compara a data da cotação com hoje. NÃO altera o preço:
// só avisa. `diasMax` default 90. Retorna { desatualizado, dias, motivo }.
function precoDesatualizado(cotacao, diasMax) {
  const lim = Number(diasMax) > 0 ? Number(diasMax) : 90;
  if (!cotacao || !cotacao.data) return { desatualizado: false, dias: null, motivo: "cotação sem data" };
  const d = new Date(cotacao.data + "T00:00:00");
  if (isNaN(d.getTime())) return { desatualizado: false, dias: null, motivo: "data inválida" };
  const hoje = new Date(hojeISO() + "T00:00:00");
  const dias = Math.floor((hoje - d) / 86400000);
  const desatualizado = dias > lim;
  return { desatualizado, dias, motivo: desatualizado ? `preço registrado há ${dias} dias (> ${lim})` : "dentro da validade" };
}
// Comparação por fornecedor: menor preço primeiro (sem afirmar qual "vale").
function compararFornecedores(codigo) {
  const lista = lerCotacoes().filter((x) => x.codigo === codigo);
  const porForn = {};
  for (const c of lista) {
    const k = c.fornecedor || "(sem fornecedor)";
    if (!porForn[k] || c.data > porForn[k].data) porForn[k] = c;
  }
  return Object.values(porForn).sort((a, b) => a.preco - b.preco);
}
function lerFornecedores() {
  try { return JSON.parse(localStorage.getItem(ORC_PRO.FORNECEDORES_KEY)) || []; } catch (e) { return []; }
}
function salvarFornecedores(l) {
  try { localStorage.setItem(ORC_PRO.FORNECEDORES_KEY, JSON.stringify(l.slice(0, 200))); } catch (e) {}
}
function salvarFornecedor(f) {
  const nome = String((f && f.nome) || "").trim();
  if (!nome) return { ok: false, motivo: "informe o nome do fornecedor" };
  const lista = lerFornecedores();
  const i = lista.findIndex((x) => x.id === f.id);
  const reg = {
    id: f.id || "forn-" + Date.now().toString(36), nome,
    telefone: (f.telefone || "").trim(), cidade: (f.cidade || "").trim(),
    categoria: (f.categoria || "").trim(), obs: (f.obs || "").trim(),
  };
  if (i >= 0) lista[i] = reg; else lista.unshift(reg);
  salvarFornecedores(lista);
  return { ok: true, fornecedor: reg };
}

// ---------- Histórico de obras reais (previsto × comprado × realizado) ----------
// Registro: { id, obraId, codigo/nome, etapa, qtdPrevista, qtdComprada,
//             qtdUsada, custoPrevisto, custoRealizado, data, justificativa }
function lerObrasReais() {
  try { return JSON.parse(localStorage.getItem(ORC_PRO.OBRAS_REAIS_KEY)) || []; } catch (e) { return []; }
}
function salvarObrasReais(l) {
  try { localStorage.setItem(ORC_PRO.OBRAS_REAIS_KEY, JSON.stringify(l.slice(0, 500))); } catch (e) {}
}
// Diferenças puras. NÃO afirma aprendizado automático — só calcula.
function diffObraReal(r) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const cp = num(r.custoPrevisto), cr = num(r.custoRealizado);
  const qp = num(r.qtdPrevista), qc = num(r.qtdComprada), qu = num(r.qtdUsada);
  const dReais = (cp != null && cr != null) ? cr - cp : null;
  const dPerc = (dReais != null && cp > 0) ? (dReais / cp) * 100 : null;
  const dQtd = (qp != null && qc != null) ? qc - qp : null;
  return { custoPrevisto: cp, custoRealizado: cr, diferencaReais: dReais, diferencaPerc: dPerc,
    qtdPrevista: qp, qtdComprada: qc, qtdUsada: qu, diferencaQtd: dQtd };
}
function salvarObraReal(r) {
  const lista = lerObrasReais();
  const reg = Object.assign({ id: r.id || "real-" + Date.now().toString(36), data: r.data || hojeISO() }, r);
  const i = lista.findIndex((x) => x.id === reg.id);
  if (i >= 0) lista[i] = reg; else lista.unshift(reg);
  salvarObrasReais(lista);
  return { ok: true, registro: reg };
}

// ---------- Cenários (explícitos, sem probabilidade inventada) ----------
// Recebe o resultado base do motor e fatores EXPLÍCITOS informados pelo usuário.
// Não inventa probabilidade: só aplica os fatores aos itens que têm preço.
// Regras: econômico reduz preço por fatorEcon (<1); conservador aumenta por
// fatorCons (>1). Quantidades não mudam salvo `fatorPerda` informado.
function gerarCenarios(base, opcoes) {
  const o = opcoes || {};
  const fEcon = Number(o.fatorEcon); // ex.: 0.9 = -10%
  const fCons = Number(o.fatorCons); // ex.: 1.15 = +15%
  const temFatores = (fEcon > 0 && fEcon !== 1) || (fCons > 0 && fCons !== 1);
  const monta = (fatorPreco) => {
    const itens = (base.itens || []).map((it) => {
      if (it.preco == null) return { nome: it.nome, total: null };
      return { nome: it.nome, total: Math.round(it.qtd * it.preco * fatorPreco * 100) / 100 };
    });
    const total = Math.round(itens.reduce((s, x) => s + (x.total || 0), 0) * 100) / 100;
    const semPreco = itens.filter((x) => x.total === null).length;
    return { itens, total, semPreco, baseadoEmFatores: temFatores };
  };
  const provavel = base.total;
  const economico = temFatores && fEcon > 0 ? monta(fEcon).total : null;
  const conservador = temFatores && fCons > 0 ? monta(fCons).total : null;
  return {
    provavel,
    economico, conservador,
    baseadoEmFatores: temFatores,
    fatores: { economico: fEcon || null, conservador: fCons || null },
    // Explicitamente: é uma SIMULAÇÃO por fatores, não probabilidade estatística.
    observacao: temFatores
      ? "Cenários SIMULADOS por fatores de preço informados pelo usuário. Não são probabilidades nem garantia de custo final."
      : "Informe os fatores econômico/conservador para simular cenários. Sem fatores, não há cenário (não inventamos margem).",
    porItem: {
      economico: fEcon > 0 ? monta(fEcon).itens : null,
      conservador: fCons > 0 ? monta(fCons).itens : null,
    },
  };
}

// ---------- Medições por ambiente e por parede (puras) ----------
// Abertura: { tipo:"porta"|"janela"|"outro", larg, alt, qtd }
// Parede:   { id, nome, comp, alt, espessura, tipoAlvenaria, material,
//             faces (0–2), aberturas:[Abertura] }
// Ambiente: { id, nome, larg, comp, alt, paredes:[Parede], piso, revestimento }

function normalizarAbertura(a) {
  const larg = Number(a && a.larg), alt = Number(a && a.alt);
  const qtd = Math.max(0, parseInt((a && a.qtd) || "1", 10) || 0);
  const tipo = (a && a.tipo) || "outro";
  if (!(larg > 0) || !(alt > 0)) return { ok: false, motivo: "abertura com largura/altura inválidas", tipo };
  if (!(qtd > 0)) return { ok: false, motivo: "abertura com quantidade zero", tipo };
  return { ok: true, tipo, larg, alt, qtd, area: larg * alt * qtd };
}
function calcularParedeDetalhe(p) {
  const comp = Number(p && p.comp), alt = Number(p && p.alt);
  if (!(comp > 0) || !(alt > 0)) return { ok: false, motivo: "comprimento/altura da parede inválidos" };
  const faces = Math.max(0, Math.min(2, parseInt((p && p.faces) != null ? p.faces : "2", 10) || 0));
  const r2 = (n) => Math.round(n * 100) / 100;
  const bruta = comp * alt;
  let aberturas = 0, invalidas = 0;
  for (const a of (p.aberturas || [])) {
    const na = normalizarAbertura(a);
    if (!na.ok) { invalidas++; continue; }
    aberturas += na.area;
  }
  if (aberturas >= bruta) {
    return { ok: false, motivo: "aberturas cobrem toda a parede", bruta: r2(bruta), aberturas: r2(aberturas) };
  }
  const liquida = bruta - aberturas;
  return {
    ok: true, comp: r2(comp), alt: r2(alt), espessura: Number(p.espessura) || null,
    tipoAlvenaria: p.tipoAlvenaria || null, material: p.material || null, faces,
    bruta: r2(bruta), aberturas: r2(aberturas), liquida: r2(liquida),
    revestimentoFaces: r2(liquida * faces),
    aberturasInvalidas: invalidas,
    origem: "medidas reais da parede (comprimento × altura − aberturas)",
    conf: 1,
  };
}
function calcularAmbienteDetalhe(a) {
  const larg = Number(a && a.larg), comp = Number(a && a.comp), alt = Number(a && a.alt);
  if (!(larg > 0) || !(comp > 0)) return { ok: false, motivo: "largura/comprimento do ambiente inválidos" };
  const r2 = (n) => Math.round(n * 100) / 100;
  const piso = larg * comp;
  return {
    ok: true, nome: a.nome || "", larg: r2(larg), comp: r2(comp), alt: Number(alt) || null,
    piso: r2(piso), perimetro: r2(2 * (larg + comp)),
    paredeAltura: alt > 0 ? r2(2 * (larg + comp) * alt) : null,
    pisoTipo: a.piso || null, revestimento: a.revestimento || null,
    origem: "medidas do ambiente (piso = larg × comp)",
    conf: 1,
  };
}
// Agrega uma obra: ambientes e/ou paredes soltas. Valida duplicidade por id.
function calcularMedicaoObra(med) {
  const ambientes = (med && med.ambientes) || [];
  const paredes = (med && med.paredes) || [];
  const vistos = new Set();
  const aberturasTipo = { porta: 0, janela: 0, outro: 0 };
  let bruta = 0, aberturas = 0, liquida = 0, revestimentoFaces = 0;
  let paredesInvalidas = 0, aberturasInvalidas = 0;
  const porAmbiente = [];
  const porParede = [];
  const duplicados = [];
  const todasParedes = [];
  for (const a of ambientes) for (const p of (a.paredes || [])) todasParedes.push(Object.assign({ ambiente: a.nome || "" }, p));
  for (const p of paredes) todasParedes.push(p);
  for (const p of todasParedes) {
    if (p.id) { if (vistos.has(p.id)) { duplicados.push(p.id); continue; } vistos.add(p.id); }
    const r = calcularParedeDetalhe(p);
    aberturasInvalidas += r.aberturasInvalidas || 0;
    if (!r.ok) { paredesInvalidas++; porParede.push(r); continue; }
    bruta += r.bruta; aberturas += r.aberturas; liquida += r.liquida; revestimentoFaces += r.revestimentoFaces;
    for (const ab of (p.aberturas || [])) {
      const na = normalizarAbertura(ab);
      if (na.ok) aberturasTipo[na.tipo] = (aberturasTipo[na.tipo] || 0) + na.qtd;
    }
    porParede.push(Object.assign({ ambiente: p.ambiente || "" }, r));
  }
  for (const a of ambientes) {
    const ra = calcularAmbienteDetalhe(a);
    porAmbiente.push(Object.assign({ paredes: (a.paredes || []).length }, ra));
  }
  const pisoTotal = porAmbiente.reduce((s, x) => s + (x.ok ? x.piso : 0), 0);
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    ok: todasParedes.length > 0 || ambientes.length > 0,
    bruta: r2(bruta), aberturas: r2(aberturas), liquida: r2(liquida),
    revestimentoFaces: r2(revestimentoFaces), pisoTotal: r2(pisoTotal),
    paredes: todasParedes.length, paredesInvalidas, aberturasInvalidas,
    duplicados, porAmbiente, porParede, aberturasTipo,
    temMedidaReal: liquida > 0,
  };
}

// Monta a entrada `e` do MOTOR ÚNICO a partir da medição + dados da tela.
// NÃO calcula quantitativo aqui: apenas traduz. O cálculo é do motor.
function montarEntradaMotor(med, campos, precos) {
  const c = campos || {};
  const medicao = calcularMedicaoObra(med);
  const paredes = (medicao.porParede || []).filter((p) => p.ok)
    .map((p) => ({ id: p.id, comp: p.comp, alt: p.alt, vaos: [] , faces: p.faces }));
  // Reconstrói vãos para o motor (para o desconto e o aviso de esquadrias).
  const paredesComVaos = [];
  if (medicao.temMedidaReal) {
    const lista = [];
    for (const a of (med.ambientes || [])) for (const p of (a.paredes || [])) lista.push(p);
    for (const p of (med.paredes || [])) lista.push(p);
    for (const p of lista) {
      const det = calcularParedeDetalhe(p);
      if (det.ok) paredesComVaos.push({ comp: p.comp, alt: p.alt, vaos: p.aberturas || [], faces: det.faces });
    }
  }
  return {
    area: numeroOuZero(c.area), quartos: c.quartos, banheiros: c.banheiros,
    sistema: c.sistema || "bloco", perimetro: c.perimetro, telhado: c.telhado,
    peletricos: c.peletricos, phidraulicos: c.phidraulicos,
    moDias: c.moDias, moDiaria: numeroOuZero(c.moDiaria),
    transporte: numeroOuZero(c.transporte), outros: numeroOuZero(c.outros),
    precos: precos || {},
    paredes: paredesComVaos.length ? paredesComVaos : undefined,
    medicao, // metadados para a auditoria (o motor ignora se não souber usar)
    // --- Dados técnicos (Seções 2,4,5,6) repassados ao motor ---
    pinturaFaces: c.pinturaFaces, pinturaTeto: c.pinturaTeto,
    telhaModelo: c.telhaModelo, telhaUnM2: c.telhaUnM2,
    moEscopo: c.moEscopo, fundacao: c.fundacao,
  };
}

// ---------- Auditoria estendida (pura) ----------
// Acrescenta a cada linha: fonte do preço, perdas e dados pendentes.
// Não altera o cálculo — só enriquece a apresentação.
function auditoriaEstendida(r, extras) {
  const e = extras || {};
  const base = (typeof montarAuditoriaOrcamento === "function") ? montarAuditoriaOrcamento(r) : { linhas: [], porConf: { 1: [], 2: [], 3: [] }, ausentes: [] };
  const cot = e.cotacoes || {};
  const linhas = base.linhas.map((l) => {
    const c = cot[l.nome];
    return Object.assign({}, l, {
      fontePreco: c ? `${c.fornecedor || "(sem fornecedor)"} — ${ORC_TIPO_PRECO[c.tipo] || c.tipo}` : (l.preco ? "preço informado na tela" : "sem preço"),
      pendente: !l.preco,
    });
  });
  return Object.assign({}, base, {
    linhas,
    categorias: {
      informado: linhas.filter((l) => l.conf === 1),
      coeficiente: linhas.filter((l) => l.conf === 2),
      projeto: linhas.filter((l) => l.conf === 3),
    },
    precoConfirmado: linhas.filter((l) => l.fontePreco && l.fontePreco.indexOf("confirmado") >= 0),
    precoHistorico: linhas.filter((l) => l.fontePreco && l.fontePreco.indexOf("histórico") >= 0),
    precoEstimado: linhas.filter((l) => l.fontePreco && l.fontePreco.indexOf("Estimativa") >= 0),
    itensSemPreco: linhas.filter((l) => !l.preco),
    avisoTotalParcial: r.semPreco > 0,
  });
}

// ---------- Persistência local das medições ----------
function lerMedicoes() {
  try { return JSON.parse(localStorage.getItem(ORC_PRO.MEDICOES_KEY)) || []; } catch (e) { return []; }
}
function salvarMedicoes(l) {
  try { localStorage.setItem(ORC_PRO.MEDICOES_KEY, JSON.stringify(l.slice(0, 100))); } catch (e) {}
}
// Medição "em edição" na tela: { ambientes:[], paredes:[] }. Sem dado → vazio.
function medicaoVazia() { return { ambientes: [], paredes: [] }; }
function lerMedicaoAtual() {
  try {
    const m = JSON.parse(localStorage.getItem(ORC_PRO.MEDICOES_KEY + "_atual") || "null");
    if (m && typeof m === "object") {
      return { ambientes: Array.isArray(m.ambientes) ? m.ambientes : [],
        paredes: Array.isArray(m.paredes) ? m.paredes : [] };
    }
  } catch (e) {}
  return medicaoVazia();
}
function salvarMedicaoAtual(m) {
  const limpa = { ambientes: (m && m.ambientes) || [], paredes: (m && m.paredes) || [] };
  try { localStorage.setItem(ORC_PRO.MEDICOES_KEY + "_atual", JSON.stringify(limpa)); } catch (e) {}
  return limpa;
}

// ---------- Fundação por elemento (persistida no aparelho - Seção 2) ----------
// Formato: { sapatas:[], baldrames:[], pilares:[], vigas:[], laje:{area,espessura}, acoKgM3 }
function fundacaoVazia() { return { sapatas: [], baldrames: [], pilares: [], vigas: [], laje: null, acoKgM3: null }; }
function lerFundacao() {
  try {
    const f = JSON.parse(localStorage.getItem(ORC_PRO.FUNDACAO_KEY) || "null");
    if (f && typeof f === "object") {
      const v = fundacaoVazia();
      for (const k of ["sapatas", "baldrames", "pilares", "vigas"]) if (Array.isArray(f[k])) v[k] = f[k];
      if (f.laje && typeof f.laje === "object") {
        const area = Number(f.laje.area);
        const esp = Number(f.laje.espessura != null ? f.laje.espessura : f.laje.esp);
        if (area > 0 && esp > 0) v.laje = { area: area, espessura: esp };
      }
      v.acoKgM3 = Number(f.acoKgM3) > 0 ? Number(f.acoKgM3) : null;
      return v;
    }
  } catch (e) {}
  return fundacaoVazia();
}
function salvarFundacao(f) {
  const limpa = fundacaoVazia();
  if (f) for (const k of ["sapatas", "baldrames", "pilares", "vigas"]) if (Array.isArray(f[k])) limpa[k] = f[k];
  if (f && f.laje && typeof f.laje === "object") {
    const area = Number(f.laje.area);
    const esp = Number(f.laje.espessura != null ? f.laje.espessura : f.laje.esp);
    if (area > 0 && esp > 0) limpa.laje = { area: area, espessura: esp };
  }
  if (f && Number(f.acoKgM3) > 0) limpa.acoKgM3 = Number(f.acoKgM3);
  try { localStorage.setItem(ORC_PRO.FUNDACAO_KEY, JSON.stringify(limpa)); } catch (e) {}
  return limpa;
}

if (typeof window !== "undefined") {
  window.OrcPro = {
    ORC_PRO, ORC_UNIDADES, ORC_TIPO_PRECO, ORC_HIPOTESE_DATA,
    converterUnidade, arredondarCompra,
    catalogoSemente, lerCatalogo, salvarCatalogo, buscarCatalogo, catalogoPorCodigo,
    lerCotacoes, salvarCotacoes, adicionarCotacao, precoVigente, compararFornecedores, precoDesatualizado,
    lerFornecedores, salvarFornecedores, salvarFornecedor,
    lerObrasReais, salvarObrasReais, diffObraReal, salvarObraReal,
    gerarCenarios,
    normalizarAbertura, calcularParedeDetalhe, calcularAmbienteDetalhe, calcularMedicaoObra,
    montarEntradaMotor, auditoriaEstendida, lerMedicoes, salvarMedicoes,
    medicaoVazia, lerMedicaoAtual, salvarMedicaoAtual,
    fundacaoVazia, lerFundacao, salvarFundacao,
  };
}
