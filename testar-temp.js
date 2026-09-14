const fs = require("fs");
const src = fs.readFileSync("script.js", "utf8");

// Stub de DOM: registra elementos por id para conferir os valores escritos
function makeEl() {
  return { hidden: false, textContent: "", innerHTML: "", value: "", style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, appendChild() {}, querySelector() { return makeEl(); },
    scrollIntoView() {}, reset() {} };
}
const registro = {};
global.document = {
  addEventListener() {},
  getElementById: (id) => (registro[id] = registro[id] || makeEl()),
  querySelectorAll: () => [],
  createElement: () => makeEl(),
};
global.window = { scrollTo() {} };
global.localStorage = { getItem: () => null, setItem: () => {} };

eval(src + `
obras = [{
  id: "o1", nome: "Casa", cliente: "J", endereco: "", valorContratado: 150000,
  dataInicio: "2026-09-01", previsaoTermino: "2026-12-20", status: "Em andamento",
  dataEncerramento: null, observacoes: "", criadoEm: "2026-09-01",
  recebimentos: [{ id: "r1", valor: 80000, data: "2026-09-10", descricao: "Etapa", formaPagamento: "PIX", observacao: "" }],
  gastos: [
    { id: "g1", categoria: "Materiais", descricao: "Cimento", valor: 250, data: "2026-09-12", observacao: "", maoObraId: null },
    { id: "g2", categoria: "Mão de obra", descricao: "João — Pedreiro (20 diárias)", valor: 3600, data: "2026-09-13", observacao: "auto", maoObraId: "t1" }
  ],
  equipe: [{ id: "t1", nome: "João", funcao: "Pedreiro", valorDiaria: 180, dias: 20, total: 3600 }]
}];
abrirObra("o1");
const txt = (id) => registro[id].textContent;
const assert = (c, m) => { if (!c) { console.error("FALHOU: " + m); process.exit(1); } console.log("ok: " + m); };
const BRL = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
assert(txt("d-valor") === BRL(150000), "valor contratado");
assert(txt("d-recebido") === BRL(80000), "recebido");
assert(txt("d-gasto") === BRL(3850), "gasto total (250 + 3600, sem duplicar)");
assert(txt("d-lucro") === BRL(80000 - 3850), "lucro = recebimentos - gastos");
assert(txt("d-areceber") === BRL(70000), "a receber");
assert(txt("total-recebimentos") === BRL(80000), "total na aba Recebimentos");
assert(txt("total-gastos") === BRL(3850), "total na aba Gastos");
assert(txt("total-equipe") === BRL(3600), "total na aba Mão de obra");
assert(txt("resumo-mo-valor") === BRL(3600), "custo MO no Resumo");
assert(txt("resumo-mo-qtd").includes("1 trabalhador"), "contagem de trabalhadores");
assert(registro["btn-encerrar-obra"].hidden === false, "botao Encerrar visivel em obra ativa");
// elementos removidos não são mais tocados
assert(!registro["qa-gasto"] && !registro["qa-recebimento"] && !registro["qa-equipe"], "sem ações rápidas");
console.log("TELA DA OBRA: tudo certo");
`);
