/* =====================================================
   CONTROLE DE OBRAS — JavaScript puro (Vanilla JS)
   -----------------------------------------------------
   Organização do código (para iniciantes):
   1. DADOS (estado global)
   2. ARMAZENAMENTO (localStorage — fácil trocar por Supabase)
   3. UTILIDADES (moeda, data, id, toast)
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

// ---------- 2. ARMAZENAMENTO ----------
// Tudo passa por este objeto "Banco".
// HOJE ele usa localStorage. NO FUTURO basta trocar o conteúdo
// destas 2 funções por chamadas ao Supabase — o resto do app não muda.
const Banco = {
  chave: "controle_obras_v1",
  carregar() {
    try {
      const texto = localStorage.getItem(this.chave);
      return texto ? JSON.parse(texto) : [];
    } catch (e) {
      console.error("Erro ao ler dados salvos:", e);
      return [];
    }
  },
  salvar(dados) {
    try {
      localStorage.setItem(this.chave, JSON.stringify(dados));
    } catch (e) {
      console.error("Erro ao salvar dados:", e);
      mostrarToast("Erro ao salvar. Espaço cheio?");
    }
  }
};

function salvarTudo() {
  Banco.salvar(obras);
}

// ---------- 3. UTILIDADES ----------
function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

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
// Regras (conforme pedido):
// totalRecebido = soma dos recebimentos
// totalGasto    = soma dos gastos (mão de obra já está dentro dos gastos!)
// aReceber      = valorContratado - totalRecebido
// lucro         = totalRecebido - totalGasto
// margem        = lucro / totalRecebido * 100 (se recebido = 0, margem = 0)
function calcularTotais(obra) {
  const totalRecebido = (obra.recebimentos || []).reduce((s, r) => s + numeroOuZero(r.valor), 0);
  const totalGasto = (obra.gastos || []).reduce((s, g) => s + numeroOuZero(g.valor), 0);
  const valorContratado = numeroOuZero(obra.valorContratado);
  const aReceber = valorContratado - totalRecebido;
  const lucro = totalRecebido - totalGasto;
  const margem = totalRecebido > 0 ? (lucro / totalRecebido) * 100 : 0; // evita divisão por zero
  return { totalRecebido, totalGasto, aReceber, lucro, margem, valorContratado };
}

function calcularResumoGeral() {
  let ativas = 0, encerradas = 0, valorTotal = 0, recebido = 0, gasto = 0, lucro = 0;
  for (const obra of obras) {
    if (ehEncerrada(obra)) encerradas++;
    else ativas++;
    const t = calcularTotais(obra);
    valorTotal += t.valorContratado;
    recebido += t.totalRecebido;
    gasto += t.totalGasto;
  }
  lucro = recebido - gasto;
  return { ativas, encerradas, valorTotal, recebido, gasto, lucro };
}

// ---------- 5. CÁLCULOS MENSAIS (FINANCEIRO) ----------
// IMPORTANTE: resultado mensal NÃO é lucro de obra.
// Resultado mensal = tudo que entrou (recebimentos com data no mês)
//                  - tudo que saiu (gastos com data no mês),
// somando TODAS as obras. Calculado na hora, a partir das datas
// já registradas — não existe lista separada, então nunca fica inconsistente.
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
    for (const g of obra.gastos || []) {
      if (dataValida(g.data) && g.data.slice(0, 7) === chaveMes) {
        gastos += numeroOuZero(g.valor);
        listaSaidas.push({ obra: obra.nome, descricao: g.descricao, data: g.data, valor: numeroOuZero(g.valor), categoria: g.categoria });
      }
    }
  }
  listaEntradas.sort((a, b) => a.data.localeCompare(b.data));
  listaSaidas.sort((a, b) => a.data.localeCompare(b.data));
  return { entradas, gastos, resultado: entradas - gastos, listaEntradas, listaSaidas };
}

// Lista todos os meses que têm algum lançamento, do mais novo ao mais antigo
function listarMesesComMovimento() {
  const meses = new Set();
  for (const obra of obras) {
    for (const r of obra.recebimentos || []) if (dataValida(r.data)) meses.add(r.data.slice(0, 7));
    for (const g of obra.gastos || []) if (dataValida(g.data)) meses.add(g.data.slice(0, 7));
  }
  return [...meses].sort().reverse();
}

// ---------- 6. NAVEGAÇÃO ----------
const telas = ["dashboard", "nova-obra", "obra", "financeiro"];

function mostrarTela(nome) {
  // Mostra só a tela pedida
  const mapa = {
    dashboard: "tela-dashboard",
    "nova-obra": "tela-nova-obra",
    obra: "tela-obra",
    financeiro: "tela-financeiro",
  };
  document.querySelectorAll(".tela").forEach((el) => el.classList.remove("ativa"));
  document.getElementById(mapa[nome]).classList.add("ativa");

  // Se abriu o Financeiro, garante que há um mês selecionado e desenha a tela
  if (nome === "financeiro") {
    if (!mesSelecionado) mesSelecionado = mesAtual();
    renderFinanceiro();
  }

  // Atualiza menu ativo
  document.querySelectorAll("[data-ir]").forEach((btn) => {
    btn.classList.toggle("ativo", btn.dataset.ir === nome || (nome === "obra" && btn.dataset.ir === "obras"));
  });

  window.scrollTo({ top: 0 });
}

function irPara(destino) {
  if (destino === "dashboard") mostrarTela("dashboard");
  else if (destino === "financeiro") mostrarTela("financeiro");
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

  const dados = {
    nome,
    cliente,
    endereco: document.getElementById("obra-endereco").value.trim(),
    valorContratado: valor,
    dataInicio: document.getElementById("obra-inicio").value,
    previsaoTermino: document.getElementById("obra-fim").value,
    status: document.getElementById("obra-status").value,
    observacoes: document.getElementById("obra-obs").value.trim(),
  };

  if (editandoObraId) {
    const obra = pegarObra(editandoObraId);
    Object.assign(obra, dados);
    // Se marcou como encerrada e ainda não tem data, registra hoje.
    // Se voltou para ativa, limpa a data de encerramento.
    if (ehEncerrada(obra) && !obra.dataEncerramento) obra.dataEncerramento = hojeISO();
    if (!ehEncerrada(obra)) obra.dataEncerramento = null;
    mostrarToast("Obra atualizada!");
    salvarTudo();
    abrirObra(editandoObraId);
  } else {
    const nova = {
      id: gerarId(), criadoEm: hojeISO(), dataEncerramento: null,
      recebimentos: [], gastos: [], equipe: [], ...dados,
    };
    // Obra nova já criada como encerrada (raro, mas possível): registra a data
    if (ehEncerrada(nova)) nova.dataEncerramento = hojeISO();
    obras.push(nova);
    mostrarToast("Obra criada!");
    salvarTudo();
    renderTudo();
    mostrarTela("dashboard");
  }
  editandoObraId = null;
}

function excluirObra() {
  const obra = pegarObra(obraAbertaId);
  if (!obra) return;
  if (!confirm(`Excluir "${obra.nome}" e todos os lançamentos?`)) return;
  obras = obras.filter((o) => o.id !== obraAbertaId);
  obraAbertaId = null;
  salvarTudo();
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
  obra.status = "Encerrada";
  obra.dataEncerramento = hojeISO();
  salvarTudo();
  renderTudo();
  mostrarToast("Obra encerrada e movida para o histórico.");
}

function reabrirObra() {
  const obra = pegarObra(obraAbertaId);
  if (!obra || !ehEncerrada(obra)) return;
  obra.status = "Em andamento";
  obra.dataEncerramento = null;
  salvarTudo();
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
function salvarRecebimento(event) {
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
    Object.assign(obra.recebimentos.find((r) => r.id === editandoRecId), dados);
    mostrarToast("Recebimento atualizado!");
  } else {
    obra.recebimentos.push({ id: gerarId(), ...dados });
    mostrarToast("Recebimento registrado!");
  }
  editandoRecId = null;
  salvarTudo();
  fecharModal();
  renderTudo();
}

function excluirRecebimento(id) {
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return;
  if (!confirm("Excluir este recebimento?")) return;
  obra.recebimentos = obra.recebimentos.filter((r) => r.id !== id);
  salvarTudo();
  renderTudo();
  mostrarToast("Recebimento excluído.");
}

// ---------- 9. GASTOS ----------
function salvarGasto(event) {
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
    observacao: document.getElementById("gasto-obs").value.trim(),
  };

  if (editandoGastoId) {
    const gasto = obra.gastos.find((g) => g.id === editandoGastoId);
    if (gasto.maoObraId) {
      mostrarToast("Edite pela aba Mão de obra.", false);
      return;
    }
    Object.assign(gasto, dados);
    mostrarToast("Gasto atualizado!");
  } else {
    obra.gastos.push({ id: gerarId(), maoObraId: null, ...dados });
    mostrarToast("Gasto registrado!");
  }
  editandoGastoId = null;
  salvarTudo();
  fecharModal();
  renderTudo();
}

function excluirGasto(id) {
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return;
  const gasto = obra.gastos.find((g) => g.id === id);
  if (!gasto) return;
  if (gasto.maoObraId) {
    mostrarToast("Exclua pela aba Mão de obra.", false);
    return;
  }
  if (!confirm("Excluir este gasto?")) return;
  obra.gastos = obra.gastos.filter((g) => g.id !== id);
  salvarTudo();
  renderTudo();
  mostrarToast("Gasto excluído.");
}

// ---------- 10. MÃO DE OBRA ----------
// COMO EVITAMOS CONTA DUPLA:
// Cada trabalhador gera UM gasto automático (categoria "Mão de obra",
// ligado pelo campo maoObraId). O total gasto soma SÓ a lista de gastos.
// Então: editar/excluir o trabalhador atualiza/apaga o gasto junto.
function salvarTrabalhador(event) {
  event.preventDefault();
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return;

  const nome = document.getElementById("eq-nome").value.trim();
  const funcao = document.getElementById("eq-funcao").value.trim();
  const diaria = numeroOuZero(document.getElementById("eq-diaria").value);
  const dias = numeroOuZero(document.getElementById("eq-dias").value);
  if (!nome || !funcao || !diaria || !dias) {
    mostrarToast("Preencha nome, função, diária e dias.", false);
    return;
  }
  const total = diaria * dias;
  const descricaoGasto = `${nome} — ${funcao} (${dias} diária${dias > 1 ? "s" : ""})`;

  if (editandoEqId) {
    const trab = obra.equipe.find((t) => t.id === editandoEqId);
    Object.assign(trab, { nome, funcao, valorDiaria: diaria, dias, total });
    // Atualiza o gasto ligado
    const gasto = obra.gastos.find((g) => g.maoObraId === editandoEqId);
    if (gasto) Object.assign(gasto, { descricao: descricaoGasto, valor: total });
    mostrarToast("Trabalhador atualizado!");
  } else {
    const id = gerarId();
    obra.equipe.push({ id, nome, funcao, valorDiaria: diaria, dias, total });
    // Cria o gasto automático (é assim que entra no total, sem duplicar)
    obra.gastos.push({
      id: gerarId(), categoria: "Mão de obra", descricao: descricaoGasto,
      valor: total, data: hojeISO(), observacao: "Gerado automaticamente (aba Mão de obra).",
      maoObraId: id,
    });
    mostrarToast("Trabalhador adicionado!");
  }
  editandoEqId = null;
  salvarTudo();
  fecharModal();
  renderTudo();
}

function excluirTrabalhador(id) {
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return;
  if (!confirm("Remover trabalhador (e o gasto ligado a ele)?")) return;
  obra.equipe = obra.equipe.filter((t) => t.id !== id);
  obra.gastos = obra.gastos.filter((g) => g.maoObraId !== id); // apaga o gasto automático junto
  salvarTudo();
  renderTudo();
  mostrarToast("Trabalhador removido.");
}

// ---------- 10. RENDERIZAÇÃO (desenhar a tela) ----------
function renderTudo() {
  renderDashboard();
  renderObra();
  // Se o Financeiro estiver aberto, atualiza ele também
  if (document.getElementById("tela-financeiro").classList.contains("ativa")) renderFinanceiro();
}

function renderDashboard() {
  const r = calcularResumoGeral();
  atualizarSaudacao();
  document.getElementById("res-ativas").textContent = r.ativas;
  document.getElementById("res-encerradas").textContent = r.encerradas;
  document.getElementById("res-valor-total").textContent = formatarMoeda(r.valorTotal);
  document.getElementById("res-recebido").textContent = formatarMoeda(r.recebido);
  document.getElementById("res-gasto").textContent = formatarMoeda(r.gasto);
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
      <p class="obra-status-linha"><span class="status-dot ${dotClasse}"></span>${proteger(obra.status || "Em andamento")}${encerrada && obra.dataEncerramento ? ` · ${formatarData(obra.dataEncerramento)}` : ""}</p>
      <button class="btn btn-primario" style="margin-top:10px">Ver obra →</button>`;
    card.querySelector("button").addEventListener("click", () => abrirObra(obra.id));
    lista.appendChild(card);
  }
}

// Saudação do topo (só visual: cumprimento + data de hoje)
function atualizarSaudacao() {
  const agora = new Date();
  const hora = agora.getHours();
  const cumprimento = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  document.getElementById("saudacao").textContent = `${cumprimento}! 👋 Resumo das suas obras`;
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
  if (!obra.gastos.length) {
    lista.innerHTML = `<div class="lista-vazia">Nenhum gasto ainda.<br>Toque em <strong>+ Adicionar gasto</strong>.</div>`;
    return;
  }
  const ordenados = [...obra.gastos].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  for (const g of ordenados) {
    const automatico = !!g.maoObraId;
    const div = document.createElement("div");
    div.className = "item gasto";
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">${iconeCategoria(g.categoria)}</span>
        <div class="item-conteudo">
          <strong>${proteger(g.descricao)}</strong>
          <span class="item-meta">${proteger(g.categoria)} • ${formatarData(g.data)}${automatico ? ' <span class="tag-auto">auto</span>' : ""}</span>
        </div>
        <span class="item-valor texto-vermelho">${formatarMoeda(g.valor)}</span>
      </div>
      ${g.observacao ? `<p class="item-meta" style="margin-top:6px">${proteger(g.observacao)}</p>` : ""}
      <div class="item-acoes"><button data-a="editar">✏️ Editar</button><button data-a="excluir" class="excluir">🗑️ Excluir</button></div>`;
    div.querySelector('[data-a="editar"]').addEventListener("click", () => {
      if (automatico) { mostrarToast("Edite pela aba Mão de obra.", false); trocarAba("equipe"); }
      else abrirModal("gasto", g.id);
    });
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
          <span class="item-meta">🏗️ ${proteger(s.obra)} • ${formatarData(s.data)}</span>
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

// Evita que texto digitado quebre o HTML (segurança simples)
function proteger(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- 11. MODAL + CONFIRMAÇÃO + EVENTOS ----------
function abrirModal(tipo, idEditar = null) {
  const obra = pegarObra(obraAbertaId);
  if (!obra || obraSomenteLeitura(obra)) return; // obra encerrada: somente leitura
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
      document.getElementById("gasto-obs").value = g.observacao || "";
    }
  }
  if (tipo === "equipe") {
    editandoEqId = idEditar;
    document.getElementById("modal-titulo").textContent = idEditar ? "Editar trabalhador" : "Novo trabalhador";
    const form = document.getElementById("form-equipe");
    form.reset();
    atualizarPreviaEquipe();
    if (idEditar) {
      const t = pegarObra(obraAbertaId).equipe.find((x) => x.id === idEditar);
      document.getElementById("eq-nome").value = t.nome;
      document.getElementById("eq-funcao").value = t.funcao;
      document.getElementById("eq-diaria").value = t.valorDiaria;
      document.getElementById("eq-dias").value = t.dias;
      atualizarPreviaEquipe();
    }
  }
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

// ---------- 12. EVENTOS (inicialização) ----------
function iniciar() {
  obras = Banco.carregar(); // carrega do localStorage
  // Garante formato novo mesmo se dados antigos existirem
  obras.forEach((o) => {
    o.recebimentos = o.recebimentos || [];
    o.gastos = o.gastos || [];
    o.equipe = o.equipe || [];
    o.status = o.status || "Em andamento";
    if (!("dataEncerramento" in o)) o.dataEncerramento = null;
  });
  mesSelecionado = mesAtual();

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
  document.getElementById("form-obra").addEventListener("submit", salvarObra);
  document.getElementById("btn-editar-obra").addEventListener("click", () => abrirFormObra(obraAbertaId));
  document.getElementById("btn-excluir-obra").addEventListener("click", excluirObra);
  document.getElementById("btn-encerrar-obra").addEventListener("click", encerrarObra);
  document.getElementById("btn-reabrir-obra").addEventListener("click", reabrirObra);

  // Filtros da lista de obras
  document.querySelectorAll(".filtro").forEach((b) =>
    b.addEventListener("click", () => { filtroObras = b.dataset.filtro; renderDashboard(); })
  );
  document.getElementById("btn-ver-encerradas").addEventListener("click", () => {
    filtroObras = "encerradas";
    renderDashboard();
    document.getElementById("ancora-obras").scrollIntoView({ behavior: "smooth" });
  });

  // Financeiro: trocar de mês
  document.getElementById("mes-anterior").addEventListener("click", () => {
    mesSelecionado = mudarMesChave(mesSelecionado || mesAtual(), -1);
    renderFinanceiro();
  });
  document.getElementById("mes-proximo").addEventListener("click", () => {
    mesSelecionado = mudarMesChave(mesSelecionado || mesAtual(), 1);
    renderFinanceiro();
  });

  // Modal de confirmação
  document.getElementById("confirm-cancelar").addEventListener("click", () => fecharConfirm(false));
  document.getElementById("confirm-ok").addEventListener("click", () => fecharConfirm(true));
  document.getElementById("modal-confirm").addEventListener("click", (e) => {
    if (e.target.id === "modal-confirm") fecharConfirm(false);
  });

  // Logo: se o arquivo logo.png existir, a imagem aparece no cabeçalho;
  // se não existir (erro 404), mantém o emoji padrão — nada quebra.
  const logoImg = document.getElementById("logo-img");
  if (logoImg) {
    const slot = document.getElementById("logo-slot");
    logoImg.addEventListener("load", () => slot.classList.add("tem-logo"));
    logoImg.addEventListener("error", () => { logoImg.hidden = true; });
    if (logoImg.complete && logoImg.naturalWidth > 0) slot.classList.add("tem-logo");
  }

  // Ações rápidas da obra: vão para a aba certa e já abrem o formulário
  document.getElementById("qa-gasto").addEventListener("click", () => { trocarAba("gastos"); abrirModal("gasto"); });
  document.getElementById("qa-recebimento").addEventListener("click", () => { trocarAba("recebimentos"); abrirModal("recebimento"); });
  document.getElementById("qa-equipe").addEventListener("click", () => { trocarAba("equipe"); abrirModal("equipe"); });

  // Botões "Cancelar" dentro dos modais
  document.querySelectorAll("[data-fechar-modal]").forEach((b) =>
    b.addEventListener("click", fecharModal)
  );

  // Botões que abrem o modal
  document.getElementById("btn-novo-recebimento").addEventListener("click", () => abrirModal("recebimento"));
  document.getElementById("btn-novo-gasto").addEventListener("click", () => abrirModal("gasto"));
  document.getElementById("btn-novo-trabalhador").addEventListener("click", () => abrirModal("equipe"));

  // Formulários do modal
  document.getElementById("form-recebimento").addEventListener("submit", salvarRecebimento);
  document.getElementById("form-gasto").addEventListener("submit", salvarGasto);
  document.getElementById("form-equipe").addEventListener("submit", salvarTrabalhador);

  // Fechar modal
  document.getElementById("modal-fechar").addEventListener("click", fecharModal);
  document.getElementById("modal-fundo").addEventListener("click", (e) => {
    if (e.target.id === "modal-fundo") fecharModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("modal-fundo").hidden) fecharModal();
  });

  // Prévia do total da mão de obra enquanto digita
  document.getElementById("eq-diaria").addEventListener("input", atualizarPreviaEquipe);
  document.getElementById("eq-dias").addEventListener("input", atualizarPreviaEquipe);
}

// Roda quando a página carrega
document.addEventListener("DOMContentLoaded", iniciar);
