/* =====================================================
   outbox.js — RASCUNHO OFFLINE (fila de sincronização)
   -----------------------------------------------------
   Sem internet, os salvamentos NÃO se perdem: entram numa
   fila (localStorage) com ID temporário e sobem sozinhos
   quando a rede voltar (ao abrir o app, ao voltar o sinal
   ou no botão "Sincronizar").
   - Não mexe nas telas: envolve os métodos de DB.*
   - Ordem preservada; IDs temporários viram reais no envio.
   - Rollback: apague este arquivo + a tag no index.html.
   ===================================================== */

const OUTBOX_KEY = "mario_outbox_v1";
const _origDB = {};
["criarObra", "atualizarObra", "excluirObra",
  "inserirRecebimento", "atualizarRecebimento", "excluirRecebimento",
  "inserirGasto", "atualizarGasto", "excluirGasto",
  "inserirTrabalhador", "atualizarTrabalhador", "excluirTrabalhador",
  "inserirParcela", "atualizarParcela", "excluirParcela",
].forEach((k) => { _origDB[k] = DB[k].bind(DB); });

function ehTempId(id) { return typeof id === "string" && id.indexOf("tmp_") === 0; }
function gerarTempId() {
  return "tmp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function ehFalhaRede(e) {
  if (!navigator.onLine) return true;
  const m = String((e && (e.message || e.msg)) || e || "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|could not connect|timeout/i.test(m);
}
function lerFila() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch (e) { return []; }
}
function salvarFila(fila) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(fila)); } catch (e) {}
  atualizarSeloOutbox();
}
function atualizarSeloOutbox() {
  const b = document.getElementById("btn-sincronizar");
  if (!b) return;
  const n = lerFila().length;
  b.hidden = n === 0;
  b.textContent = `↑ Sincronizar (${n})`;
}
function avisarOffline() {
  mostrarToast("Sem internet: salvo aqui, envia sozinho depois.", false);
}

// Troca ID temporário pelo real em tudo que está na tela
function trocarIdLocal(tmp, real) {
  for (const o of obras) {
    if (o.id === tmp) o.id = real;
    for (const lista of ["recebimentos", "gastos", "equipe", "parcelas"]) {
      for (const x of o[lista] || []) {
        if (x.id === tmp) x.id = real;
        if (x.recebimentoId === tmp) x.recebimentoId = real;
        if (x.maoObraId === tmp) x.maoObraId = real;
      }
    }
  }
}

// ---------- Envolvimento dos métodos de escrita ----------
DB.criarObra = async function (dados) {
  try { return await _origDB.criarObra(dados); }
  catch (e) {
    if (!ehFalhaRede(e)) throw e;
    const tmp = gerarTempId();
    const fila = lerFila();
    fila.push({ t: "criarObra", tempId: tmp, dados });
    salvarFila(fila); avisarOffline();
    return { id: tmp, ...dados, dataEncerramento: dados.dataEncerramento || null, recebimentos: [], gastos: [], equipe: [], parcelas: [], _offline: true };
  }
};

function ecoInserir(tipo, obraId, dados, camposEcho) {
  return _origDB[tipo](obraId, dados).catch((e) => {
    if (!ehFalhaRede(e)) throw e;
    const tmp = gerarTempId();
    const fila = lerFila();
    fila.push({ t: tipo, obra: obraId, tempId: tmp, dados });
    salvarFila(fila); avisarOffline();
    return { id: tmp, ...camposEcho, ...dados, _offline: true };
  });
}
DB.inserirRecebimento = (obraId, dados) => ecoInserir("inserirRecebimento", obraId, dados, {});
DB.inserirGasto = (obraId, dados) => ecoInserir("inserirGasto", obraId, dados, {});
DB.inserirTrabalhador = (obraId, dados) => ecoInserir("inserirTrabalhador", obraId, dados, { total: (dados.valorDiaria || 0) * (dados.dias || 0) });
DB.inserirParcela = (obraId, dados) => ecoInserir("inserirParcela", obraId, dados, {});

function ecoAtualizar(tipo, id, dados) {
  // Atualizar algo ainda não enviado: incorpora na criação pendente
  if (ehTempId(id)) {
    const fila = lerFila();
    const alvo = fila.find((o) => o.tempId === id);
    if (alvo) Object.assign(alvo.dados, dados);
    salvarFila(fila);
    return Promise.resolve({});
  }
  return _origDB[tipo](id, dados).catch((e) => {
    if (!ehFalhaRede(e)) throw e;
    const fila = lerFila();
    fila.push({ t: tipo, id, dados });
    salvarFila(fila); avisarOffline();
    return {};
  });
}
DB.atualizarObra = (id, dados) => ecoAtualizar("atualizarObra", id, dados);
DB.atualizarRecebimento = (id, dados) => ecoAtualizar("atualizarRecebimento", id, dados);
DB.atualizarGasto = (id, dados) => ecoAtualizar("atualizarGasto", id, dados);
DB.atualizarTrabalhador = (id, dados) => ecoAtualizar("atualizarTrabalhador", id, dados);
DB.atualizarParcela = (id, dados) => ecoAtualizar("atualizarParcela", id, dados);

function ecoExcluir(tipo, id) {
  // Excluir algo ainda não enviado: some da fila, sem falar com o servidor
  if (ehTempId(id)) {
    const fila = lerFila().filter((o) => o.tempId !== id && o.id !== id &&
      !(o.dados && (o.dados.recebimentoId === id)));
    salvarFila(fila);
    return Promise.resolve({});
  }
  return _origDB[tipo](id).catch((e) => {
    if (!ehFalhaRede(e)) throw e;
    const fila = lerFila();
    fila.push({ t: tipo, id });
    salvarFila(fila); avisarOffline();
    return {};
  });
}
DB.excluirObra = (id) => ecoExcluir("excluirObra", id);
DB.excluirRecebimento = (id) => ecoExcluir("excluirRecebimento", id);
DB.excluirGasto = (id) => ecoExcluir("excluirGasto", id);
DB.excluirTrabalhador = (id) => ecoExcluir("excluirTrabalhador", id);
DB.excluirParcela = (id) => ecoExcluir("excluirParcela", id);

// ---------- Descarga da fila (ordem preservada, IDs resolvidos) ----------
let descarregando = false;
async function descarregarOutbox() {
  if (descarregando || !sb) return;
  let fila = lerFila();
  if (!fila.length) { atualizarSeloOutbox(); return; }
  if (!navigator.onLine) { atualizarSeloOutbox(); return; }
  descarregando = true;
  // Otimização: criação + exclusão do mesmo temporário se anulam
  const excluidos = new Set(fila.filter((o) => o.t.indexOf("excluir") === 0 && ehTempId(o.id)).map((o) => o.id));
  if (excluidos.size) fila = fila.filter((o) => !(o.tempId && excluidos.has(o.tempId)) && !(o.t.indexOf("excluir") === 0 && ehTempId(o.id)));
  const mapa = {}; // tempId -> id real
  const resolver = (v) => (typeof v === "string" && mapa[v] ? mapa[v] : v);
  const pendentes = [];
  let enviados = 0;
  for (const op of fila) {
    try {
      if (op.t === "criarObra") {
        const r = await _origDB.criarObra(op.dados);
        mapa[op.tempId] = r.id; trocarIdLocal(op.tempId, r.id); enviados++;
      } else if (op.t === "inserirRecebimento") {
        const r = await _origDB.inserirRecebimento(resolver(op.obra), op.dados);
        mapa[op.tempId] = r.id; trocarIdLocal(op.tempId, r.id); enviados++;
      } else if (op.t === "inserirGasto") {
        const r = await _origDB.inserirGasto(resolver(op.obra), op.dados);
        mapa[op.tempId] = r.id; trocarIdLocal(op.tempId, r.id); enviados++;
      } else if (op.t === "inserirTrabalhador") {
        const r = await _origDB.inserirTrabalhador(resolver(op.obra), op.dados);
        mapa[op.tempId] = r.id; trocarIdLocal(op.tempId, r.id); enviados++;
      } else if (op.t === "inserirParcela") {
        const r = await _origDB.inserirParcela(resolver(op.obra), op.dados);
        mapa[op.tempId] = r.id; trocarIdLocal(op.tempId, r.id); enviados++;
      } else if (op.t === "atualizarObra") {
        await _origDB.atualizarObra(resolver(op.id), op.dados); enviados++;
      } else if (op.t === "atualizarRecebimento") {
        await _origDB.atualizarRecebimento(resolver(op.id), op.dados); enviados++;
      } else if (op.t === "atualizarGasto") {
        await _origDB.atualizarGasto(resolver(op.id), op.dados); enviados++;
      } else if (op.t === "atualizarTrabalhador") {
        await _origDB.atualizarTrabalhador(resolver(op.id), op.dados); enviados++;
      } else if (op.t === "atualizarParcela") {
        const d = { ...op.dados };
        if (d.recebimentoId) d.recebimentoId = resolver(d.recebimentoId);
        await _origDB.atualizarParcela(resolver(op.id), d); enviados++;
      } else if (op.t === "excluirObra") {
        await _origDB.excluirObra(resolver(op.id)); enviados++;
      } else if (op.t === "excluirRecebimento") {
        await _origDB.excluirRecebimento(resolver(op.id)); enviados++;
      } else if (op.t === "excluirGasto") {
        await _origDB.excluirGasto(resolver(op.id)); enviados++;
      } else if (op.t === "excluirTrabalhador") {
        await _origDB.excluirTrabalhador(resolver(op.id)); enviados++;
      } else if (op.t === "excluirParcela") {
        await _origDB.excluirParcela(resolver(op.id)); enviados++;
      }
    } catch (e) {
      if (ehFalhaRede(e)) pendentes.push(op); // tenta de novo depois
      else console.error("Outbox descartou operação com erro:", op.t, e);
    }
  }
  salvarFila(pendentes);
  descarregando = false;
  if (enviados > 0) {
    try { obras = await DB.carregarTudo(); } catch (e) {}
    renderTudo();
    mostrarToast(pendentes.length ? `${enviados} enviados, ${pendentes.length} ainda pendentes.` : "Tudo sincronizado!");
  }
}

// Liga o botão + gatilhos (seguro chamar 1x)
(function ligarOutbox() {
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("btn-sincronizar");
    if (b) b.addEventListener("click", descarregarOutbox);
    atualizarSeloOutbox();
  });
  window.addEventListener("online", () => {
    mostrarToast("Internet de volta: sincronizando...");
    descarregarOutbox();
  });
})();
