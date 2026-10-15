/* =====================================================
   composicoes.js — CATÁLOGO DE COMPOSIÇÕES DE SERVIÇO
   -----------------------------------------------------
   Composição = serviço com insumos, coeficientes, unidade
   e fonte técnica. O orçamento usa para montar itens com
   memória de cálculo rastreável.
   - Semente com composições comuns (fonte declarada).
   - CRUD local; SyncOrc não cobre (fase atual).
   ===================================================== */

const COMP_SAVE_KEY = "mario_composicoes_v1";

function compSemente() {
  const hoje = new Date().toISOString().slice(0, 10);
  return [
    {
      id: "comp-reboco", codigo: "REB-01", descricao: "Reboco de parede interna",
      unidade: "m²", metodo: "Chapisco + reboco desempenado", ativo: true,
      fonte: "Prática de obra", dataRef: hoje, obs: "",
      insumos: [
        { nome: "Cimento", qtd: 0.25, unidade: "saco", preco: null },
        { nome: "Areia média", qtd: 0.03, unidade: "m³", preco: null },
        { nome: "Pedreiro", qtd: 0.15, unidade: "dia", preco: null },
      ],
    },
    {
      id: "comp-piso", codigo: "PIS-01", descricao: "Piso cerâmico assentado",
      unidade: "m²", metodo: "Argamassa AC-I, rejunte", ativo: true,
      fonte: "Prática de obra", dataRef: hoje, obs: "",
      insumos: [
        { nome: "Piso cerâmico", qtd: 1.1, unidade: "m²", preco: null },
        { nome: "Argamassa AC-I 20kg", qtd: 0.25, unidade: "saco", preco: null },
        { nome: "Pedreiro", qtd: 0.12, unidade: "dia", preco: null },
      ],
    },
  ];
}
function lerComposicoes() {
  try {
    const l = JSON.parse(localStorage.getItem(COMP_SAVE_KEY) || "null");
    if (Array.isArray(l)) return l;
  } catch (e) {}
  const s = compSemente();
  try { localStorage.setItem(COMP_SAVE_KEY, JSON.stringify(s)); } catch (e) {}
  return s;
}
function salvarComposicoes(l) {
  try { localStorage.setItem(COMP_SAVE_KEY, JSON.stringify(l)); } catch (e) {}
}
// Custo da composição com preços do catálogo (sem inventar: sem preço = null)
function custoComposicao(c) {
  let precificado = true;
  let total = 0;
  const linhas = [];
  for (const ins of c.insumos || []) {
    let preco = ins.preco;
    if (!(preco > 0) && typeof precoCadastrado === "function") {
      const ach = precoCadastrado(ins.nome);
      if (ach) preco = ach.preco;
    }
    if (!(preco > 0)) { precificado = false; linhas.push(`${ins.nome}: sem preço`); continue; }
    const ct = (Number(ins.qtd) || 0) * preco;
    total += ct;
    linhas.push(`${ins.nome}: ${ins.qtd} ${ins.unidade} × ${preco} = ${ct.toFixed(2)}`);
  }
  return { total: precificado ? total : null, parcial: total, linhas, completa: precificado };
}
function elComp(id) { return document.getElementById(id); }
function desenharComposicoes() {
  const box = elComp("lista-composicoes");
  if (!box) return;
  const lista = lerComposicoes().filter((c) => c.ativo !== false);
  box.innerHTML = "";
  if (!lista.length) {
    box.innerHTML = `<div class="lista-vazia">Nenhuma composição.</div>`;
    return;
  }
  for (const c of lista) {
    const ct = custoComposicao(c);
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">C</span>
        <div class="item-conteudo">
          <strong>${proteger(c.codigo ? c.codigo + " — " + c.descricao : c.descricao)}</strong>
          <span class="item-meta">por ${proteger(c.unidade)} • ${ct.completa ? "total " + formatarMoeda(ct.total) : "parcial " + formatarMoeda(ct.parcial) + " (falta preço)"}</span>
        </div>
      </div>
      <div class="item-acoes"><button data-a="ver">Ver insumos</button></div>
      <div data-detalhe hidden style="margin-top:8px"></div>`;
    div.querySelector('[data-a="ver"]').addEventListener("click", () => {
      const d = div.querySelector("[data-detalhe]");
      d.hidden = !d.hidden;
      if (!d.hidden) {
        d.innerHTML = `<p class="texto-suave">Método: ${proteger(c.metodo || "—")}</p>` +
          `<p class="texto-suave">Fonte: ${proteger(c.fonte || "—")}${c.dataRef ? " • " + c.dataRef : ""}</p>` +
          ct.linhas.map((l) => `<p class="texto-suave">• ${proteger(l)}</p>`).join("");
      }
    });
    box.appendChild(div);
  }
}
function ligarComposicoes() {
  document.querySelectorAll('[data-ir="composicoes"]').forEach((x) => {
    if (!x.dataset.compLigado) {
      x.dataset.compLigado = "1";
      x.addEventListener("click", () => setTimeout(desenharComposicoes, 100));
    }
  });
}
