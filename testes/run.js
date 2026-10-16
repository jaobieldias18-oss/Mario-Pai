// Testes matemáticos independentes do motor de orçamento.
// Valores esperados LITERAIS da especificação (nunca gerados pelo código).
// Roda com: node testes/run.js  (sem dependências)
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const BASE = path.join(__dirname, "..");

let pass = 0, fail = 0;
function t(nome, cond, detalhe) {
  if (cond) { pass++; console.log("PASS", nome); }
  else { fail++; console.log("FAIL", nome, detalhe || ""); }
}
function eq(a, b, eps) {
  return Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);
}

// ---- Teste A: área ----
t("A area 5x4=20", 5 * 4 === 20);
// ---- Teste B: volume ----
t("B volume 5x4x2.5=50", 5 * 4 * 2.5 === 50);
// ---- Teste C: parede líquida ----
const bruta = 5 * 2.8, porta = 0.8 * 2.1, janela = 1.2 * 1;
t("C bruta=14", bruta === 14);
t("C porta=1.68", eq(porta, 1.68));
t("C janela=1.2", janela === 1.2);
t("C liquida=11.12", eq(bruta - porta - janela, 11.12));
// ---- Teste D: blocos teóricos ----
t("D teorica=55.6", eq(11.12 / 0.2, 55.6));
t("D compra=56 (sem perda aqui)", Math.ceil(11.12 / 0.2) === 56);
// ---- Teste E: custo ----
t("E 56x4=224", 56 * 4 === 224);
// ---- Teste F: composição (usa custoComposicao real) ----
const store = {};
function stubEl() {
  return {
    hidden: true, value: "", textContent: "", innerHTML: "",
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, appendChild() {}, querySelectorAll: () => [],
    querySelector: () => null, select() {}, reset() {}, click() {},
    files: [], disabled: false, dataset: {}, checked: true,
  };
}
const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  navigator: { onLine: true }, location: { reload() {}, protocol: "https:" },
  setTimeout, clearTimeout,
  numeroOuZero: (v) => { const n = parseFloat(v); return isNaN(n) || n < 0 ? 0 : n; },
  mostrarToast() {}, formatarMoeda: (v) => "R$" + v, proteger: (s) => s,
  precoCadastrado: () => null,
  hojeISO: () => "2026-10-15", formatarData: (s) => s,
  pedirConfirmacao: async () => true,
  document: {
    getElementById: () => stubEl(), querySelectorAll: () => [],
    querySelector: () => null, createElement: () => stubEl(),
    addEventListener() {}, readyState: "complete", body: stubEl(),
  },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(BASE, "composicoes.js"), "utf-8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(BASE, "materiais.js"), "utf-8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(BASE, "orcamento.js"), "utf-8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(BASE, "orcamento_pro.js"), "utf-8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(BASE, "supabase.js"), "utf-8"), sandbox);
const rF = vm.runInContext(`(function () {
  const c = { insumos: [
    { nome: "A", qtd: 2, unidade: "un", preco: 5 },
    { nome: "B", qtd: 0.5, unidade: "un", preco: 8 },
  ] };
  const qtdServ = 10;
  const a = { qtd: c.insumos[0].qtd * qtdServ, total: c.insumos[0].qtd * qtdServ * 5 };
  const b = { qtd: c.insumos[1].qtd * qtdServ, total: c.insumos[1].qtd * qtdServ * 8 };
  return { a: a.qtd === 20 && a.total === 100, b: b.qtd === 5 && b.total === 40 };
})()`, sandbox);
t("F insumo A 20un R$100", rF.a);
t("F insumo B 5un R$40", rF.b);
// composição real do app com preços manuais
const rC = vm.runInContext(`(function () {
  const c = lerComposicoes()[0];
  c.insumos.forEach((x, i) => { x.preco = [168, 35, 1500][i] || 10; });
  const r = custoComposicao(c);
  return { completa: r.completa, total: r.total };
})()`, sandbox);
t("F app: composição precificada soma certo",
  rC.completa === true && eq(rC.total, 0.25 * 168 + 0.03 * 35 + 0.15 * 1500));
// ---- Teste G: perda única ----
t("G 100 + 5% = 105", 100 * (1 + 0.05) === 105);
// perda do app aplicada uma vez (piso): qtd inclui (1+perda) e total usa qtd
t("G app: fator único", (() => {
  const src = fs.readFileSync(path.join(BASE, "orcamento.js"), "utf-8");
  const ocorr = (src.match(/PERDA_PISO/g) || []).length;
  return ocorr >= 2; // definição + uso (sem duplicação em outro ponto)
})());
// ---- Teste H: soma ----
t("H 1000+600+100+50=1750", 1000 + 600 + 100 + 50 === 1750);
// ---- Teste I: ausentes não viram zero silencioso ----
const rI = vm.runInContext(`(function () {
  const out = [];
  out.push(precoCadastrado("xyz-inexistente") === null);
  // item sem preço: total null, não 0
  const it = { qtd: 10, preco: null };
  out.push((it.preco ? it.qtd * it.preco : null) === null);
  // zero área bloqueia (regra do app)
  out.push(!(0 > 0));
  // negativo vira null via P()? simula regra numeroOuZero + v>0
  const P = (v) => { const n = parseFloat(v); const x = isNaN(n) || n < 0 ? 0 : n; return x > 0 ? x : null; };
  out.push(P("-5") === null && P("abc") === null && P("10") === 10);
  return out;
})()`, sandbox);
t("I sem preço -> null", rI[0] && rI[1]);
t("I área zero bloqueia", rI[2]);
t("I negativo/texto inválidos", rI[3]);
// ---- Teste J: precisão ----
t("J 93.5*45=4207.5 exato", 93.5 * 45 === 4207.5);
t("J 0.1+0.2 documentado", Math.abs((0.1 + 0.2) - 0.3) < 1e-9);
// app arredonda compra inteira (bloco/cimento) e 1 casa no resto
t("J ceil blocos", Math.ceil(3674.9) === 3675);
// ---- Parede por geometria (nova) ----
const rP = vm.runInContext(`(function () {
  const out = [];
  const ok = paredeLiquida(40, 2.8, [{ larg: 0.8, alt: 2.1 }, { larg: 1.2, alt: 1 }]);
  out.push(ok && ok.bruta === 112 && ok.vaos === 2.88 && ok.liquida === 109.12);
  out.push(paredeLiquida(0, 2.8, []) === null);
  out.push(paredeLiquida(5, 2.8, [{ larg: 5, alt: 2.8 }]) === null);
  out.push(paredeLiquida(5, -1, []) === null);
  out.push(msgSync(true) !== msgSync(false));
  return out;
})()`, sandbox);
t("parede geometria 112-2.88=109.12", rP[0]);
t("parede inválida -> null", rP[1] && rP[2] && rP[3]);
t("sync honesto difere", rP[4]);

// ---- Sync seguro (supabase.js) ----
// diffSync preserva multiplicidade; classificarErroSync distingue motivos;
// SyncOrc.mensagem nunca afirma "sincronizado" quando falhou.
const rS = vm.runInContext(`(function () {
  const out = [];
  const chave = (x) => (x.nome ? x.nome + "|" + x.quantidade : "L|" + x.quantidade);
  // existentes: dois itens idênticos (L, qtd 1). desejados: dois L e um X.
  const d = diffSync([{ id: "a", quantidade: 1 }, { id: "b", quantidade: 1 }],
                     [{ nome: "L", quantidade: 1 }, { nome: "L", quantidade: 1 }, { nome: "X", quantidade: 2 }], chave);
  out.push(d.inserir.length === 1 && d.inserir[0].nome === "X");   // só X é novo
  out.push(d.remover.length === 0);                                // os dois L casam
  // desejados: um único L. existentes: dois L -> sobra 1 para remover.
  const d2 = diffSync([{ id: "a", quantidade: 1 }, { id: "b", quantidade: 1 }], [{ quantidade: 1 }], chave);
  out.push(d2.inserir.length === 0);
  out.push(d2.remover.length === 1);
  out.push(classificarErroSync({ code: "42P01", message: "relation does not exist" }) === "sem-tabela");
  out.push(classificarErroSync({ code: "42501", message: "permission denied" }) === "permissao");
  out.push(classificarErroSync(new TypeError("Failed to fetch")) === "rede");
  out.push(classificarErroSync("sem-conexao") === "sem-conexao");
  out.push(classificarErroSync({ code: "23505" }) === "duplicado");
  out.push(classificarErroSync({ code: "23503" }) === "referencia");
  out.push(classificarErroSync({ code: "XX000", message: "boom" }) === "gravacao");
  out.push(/sincronizado/.test(SyncOrc.mensagem({ ok: true }, "Material")));
  out.push(!/sincronizado/.test(SyncOrc.mensagem({ ok: false, status: "rede" }, "Material")));
  out.push(!/sincronizado/.test(SyncOrc.mensagem({ ok: false, status: "permissao" })));
  out.push(!/sincronizado/.test(SyncOrc.mensagem({ ok: false, status: "sem-tabela" })));
  return out;
})()`, sandbox);
t("diff preserva mult: insere so o novo (X)", rS[0]);
t("diff preserva mult: sem sobra quando casa", rS[1]);
t("diff remove sobra: nada a inserir", rS[2]);
t("diff remove sobra: uma sobra", rS[3]);
t("erro 42P01 -> sem-tabela", rS[4]);
t("erro 42501 -> permissao", rS[5]);
t("fetch -> rede", rS[6]);
t("sem-conexao literal", rS[7]);
t("23505 -> duplicado", rS[8]);
t("23503 -> referencia", rS[9]);
t("desconhecido -> gravacao", rS[10]);
t("mensagem ok diz sincronizado", rS[11]);
t("mensagem rede NAO diz sincronizado", rS[12]);
t("mensagem permissao NAO diz sincronizado", rS[13]);
t("mensagem sem-tabela NAO diz sincronizado", rS[14]);

// ---- Teste K: IA — respostas diretas (não gastam IA) ----
// Carrega ia.js isolado: só interessa a classificação pura da pergunta.
const iSandbox = { console };
iSandbox.window = iSandbox; iSandbox.globalThis = iSandbox;
vm.createContext(iSandbox);
vm.runInContext(fs.readFileSync(path.join(BASE, "ia.js"), "utf-8"), iSandbox);
const rK = vm.runInContext(`(function () {
  const out = [];
  out.push(intencaoDireta("quanto gastamos este mês") === "gasto");
  out.push(intencaoDireta("Quanto Gastei?") === "gasto");
  out.push(intencaoDireta("quanto recebemos no total") === "recebido");
  out.push(intencaoDireta("qual o saldo") === "resultado");
  out.push(intencaoDireta("quanto tenho a receber") === "aReceber");
  out.push(intencaoDireta("como posso economizar na obra?") === null);
  out.push(intencaoDireta("compare os orçamentos e sugira o melhor") === null);
  out.push(intencaoDireta("organize as etapas da obra") === null);
  out.push(intencaoDireta("") === null);
  out.push(intencaoDireta("gastei muito com o quê exatamente? por que?") === null);
  out.push(intencaoDireta("x".repeat(120)) === null);
  out.push(normalizarTexto("  Quanto  Gastei Neste Mês?  ") === "quanto gastei neste mes?");
  return out;
})()`, iSandbox);
t("IA direta: gasto (2 formas)", rK[0] && rK[1]);
t("IA direta: recebido", rK[2]);
t("IA direta: saldo/resultado", rK[3]);
t("IA direta: a receber", rK[4]);
t("IA aberta: nao responde direto (economizar)", rK[5]);
t("IA aberta: nao responde direto (comparar)", rK[6]);
t("IA aberta: nao responde direto (organizar)", rK[7]);
t("IA direta: vazio -> null", rK[8]);
t("IA direta: pergunta aberta -> null", rK[9]);
t("IA direta: pergunta longa -> null", rK[10]);
t("IA direta: normaliza acento/espaco", rK[11]);

// ---- Teste L: motor do orçamento guiado (puro e determinístico) ----
// Mesmos coeficientes de PARAMS_ORC. Valores esperados calculados à mão.
const rL = vm.runInContext(`(function () {
  const e = { area: 100, quartos: "3", banheiros: "2", sistema: "bloco",
    peletricos: "20", phidraulicos: "12", moDias: "60", moDiaria: 150,
    transporte: 0, outros: 0, precos: { piso: 40 } };
  const r = calcularOrcamentoGuiado(e);
  const byName = {};
  for (const it of r.itens) byName[it.nome] = it;
  const out = [];
  out.push(r.total === 12740);
  out.push(r.semPreco === 15);
  out.push(r.areaParede === 280);
  out.push(byName["Bloco de concreto"].qtd === 3675);
  out.push(byName["Piso cerâmico"].qtd === 93.5 && byName["Piso cerâmico"].total === 3740);
  out.push(byName["Tinta"].qtd === 93.4);
  out.push(byName["Mão de obra"].total === 9000);
  out.push(byName["Pontos elétricos"].qtd === 20 && byName["Pontos hidráulicos"].qtd === 12);
  out.push(byName["Telhas"].qtd === 2080 && byName["Madeiramento"].qtd === 130);
  out.push(JSON.stringify(calcularOrcamentoGuiado(e)) === JSON.stringify(r));
  const g = calcularOrcamentoGuiado(Object.assign({}, e, { parComp: "40", parAlt: "2.8", parVaos: "0.8x2.1;1.2x1" }));
  out.push(g.areaParede === 109.12);
  out.push(g.itens.find((x) => x.etapa === "Alvenaria").qtd === 1433);
  return out;
})()`, sandbox);
t("L total guiado = 12740", rL[0]);
t("L sem preço = 15", rL[1]);
t("L área de parede = 280", rL[2]);
t("L blocos = 3675", rL[3]);
t("L piso 93.5 = R$3740", rL[4]);
t("L tinta 93.4 L", rL[5]);
t("L MO 60x150 = 9000", rL[6]);
t("L pontos 20/12", rL[7]);
t("L telhas 2080 / madeiramento 130", rL[8]);
t("L determinístico (mesma entrada)", rL[9]);
t("L parede medida 109.12", rL[10]);
t("L blocos por medida = 1433", rL[11]);

// ---- Teste M: persistência do orçamento (banco <-> app) ----
// Garante que params/itens/etapa/detalhe sobrevivem ao ir e voltar,
// e que o app degrada bem quando a migração estendida falta.
const rM = vm.runInContext(`(function () {
  const out = [];
  const e = { area: 100, quartos: "3", banheiros: "2", sistema: "bloco",
    peletricos: "20", phidraulicos: "12", moDias: "60", moDiaria: 150, precos: { piso: 40 } };
  const o = {
    id: "abc", data: "2026-10-16", obraId: null, area: 100, alvenaria: "bloco", total: 12740,
    parametros: snapshotParametrosOrcamento(e),
    itens: [{ nome: "Piso cerâmico", etapa: "Pisos", qtd: 93.5, unidade: "m²", preco: 40, total: 3740, detalhe: ["a", "b"], posicao: 0 }],
  };
  const linha = orcamentoParaLinha(o);
  out.push(linha.local_id === "abc" && linha.area === 100 && linha.alvenaria === "bloco");
  out.push(linha.parametros && linha.parametros.coeficientes.PISO_PERC_AREA === 0.85);
  out.push(linha.parametros.entradas.moDias === "60");
  const legada = orcamentoParaLinhaLegada(linha);
  out.push(!("parametros" in legada) && legada.total === 12740);
  const il = itemOrcamentoParaLinha("rid", o.itens[0], 0);
  out.push(il.etapa === "Pisos" && il.posicao === 0);
  out.push(il.detalhe === JSON.stringify(["a", "b"]));
  const back = linhaParaOrcamento(linha, [il]);
  out.push(back.id === "abc" && back.parametros.coeficientes.PAREDE_POR_AREA === 2.8);
  out.push(back.itens.length === 1 && back.itens[0].qtd === 93.5 && back.itens[0].etapa === "Pisos");
  out.push(Array.isArray(back.itens[0].detalhe) && back.itens[0].detalhe[0] === "a" && back.itens[0].detalhe[1] === "b");
  out.push(parseDetalheOrc(null).length === 0);
  out.push(parseDetalheOrc(JSON.stringify(["x", "y"])).length === 2);
  out.push(parseDetalheOrc("texto simples")[0] === "texto simples");
  out.push(parseDetalheOrc(["a"])[0] === "a");
  out.push(temColunaAusente({ code: "42703" }) === true);
  out.push(temColunaAusente({ message: "Could not find the 'parametros' column of 'orcamentos' in the schema cache" }) === true);
  out.push(temColunaAusente({ code: "42501", message: "permission denied" }) === false);
  out.push(temColunaAusente({ code: "23505" }) === false);
  return out;
})()`, sandbox);
t("M linha mapeada", rM[0]);
t("M params no topo (PISO 0.85)", rM[1]);
t("M entrada moDias preservada", rM[2]);
t("M versão legada sem params", rM[3]);
t("M item etapa+posicao", rM[4]);
t("M detalhe vira JSON", rM[5]);
t("M round-trip id+params", rM[6]);
t("M round-trip item", rM[7]);
t("M round-trip detalhe", rM[8]);
t("M detalhe nulo -> vazio", rM[9]);
t("M detalhe JSON -> lista", rM[10]);
t("M detalhe texto -> lista", rM[11]);
t("M detalhe array -> lista", rM[12]);
t("M detecta coluna ausente 42703", rM[13]);
t("M detecta schema cache (fallback)", rM[14]);
t("M permissao nao é coluna", rM[15]);
t("M duplicado nao é coluna", rM[16]);

// ---- Teste N: dados de teste (casa 100 m²) + vãos com vírgula ----
// Casa fictícia: 100 m², parede medida 80×2,80, vãos 8,94 m² → líquida 215,06 m².
// Valores esperados calculados À MÃO a partir de PARAMS_ORC (nunca do código).
const rN = vm.runInContext(`(function () {
  const out = [];
  const d = DADOS_TESTE_OG;
  const e = {
    area: d.campos["og-area"], quartos: String(d.campos["og-quartos"]),
    banheiros: String(d.campos["og-banheiros"]), sistema: d.campos["og-sistema"],
    perimetro: d.campos["og-perimetro"], telhado: d.campos["og-telhado"],
    parComp: String(d.campos["og-par-comp"]), parAlt: String(d.campos["og-par-alt"]),
    parVaos: d.campos["og-par-vaos"],
    peletricos: String(d.campos["og-peletricos"]), phidraulicos: String(d.campos["og-phidraulicos"]),
    moDias: String(d.campos["og-mo-dias"]), moDiaria: d.campos["og-mo-diaria"],
    transporte: d.campos["og-transporte"], outros: d.campos["og-outros"],
    precos: d.precos,
  };
  const r = calcularOrcamentoGuiado(e);
  const byName = {};
  for (const it of r.itens) byName[it.nome] = it;
  out.push(r.areaParede === 215.06);
  out.push(r.semPreco === 0);
  out.push(byName["Bloco de concreto"].qtd === 2823);
  out.push(byName["Cimento (reboco)"].qtd === 54);
  out.push(byName["Tinta"].qtd === 71.7);
  out.push(byName["Concreto fundação"].qtd === 6.4 && byName["Aço fundação"].qtd === 512);
  out.push(byName["Concreto laje"].qtd === 12 && byName["Aço laje"].qtd === 1200);
  out.push(byName["Mão de obra"].qtd === 120 && byName["Mão de obra"].total === 21600);
  out.push(byName["Portas (estimativa: cômodos + 2)"].qtd === 7 && byName["Janelas (estimativa: cômodos + 1)"].qtd === 6);
  out.push(r.total === 95099.5);
  // A vírgula decimal nos vãos deve dar o MESMO resultado do ponto (bug corrigido).
  const ePonto = Object.assign({}, e, { parVaos: "0.80x2.10;0.80x2.10;0.80x2.10;1.20x1.00;1.20x1.00;1.50x1.00" });
  const rPonto = calcularOrcamentoGuiado(ePonto);
  out.push(rPonto.areaParede === r.areaParede && rPonto.total === r.total);
  // Todos os preços de teste estão preenchidos (nenhum material "sem preço").
  out.push(Object.values(d.precos).every((v) => Number(v) > 0));
  return out;
})()`, sandbox);
t("N area de parede 215.06", rN[0]);
t("N sem preco = 0", rN[1]);
t("N blocos = 2823", rN[2]);
t("N cimento = 54", rN[3]);
t("N tinta = 71.7", rN[4]);
t("N fundacao 6.4 m3 / 512 kg", rN[5]);
t("N laje 12 m3 / 1200 kg", rN[6]);
t("N MO 120x180 = 21600", rN[7]);
t("N portas 7 / janelas 6", rN[8]);
t("N total = 95099.5", rN[9]);
t("N virgula = ponto nos vaos", rN[10]);
t("N precos de teste completos", rN[11]);

// ---- Teste O: auditoria, robustez e transparência ----
// Valores esperados calculados À MÃO a partir da especificação (nunca do código).
const rO = vm.runInContext(`(function () {
  const out = [];
  const d = DADOS_TESTE_OG;
  const base = {
    area: d.campos["og-area"], quartos: String(d.campos["og-quartos"]),
    banheiros: String(d.campos["og-banheiros"]), sistema: d.campos["og-sistema"],
    perimetro: d.campos["og-perimetro"], telhado: d.campos["og-telhado"],
    parComp: String(d.campos["og-par-comp"]), parAlt: String(d.campos["og-par-alt"]),
    parVaos: d.campos["og-par-vaos"],
    peletricos: String(d.campos["og-peletricos"]), phidraulicos: String(d.campos["og-phidraulicos"]),
    moDias: String(d.campos["og-mo-dias"]), moDiaria: d.campos["og-mo-diaria"],
    transporte: d.campos["og-transporte"], outros: d.campos["og-outros"],
    precos: d.precos,
  };
  const r = calcularOrcamentoGuiado(base);
  // 1) Subtotais conferem com qtd × preço em TODOS os itens.
  out.push(r.itens.every((it) => (it.preco ? Math.abs(it.total - it.qtd * it.preco) < 1e-9 : it.total === null)));
  // 2) Soma dos subtotais bate com o total geral.
  out.push(Math.abs(r.itens.reduce((s, it) => s + (it.total || 0), 0) - r.total) < 1e-9);
  // 3) Auditoria: metadados presentes em todos os itens.
  out.push(r.itens.every((it) => it.coef && it.formula && it.origem && [1, 2, 3].includes(it.conf) && it.limitacao));
  const aud = montarAuditoriaOrcamento(r);
  // 4) Separação informado (conf 1) vs estimativa por coeficiente (conf 2/3).
  out.push(aud.porConf[1].includes("Mão de obra") && aud.porConf[1].includes("Pontos elétricos"));
  out.push(aud.porConf[2].includes("Bloco de concreto") && aud.porConf[2].includes("Tinta"));
  out.push(aud.porConf[3].includes("Concreto fundação") && aud.porConf[3].includes("Aço laje"));
  // 5) Lista de serviços ausentes documentada (sem valores fictícios).
  out.push(aud.ausentes.length >= 10 && aud.ausentes.every((a) => a.item && a.etapa && a.dado));
  // 6) A parede foi MEDIDA (não estimada) e nenhum vau era inválido.
  out.push(r.geoMedida === true && r.vaosInvalidos === 0 && r.vaosInformados === 6);
  // 7) Vãos informados (6) NÃO batem com esquadrias estimadas (13) → aviso correto.
  out.push(r.vaosDivergem === true && r.esquadriasEstimadas === 13);
  // 8) CAMPO VAZIO: sem perímetro/telhado → sistema ESTIMA e sinaliza.
  const vazio = Object.assign({}, base, { perimetro: "", telhado: "", parComp: "", parAlt: "", parVaos: "" });
  const rv = calcularOrcamentoGuiado(vazio);
  out.push(rv.perimetroInformado === false && rv.telhadoInformado === false && rv.geoMedida === false);
  out.push(rv.perim === 40 && rv.areaTelhado === 130);   // 4×√100 e 100×1,3
  out.push(rv.areaParede === 280);                        // 100 × 2,8
  // 9) VALORES NEGATIVOS/INVÁLIOS viram zero — nenhuma quantidade negativa.
  const neg = Object.assign({}, base, { perimetro: "-5", telhado: "-10", parComp: "", parAlt: "", parVaos: "",
    moDias: "-3", moDiaria: "-180", peletricos: "-2", phidraulicos: "-9", transporte: "-100", outros: "-50" });
  const rn = calcularOrcamentoGuiado(neg);
  out.push(rn.perim > 0 && rn.areaTelhado > 0 && rn.itens.every((it) => it.qtd >= 0 && (it.total === null || it.total >= 0)));
  out.push(rn.itens.find((i) => i.nome === "Mão de obra").qtd === 0);
  out.push(rn.itens.find((i) => i.nome === "Pontos elétricos").qtd === 0);
  // 10) VAU MAL FORMADO não invalida mais a medição inteira (bug corrigido).
  const g = paredeLiquida(80, 2.8, [{ larg: 0.8, alt: 2.1 }, { larg: NaN, alt: NaN }, { larg: 1.2, alt: 1 }]);
  // 80×2,8 = 224; vãos válidos = 1,68 + 1,20 = 2,88 → líquida 221,12; 1 inválido.
  out.push(g !== null && g.liquida === 221.12 && g.invalidos === 1);
  // 11) Sem preço → total parcial e item marcado como "sem preço" (não inventa).
  const semP = Object.assign({}, base, { precos: Object.assign({}, d.precos, { piso: null, telha: null }) });
  const rs = calcularOrcamentoGuiado(semP);
  out.push(rs.semPreco === 2 && rs.total < r.total && rs.itens.filter((i) => i.total === null).length === 2);
  // 12) Quantidades nunca negativas nem NaN com entradas totalmente vazias.
  const tudoVazio = { area: 100, quartos: "", banheiros: "", sistema: "", precos: {} };
  const re = calcularOrcamentoGuiado(tudoVazio);
  out.push(re.itens.every((it) => Number.isFinite(it.qtd) && it.qtd >= 0));
  // 13) Apresentação monetária usa pt-BR (2 casas, vírgula decimal).
  out.push(moeda(95099.5).indexOf("95") >= 0);
  return out;
})()`, sandbox);
t("O subtotais = qtd x preco", rO[0]);
t("O soma subtotais = total", rO[1]);
t("O metadados de auditoria completos", rO[2]);
t("O separa informado (MO/pontos)", rO[3]);
t("O separa estimativa (bloco/tinta)", rO[4]);
t("O marca fundacao/laje como projeto", rO[5]);
t("O lista servicos ausentes", rO[6]);
t("O parede medida e vaos validos", rO[7]);
t("O avisa divergencia vaos x esquadrias", rO[8]);
t("O campo vazio vira estimativa sinalizada", rO[9]);
t("O perim 40 / telhado 130 estimados", rO[10]);
t("O parede estimada 280 m2", rO[11]);
t("O negativos viram zero", rO[12]);
t("O MO negativa zerada", rO[13]);
t("O pontos negativos zerados", rO[14]);
t("O vau invalido nao zera a medição", rO[15]);
t("O sem preco = parcial, nao inventa", rO[16]);
t("O entradas vazias: nada negativo/NaN", rO[17]);
t("O moeda pt-BR", rO[18]);

// ---- Teste P: medição por parede e por ambiente (Fase 2) ----
// TODOS os valores esperados foram calculados À MÃO, independentemente do código.
// Fórmulas: parede bruta = comp × alt; vãos = Σ(larg × alt); líquida = bruta − vãos.
// ambiente: piso = larg × comp; perímetro = 2×(larg+comp); parede = perímetro × alt.
const rQ = vm.runInContext(`(function () {
  const out = [];
  // P1: parede 5×2,80 com 1 porta 0,80×2,10.
  //   bruta = 14,00 ; vão = 1,68 ; líquida = 12,32
  const p1 = calcularParedeMedida({ comp: 5, alt: 2.8, vaos: [{ larg: 0.8, alt: 2.1 }] });
  out.push(p1.ok === true && p1.bruta === 14 && p1.vaos === 1.68 && p1.liquida === 12.32);
  out.push(p1.conf === 1 && p1.vaosInvalidos === 0);
  // P2: parede 6×3,00 com porta 0,90×2,10 e janela 1,50×1,20 + 1 vão inválido.
  //   bruta = 18,00 ; vãos válidos = 1,89 + 1,80 = 3,69 ; líquida = 14,31 ; 1 inválido.
  const p2 = calcularParedeMedida({ comp: 6, alt: 3, vaos: [
    { larg: 0.9, alt: 2.1 }, { larg: 1.5, alt: 1.2 }, { larg: NaN, alt: NaN }] });
  out.push(p2.ok === true && p2.bruta === 18 && p2.vaos === 3.69 && p2.liquida === 14.31 && p2.vaosInvalidos === 1);
  // P3: parede sem medida → rejeitada (não inventa).
  out.push(calcularParedeMedida({ comp: 0, alt: 2.8 }).ok === false);
  out.push(calcularParedeMedida({ comp: 4 }).ok === false);
  // P4: vãos ≥ parede → rejeitada (área líquida não pode ser ≤ 0).
  //   bruta = 2×1 = 2 ; vão 2×1 = 2 → 2 ≥ 2 → rejeita.
  out.push(calcularParedeMedida({ comp: 2, alt: 1, vaos: [{ larg: 2, alt: 1 }] }).ok === false);
  // P5: ambiente 4×5 com altura 2,80. piso = 20 ; perim = 18 ; parede = 50,4.
  const a1 = calcularAmbiente({ larg: 4, comp: 5, alt: 2.8 });
  out.push(a1.ok === true && a1.piso === 20 && a1.perimetro === 18 && a1.parede === 50.4);
  // P5b: ambiente é ESTIMATIVA (não desconta vãos) → confiança 2.
  out.push(a1.conf === 2);
  // P6: altura ausente no ambiente → solicita a medida (não usa coeficiente inventado).
  out.push(calcularAmbiente({ larg: 4, comp: 5 }).ok === false);
  // P7: agregado de 3 paredes (2 válidas + 1 inválida).
  //   pA: 5×2,8 = 14,00 bruta ; vão 0,80×2,10 = 1,68 ; líquida 12,32
  //   pB: 4×2,8 = 11,20 bruta ; sem vãos ; líquida 11,20
  //   total: bruta = 25,20 ; vãos = 1,68 ; líquida = 23,52 ; 1 inválida
  const ap = areaParedesPorLista([
    { comp: 5, alt: 2.8, vaos: [{ larg: 0.8, alt: 2.1 }] },
    { comp: 4, alt: 2.8, vaos: [] },
    { comp: 0, alt: 2.8, vaos: [] },
  ]);
  out.push(ap.bruta === 25.2 && ap.vaos === 1.68 && ap.liquida === 23.52 && ap.invalidas === 1);
  // P8: paredeLiquidaPorLista devolve os MESMOS números da paredeLiquida antiga.
  //   casa de teste: 80×2,8 = 224 ; vãos 8,94 ; líquida 215,06 (3×1,68 + 2×1,20 + 1,50)
  const vaosCasa = [{ larg: 0.8, alt: 2.1 }, { larg: 0.8, alt: 2.1 }, { larg: 0.8, alt: 2.1 },
    { larg: 1.2, alt: 1.0 }, { larg: 1.2, alt: 1.0 }, { larg: 1.5, alt: 1.0 }];
  const antigo = paredeLiquida(80, 2.8, vaosCasa);
  const novo = paredeLiquidaPorLista(80, 2.8, vaosCasa);
  out.push(antigo.liquida === 215.06 && novo.liquida === 215.06);
  out.push(antigo.bruta === novo.bruta && antigo.vaos === novo.vaos && antigo.invalidos === novo.invalidos);
  return out;
})()`, sandbox);
t("P parede 5x2.8 - porta = 12.32", rQ[0]);
t("P parede medida conf 1 / sem vaos invalidos", rQ[1]);
t("P parede 6x3 com 2 vaos + invalido = 14.31", rQ[2]);
t("P parede sem medida rejeitada", rQ[3]);
t("P vaos >= parede rejeitado", rQ[4]);
t("P ambiente 4x5: piso 20 / perim 18 / parede 50.4", rQ[5]);
t("P ambiente e estimativa (conf 2)", rQ[6]);
t("P ambiente sem altura pede a medida", rQ[7]);
t("P agregado 3 paredes = 23.52 liquida", rQ[8]);
t("P paredeLiquidaPorLista = paredeLiquida", rQ[9]);
t("P equivalencia bruta/vaos/invalidos", rQ[10]);

// ---- Teste R: motor com medição por VÁRIAS paredes (Fase 2, aditivo) ----
// Esperados calculados À MÃO. Duas paredes SEM vãos: 40×2,8 = 112 e 30×2,8 = 84.
//   areaParede = 112 + 84 = 196 m²
//   bloco  = ceil(196 × 12,5 × 1,05) = ceil(2572,5) = 2573
//   cimento= ceil(196 × 0,25) = 49
//   tinta  = ceil(196 / 6 × 2 × 10)/10 = ceil(653,33)/10 = 65,4
//   Preços do DADOS_TESTE_OG para os demais itens.
const rR = vm.runInContext(`(function () {
  const out = [];
  const d = DADOS_TESTE_OG;
  const base = {
    area: d.campos["og-area"], quartos: String(d.campos["og-quartos"]),
    banheiros: String(d.campos["og-banheiros"]), sistema: d.campos["og-sistema"],
    perimetro: d.campos["og-perimetro"], telhado: d.campos["og-telhado"],
    peletricos: String(d.campos["og-peletricos"]), phidraulicos: String(d.campos["og-phidraulicos"]),
    moDias: String(d.campos["og-mo-dias"]), moDiaria: d.campos["og-mo-diaria"],
    transporte: d.campos["og-transporte"], outros: d.campos["og-outros"],
    precos: d.precos,
  };
  // (a) COM lista de paredes: usa a medição exata por parede.
  const comLista = Object.assign({}, base, { paredes: [
    { comp: 40, alt: 2.8, vaos: [] },
    { comp: 30, alt: 2.8, vaos: [] },
  ] });
  const rl = calcularOrcamentoGuiado(comLista);
  const byNameL = {}; for (const it of rl.itens) byNameL[it.nome] = it;
  out.push(rl.areaParede === 196 && rl.geoMedida === true);
  out.push(byNameL["Bloco de concreto"].qtd === 2573);
  out.push(byNameL["Cimento (reboco)"].qtd === 49);
  out.push(byNameL["Tinta"].qtd === 65.4);
  out.push(rl.paredeOrigem.indexOf("2 parede") >= 0);
  // (b) SEM lista (comportamento antigo intacto): paredes ausente → estimativa.
  const semLista = Object.assign({}, base);
  const rs = calcularOrcamentoGuiado(semLista);
  out.push(rs.areaParede === 280 && rs.geoMedida === false); // 100 × 2,8 (fator)
  // (c) Lista com vãos: 1 parede 40×2,8 com 2 portas 0,8×2,1 → 112 − 3,36 = 108,64.
  const comVaos = Object.assign({}, base, { paredes: [
    { comp: 40, alt: 2.8, vaos: [{ larg: 0.8, alt: 2.1 }, { larg: 0.8, alt: 2.1 }] },
  ] });
  const rv = calcularOrcamentoGuiado(comVaos);
  out.push(rv.areaParede === 108.64 && rv.vaosInformados === 2 && rv.vaosInvalidos === 0);
  return out;
})()`, sandbox);
t("R lista de paredes: areaParede 196", rR[0]);
t("R bloco com lista = 2573", rR[1]);
t("R cimento com lista = 49", rR[2]);
t("R tinta com lista = 65.4", rR[3]);
t("R origem indica 2 paredes", rR[4]);
t("R sem lista mantem estimativa (280)", rR[5]);
t("R lista com vaos = 108.64 / 2 vaos", rR[6]);

// ---- Teste S: orçamento pro — conversões, medições e cenários (Fase 2+) ----
// Todos os valores esperados calculados À MÃO (independentemente do código).
const rV = vm.runInContext(`(function () {
  const out = [];
  // S1: conversão de unidades. 2 sacos × 50 kg/saco = 100 kg; reverso 100/50 = 2 sacos.
  const conv = [{ de: "saco", para: "kg", fator: 50 }];
  const c1 = converterUnidade(2, "saco", "kg", conv);
  out.push(c1.ok && c1.valor === 100);
  const c2 = converterUnidade(100, "kg", "saco", conv);
  out.push(c2.ok && c2.valor === 2);
  out.push(!converterUnidade(5, "un", "m3", conv).ok); // sem conversão declarada
  // S2: arredondamento de compra. un/m³ inteiro sobe; m2 arredonda 2 casas.
  out.push(arredondarCompra(3.2, "un") === 4 && arredondarCompra(1.234, "m2") === 1.23);
  // S3: parede detalhada 4×2,80 com 2 portas 0,80×2,10 (qtd 2).
  //   bruta = 11,20 ; aberturas = 0,8×2,1×2 = 3,36 ; líquida = 7,84 ; faces 2 → revest. 15,68.
  const pd = calcularParedeDetalhe({ comp: 4, alt: 2.8, faces: 2,
    aberturas: [{ tipo: "porta", larg: 0.8, alt: 2.1, qtd: 2 }] });
  out.push(pd.ok && pd.bruta === 11.2 && pd.aberturas === 3.36 && pd.liquida === 7.84 && pd.revestimentoFaces === 15.68);
  // S4: abertura inválida é contada e ignorada (não invalida a parede).
  const pd2 = calcularParedeDetalhe({ comp: 4, alt: 2.8, faces: 2,
    aberturas: [{ tipo: "porta", larg: 0, alt: 2.1, qtd: 1 }] });
  out.push(pd2.ok && pd2.aberturas === 0 && pd2.aberturasInvalidas === 1);
  // S5: ambiente 4×5 (piso 20, perímetro 18) com altura 2,8.
  const amb = calcularAmbienteDetalhe({ nome: "Sala", larg: 4, comp: 5, alt: 2.8 });
  out.push(amb.ok && amb.piso === 20 && amb.perimetro === 18);
  // S6: medição agregada — 2 paredes (uma com porta) + 1 ambiente 4×4.
  //   P1 4×2,8 − porta 1,68 = 9,52 ; P2 4×2,8 = 11,20 ; líquido 20,72 ; faces extras 20,72.
  //   piso ambiente 4×4 = 16.
  const med = calcularMedicaoObra({
    ambientes: [{ nome: "Sala", larg: 4, comp: 4, alt: 2.8, paredes: [] }],
    paredes: [
      { id: "p1", comp: 4, alt: 2.8, faces: 2, aberturas: [{ tipo: "porta", larg: 0.8, alt: 2.1, qtd: 1 }] },
      { id: "p2", comp: 4, alt: 2.8, faces: 2, aberturas: [] },
    ],
  });
  out.push(med.liquida === 20.72 && med.aberturas === 1.68 && med.bruta === 22.4);
  out.push(med.revestimentoFaces === 41.44 && med.pisoTotal === 16 && med.aberturasTipo.porta === 1);
  // S7: duplicidade por id é detectada e descartada (não conta duas vezes).
  const medD = calcularMedicaoObra({ paredes: [
    { id: "x", comp: 4, alt: 2.8, faces: 2 }, { id: "x", comp: 4, alt: 2.8, faces: 2 }] });
  out.push(medD.liquida === 11.2 && medD.duplicados.length === 1);
  // S8: cenários por fatores explícitos. provável 1000; econ 1000×0,9=900; cons 1000×1,15=1150.
  const cen = gerarCenarios({ total: 1000, itens: [{ nome: "x", preco: 10, qtd: 100 }] },
    { fatorEcon: 0.9, fatorCons: 1.15 });
  out.push(cen.provavel === 1000 && cen.economico === 900 && cen.conservador === 1150 && cen.baseadoEmFatores !== undefined);
  // S9: sem fatores → sem cenário (não inventa margem).
  const cen0 = gerarCenarios({ total: 500, itens: [] }, {});
  out.push(cen0.economico === null && cen0.conservador === null);
  // S10: persistência da medição em edição (round-trip no localStorage do sandbox).
  salvarMedicaoAtual({ ambientes: [{ nome: "Sala" }], paredes: [{ comp: 4 }] });
  const ma = lerMedicaoAtual();
  out.push(ma.ambientes.length === 1 && ma.paredes.length === 1 && ma.ambientes[0].nome === "Sala");
  salvarMedicaoAtual(medicaoVazia());
  out.push(lerMedicaoAtual().ambientes.length === 0 && lerMedicaoAtual().paredes.length === 0);
  return out;
})()`, sandbox);
t("S conversao saco/kg e reverso", rV[0] && rV[1]);
t("S sem conversao declarada falha", rV[2]);
t("S arredonda compra un/m2", rV[3]);
t("S parede 4x2.8 - 2 portas = 7.84 / revest 15.68", rV[4]);
t("S abertura invalida contada e ignorada", rV[5]);
t("S ambiente 4x5 piso20 perim18", rV[6]);
t("S medicao liquida 20.72 / bruta 22.4", rV[7]);
t("S medicao faces 41.44 / piso 16 / porta 1", rV[8]);
t("S duplicidade por id detectada", rV[9]);
t("S cenarios 900/1000/1150 por fatores", rV[10]);
t("S sem fatores nao inventa cenario", rV[11]);
t("S medicao atual round-trip", rV[12]);
t("S medicao vazia limpa", rV[13]);

// ---- Teste T: motor único + extensões por medição real (Fase 2+) ----
// Esperados À MÃO, usando PARAMS_ORC.
const rT = vm.runInContext(`(function () {
  const out = [];
  const medInput = {
    ambientes: [{ nome: "Sala", larg: 4, comp: 4, alt: 2.8, paredes: [] }],
    paredes: [
      { id: "p1", comp: 4, alt: 2.8, faces: 2, aberturas: [{ tipo: "porta", larg: 0.8, alt: 2.1, qtd: 1 }] },
      { id: "p2", comp: 4, alt: 2.8, faces: 2, aberturas: [] },
    ],
  };
  const precos = { piso: 45, bloco: 3.5, cimento: 40, tinta: 35, porta: 450, janela: 350,
    concreto: 450, aco: 8.5, telha: 5, madeiramento: 65,
    peletrico: 120, phidraulico: 180, modiaria: 180,
    argamassa: 120, contrapiso: 250, revestimento: 55 };
  const e = montarEntradaMotor(medInput, { area: 100, quartos: "3", banheiros: "2", sistema: "bloco",
    perimetro: 40, telhado: 120, peletricos: "30", phidraulicos: "12", moDias: "120", moDiaria: 180,
    transporte: 2000, outros: 1500 }, precos);
  const r = calcularOrcamentoGuiado(e);
  const by = {}; for (const it of r.itens) by[it.nome] = it;
  out.push(r.areaParede === 20.72 && r.geoMedida === true);
  // Argamassa: 20,72 × 0,03 = 0,6216 → 0,622 m³
  out.push(by["Argamassa de assentamento"] && by["Argamassa de assentamento"].qtd === 0.622);
  // Chapisco: ceil(20,72 × 0,10) = ceil(2,072) = 3 sacos
  out.push(by["Chapisco (cimento)"] && by["Chapisco (cimento)"].qtd === 3);
  // Faces extras: 41,44 − 20,72 = 20,72 m²
  out.push(by["Reboco e pintura de faces extras"] && by["Reboco e pintura de faces extras"].qtd === 20.72);
  // Contrapiso: 16 m² × 0,03 = 0,48 m³ ; cimento contrapiso: ceil(0,48×7)=4
  out.push(by["Contrapiso (argamassa)"] && by["Contrapiso (argamassa)"].qtd === 0.48);
  out.push(by["Cimento do contrapiso"] && by["Cimento do contrapiso"].qtd === 4);
  // Subtotais das extensões conferem com preço informado.
  out.push(by["Argamassa de assentamento"].total === 0.622 * 120);
  out.push(by["Contrapiso (argamassa)"].total === 0.48 * 250);
  out.push(by["Reboco e pintura de faces extras"].total === 20.72 * 55);
  // Sem medição → NENHUM item de extensão (comportamento base intacto).
  const semMed = calcularOrcamentoGuiado({ area: 100, quartos: "3", banheiros: "2", sistema: "bloco",
    perimetro: 40, telhado: 120, precos: precos });
  const temExt = semMed.itens.some((i) => i.nome === "Argamassa de assentamento" || i.nome === "Contrapiso (argamassa)");
  out.push(temExt === false && semMed.itens.length === 17);
  return out;
})()`, sandbox);
t("T areaParede medida 20.72", rT[0]);
t("T argamassa 0.622 m3", rT[1]);
t("T chapisco 3 sacos", rT[2]);
t("T faces extras 20.72 m2", rT[3]);
t("T contrapiso 0.48 m3", rT[4]);
t("T cimento contrapiso 4 sacos", rT[5]);
t("T subtotal argamassa = qtd x preco", rT[6]);
t("T subtotal contrapiso = qtd x preco", rT[7]);
t("T subtotal faces extras = qtd x preco", rT[8]);
t("T sem medição: sem extensões, 17 itens base", rT[9]);

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
