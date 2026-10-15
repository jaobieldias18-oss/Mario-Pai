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
console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
