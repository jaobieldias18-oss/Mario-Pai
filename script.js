/* =====================================================
   CONTROLE DE OBRAS — JavaScript puro (Vanilla JS)
   -----------------------------------------------------
   Organização do código (para iniciantes):
   1. DADOS (estado global)
   2. ARMAZENAMENTO (Supabase — ver supabase.js)
   3. UTILIDADES (moeda, data, toast)
   4. CÁLCULOS DA OBRA (recebido, gasto, lucro, margem...)
   5. CÁLCULOS MENSAIS (financeiro: entradas/gastos por mês)
   6. NAVEGAÇÃO (trocar de telas e abas)
   7. OBRAS (criar, editar, excluir, encerrar, reabrir, listar)
   8. RECEBIMENTOS (adicionar, editar, excluir)
   9. GASTOS (adicionar, editar, excluir)
   10. MÃO DE OBRA (entra sozinha nos gastos, sem duplicar)
   11. MODAL + CONFIRMAÇÃO + EVENTOS (ligar botões às funções)
   ===================================================== */

// ---------- 1. DADOS ----------
let obras = [];            // lista de todas as obras
let obraAbertaId = null;   // qual obra está aberta na tela de detalhe
let editandoObraId = null; // se estamos editando obra (null = criando nova)
let editandoRecId = null;  // recebimento sendo editado
let editandoGastoId = null;// gasto sendo editado
let editandoEqId = null;   // trabalhador sendo editado
let filtroObras = "ativas"; // filtro da lista: "ativas" | "encerradas" | "todas"
let mesSelecionado = null;  // mês aberto no Financeiro, formato "AAAA-MM"
let vgAno = null;           // ano do filtro da Visão Geral ("2026" ou "todos")
let vgMesDetalhe = null;    // mês tocado na Visão Geral, formato "AAAA-MM"

const CATEGORIAS = ["Materiais", "Mão de obra", "Frete/Transporte", "Ferramentas", "Alimentação", "Equipamentos", "Outros"];

// Ícones das categorias (só visual — os dados continuam iguais)
const ICONES_CATEGORIA = {
  "Materiais": "🧱",
  "Mão de obra": "👷",
  "Frete/Transporte": "🚚",
  "Ferramentas": "🧰",
  "Alimentação": "🍽️",
  "Equipamentos": "⚙️",
  "Outros": "📦",
};
function iconeCategoria(cat) {
  return ICONES_CATEGORIA[cat] || "📦";
}
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// Obra encerrada = status "Encerrada" (novo) ou "Concluída" (antigo, mantido por compatibilidade)
function ehEncerrada(obra) {
  return obra.status === "Encerrada" || obra.status === "Concluída";
}

// ---------- 2. ARMAZENAMENTO (Supabase) ----------
// Os dados vivem no Supabase (ver supabase.js, objeto DB).
// Nada é lido ou salvo no localStorage durante o uso normal.

// Recarrega tudo do banco (a tela sempre mostra a verdade do servidor)
async function recarregar() {
  try {
    obras = await DB.carregarTudo();
  } catch (e) {
    console.error("Erro ao recarregar do banco:", e);
  }
  renderTudo();
}

// Erro padrão: avisa o usuário, registra e recarrega (nunca finge que salvou)
async function erroBanco(operacao, e) {
  console.error("Erro Supabase (" + operacao + "):", e);
  mostrarToast("Não foi possível " + operacao + ". Verifique sua conexão e tente novamente.", false);
  await recarregar();
}

// ---------- 3. UTILIDADES ----------
function formatarMoeda(valor) {
  const numero = Number(valor) || 0;
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(textoISO) {
  // "2026-09-10" -> "10/09/2026"
  if (!textoISO) return "—";
  const partes = textoISO.split("-");
  if (partes.length !== 3) return textoISO;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

// Mês atual no formato "AAAA-MM" (ex: "2026-09")
function mesAtual() {
  return hojeISO().slice(0, 7);
}

// "2026-09" -> "Setembro 2026" (para exibir no seletor e no histórico)
function nomeMes(chave) {
  if (!chave || !/^\d{4}-\d{2}$/.test(chave)) return "—";
  const [ano, mes] = chave.split("-").map(Number);
  if (mes < 1 || mes > 12) return chave;
  return MESES[mes - 1][0].toUpperCase() + MESES[mes - 1].slice(1) + " " + ano;
}

// Soma +1 ou -1 mês em uma chave "AAAA-MM" (ex: mudarMesChave("2026-01", -1) = "2025-12")
function mudarMesChave(chave, delta) {
  let [ano, mes] = chave.split("-").map(Number);
  mes += delta;
  while (mes < 1) { mes += 12; ano--; }
  while (mes > 12) { mes -= 12; ano++; }
  return ano + "-" + String(mes).padStart(2, "0");
}

function pegarObra(id) {
  return obras.find((o) => o.id === id);
}

function numeroOuZero(valor) {
  const n = parseFloat(valor);
  return isNaN(n) || n < 0 ? 0 : n;
}

let tempoToast = null;
function mostrarToast(mensagem, sucesso = true) {
  const el = document.getElementById("toast");
  el.textContent = mensagem;
  el.hidden = false;
  el.classList.toggle("sucesso", sucesso);
  clearTimeout(tempoToast);
  tempoToast = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------- 4. CÁLCULOS ----------
// Regras (gastos e mão de obra SEPARADOS, sem conta dupla):
// totalRecebido = soma dos recebimentos
// totalGasto    = soma SÓ dos gastos sem elo de mão de obra (despesas puras)
// totalMO       = soma dos trabalhadores (diaria × dias)
// totalCusto    = totalGasto + totalMO (tudo que a obra custou)
// aReceber      = valorContratado - totalRecebido
// lucro         = totalRecebido - totalCusto
// margem        = lucro / totalRecebido * 100 (se recebido = 0, margem = 0)
function totalMaoObra(obra) {
  // Custo de mão de obra = soma dos trabalhadores (fonte única da verdade).
  // Gastos automáticos antigos (maoObraId) NÃO entram aqui: o trabalhador
  // já representa esse custo — somar os dois seria contar duas vezes.
  return (obra.equipe || []).reduce(
    (s, x) => s + (Number(x.total) || (numeroOuZero(x.valorDiaria) * numeroOuZero(x.dias))), 0);
}

function calcularTotais(obra) {
  const totalRecebido = (obra.recebimentos || []).reduce((s, r) => s + numeroOuZero(r.valor), 0);
  const totalGasto = (obra.gastos || [])
    .filter((g) => !g.maoObraId) // ignora gastos automáticos legados de mão de obra
    .reduce((s, g) => s + numeroOuZero(g.valor), 0);
  const totalMO = totalMaoObra(obra);
  const totalCusto = totalGasto + totalMO; // tudo que a obra custou
  const valorContratado = numeroOuZero(obra.valorContratado);
  const aReceber = valorContratado - totalRecebido;
  const lucro = totalRecebido - totalCusto;
  const margem = totalRecebido > 0 ? (lucro / totalRecebido) * 100 : 0; // evita divisão por zero
  return { totalRecebido, totalGasto, totalMO, totalCusto, aReceber, lucro, margem, valorContratado };
}

function calcularResumoGeral() {
  let ativas = 0, encerradas = 0, valorTotal = 0, recebido = 0, gasto = 0, mo = 0, lucro = 0;
  for (const obra of obras) {
    if (ehEncerrada(obra)) encerradas++;
    else ativas++;
    const t = calcularTotais(obra);
    valorTotal += t.valorContratado;
    recebido += t.totalRecebido;
    gasto += t.totalGasto;
    mo += t.totalMO;
  }
  lucro = recebido - gasto - mo;
  return { ativas, encerradas, valorTotal, recebido, gasto, mo, lucro };
}

// ---------- 5. CÁLCULOS MENSAIS (FINANCEIRO) ----------
// IMPORTANTE: resultado mensal NÃO é lucro de obra.
// Resultado mensal = tudo que entrou (recebimentos com data no mês)
//                  - tudo que saiu no mês, sendo:
//                    + gastos (despesas) com data no mês, e
//                    + mão de obra do mês (cada trabalhador conta UMA vez,
//                      na data do seu gasto automático legado OU na sua
//                      própria data — nunca nas duas).
// Somando TODAS as obras (inclusive encerradas: vale a DATA).
// Calculado na hora — não existe lista separada, nunca fica inconsistente.
function dataValida(texto) {
  return typeof texto === "string" && /^\d{4}-\d{2}-\d{2}$/.test(texto);
}

function calcularMes(chaveMes) {
  // chaveMes = "AAAA-MM", ex: "2026-09"
  let entradas = 0, gastos = 0;
  const listaEntradas = []; // {obra, descricao, data, valor}
  const listaSaidas = [];
  for (const obra of obras) {
    for (const r of obra.recebimentos || []) {
      if (dataValida(r.data) && r.data.slice(0, 7) === chaveMes) {
        entradas += numeroOuZero(r.valor);
        listaEntradas.push({ obra: obra.nome, descricao: r.descricao, data: r.data, valor: numeroOuZero(r.valor) });
      }
    }
    // Datas dos gastos automáticos legados (preserva o histórico original)
    const dataAutoMO = {};
    for (const g of obra.gastos || []) {
      if (g.maoObraId) {
        if (dataValida(g.data)) dataAutoMO[g.maoObraId] = g.data;
      } else if (dataValida(g.data) && g.data.slice(0, 7) === chaveMes) {
        gastos += numeroOuZero(g.valor);
        listaSaidas.push({ obra: obra.nome, descricao: g.descricao, data: g.data, valor: numeroOuZero(g.valor), categoria: g.categoria, formaPagamento: g.formaPagamento || "" });
      }
    }
    // Mão de obra do mês (uma vez por trabalhador, sem duplicar)
    for (const t of obra.equipe || []) {
      const total = numeroOuZero(t.valorDiaria) * numeroOuZero(t.dias);
      const dataMO = dataAutoMO[t.id] || t.data || "";
      if (dataValida(dataMO) && dataMO.slice(0, 7) === chaveMes) {
        gastos += total;
        listaSaidas.push({
          obra: obra.nome,
          descricao: `${t.nome} — ${t.funcao} (${t.dias} dia${t.dias > 1 ? "s" : ""})`,
          data: dataMO, valor: total, categoria: "Mão de obra",
        });
      }
    }
  }
  listaEntradas.sort((a, b) => a.data.localeCompare(b.data));
  listaSaidas.sort((a, b) => a.data.localeCompare(b.data));
  return { entradas, gastos, resultado: entradas - gastos, listaEntradas, listaSaidas };
}

// Lista todos os meses que têm algum lançamento, do mais novo ao mais antigo
// (recebimentos, gastos E mão de obra — pela data de cada um)
function listarMesesComMovimento() {
  const meses = new Set();
  for (const obra of obras) {
    for (const r of obra.recebimentos || []) if (dataValida(r.data)) meses.add(r.data.slice(0, 7));
    for (const g of obra.gastos || []) {
      if (g.maoObraId || !dataValida(g.data)) continue; // automático legado não conta aqui
      meses.add(g.data.slice(0, 7));
    }
    for (const t of obra.equipe || []) {
      const auto = (obra.gastos || []).find((g) => g.maoObraId === t.id);
      const dataMO = (auto && dataValida(auto.data) && auto.data) || t.data || "";
      if (dataValida(dataMO)) meses.add(dataMO.slice(0, 7));
    }
  }
  return [...meses].sort().reverse();
}

// ---------- 6. NAVEGAÇÃO ----------
const telas = ["dashboard", "nova-obra", "obra", "financeiro", "visao-geral"];

function mostrarTela(nome) {
  // Mostra só a tela pedida
  const mapa = {
    dashboard: "tela-dashboard",
    "nova-obra": "tela-nova-obra",
    obra: "tela-obra",
    financeiro: "tela-financeiro",
    "visao-geral": "tela-visao-geral",
  };
  document.querySelectorAll(".tela").forEach((el) => el.classList.remove("ativa"));
  document.getElementById(mapa[nome]).classList.add("ativa");

  // Se abriu o Financeiro, garante que há um mês selecionado e desenha a tela
  if (nome === "financeiro") {
    if (!mesSelecionado) mesSelecionado = mesAtual();
    renderFinanceiro();
  }

  // Visão Geral: desenha com os mesmos dados do Financeiro (sem nova consulta)
  if (nome === "visao-geral") renderVisaoGeral();

  // Atualiza menu ativo
  document.querySelectorAll("[data-ir]").forEach((btn) => {
    btn.classList.toggle("ativo", btn.dataset.ir === nome || (nome === "obra" && btn.dataset.ir === "obras"));
  });

  window.scrollTo({ top: 0 });
}

function irPara(destino) {
  if (destino === "dashboard") mostrarTela("dashboard");
  else if (destino === "financeiro") mostrarTela("financeiro");
  else if (destino === "visao-geral") mostrarTela("visao-geral");
  else if (destino === "obras") {
    mostrarTela("dashboard");
    setTimeout(() => document.getElementById("ancora-obras").scrollIntoView({ behavior: "smooth" }), 50);
  }
  else if (destino === "nova-obra") abrirFormObra(null);
}

function trocarAba(nomeAba) {
  document.querySelectorAll(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === nomeAba));
  document.querySelectorAll(".painel-aba").forEach((p) => p.classList.remove("ativo"));
  document.getElementById("aba-" + nomeAba).classList.add("ativo");
}

// ---------- 7. OBRAS ----------
function abrirFormObra(id) {
  // id = null → criar nova | id existente → editar
  editandoObraId = id;
  const form = document.getElementById("form-obra");
  form.reset();

  if (id) {
    const obra = pegarObra(id);
    if (!obra) return;
    document.getElementById("titulo-form-obra").textContent = "Editar obra";
    document.getElementById("btn-salvar-obra").textContent = "Salvar alterações";
    document.getElementById("obra-nome").value = obra.nome || "";
    document.getElementById("obra-cliente").value = obra.cliente || "";
    document.getElementById("obra-endereco").value = obra.endereco || "";
    document.getElementById("obra-valor").value = obra.valorContratado || "";
    document.getElementById("obra-inicio").value = obra.dataInicio || "";
    document.getElementById("obra-fim").value = obra.previsaoTermino || "";
    document.getElementById("obra-status").value = obra.status || "Em andamento";
    document.getElementById("obra-obs").value = obra.observacoes || "";
  } else {
    document.getElementById("titulo-form-obra").textContent = "Nova obra";
    document.getElementById("btn-salvar-obra").textContent = "Criar obra";
  }
  mostrarTela("nova-obra");
}

function salvarObra(event) {
  event.preventDefault(); // não recarrega a página

  const nome = document.getElementById("obra-nome").value.trim();
  const cliente = document.getElementById("obra-cliente").value.trim();
  const valor = numeroOuZero(document.getElementById("obra-valor").value);

  if (!nome || !cliente || valor <= 0) {
    mostrarToast("Preencha nome, cliente e valor válido.", false);
    return;
  }

  // Se o status atual da obra não existe mais nas opções (ex: "Pausada",
  // removida do formulário), mantém o status antigo em vez de salvar vazio.
  const statusSel = document.getElementById("obra-status").value;
  const statusAntigo = editandoObraId && pegarObra(editandoObraId) ? pegarObra(editandoObraId).status : "";
  const dados = {
    nome,
    cliente,
    endereco: document.getElementById("obra-endereco").value.trim(),
    valorContratado: valor,
    dataInicio: document.getElementById("obra-inicio").value,
    previsaoTermino: document.getElementById("obra-fim").value,
    status: statusSel || statusAntigo || "Em andamento",
    observacoes: document.getElementById("obra-obs").value.trim(),
  };

  salvarObraNoBanco(dados);
}

// Parte que fala com o Supabase (separada para tratar erro de conexão)
async function salvarObraNoBanco(dados) {
  if (editandoObraId) {
    const obra = pegarObra(editandoObraId);
    if (!obra) { editandoObraId = null; return; }
    const atual = { ...obra, ...dados };
    // Se marcou como encerrada e ainda não tem data, registra hoje.
    // Se voltou para ativa, limpa a data de encerramento.
    if (ehEncerrada(atual) && !atual.dataEncerramento) atual.dataEncerramento = hojeISO();
    if (!ehEncerrada(atual)) atual.dataEncerramento = null;
    try {
      await DB.atualizarObra(editandoObraId, atual); // UPDATE em obras
      Object.assign(obra, atual);
    } catch (e) {
      editandoObraId = null;
      await erroBanco("salvar a obra", e);
      return;
    }
    mostrarToast("Obra atualizada!");
    abrirObra(editandoObraId);
  } else {
    const nova = { ...dados, dataEncerramento: null };
    // Obra nova já criada como encerrada (raro, mas possível): registra a data
    if (ehEncerrada(nova)) nova.dataEncerramento = hojeISO();
    let criada;
    try {
      criada = await DB.criarObra(nova); // INSERT em obras
    } catch (e) {
      editandoObraId = null;
      await erroBanco("criar a obra", e);
      return;
    }
    obras.push(criada);
    mostrarToast("Obra criada!");
    renderTudo();
    mostrarTela("dashboard");
  }
  editandoObraId = null;
}

async function excluirObra() {
  const obra = pegarObra(obraAbertaId);
  if (!obra) return;
  if (!confirm(`Excluir "${obra.nome}" e todos os lançamentos?`)) return;
  try {
    await DB.excluirObra(obraAbertaId); // DELETE (o banco apaga os filhos junto)
  } catch (e) {
    await erroBanco("excluir a obra", e);
    return;
  }
  obras = obras.filter((o) => o.id !== obraAbertaId);
  obraAbertaId = null;
  renderTudo();
  mostrarTela("dashboard");
  mostrarToast("Obra excluída.");
}

function abrirObra(id) {
  obraAbertaId = id;
  trocarAba("resumo");
  renderObra();
  mostrarTela("obra");
}

// ---------- ENCERRAMENTO DE OBRA ----------
// Encerrar NÃO apaga nada: só muda o status para "Encerrada",
// registra a data e tira a obra da lista de ativas.
// Gastos, recebimentos e equipe continuam salvos e visíveis.
async function encerrarObra() {
  const obra = pegarObra(obraAbertaId);
  if (!obra || ehEncerrada(obra)) return;
  const ok = await pedirConfirmacao(
    "Encerrar obra?",
    `Tem certeza que deseja encerrar "${obra.nome}"? A obra será movida para o histórico e não aparecerá mais entre as obras em andamento.`,
    "Encerrar obra"
  );
  if (!ok) return;
  try {
    await DB.atualizarObra(obraAbertaId, { ...obra, status: "Encerrada", dataEncerramento: hojeISO() });
  } catch (e) {
    await erroBanco("encerrar a obra", e);
    return;
  }
  obra.status = "Encerrada";
  obra.dataEncerramento = hojeISO();
  renderTudo();
  mostrarToast("Obra encerrada e movida para o histórico.");
}

async function reabrirObra() {
  const obra = pegarObra(obraAbertaId);
  if (!obra || !ehEncerrada(obra)) return;
  try {
    await DB.atualizarObra(obraAbertaId, { ...obra, status: "Em andamento", dataEncerramento: null });
  } catch (e) {
    await erroBanco("reabrir a obra", e);
    return;
  }
  obra.status = "Em andamento";
  obra.dataEncerramento = null;
  renderTudo();
  mostrarToast("Obra reaberta.");
}

// Obra encerrada é somente leitura: bloqueia qualquer alteração
// (adicionar, editar ou excluir lançamentos) e avisa o usuário.
function obraSomenteLeitura(obra) {
  if (obra && ehEncerrada(obra)) {
    mostrarToast("Obra encerrada. Reabra para alterar.", false);
    return true;
  }
  return false;
}

// ---------- 8. RECEBIMENTOS ----------
async function salvarRecebimento(event) {
  event.preventDefault();
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return;

  const valor = numeroOuZero(document.getElementById("rec-valor").value);
  const data = document.getElementById("rec-data").value;
  const descricao = document.getElementById("rec-desc").value.trim();
  if (!valor || !data || !descricao) {
    mostrarToast("Preencha valor, data e descrição.", false);
    return;
  }

  const dados = {
    valor, data, descricao,
    formaPagamento: document.getElementById("rec-forma").value,
    observacao: document.getElementById("rec-obs").value.trim(),
  };

  if (editandoRecId) {
    try {
      await DB.atualizarRecebimento(editandoRecId, dados); // UPDATE em recebimentos
      Object.assign(obra.recebimentos.find((r) => r.id === editandoRecId), dados);
    } catch (e) {
      editandoRecId = null;
      fecharModal();
      await erroBanco("atualizar o recebimento", e);
      return;
    }
    mostrarToast("Recebimento atualizado!");
  } else {
    let novo;
    try {
      novo = await DB.inserirRecebimento(obra.id, dados); // INSERT em recebimentos
    } catch (e) {
      editandoRecId = null;
      fecharModal();
      await erroBanco("registrar o recebimento", e);
      return;
    }
    obra.recebimentos.push(novo);
    mostrarToast("Recebimento registrado!");
  }
  editandoRecId = null;
  fecharModal();
  renderTudo();
}

async function excluirRecebimento(id) {
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return;
  if (!confirm("Excluir este recebimento?")) return;
  try {
    await DB.excluirRecebimento(id); // DELETE em recebimentos
  } catch (e) {
    await erroBanco("excluir o recebimento", e);
    return;
  }
  obra.recebimentos = obra.recebimentos.filter((r) => r.id !== id);
  renderTudo();
  mostrarToast("Recebimento excluído.");
}

// ---------- 9. GASTOS ----------
async function salvarGasto(event) {
  event.preventDefault();
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return;

  const valor = numeroOuZero(document.getElementById("gasto-valor").value);
  const data = document.getElementById("gasto-data").value;
  const descricao = document.getElementById("gasto-desc").value.trim();
  if (!valor || !data || !descricao) {
    mostrarToast("Preencha descrição, valor e data.", false);
    return;
  }

  const dados = {
    categoria: document.getElementById("gasto-categoria").value,
    descricao, valor, data,
    formaPagamento: document.getElementById("gasto-forma").value,
    observacao: document.getElementById("gasto-obs").value.trim(),
  };

  if (editandoGastoId) {
    const gasto = obra.gastos.find((g) => g.id === editandoGastoId);
    if (gasto.maoObraId) {
      mostrarToast("Edite pela aba Mão de obra.", false);
      return;
    }
    try {
      await DB.atualizarGasto(editandoGastoId, dados); // UPDATE em gastos
      Object.assign(gasto, dados);
    } catch (e) {
      editandoGastoId = null;
      fecharModal();
      await erroBanco("atualizar o gasto", e);
      return;
    }
    mostrarToast("Gasto atualizado!");
  } else {
    let novo;
    try {
      novo = await DB.inserirGasto(obra.id, { ...dados, maoObraId: null }); // INSERT em gastos
    } catch (e) {
      editandoGastoId = null;
      fecharModal();
      await erroBanco("registrar o gasto", e);
      return;
    }
    obra.gastos.push(novo);
    mostrarToast("Gasto registrado!");
  }
  editandoGastoId = null;
  fecharModal();
  renderTudo();
}

async function excluirGasto(id) {
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return;
  const gasto = obra.gastos.find((g) => g.id === id);
  if (!gasto) return;
  if (gasto.maoObraId) {
    mostrarToast("Exclua pela aba Mão de obra.", false);
    return;
  }
  if (!confirm("Excluir este gasto?")) return;
  try {
    await DB.excluirGasto(id); // DELETE em gastos
  } catch (e) {
    await erroBanco("excluir o gasto", e);
    return;
  }
  obra.gastos = obra.gastos.filter((g) => g.id !== id);
  renderTudo();
  mostrarToast("Gasto excluído.");
}

// ---------- 10. MÃO DE OBRA (módulo separado dos gastos) ----------
// SEPARAÇÃO TOTAL: trabalhador NÃO cria mais gasto automático.
// - Total de mão de obra = soma dos trabalhadores (diaria × dias).
// - Total de gastos = soma SÓ dos gastos sem elo (despesas puras).
// - O custo da obra considera os dois, cada um uma única vez.
// Gastos automáticos antigos (maoObraId) são ignorados nas listas e
// totais de gastos; ao editar/excluir o trabalhador, o legado ligado
// a ele é atualizado/apagado junto para manter tudo consistente.
async function salvarTrabalhador(event) {
  event.preventDefault();
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return;

  const nome = document.getElementById("eq-nome").value.trim();
  const funcao = document.getElementById("eq-funcao").value.trim();
  const diaria = numeroOuZero(document.getElementById("eq-diaria").value);
  const dias = numeroOuZero(document.getElementById("eq-dias").value);
  const data = document.getElementById("eq-data").value || hojeISO();
  if (!nome || !funcao || !diaria || !dias) {
    mostrarToast("Preencha nome, função, diária e dias.", false);
    return;
  }
  const total = diaria * dias;

  if (editandoEqId) {
    const trab = obra.equipe.find((t) => t.id === editandoEqId);
    if (!trab) { editandoEqId = null; fecharModal(); return; }
    // Legado: se existe gasto automático antigo ligado, atualiza junto
    const gasto = obra.gastos.find((g) => g.maoObraId === editandoEqId);
    try {
      await DB.atualizarTrabalhador(editandoEqId, { nome, funcao, valorDiaria: diaria, dias, data });
      if (gasto) {
        await DB.atualizarGasto(gasto.id, {
          categoria: gasto.categoria,
          descricao: `${nome} — ${funcao} (${dias} diária${dias > 1 ? "s" : ""})`,
          valor: total, data: gasto.data, observacao: gasto.observacao, maoObraId: editandoEqId,
        });
      }
      Object.assign(trab, { nome, funcao, valorDiaria: diaria, dias, total, data });
      if (gasto) Object.assign(gasto, { valor: total });
    } catch (e) {
      editandoEqId = null;
      fecharModal();
      await erroBanco("atualizar o trabalhador", e);
      return;
    }
    mostrarToast("Trabalhador atualizado!");
  } else {
    let novoT = null;
    try {
      novoT = await DB.inserirTrabalhador(obra.id, { nome, funcao, valorDiaria: diaria, dias, data });
      obra.equipe.push(novoT);
    } catch (e) {
      editandoEqId = null;
      fecharModal();
      await erroBanco("adicionar o trabalhador", e);
      return;
    }
    mostrarToast("Trabalhador adicionado!");
  }
  editandoEqId = null;
  fecharModal();
  renderTudo();
}

async function excluirTrabalhador(id) {
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return;
  if (!confirm("Remover trabalhador?")) return;
  const gasto = obra.gastos.find((g) => g.maoObraId === id); // legado automático junto
  try {
    if (gasto) await DB.excluirGasto(gasto.id);
    await DB.excluirTrabalhador(id);
  } catch (e) {
    await erroBanco("remover o trabalhador", e);
    return;
  }
  obra.equipe = obra.equipe.filter((t) => t.id !== id);
  obra.gastos = obra.gastos.filter((g) => g.maoObraId !== id);
  renderTudo();
  mostrarToast("Trabalhador removido.");
}

// ---------- 10. RENDERIZAÇÃO (desenhar a tela) ----------
function renderTudo() {
  // Cada tela é desenhada de forma isolada: se uma falhar (ex: versão
  // antiga do HTML em cache), as outras continuam funcionando e o erro
  // aparece no console em vez de travar a tela em silêncio.
  try {
    renderDashboard();
  } catch (e) { console.error("Erro ao desenhar dashboard:", e); }
  try {
    renderObra();
  } catch (e) { console.error("Erro ao desenhar obra:", e); }
  // Se o Financeiro estiver aberto, atualiza ele também
  try {
    if (document.getElementById("tela-financeiro").classList.contains("ativa")) renderFinanceiro();
  } catch (e) { console.error("Erro ao desenhar financeiro:", e); }
  // Idem para a Visão Geral (usa os mesmos dados, sem nova consulta)
  try {
    if (document.getElementById("tela-visao-geral").classList.contains("ativa")) renderVisaoGeral();
  } catch (e) { console.error("Erro ao desenhar visão geral:", e); }
}

function renderDashboard() {
  const r = calcularResumoGeral();
  atualizarSaudacao();
  document.getElementById("res-ativas").textContent = r.ativas;
  document.getElementById("res-encerradas").textContent = r.encerradas;
  document.getElementById("res-valor-total").textContent = formatarMoeda(r.valorTotal);
  document.getElementById("res-recebido").textContent = formatarMoeda(r.recebido);
  document.getElementById("res-gasto").textContent = formatarMoeda(r.gasto);
  document.getElementById("res-mo").textContent = formatarMoeda(r.mo);
  const lucroEl = document.getElementById("res-lucro");
  lucroEl.textContent = formatarMoeda(r.lucro);
  lucroEl.style.color = r.lucro < 0 ? "#ff9d97" : "#fff";

  // Resumo financeiro do mês atual (entradas - gastos de TODAS as obras)
  const chaveMes = mesAtual();
  const rm = calcularMes(chaveMes);
  document.getElementById("dash-mes-titulo").textContent = "Financeiro · " + nomeMes(chaveMes);
  document.getElementById("dash-mes-entradas").textContent = formatarMoeda(rm.entradas);
  document.getElementById("dash-mes-gastos").textContent = formatarMoeda(rm.gastos);
  const resEl = document.getElementById("dash-mes-resultado");
  resEl.textContent = formatarMoeda(rm.resultado);
  resEl.style.color = rm.resultado < 0 ? "#ff9d97" : "#fff";

  // Filtro ativo nos botões
  document.querySelectorAll(".filtro").forEach((b) =>
    b.classList.toggle("ativo", b.dataset.filtro === filtroObras)
  );

  // Aplica o filtro: ativas = não encerradas | encerradas | todas
  let visiveis = obras;
  if (filtroObras === "ativas") visiveis = obras.filter((o) => !ehEncerrada(o));
  else if (filtroObras === "encerradas") visiveis = obras.filter((o) => ehEncerrada(o));

  document.getElementById("contador-obras").textContent =
    visiveis.length === 0 ? "" : `${visiveis.length} obra${visiveis.length > 1 ? "s" : ""}`;

  // Botão "Ver obras encerradas": aparece quando há encerradas e o filtro não é o delas
  document.getElementById("btn-ver-encerradas").hidden =
    !(r.encerradas > 0 && filtroObras !== "encerradas");

  const lista = document.getElementById("lista-obras");
  const vazio = document.getElementById("estado-vazio");
  vazio.hidden = obras.length !== 0;
  lista.innerHTML = "";

  if (obras.length > 0 && visiveis.length === 0) {
    lista.innerHTML = `<div class="lista-vazia">Nenhuma obra neste filtro.<br>Toque em outra aba acima.</div>`;
    return;
  }

  for (const obra of visiveis) {
    const t = calcularTotais(obra);
    const encerrada = ehEncerrada(obra);
    const inicial = (obra.nome || "?").trim().charAt(0).toUpperCase();
    const dotClasse = encerrada ? "encerrada" : obra.status === "Pausada" ? "pausada" : "";
    const card = document.createElement("article");
    card.className = "obra-card" + (encerrada ? " encerrada" : "");
    card.innerHTML = `
      <div class="obra-topo">
        <div class="obra-avatar" aria-hidden="true">${proteger(inicial)}</div>
        <div>
          <h3>${proteger(obra.nome)}</h3>
          <p class="obra-cliente">Cliente: ${proteger(obra.cliente)}</p>
        </div>
      </div>
      <div class="obra-numeros">
        <div><small>Contratado</small><b>${formatarMoeda(t.valorContratado)}</b></div>
        <div><small>Gastos</small><b class="texto-vermelho">${formatarMoeda(t.totalGasto)}</b></div>
        <div><small>${encerrada ? "Lucro final" : "Lucro atual"}</small><b class="texto-azul">${formatarMoeda(t.lucro)}</b></div>
      </div>
      <p class="obra-status-linha"><span class="status-dot ${dotClasse}"></span>${proteger(obra.status || "Em andamento")}${encerrada && obra.dataEncerramento ? ` · ${formatarData(obra.dataEncerramento)}` : ""} · 👷 ${formatarMoeda(t.totalMO)}</p>
      <button class="btn btn-primario" style="margin-top:10px">Ver obra →</button>`;
    card.querySelector("button").addEventListener("click", () => abrirObra(obra.id));
    lista.appendChild(card);
  }
}

// Saudação do topo (só visual: cumprimento por horário + nome)
function atualizarSaudacao() {
  const agora = new Date();
  const hora = agora.getHours();
  const cumprimento = hora >= 5 && hora < 12 ? "Bom dia" : hora >= 12 && hora < 18 ? "Boa tarde" : "Boa noite";
  document.getElementById("saudacao").innerHTML = `${cumprimento}, <strong>Mario Dias</strong>! 👋`;
  const dias = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  document.getElementById("saudacao-data").textContent =
    `${dias[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}`;
}

// Desenha a tela de detalhe da obra aberta
function renderObra() {
  const obra = pegarObra(obraAbertaId);
  if (!obra) return;
  const t = calcularTotais(obra);

  document.getElementById("obra-titulo").textContent = obra.nome;
  document.getElementById("obra-cliente-linha").textContent = "Cliente: " + obra.cliente;
  document.getElementById("obra-avatar").textContent = (obra.nome || "?").trim().charAt(0).toUpperCase();

  const badge = document.getElementById("obra-status-badge");
  badge.textContent = obra.status || "Em andamento";
  badge.className = "badge-status" +
    (obra.status === "Pausada" ? " pausada" : ehEncerrada(obra) ? " concluida" : "");

  document.getElementById("d-valor").textContent = formatarMoeda(t.valorContratado);
  document.getElementById("d-recebido").textContent = formatarMoeda(t.totalRecebido);
  document.getElementById("d-gasto").textContent = formatarMoeda(t.totalGasto);
  const lucroEl = document.getElementById("d-lucro");
  lucroEl.textContent = formatarMoeda(t.lucro);
  lucroEl.style.color = t.lucro < 0 ? "var(--vermelho)" : "inherit";
  document.getElementById("d-areceber").textContent = formatarMoeda(t.aReceber);
  document.getElementById("d-margem").textContent =
    t.totalRecebido > 0 ? t.margem.toFixed(2).replace(".", ",") + "%" : "—";

  // Totais por aba + custo de mão de obra no Resumo (só exibição).
  const custoMO = t.totalMO; // soma dos trabalhadores (o que a aba Mão de obra lista)
  document.getElementById("d-mo").textContent = formatarMoeda(custoMO);
  document.getElementById("d-custos").textContent = formatarMoeda(t.totalCusto);
  document.getElementById("resumo-mo-valor").textContent = formatarMoeda(custoMO);
  document.getElementById("resumo-mo-qtd").textContent =
    obra.equipe.length === 0 ? "· nenhum trabalhador"
    : `· ${obra.equipe.length} trabalhador${obra.equipe.length > 1 ? "es" : ""}`;
  document.getElementById("total-recebimentos").textContent = formatarMoeda(t.totalRecebido);
  document.getElementById("total-gastos").textContent = formatarMoeda(t.totalGasto);
  document.getElementById("total-equipe").textContent = formatarMoeda(custoMO);

  renderRecebimentos(obra);
  renderGastos(obra);
  renderEquipe(obra);
  renderResumoCategorias(obra);
  renderInfoExtra(obra);
  renderEncerramento(obra);
}

// Desenha tudo que depende de a obra estar encerrada ou não:
// banner de resultado final, aviso de leitura, botões encerrar/reabrir
// e esconde os botões de "+ Adicionar" quando encerrada.
function renderEncerramento(obra) {
  const encerrada = ehEncerrada(obra);
  const t = calcularTotais(obra);

  const banner = document.getElementById("obra-resultado-final");
  banner.hidden = !encerrada;
  if (encerrada) {
    banner.innerHTML = `
      <h3>🏁 Resultado final da obra</h3>
      <div class="rf-linha"><span>Valor da obra</span><strong>${formatarMoeda(t.valorContratado)}</strong></div>
      <div class="rf-linha"><span>Total recebido</span><strong>${formatarMoeda(t.totalRecebido)}</strong></div>
      <div class="rf-linha"><span>Total gasto</span><strong>${formatarMoeda(t.totalGasto)}</strong></div>
      <div class="rf-linha"><span>Mão de obra</span><strong>${formatarMoeda(t.totalMO)}</strong></div>
      <div class="rf-linha"><span>Custos totais</span><strong>${formatarMoeda(t.totalCusto)}</strong></div>
      <div class="rf-linha"><span>Lucro final</span><strong class="texto-verde">${formatarMoeda(t.lucro)}</strong></div>
      <div class="rf-linha"><span>Margem de lucro</span><strong>${t.totalRecebido > 0 ? t.margem.toFixed(2).replace(".", ",") + "%" : "—"}</strong></div>
      <div class="rf-linha"><span>Data de encerramento</span><strong>${formatarData(obra.dataEncerramento)}</strong></div>`;
  }

  const aviso = document.getElementById("obra-aviso-encerrada");
  aviso.hidden = !encerrada;
  if (encerrada) document.getElementById("obra-data-encerramento").textContent = formatarData(obra.dataEncerramento);

  document.getElementById("btn-encerrar-obra").hidden = encerrada;
  document.getElementById("btn-reabrir-obra").hidden = !encerrada;

  // Esconde os botões de adicionar em obra encerrada (somente leitura)
  document.getElementById("btn-novo-recebimento").hidden = encerrada;
  document.getElementById("btn-novo-gasto").hidden = encerrada;
  document.getElementById("btn-novo-trabalhador").hidden = encerrada;
}

function renderRecebimentos(obra) {
  const lista = document.getElementById("lista-recebimentos");
  lista.innerHTML = "";
  if (!obra.recebimentos.length) {
    lista.innerHTML = `<div class="lista-vazia">Nenhum recebimento ainda.<br>Toque em <strong>+ Adicionar recebimento</strong>.</div>`;
    return;
  }
  const ordenados = [...obra.recebimentos].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  for (const r of ordenados) {
    const div = document.createElement("div");
    div.className = "item recebimento";
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">💰</span>
        <div class="item-conteudo">
          <strong>${proteger(r.descricao)}</strong>
          <span class="item-meta">${formatarData(r.data)} • ${proteger(r.formaPagamento || "")}</span>
        </div>
        <span class="item-valor texto-verde">${formatarMoeda(r.valor)}</span>
      </div>
      ${r.observacao ? `<p class="item-meta" style="margin-top:6px">${proteger(r.observacao)}</p>` : ""}
      <div class="item-acoes"><button data-a="editar">✏️ Editar</button><button data-a="excluir" class="excluir">🗑️ Excluir</button></div>`;
    div.querySelector('[data-a="editar"]').addEventListener("click", () => abrirModal("recebimento", r.id));
    div.querySelector('[data-a="excluir"]').addEventListener("click", () => excluirRecebimento(r.id));
    lista.appendChild(div);
  }
}

function renderGastos(obra) {
  const lista = document.getElementById("lista-gastos");
  lista.innerHTML = "";
  // SOMENTE despesas: ignora gastos automáticos legados de mão de obra
  const soDespesas = (obra.gastos || []).filter((g) => !g.maoObraId);
  if (!soDespesas.length) {
    lista.innerHTML = `<div class="lista-vazia">Nenhum gasto ainda.<br>Toque em <strong>+ Adicionar gasto</strong>.</div>`;
    return;
  }
  const ordenados = [...soDespesas].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  for (const g of ordenados) {
    const div = document.createElement("div");
    div.className = "item gasto";
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">${iconeCategoria(g.categoria)}</span>
        <div class="item-conteudo">
          <strong>${proteger(g.descricao)}</strong>
          <span class="item-meta">${proteger(g.categoria)} • ${formatarData(g.data)}${g.formaPagamento ? " • " + proteger(g.formaPagamento) : ""}</span>
        </div>
        <span class="item-valor texto-vermelho">${formatarMoeda(g.valor)}</span>
      </div>
      ${g.observacao ? `<p class="item-meta" style="margin-top:6px">${proteger(g.observacao)}</p>` : ""}
      <div class="item-acoes"><button data-a="editar">✏️ Editar</button><button data-a="excluir" class="excluir">🗑️ Excluir</button></div>`;
    div.querySelector('[data-a="editar"]').addEventListener("click", () => abrirModal("gasto", g.id));
    div.querySelector('[data-a="excluir"]').addEventListener("click", () => excluirGasto(g.id));
    lista.appendChild(div);
  }
}

function renderEquipe(obra) {
  const lista = document.getElementById("lista-equipe");
  lista.innerHTML = "";
  if (!obra.equipe.length) {
    lista.innerHTML = `<div class="lista-vazia">Nenhum trabalhador lançado.<br>Toque em <strong>+ Adicionar trabalhador</strong>.</div>`;
    return;
  }
  for (const t of obra.equipe) {
    const div = document.createElement("div");
    div.className = "item equipe";
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">👷</span>
        <div class="item-conteudo">
          <strong>${proteger(t.nome)} • ${proteger(t.funcao)}</strong>
          <span class="item-meta">${formatarMoeda(t.valorDiaria)}/dia × ${t.dias} dia${t.dias > 1 ? "s" : ""}</span>
        </div>
        <span class="item-valor texto-azul">${formatarMoeda(t.total)}</span>
      </div>
      <div class="item-acoes"><button data-a="editar">✏️ Editar</button><button data-a="excluir" class="excluir">🗑️ Excluir</button></div>`;
    div.querySelector('[data-a="editar"]').addEventListener("click", () => abrirModal("equipe", t.id));
    div.querySelector('[data-a="excluir"]').addEventListener("click", () => excluirTrabalhador(t.id));
    lista.appendChild(div);
  }
}

function renderResumoCategorias(obra) {
  const box = document.getElementById("resumo-categorias");
  box.innerHTML = "";
  const porCategoria = {};
  CATEGORIAS.forEach((c) => (porCategoria[c] = 0));
  for (const g of obra.gastos || []) {
    if (g.maoObraId) continue; // legado de mão de obra não entra no resumo de gastos
    const cat = CATEGORIAS.includes(g.categoria) ? g.categoria : "Outros";
    porCategoria[cat] += numeroOuZero(g.valor);
  }
  const total = Object.values(porCategoria).reduce((s, v) => s + v, 0);
  if (total <= 0) {
    box.innerHTML = `<div class="lista-vazia">Sem gastos para resumir.</div>`;
    return;
  }
  for (const cat of CATEGORIAS) {
    const valor = porCategoria[cat];
    if (valor <= 0) continue;
    const pct = Math.min(100, (valor / total) * 100);
    const div = document.createElement("div");
    div.className = "cat-linha";
    div.innerHTML = `
      <div class="cat-topo"><span>${cat}</span><span>${formatarMoeda(valor)}</span></div>
      <div class="barra"><div style="width:${pct.toFixed(1)}%"></div></div>`;
    box.appendChild(div);
  }
}

function renderInfoExtra(obra) {
  document.getElementById("obra-info-extra").innerHTML = `
    <p><strong>Endereço:</strong> ${proteger(obra.endereco || "—")}</p>
    <p><strong>Início:</strong> ${formatarData(obra.dataInicio)} &nbsp;•&nbsp; <strong>Previsão:</strong> ${formatarData(obra.previsaoTermino)}</p>
    ${obra.observacoes ? `<p style="margin-top:8px"><strong>Obs:</strong> ${proteger(obra.observacoes)}</p>` : ""}`;
}

// ---------- FINANCEIRO MENSAL (renderização) ----------
function renderFinanceiro() {
  if (!mesSelecionado) mesSelecionado = mesAtual();
  const rm = calcularMes(mesSelecionado);

  document.getElementById("fin-mes-titulo").textContent = nomeMes(mesSelecionado);
  document.getElementById("fin-entradas").textContent = formatarMoeda(rm.entradas);
  document.getElementById("fin-gastos").textContent = formatarMoeda(rm.gastos);
  const resEl = document.getElementById("fin-resultado");
  resEl.textContent = formatarMoeda(rm.resultado);
  resEl.style.color = rm.resultado < 0 ? "#ff9d97" : "#fff";

  renderGrafico();
  renderDetalheMes(rm);
  renderHistorico();
}

// Gráfico de barras simples (só CSS): últimos 6 meses com movimento.
// Cada mês tem 3 barras: Entradas (verde), Gastos (vermelho), Resultado (azul).
function renderGrafico() {
  const box = document.getElementById("fin-grafico");
  box.innerHTML = "";
  let meses = listarMesesComMovimento().slice(0, 6).reverse(); // do mais antigo ao mais novo
  // Garante que o mês selecionado aparece no gráfico mesmo sem movimento
  if (mesSelecionado && !meses.includes(mesSelecionado)) {
    meses.push(mesSelecionado);
    meses.sort();
    meses = meses.slice(-6);
  }
  if (meses.length === 0) {
    box.innerHTML = `<div class="lista-vazia">Sem dados para o gráfico.<br>Registre recebimentos e gastos nas obras.</div>`;
    return;
  }
  const dados = meses.map((m) => ({ chave: m, ...calcularMes(m) }));
  const maximo = Math.max(1, ...dados.flatMap((d) => [d.entradas, d.gastos, Math.abs(d.resultado)]));

  for (const d of dados) {
    const grupo = document.createElement("div");
    grupo.className = "g-grupo";
    const altura = (v) => Math.max(3, Math.round((v / maximo) * 100));
    grupo.innerHTML = `
      <div class="g-barras">
        <div class="g-barra e" style="height:${altura(d.entradas)}%" title="Entradas: ${formatarMoeda(d.entradas)}"></div>
        <div class="g-barra g" style="height:${altura(d.gastos)}%" title="Gastos: ${formatarMoeda(d.gastos)}"></div>
        <div class="g-barra r${d.resultado < 0 ? " neg" : ""}" style="height:${altura(Math.abs(d.resultado))}%" title="Resultado: ${formatarMoeda(d.resultado)}"></div>
      </div>
      <span class="g-mes">${MESES[Number(d.chave.slice(5, 7)) - 1].slice(0, 3)}</span>`;
    box.appendChild(grupo);
  }
}

// Detalhe do mês: lista cada entrada e cada saída (com a obra de origem)
function renderDetalheMes(rm) {
  const box = document.getElementById("fin-detalhe");
  box.innerHTML = "";
  if (rm.listaEntradas.length === 0 && rm.listaSaidas.length === 0) {
    box.innerHTML = `<div class="lista-vazia">Nenhum movimento em ${nomeMes(mesSelecionado)}.</div>`;
    return;
  }
  for (const e of rm.listaEntradas) {
    const div = document.createElement("div");
    div.className = "item recebimento";
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">💰</span>
        <div class="item-conteudo">
          <strong>${proteger(e.descricao)}</strong>
          <span class="item-meta">🏗️ ${proteger(e.obra)} • ${formatarData(e.data)}</span>
        </div>
        <span class="item-valor texto-verde">+ ${formatarMoeda(e.valor)}</span>
      </div>`;
    box.appendChild(div);
  }
  for (const s of rm.listaSaidas) {
    const div = document.createElement("div");
    div.className = "item gasto";
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">${iconeCategoria(s.categoria)}</span>
        <div class="item-conteudo">
          <strong>${proteger(s.descricao)}</strong>
          <span class="item-meta">🏗️ ${proteger(s.obra)} • ${formatarData(s.data)}${s.formaPagamento ? " • " + proteger(s.formaPagamento) : ""}</span>
        </div>
        <span class="item-valor texto-vermelho">− ${formatarMoeda(s.valor)}</span>
      </div>`;
    box.appendChild(div);
  }
}

// Histórico: um botão por mês; tocar seleciona o mês e mostra o detalhe
function renderHistorico() {
  const box = document.getElementById("fin-historico");
  box.innerHTML = "";
  const meses = listarMesesComMovimento();
  if (meses.length === 0) {
    box.innerHTML = `<div class="lista-vazia">O histórico aparece aqui<br>quando houver lançamentos.</div>`;
    return;
  }
  for (const m of meses) {
    const r = calcularMes(m);
    const btn = document.createElement("button");
    btn.className = "hist-item" + (m === mesSelecionado ? " selecionado" : "");
    btn.innerHTML = `
      <strong>${nomeMes(m)}</strong>
      <div class="hist-linha"><span>Entradas: ${formatarMoeda(r.entradas)}</span></div>
      <div class="hist-linha"><span>Gastos: ${formatarMoeda(r.gastos)}</span></div>
      <div class="hist-linha"><span>Resultado:</span><span class="hist-resultado ${r.resultado < 0 ? "texto-vermelho" : "texto-verde"}">${formatarMoeda(r.resultado)}</span></div>`;
    btn.addEventListener("click", () => {
      mesSelecionado = m;
      renderFinanceiro();
      document.getElementById("fin-mes-titulo").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    box.appendChild(btn);
  }
}

// ---------- VISÃO GERAL (usa calcularMes — mesma fonte do Financeiro) ----------
// Sem tabela nova, sem consulta nova, sem localStorage: tudo é derivado
// das datas reais dos recebimentos e gastos já carregados (inclui encerradas,
// pois o que vale é a DATA do movimento, não o status da obra).
function anosComMovimento() {
  // ["2026", "2025", ...] a partir dos meses que têm lançamento
  const anos = new Set(listarMesesComMovimento().map((m) => m.slice(0, 4)));
  return [...anos].sort().reverse();
}

function mesesDoFiltro() {
  // "todos" = só meses com movimento (ordem cronológica);
  // ano = Jan..Dez completos (mês parado aparece zerado p/ leitura da sequência)
  if (vgAno === "todos") return listarMesesComMovimento().slice().reverse();
  const ano = vgAno || mesAtual().slice(0, 4);
  const meses = [];
  for (let m = 1; m <= 12; m++) meses.push(ano + "-" + String(m).padStart(2, "0"));
  return meses;
}

function renderVisaoGeral() {
  // Filtro padrão: ano atual se tem movimento, senão "todos"
  const anos = anosComMovimento();
  const anoAtual = mesAtual().slice(0, 4);
  if (!vgAno) vgAno = anos.includes(anoAtual) ? anoAtual : "todos";

  // Preenche o select de ano (preserva a escolha)
  const sel = document.getElementById("vg-ano");
  sel.innerHTML = "";
  const opTodos = document.createElement("option");
  opTodos.value = "todos";
  opTodos.textContent = "Todos os meses";
  sel.appendChild(opTodos);
  for (const a of anos) {
    const op = document.createElement("option");
    op.value = a;
    op.textContent = a;
    sel.appendChild(op);
  }
  sel.value = vgAno;

  // Calcula cada mês com a MESMA função do Financeiro (sem duplicar lógica)
  const meses = mesesDoFiltro();
  const dados = meses.map((m) => ({ chave: m, ...calcularMes(m) }));

  if (dados.length === 0) {
    document.getElementById("vg-grafico").innerHTML =
      `<div class="lista-vazia">Sem movimentação.<br>Registre recebimentos e gastos nas obras.</div>`;
    document.getElementById("vg-lista").innerHTML = "";
    document.getElementById("vg-extremos").hidden = true;
    document.getElementById("vg-detalhe").hidden = true;
    return;
  }

  // Cards de resumo do período
  const totE = dados.reduce((s, d) => s + d.entradas, 0);
  const totG = dados.reduce((s, d) => s + d.gastos, 0);
  document.getElementById("vg-entradas").textContent = formatarMoeda(totE);
  document.getElementById("vg-gastos").textContent = formatarMoeda(totG);
  const resEl = document.getElementById("vg-resultado");
  resEl.textContent = formatarMoeda(totE - totG);
  resEl.style.color = totE - totG < 0 ? "#ff9d97" : "#fff";

  renderVgGrafico(dados);
  renderVgLista(dados);
  renderVgExtremos(dados);
  renderVgDetalhe(dados);
}

// Gráfico de barras do resultado (CSS puro, toque p/ detalhar)
function renderVgGrafico(dados) {
  const box = document.getElementById("vg-grafico");
  box.innerHTML = "";
  const maximo = Math.max(1, ...dados.map((d) => Math.abs(d.resultado)));
  for (const d of dados) {
    const b = document.createElement("button");
    b.className = "vg-coluna" + (d.chave === vgMesDetalhe ? " selecionada" : "");
    const cls = d.resultado > 0 ? "pos" : d.resultado < 0 ? "neg" : "zero";
    const altura = Math.max(3, Math.round((Math.abs(d.resultado) / maximo) * 100));
    b.title = `${nomeMes(d.chave)}: ${formatarMoeda(d.resultado)}`;
    b.setAttribute("aria-label", `Ver ${nomeMes(d.chave)}`);
    b.innerHTML = `
      <div class="vg-coluna-barra"><div class="vg-barra-r ${cls}" style="height:${altura}%"></div></div>
      <span class="g-mes">${MESES[Number(d.chave.slice(5, 7)) - 1].slice(0, 3)}</span>`;
    b.addEventListener("click", () => selecionarVgMes(d.chave));
    box.appendChild(b);
  }
}

// Linhas de mês com entradas/gastos/resultado (toque p/ detalhar)
function renderVgLista(dados) {
  const box = document.getElementById("vg-lista");
  box.innerHTML = "";
  const maximo = Math.max(1, ...dados.flatMap((d) => [d.entradas, d.gastos]));
  for (const d of dados) {
    const b = document.createElement("button");
    b.className = "vg-linha" + (d.chave === vgMesDetalhe ? " selecionada" : "");
    const pctE = Math.max(2, Math.round((d.entradas / maximo) * 100));
    const pctG = Math.max(2, Math.round((d.gastos / maximo) * 100));
    b.innerHTML = `
      <div class="vg-linha-topo">
        <strong>${nomeMes(d.chave)}</strong>
        <span class="hist-resultado ${d.resultado < 0 ? "texto-vermelho" : "texto-verde"}">${formatarMoeda(d.resultado)}</span>
      </div>
      <div class="vg-barra-linha">
        <span>Entradas</span>
        <div class="barra"><div style="width:${pctE}%;background:var(--sucesso)"></div></div>
        <b>${formatarMoeda(d.entradas)}</b>
      </div>
      <div class="vg-barra-linha">
        <span>Gastos</span>
        <div class="barra"><div style="width:${pctG}%;background:var(--erro)"></div></div>
        <b>${formatarMoeda(d.gastos)}</b>
      </div>`;
    b.addEventListener("click", () => selecionarVgMes(d.chave));
    box.appendChild(b);
  }
}

function selecionarVgMes(chave) {
  vgMesDetalhe = vgMesDetalhe === chave ? null : chave; // toca de novo p/ fechar
  renderVisaoGeral();
  if (vgMesDetalhe) {
    document.getElementById("vg-detalhe").scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// Melhor mês e menor resultado (só entre meses COM movimento)
function renderVgExtremos(dados) {
  const comMovimento = dados.filter((d) => d.entradas + d.gastos > 0);
  const box = document.getElementById("vg-extremos");
  if (comMovimento.length === 0) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  let melhor = comMovimento[0], pior = comMovimento[0];
  for (const d of comMovimento) {
    if (d.resultado > melhor.resultado) melhor = d;
    if (d.resultado < pior.resultado) pior = d;
  }
  document.getElementById("vg-melhor-nome").textContent = nomeMes(melhor.chave);
  document.getElementById("vg-melhor-valor").textContent = formatarMoeda(melhor.resultado);
  document.getElementById("vg-pior-nome").textContent = nomeMes(pior.chave);
  document.getElementById("vg-pior-valor").textContent = formatarMoeda(pior.resultado);
}

// Detalhe do mês tocado + atalho para o Financeiro
function renderVgDetalhe(dados) {
  const box = document.getElementById("vg-detalhe");
  const d = dados.find((x) => x.chave === vgMesDetalhe);
  if (!d) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `
    <h3>${nomeMes(d.chave)}</h3>
    <div class="rf-linha"><span>Entradas</span><strong class="texto-verde">${formatarMoeda(d.entradas)}</strong></div>
    <div class="rf-linha"><span>Gastos</span><strong class="texto-vermelho">${formatarMoeda(d.gastos)}</strong></div>
    <div class="rf-linha"><span>Resultado</span><strong>${formatarMoeda(d.resultado)}</strong></div>
    <button class="btn btn-texto" id="vg-ver-mes">Ver mês no Financeiro →</button>`;
  document.getElementById("vg-ver-mes").addEventListener("click", () => {
    mesSelecionado = d.chave;
    mostrarTela("financeiro");
  });
}

// Evita que texto digitado quebre o HTML (segurança simples)
function proteger(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- 11. MODAL + CONFIRMAÇÃO + EVENTOS ----------
function abrirModal(tipo, idEditar = null) {
  const obra = pegarObra(obraAbertaId);
  if (!obra) {
    mostrarToast("Obra não encontrada. Volte e abra a obra novamente.", false);
    return;
  }
  if (obraSomenteLeitura(obra)) return; // obra encerrada: somente leitura (já avisa)
  const fundo = document.getElementById("modal-fundo");
  fundo.hidden = false;
  // Esconde os 3 formulários, mostra só o pedido
  document.getElementById("form-recebimento").hidden = tipo !== "recebimento";
  document.getElementById("form-gasto").hidden = tipo !== "gasto";
  document.getElementById("form-equipe").hidden = tipo !== "equipe";

  if (tipo === "recebimento") {
    editandoRecId = idEditar;
    document.getElementById("modal-titulo").textContent = idEditar ? "Editar recebimento" : "Novo recebimento";
    const form = document.getElementById("form-recebimento");
    form.reset();
    document.getElementById("rec-data").value = hojeISO();
    if (idEditar) {
      const r = pegarObra(obraAbertaId).recebimentos.find((x) => x.id === idEditar);
      document.getElementById("rec-valor").value = r.valor;
      document.getElementById("rec-data").value = r.data;
      document.getElementById("rec-desc").value = r.descricao;
      document.getElementById("rec-forma").value = r.formaPagamento || "PIX";
      document.getElementById("rec-obs").value = r.observacao || "";
    }
  }
  if (tipo === "gasto") {
    editandoGastoId = idEditar;
    document.getElementById("modal-titulo").textContent = idEditar ? "Editar gasto" : "Novo gasto";
    const form = document.getElementById("form-gasto");
    form.reset();
    document.getElementById("gasto-data").value = hojeISO();
    if (idEditar) {
      const g = pegarObra(obraAbertaId).gastos.find((x) => x.id === idEditar);
      document.getElementById("gasto-categoria").value = g.categoria;
      document.getElementById("gasto-desc").value = g.descricao;
      document.getElementById("gasto-valor").value = g.valor;
      document.getElementById("gasto-data").value = g.data;
      document.getElementById("gasto-forma").value = g.formaPagamento || "PIX";
      document.getElementById("gasto-obs").value = g.observacao || "";
    }
  }
  if (tipo === "equipe") {
    editandoEqId = idEditar;
    document.getElementById("modal-titulo").textContent = idEditar ? "Editar trabalhador" : "Novo trabalhador";
    const form = document.getElementById("form-equipe");
    form.reset();
    document.getElementById("eq-data").value = hojeISO();
    atualizarPreviaEquipe();
    if (idEditar) {
      const t = pegarObra(obraAbertaId).equipe.find((x) => x.id === idEditar);
      document.getElementById("eq-nome").value = t.nome;
      document.getElementById("eq-funcao").value = t.funcao;
      document.getElementById("eq-diaria").value = t.valorDiaria;
      document.getElementById("eq-dias").value = t.dias;
      document.getElementById("eq-data").value = t.data || hojeISO();
      atualizarPreviaEquipe();
    }
  }
}

// ---------- ABERTURA SEPARADA DOS FORMULÁRIOS ----------
// Cada botão chama a SUA função (lógica separada por tipo).
// O motor comum abrirModal() mostra um form e esconde os outros;
// com a regra CSS [hidden], só o form pedido aparece na tela.
function abrirFormRecebimento() {
  abrirModal("recebimento");
}

function abrirFormGasto() {
  abrirModal("gasto");
}

function abrirFormEquipe() {
  abrirModal("equipe");
}

function fecharModal() {
  document.getElementById("modal-fundo").hidden = true;
  editandoRecId = editandoGastoId = editandoEqId = null;
}

function atualizarPreviaEquipe() {
  const diaria = numeroOuZero(document.getElementById("eq-diaria").value);
  const dias = numeroOuZero(document.getElementById("eq-dias").value);
  document.getElementById("eq-total-previa").textContent = formatarMoeda(diaria * dias);
}

// Modal de confirmação bonito (usado no "Encerrar obra").
// Devolve true se confirmou, false se cancelou.
let resolverConfirm = null;
function pedirConfirmacao(titulo, texto, textoBotao) {
  document.getElementById("confirm-titulo").textContent = titulo;
  document.getElementById("confirm-texto").textContent = texto;
  document.getElementById("confirm-ok").textContent = textoBotao;
  document.getElementById("modal-confirm").hidden = false;
  return new Promise((resolve) => { resolverConfirm = resolve; });
}

function fecharConfirm(resposta) {
  document.getElementById("modal-confirm").hidden = true;
  if (resolverConfirm) resolverConfirm(resposta);
  resolverConfirm = null;
}

// ---------- CARREGAMENTO ----------
function mostrarCarregando(visivel) {
  document.getElementById("carregando").hidden = !visivel;
}

// ---------- 12. EVENTOS (inicialização) ----------
// Fiação segura: se um elemento não existir (ex: HTML desatualizado),
// registra o erro e segue ligando o resto — um botão nunca mais
// impede os outros de funcionar.
function elementoSeguro(id) {
  const el = document.getElementById(id);
  if (!el) console.error("Elemento ausente no HTML: " + id);
  return el;
}

function aoClicar(id, fn) {
  const el = elementoSeguro(id);
  if (el) el.addEventListener("click", fn);
}

function aoEnviar(id, fn) {
  const el = elementoSeguro(id);
  if (el) el.addEventListener("submit", fn);
}

function aoMudar(id, evento, fn) {
  const el = elementoSeguro(id);
  if (el) el.addEventListener(evento, fn);
}

async function iniciar() {
  mesSelecionado = mesAtual();

  // 1. Carrega tudo do Supabase (com tela de "Carregando...")
  mostrarCarregando(true);
  try {
    obras = await DB.carregarTudo();
  } catch (e) {
    console.error("Erro ao carregar do banco:", e);
    obras = [];
    mostrarToast("Sem conexão com o banco. Verifique a internet e recarregue.", false);
  }
  mostrarCarregando(false);

  renderTudo();
  mostrarTela("dashboard");

  // Navegação (menus topo + barra inferior + botões voltar)
  document.querySelectorAll("[data-ir]").forEach((btn) =>
    btn.addEventListener("click", () => irPara(btn.dataset.ir))
  );

  // Abas da obra
  document.querySelectorAll(".aba").forEach((b) =>
    b.addEventListener("click", () => trocarAba(b.dataset.aba))
  );

  // Obra: criar / editar / excluir / encerrar / reabrir
  aoEnviar("form-obra", salvarObra);
  aoClicar("btn-editar-obra", () => abrirFormObra(obraAbertaId));
  aoClicar("btn-excluir-obra", excluirObra);
  aoClicar("btn-encerrar-obra", encerrarObra);
  aoClicar("btn-reabrir-obra", reabrirObra);

  // Filtros da lista de obras
  document.querySelectorAll(".filtro").forEach((b) =>
    b.addEventListener("click", () => { filtroObras = b.dataset.filtro; renderDashboard(); })
  );
  aoClicar("btn-ver-encerradas", () => {
    filtroObras = "encerradas";
    renderDashboard();
    document.getElementById("ancora-obras").scrollIntoView({ behavior: "smooth" });
  });

  // Financeiro: trocar de mês
  aoClicar("mes-anterior", () => {
    mesSelecionado = mudarMesChave(mesSelecionado || mesAtual(), -1);
    renderFinanceiro();
  });
  aoClicar("mes-proximo", () => {
    mesSelecionado = mudarMesChave(mesSelecionado || mesAtual(), 1);
    renderFinanceiro();
  });

  // Modal de confirmação
  aoClicar("confirm-cancelar", () => fecharConfirm(false));
  aoClicar("confirm-ok", () => fecharConfirm(true));
  aoClicar("modal-confirm", (e) => {
    if (e.target.id === "modal-confirm") fecharConfirm(false);
  });

  // Logo MARIO (assets/logo-claro.svg): se carregar, mostra;
  // se falhar, mantém o emoji padrão — nada quebra.
  const logoImg = document.getElementById("logo-img");
  if (logoImg) {
    const slot = document.getElementById("logo-slot");
    logoImg.addEventListener("load", () => slot.classList.add("tem-logo"));
    logoImg.addEventListener("error", () => { logoImg.hidden = true; });
    if (logoImg.complete && logoImg.naturalWidth > 0) slot.classList.add("tem-logo");
  }

  // Botões "Cancelar" dentro dos modais
  document.querySelectorAll("[data-fechar-modal]").forEach((b) =>
    b.addEventListener("click", fecharModal)
  );

  // Visão Geral: troca de ano
  aoMudar("vg-ano", "change", (e) => {
    vgAno = e.target.value;
    vgMesDetalhe = null;
    renderVisaoGeral();
  });

  // Botões que abrem o modal (cada um chama sua função separada)
  aoClicar("btn-novo-recebimento", abrirFormRecebimento);
  aoClicar("btn-novo-gasto", abrirFormGasto);
  aoClicar("btn-novo-trabalhador", abrirFormEquipe);

  // Formulários do modal
  aoEnviar("form-recebimento", salvarRecebimento);
  aoEnviar("form-gasto", salvarGasto);
  aoEnviar("form-equipe", salvarTrabalhador);

  // Fechar modal
  aoClicar("modal-fechar", fecharModal);
  aoClicar("modal-fundo", (e) => {
    if (e.target.id === "modal-fundo") fecharModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("modal-fundo").hidden) fecharModal();
  });

  // Prévia do total da mão de obra enquanto digita
  aoMudar("eq-diaria", "input", atualizarPreviaEquipe);
  aoMudar("eq-dias", "input", atualizarPreviaEquipe);
}

// Roda quando a página carrega
document.addEventListener("DOMContentLoaded", iniciar);
