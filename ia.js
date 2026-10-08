/* =====================================================
   ia.js — IA DA OBRA (assistente do Mário)
   -----------------------------------------------------
   - Usa SÓ dados reais do MARIO (obras, gastos, MO,
     recebimentos, parcelas, plantas). Nunca inventa:
     sem dado = "ainda não foi cadastrada".
   - Cálculos determinísticos no aparelho; a IA (Groq)
     só redige textos com o contexto entregue.
   - Chave Groq: a mesma guardada no aparelho (pede 1x).
   - Histórico simples no aparelho (últimas 20 análises).
   ===================================================== */

const IA_HIST_KEY = "ia_historico_v1";
const IA_CHAT_KEY = "ia_chat_v1";
const IA_USOS_KEY = "ia_usos_v1";
const IA_MODEL = (typeof GROQ_MODEL !== "undefined" && GROQ_MODEL) || "qwen/qwen3.8-27b";
const IA_URL = "https://api.groq.com/openai/v1/chat/completions";

function elIA(id) { return document.getElementById(id); }
function obrasNoEscopo() {
  const id = (elIA("ia-obra") || {}).value || "";
  if (id) {
    const o = (obras || []).find((x) => x.id === id);
    return o ? [o] : [];
  }
  return obras || [];
}
function nomeEscopo() {
  const id = (elIA("ia-obra") || {}).value || "";
  if (!id) return "Todas as obras";
  const o = (obras || []).find((x) => x.id === id);
  return o ? o.nome : "Todas as obras";
}
function contarUso(acao) {
  try {
    const u = JSON.parse(localStorage.getItem(IA_USOS_KEY) || "{}");
    const hoje = hojeISO();
    u[hoje] = u[hoje] || {};
    u[hoje][acao] = (u[hoje][acao] || 0) + 1;
    localStorage.setItem(IA_USOS_KEY, JSON.stringify(u));
  } catch (e) {}
}
function lerHistoricoIA() {
  try { return JSON.parse(localStorage.getItem(IA_HIST_KEY)) || []; } catch (e) { return []; }
}
function guardarHistoricoIA(acao, obra, resumoHtml) {
  try {
    const h = lerHistoricoIA();
    h.unshift({ data: hojeISO(), acao, obra, html: resumoHtml });
    localStorage.setItem(IA_HIST_KEY, JSON.stringify(h.slice(0, 20)));
  } catch (e) {}
  renderHistoricoIA();
}
function renderHistoricoIA() {
  const box = elIA("lista-ia-historico");
  if (!box) return;
  const h = lerHistoricoIA();
  box.innerHTML = "";
  if (!h.length) {
    box.innerHTML = `<div class="lista-vazia">Nenhuma análise ainda.</div>`;
    return;
  }
  for (const item of h) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item-topo">
        <span class="item-icone" aria-hidden="true">R</span>
        <div class="item-conteudo">
          <strong>${proteger(item.acao)}</strong>
          <span class="item-meta">${formatarData(item.data)} • ${proteger(item.obra || "")}</span>
        </div>
      </div>
      <div class="item-acoes"><button data-a="ver">Abrir de novo</button></div>`;
    div.querySelector('[data-a="ver"]').addEventListener("click", () => {
      elIA("ia-painel").innerHTML = item.html || "";
      document.getElementById("ia-painel").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    box.appendChild(div);
  }
}
function chaveIAGroq() {
  try {
    let k = localStorage.getItem("mario_groq_key") || "";
    if (!k) {
      k = (prompt("Cole a chave da Groq (só na primeira vez):") || "").trim();
      if (k) localStorage.setItem("mario_groq_key", k);
    }
    return k;
  } catch (e) { return ""; }
}
async function iaConversar(pergunta, contexto) {
  // 1) Servidor (sem chave no aparelho)
  try {
    const resp = await fetch(
      "https://wmcrbjlzsqveekwifded.supabase.co/functions/v1/analisar-planta",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo: "chat", pergunta, contexto }),
      }
    );
    if (resp.ok) {
      const j = await resp.json();
      if (j.resposta) return String(j.resposta).trim();
    }
  } catch (e) { console.error("chat servidor:", e); }
  // 2) Reserva: Groq direto com a chave do aparelho
  const chave = chaveIAGroq();
  if (!chave) throw new Error("sem-chave");
  let resp = null, ultimo = "";
  for (let t = 1; t <= 2; t++) {
    try {
      resp = await fetch(IA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + chave },
        body: JSON.stringify({
          model: IA_MODEL, temperature: 0.2, max_tokens: 800,
          messages: [
            {
              role: "system",
              content: "Você é o assistente do Mário, chefe de obra. Fale simples e curto, " +
                "como quem explica na obra, sem termos técnicos. Use SOMENTE os dados " +
                "fornecidos abaixo. Se algo não estiver nos dados, diga exatamente: " +
                "'Essa informação ainda não foi cadastrada.' Nunca invente valores, " +
                "datas, nomes ou materiais.",
            },
            { role: "user", content: "DADOS REAIS DO SISTEMA:\n" + contexto + "\n\nPERGUNTA: " + pergunta },
          ],
        }),
      });
      if (resp.ok) break;
      ultimo = "IA " + resp.status;
      if (resp.status === 401) {
        try { localStorage.removeItem("mario_groq_key"); } catch (e) {}
        throw new Error("Chave recusada. Tente de novo com a chave atual.");
      }
      resp = null;
    } catch (e) {
      ultimo = e.message || "rede";
      resp = null;
    }
  }
  if (!resp) throw new Error(ultimo || "falha temporária");
  const j = await resp.json();
  return ((((j.choices || [])[0] || {}).message || {}).content || "").trim();
}
function contextoEscopo() {
  const lista = obrasNoEscopo();
  const L = [`Escopo: ${nomeEscopo()} (${lista.length} obra(s)).`];
  for (const o of lista) {
    const t = calcularTotais(o);
    L.push(`Obra "${o.nome}" (cliente ${o.cliente}, status ${o.status}): ` +
      `contratado ${t.valorContratado}, recebido ${t.totalRecebido}, ` +
      `gastos ${t.totalGasto}, mão de obra ${t.totalMO}, a receber ${t.aReceber}, lucro ${t.lucro}.`);
    const pend = (o.parcelas || []).filter((p) => !(p.status === "pago" || p.status === "Recebida"));
    if (pend.length) L.push(`  Parcelas em aberto: ${pend.length} (próximo vencimento ${(pend.map((p) => p.vencimento || "").filter(Boolean).sort()[0]) || "—"}).`);
    if ((o.equipe || []).length) L.push(`  Equipe: ${(o.equipe || []).map((x) => `${x.nome} (${x.funcao})`).join(", ")}.`);
  }
  const chave = mesAtual();
  const rm = calcularMes(chave);
  L.push(`Mês atual (${chave}): entradas ${rm.entradas}, gastos ${rm.gastos}, resultado ${rm.resultado}.`);
  return L.join("\n");
}
function painelVoltar(html) {
  elIA("ia-painel").innerHTML =
    `<button class="btn btn-texto ia-painel-voltar" id="ia-voltar">← Voltar</button>` + html;
  elIA("ia-voltar").addEventListener("click", () => { elIA("ia-painel").innerHTML = ""; });
  elIA("ia-painel").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Ferramenta: Analisar gastos (conta exata, sem chute) ----------
function ferramentaGastos() {
  const lista = obrasNoEscopo();
  const chave = mesAtual();
  const rm = calcularMes(chave);
  const ant = mudarMesChave(chave, -1);
  const rmAnt = calcularMes(ant);
  let mat = 0, mo = 0, outros = 0, maior = { desc: "—", valor: 0 };
  for (const o of lista) {
    const escopo = (arr) => arr || [];
    for (const g of escopo(o.gastos)) {
      if (g.maoObraId || !dataValida(g.data) || g.data.slice(0, 7) !== chave) continue;
      const v = numeroOuZero(g.valor);
      if (g.categoria === "Materiais") mat += v;
      else outros += v;
      if (v > maior.valor) maior = { desc: `${g.descricao} (${o.nome})`, valor: v };
    }
    for (const t of escopo(o.equipe)) {
      const dataMO = t.data || "";
      if (dataValida(dataMO) && dataMO.slice(0, 7) === chave) mo += numeroOuZero(t.valorDiaria) * numeroOuZero(t.dias);
    }
  }
  const total = mat + mo + outros;
  let variacao = "—";
  if (rmAnt.gastos > 0) {
    const pct = ((rm.gastos - rmAnt.gastos) / rmAnt.gastos) * 100;
    variacao = `${pct >= 0 ? "+" : ""}${pct.toFixed(1).replace(".", ",")}% em relação ao mês anterior`;
  }
  const html = `
    <div class="card"><h3 class="titulo-secao" style="margin-top:0">Análise do mês — ${nomeMes(chave)}</h3>
    <div class="parcelas-resumo">
      <div class="numero-card"><span>Total gasto</span><strong>${formatarMoeda(total)}</strong></div>
      <div class="numero-card"><span>Materiais</span><strong>${formatarMoeda(mat)}</strong></div>
      <div class="numero-card"><span>Mão de obra</span><strong>${formatarMoeda(mo)}</strong></div>
      <div class="numero-card"><span>Outros</span><strong>${formatarMoeda(outros)}</strong></div>
    </div>
    <p class="texto-suave" style="margin-top:8px">Maior gasto: <strong>${proteger(maior.desc)} (${formatarMoeda(maior.valor)})</strong></p>
    <p class="texto-suave">Variação: <strong>${variacao}</strong></p>
    <button class="btn btn-texto" id="ia-como">Como funciona?</button>
    <p class="texto-suave" id="ia-como-tx" hidden>Somo os gastos com data neste mês: materiais de um lado, diárias do outro. O resto vai para "Outros".</p>
    </div>`;
  painelVoltar(html);
  elIA("ia-como").addEventListener("click", () => { elIA("ia-como-tx").hidden = !elIA("ia-como-tx").hidden; });
  contarUso("gastos");
  guardarHistoricoIA("Análise de gastos", nomeEscopo(), html);
}

// ---------- Ferramenta: Alertas (regras sobre dados reais) ----------
function gerarAlertas() {
  const out = [];
  const chave = mesAtual();
  const ant = mudarMesChave(chave, -1);
  const rm = calcularMes(chave), rmAnt = calcularMes(ant);
  if (rmAnt.gastos > 0 && rm.gastos > rmAnt.gastos * 1.2) {
    const pct = Math.round(((rm.gastos - rmAnt.gastos) / rmAnt.gastos) * 100);
    out.push({ texto: `Os gastos aumentaram ${pct}% neste mês.`, ir: "financeiro" });
  }
  const hoje = hojeISO();
  const limite = new Date(); limite.setDate(limite.getDate() + 3);
  const limStr = limite.toISOString().slice(0, 10);
  for (const o of obrasNoEscopo()) {
    for (const p of o.parcelas || []) {
      if (p.status === "pago" || p.status === "Recebida" || p.recebimentoId) continue;
      if (p.vencimento && p.vencimento < hoje)
        out.push({ texto: `Parcela vencida em "${o.nome}" (${formatarData(p.vencimento)}).`, obra: o.id, aba: "recebimentos" });
      else if (p.vencimento && p.vencimento <= limStr)
        out.push({ texto: `Parcela vencendo em "${o.nome}" (${formatarData(p.vencimento)}).`, obra: o.id, aba: "recebimentos" });
    }
    const t = calcularTotais(o);
    if (!ehEncerrada(o) && t.valorContratado > 0 && t.aReceber > t.valorContratado * 0.5)
      out.push({ texto: `"${o.nome}" ainda tem ${formatarMoeda(t.aReceber)} a receber.`, obra: o.id, aba: "recebimentos" });
  }
  return out;
}
function ferramentaAlertas() {
  const lista = gerarAlertas();
  let html = `<div class="card"><h3 class="titulo-secao" style="margin-top:0">Pontos de atenção (${lista.length})</h3>`;
  if (!lista.length) html += `<p class="texto-suave">Nada urgente por aqui.</p>`;
  html += `<div class="lista">`;
  for (let i = 0; i < lista.length; i++) {
    html += `<div class="item"><div class="item-topo"><div class="item-conteudo"><strong>${proteger(lista[i].texto)}</strong></div></div>` +
      `<div class="item-acoes"><button data-i="${i}">Ver</button></div></div>`;
  }
  html += `</div></div>`;
  painelVoltar(html);
  elIA("ia-painel").querySelectorAll("[data-i]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = lista[Number(b.dataset.i)];
      if (a.obra) { abrirObra(a.obra); if (a.aba) trocarAba(a.aba); }
      else if (a.ir) mostrarTela(a.ir);
    })
  );
  contarUso("alertas");
  guardarHistoricoIA("Alertas", nomeEscopo(), html);
}
function atualizarBannerAtencao() {
  const b = elIA("ia-atencao");
  if (!b) return;
  let n = 0;
  try { n = gerarAlertas().length; } catch (e) { n = 0; }
  b.hidden = n === 0;
  if (n) b.textContent = `Atenção hoje: ${n} ponto${n > 1 ? "s" : ""} para verificar →`;
}

// ---------- Ferramenta: Relatório (receita x custo, realizado x previsto) ----------
function ferramentaRelatorio() {
  const lista = obrasNoEscopo();
  let html = `<div class="card"><h3 class="titulo-secao" style="margin-top:0">Resultado — ${proteger(nomeEscopo())}</h3>`;
  for (const o of lista) {
    const t = calcularTotais(o);
    const mg = t.totalRecebido > 0 ? ((t.lucro / t.totalRecebido) * 100).toFixed(1).replace(".", ",") + "%" : "—";
    html += `<h3 class="titulo-secao">${proteger(o.nome)}</h3>
    <div class="parcelas-resumo">
      <div class="numero-card"><span>Valor contratado (previsto)</span><strong>${formatarMoeda(t.valorContratado)}</strong></div>
      <div class="numero-card verde"><span>Recebido (realizado)</span><strong>${formatarMoeda(t.totalRecebido)}</strong></div>
      <div class="numero-card vermelho"><span>Gastos + mão de obra</span><strong>${formatarMoeda(t.totalGasto + t.totalMO)}</strong></div>
      <div class="numero-card azul"><span>Resultado parcial</span><strong>${formatarMoeda(t.lucro)}</strong></div>
      <div class="numero-card"><span>A receber</span><strong>${formatarMoeda(t.aReceber)}</strong></div>
      <div class="numero-card"><span>Margem</span><strong>${mg}</strong></div>
    </div>`;
  }
  html += `<p class="texto-suave" style="margin-top:8px">Resultado parcial = recebido menos custos até agora. Não é lucro final enquanto houver valor a receber.</p>
    <button class="btn btn-texto" id="ia-rel-como">Como funciona?</button>
    <p class="texto-suave" id="ia-rel-como-tx" hidden>Recebido é o que já entrou. Custos somam gastos e diárias. A receber é o contratado menos o recebido.</p>
    <button class="btn btn-primario" id="ia-rel-imprimir">Imprimir</button></div>`;
  painelVoltar(html);
  elIA("ia-rel-como").addEventListener("click", () => { elIA("ia-rel-como-tx").hidden = !elIA("ia-rel-como-tx").hidden; });
  elIA("ia-rel-imprimir").addEventListener("click", () => { imprimirRelatorio(); });
  contarUso("relatorio");
  guardarHistoricoIA("Relatório", nomeEscopo(), html);
}

// ---------- Ferramenta: Mensagem para cliente (IA redige com dados reais) ----------
function ferramentaMensagem() {
  const html = `<div class="card"><h3 class="titulo-secao" style="margin-top:0">Mensagem para cliente</h3>
    <div class="form">
      <label class="campo"><span>Assunto</span><select id="ia-msg-tipo">
        <option value="atualizacao">Atualização da obra</option>
        <option value="pagamento">Aviso de pagamento</option>
        <option value="etapa">Etapa concluída</option>
        <option value="visita">Confirmação de visita</option>
      </select></label>
      <label class="campo"><span>Tom</span><select id="ia-msg-tom">
        <option value="simples">Simples (WhatsApp)</option>
        <option value="profissional">Profissional</option>
      </select></label>
      <button class="btn btn-primario" id="ia-msg-gerar">Criar mensagem</button>
      <label class="campo"><span>Texto (pode ajustar)</span><textarea id="ia-msg-texto" rows="5"></textarea></label>
      <button class="btn btn-texto" id="ia-msg-copiar">Copiar</button>
    </div></div>`;
  painelVoltar(html);
  elIA("ia-msg-copiar").addEventListener("click", () => {
    const t = elIA("ia-msg-texto");
    t.select();
    try { document.execCommand("copy"); } catch (e) {}
    if (navigator.clipboard) navigator.clipboard.writeText(t.value).catch(() => {});
    mostrarToast("Mensagem copiada!");
  });
  elIA("ia-msg-gerar").addEventListener("click", async () => {
    const btn = elIA("ia-msg-gerar");
    btn.disabled = true; btn.textContent = "Criando...";
    try {
      const txt = await iaConversar(
        `Escreva uma mensagem curta de ${elIA("ia-msg-tipo").value} em tom ${elIA("ia-msg-tom").value} para o cliente, usando os dados. Sem rodeios.`,
        contextoEscopo()
      );
      elIA("ia-msg-texto").value = txt;
      contarUso("mensagem");
      guardarHistoricoIA("Mensagem para cliente", nomeEscopo(), `<div class="card"><p>${proteger(txt)}</p></div>`);
    } catch (e) {
      mostrarToast("Não foi possível criar: " + (e.message || "erro"), false);
    }
    btn.disabled = false; btn.textContent = "Criar mensagem";
  });
}

// ---------- Ferramenta: Perguntar (conversa estilo chat) ----------
function lerChatIA() {
  try { return JSON.parse(localStorage.getItem(IA_CHAT_KEY)) || []; } catch (e) { return []; }
}
function renderChatHistorico() {
  const box = elIA("lista-ia-chat");
  if (!box) return;
  const h = lerChatIA();
  box.innerHTML = "";
  if (!h.length) {
    box.innerHTML = `<div class="lista-vazia">Nenhuma conversa salva.</div>`;
    return;
  }
  for (const item of h) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item-conteudo">
        <strong>${proteger(item.p)}</strong>
        <span class="item-meta">${formatarData(item.data)} • ${proteger(item.obra || "")}</span>
        <p class="texto-suave" style="margin-top:6px">${proteger((item.r || "").slice(0, 160))}${(item.r || "").length > 160 ? "..." : ""}</p>
      </div>
      <div class="item-acoes"><button data-a="ver">Abrir</button></div>`;
    div.querySelector('[data-a="ver"]').addEventListener("click", () => {
      const chat = elIA("ia-chat");
      if (chat) {
        chat.innerHTML += `<div class="ia-msg voce">${proteger(item.p)}</div><div class="ia-msg ia">${proteger(item.r)}</div>`;
        chat.scrollTop = chat.scrollHeight;
        chat.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    box.appendChild(div);
  }
}
async function enviarPerguntaChat(texto) {
  const pergunta = (texto || (elIA("ia-pergunta") || {}).value || "").trim();
  if (!pergunta) return;
  const box = elIA("ia-chat");
  if (!box) return;
  box.innerHTML += `<div class="ia-msg voce">${proteger(pergunta)}</div><div class="ia-msg ia digitando" id="ia-digitando"><span></span><span></span><span></span></div>`;
  box.scrollTop = box.scrollHeight;
  const campo = elIA("ia-pergunta");
  if (campo) campo.value = "";
  try {
    const resp = await iaConversar(pergunta, contextoEscopo());
    const d = document.getElementById("ia-digitando");
    if (d) { d.textContent = resp; d.classList.remove("digitando"); d.removeAttribute("id"); }
    box.scrollTop = box.scrollHeight;
    contarUso("pergunta");
    atualizarStatusChaveIA();
    try {
      const hc = lerChatIA();
      hc.unshift({ p: pergunta.slice(0, 300), r: resp.slice(0, 2000), obra: nomeEscopo(), data: hojeISO() });
      localStorage.setItem(IA_CHAT_KEY, JSON.stringify(hc.slice(0, 30)));
    } catch (e) {}
    renderChatHistorico();
    guardarHistoricoIA("Pergunta: " + pergunta.slice(0, 60), nomeEscopo(),
      `<div class="card"><p><strong>${proteger(pergunta)}</strong></p><p>${proteger(resp)}</p></div>`);
  } catch (e) {
    const d = document.getElementById("ia-digitando");
    if (d) { d.textContent = "Não consegui responder: " + (e.message || "erro"); d.classList.remove("digitando"); d.removeAttribute("id"); }
  }
}
function ferramentaPerguntar() {
  const c = elIA("ia-pergunta");
  if (c) c.focus();
  const chat = elIA("ia-chat");
  if (chat) chat.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- Liga a tela ----------
function atualizarStatusChaveIA() {
  const el = elIA("ia-chave-status");
  if (!el) return;
  let tem = false;
  try { tem = !!(localStorage.getItem("mario_groq_key") || ""); } catch (e) {}
  el.textContent = tem
    ? "IA pronta para conversar."
    : "Na primeira pergunta, cole a chave quando pedir (só desta vez neste aparelho).";
}
function atualizarObrasIA() {
  const sel = elIA("ia-obra");
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = `<option value="">Todas as obras</option>`;
  for (const o of obras || []) {
    const op = document.createElement("option");
    op.value = o.id;
    op.textContent = o.nome;
    sel.appendChild(op);
  }
  if (atual) sel.value = atual;
}
function ligarIA() {
  const ao = (id, fn) => {
    const b = elIA(id);
    if (b && !b.dataset.iaLigado) { b.dataset.iaLigado = "1"; b.addEventListener("click", fn); }
  };
  ao("qa-ia-obra", () => mostrarTela("ia"));
  document.querySelectorAll("[data-ia]").forEach((b) => {
    if (!b.dataset.iaLigado) {
      b.dataset.iaLigado = "1";
      b.addEventListener("click", () => {
        const qual = b.dataset.ia;
        if (qual === "gastos") ferramentaGastos();
        else if (qual === "alertas") ferramentaAlertas();
        else if (qual === "relatorio") ferramentaRelatorio();
        else if (qual === "mensagem") ferramentaMensagem();
        else if (qual === "perguntar") ferramentaPerguntar();
      });
    }
  });
  const sel = elIA("ia-obra");
  if (sel && !sel.dataset.iaLigado) {
    sel.dataset.iaLigado = "1";
    sel.addEventListener("change", () => { elIA("ia-painel").innerHTML = ""; atualizarBannerAtencao(); });
  }
  ao("ia-atencao", () => { mostrarTela("ia"); setTimeout(ferramentaAlertas, 100); });
  renderChatHistorico();
  const limpar = elIA("ia-limpar");
  if (limpar && !limpar.dataset.iaLigado) {
    limpar.dataset.iaLigado = "1";
    limpar.addEventListener("click", async () => {
      const ok = await pedirConfirmacao("Limpar conversas?", "Apaga o histórico de conversas com a IA.", "Apagar");
      if (!ok) return;
      try { localStorage.removeItem(IA_CHAT_KEY); } catch (e) {}
      renderChatHistorico();
      mostrarToast("Conversas apagadas.");
    });
  }
  const form = elIA("ia-form");
  if (form && !form.dataset.iaLigado) {
    form.dataset.iaLigado = "1";
    form.addEventListener("submit", (e) => { e.preventDefault(); enviarPerguntaChat(); });
  }
  document.querySelectorAll("[data-sug]").forEach((b) => {
    if (!b.dataset.iaLigado) {
      b.dataset.iaLigado = "1";
      b.addEventListener("click", () => enviarPerguntaChat(b.dataset.sug));
    }
  });
  document.querySelectorAll('[data-ir="ia"]').forEach((b) => {
    if (!b.dataset.iaLigado) {
      b.dataset.iaLigado = "1";
      b.addEventListener("click", () => { setTimeout(() => { atualizarObrasIA(); renderHistoricoIA(); atualizarBannerAtencao(); atualizarStatusChaveIA(); }, 100); });
    }
  });
}
