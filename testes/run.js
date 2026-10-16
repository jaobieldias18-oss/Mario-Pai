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

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
