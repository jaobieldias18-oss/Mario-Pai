/* =====================================================
   supabase.js — CAMADA DE BANCO DE DADOS (Supabase)
   JavaScript puro, sem frameworks.
   -----------------------------------------------------
   - ÚNICO lugar com URL e chave PÚBLICA (publishable).
   - NUNCA colocar a chave secreta (secret) neste arquivo.
   - Sem login: o acesso é anon (RLS continua ativo).
   - Converte banco (snake_case) <-> app (camelCase + listas
     aninhadas), então o resto do código NÃO muda.
   ===================================================== */

const SUPABASE_URL = "https://wmcrbjlzsqveekwifded.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hNmsPcjC-SKWhQRjd25H3Q_eKevCrOx";

// Cria o cliente (se o CDN falhar, sb fica null e o app avisa)
let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
} catch (e) {
  console.error("Supabase CDN não carregou:", e);
}

function exigirConexao() {
  if (!sb) throw new Error("sem-conexao");
}

// ---------- Fotos de comprovantes (Storage, bucket "anexos") ----------
// Reduz para no máx. 1280px (JPEG 0.8) antes de enviar: rápido no 4G.
function prepararFoto(arquivo) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(arquivo);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1280;
      let w = img.width, h = img.height;
      if (Math.max(w, h) > MAX) {
        const k = MAX / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("foto"))), "image/jpeg", 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("foto")); };
    img.src = url;
  });
}

async function enviarFoto(arquivo) {
  exigirConexao();
  const blob = await prepararFoto(arquivo);
  // Nome longo e imprevisível: sem listar o bucket, ninguém adivinha a URL
  const aleat = (crypto.getRandomValues ? [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(36)).join("") : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 24);
  const nome = Date.now().toString(36) + "-" + aleat + ".jpg";
  const { error } = await sb.storage.from("anexos").upload(nome, blob, { contentType: "image/jpeg" });
  if (error) throw error;
  const { data } = sb.storage.from("anexos").getPublicUrl(nome);
  return data.publicUrl;
}

const dataOuNulo = (v) => (v ? v : null);

// ---------- Conversão banco -> app ----------
function linhaParaObra(l) {
  return {
    id: l.id,
    nome: l.nome,
    cliente: l.cliente,
    endereco: l.endereco || "",
    valorContratado: Number(l.valor_contratado) || 0,
    dataInicio: l.data_inicio || "",
    previsaoTermino: l.previsao_termino || "",
    status: l.status || "Em andamento",
    dataEncerramento: l.data_encerramento || null,
    observacoes: l.observacoes || "",
    criadoEm: (l.created_at || "").slice(0, 10),
    recebimentos: (l.recebimentos || []).map((r) => ({
      id: r.id,
      valor: Number(r.valor) || 0,
      data: r.data,
      descricao: r.descricao,
      formaPagamento: r.forma_pagamento || "PIX",
      observacao: r.observacao || "",
      fotoUrl: r.foto_url || "",
    })),
    gastos: (l.gastos || []).map((g) => ({
      id: g.id,
      categoria: g.categoria,
      descricao: g.descricao,
      valor: Number(g.valor) || 0,
      data: g.data,
      formaPagamento: g.forma_pagamento || "",
      observacao: g.observacao || "",
      maoObraId: g.mao_obra_id || null, // elo LEGADO (ignorado nas listas/totais)
      fotoUrl: g.foto_url || "",
    })),
    parcelas: (l.parcelas || []).map((p) => ({
      id: p.id,
      descricao: p.descricao,
      // Plano mensal (spec): numero/total; vencimento e pagamento com
      // fallback para as colunas legadas (vencimento/data_recebimento).
      numero: p.numero_parcela || null,
      total: p.total_parcelas || null,
      valor: Number(p.valor) || 0,
      vencimento: p.data_vencimento || p.vencimento || "",
      status: p.status || "pendente",
      dataRecebimento: p.data_pagamento || p.data_recebimento || null,
      recebimentoId: p.recebimento_id || null, // recebimento gerado (evita duplicar)
      observacao: p.observacao || "",
    })),
    equipe: (l.trabalhadores || []).map((t) => {
      const diaria = Number(t.diaria) || 0;
      const dias = Number(t.dias_trabalhados) || 0;
      return {
        id: t.id,
        nome: t.nome,
        funcao: t.funcao,
        valorDiaria: diaria,
        dias: dias,
        total: diaria * dias, // calculado, igual ao app original
        // data p/ o financeiro mensal (prioriza a informada; senão, a de cadastro)
        data: t.data || (t.created_at || "").slice(0, 10) || "",
      };
    }),
  };
}

// ---------- Conversão app -> banco ----------
function obraParaLinha(o) {
  return {
    nome: o.nome,
    cliente: o.cliente,
    endereco: o.endereco || null,
    valor_contratado: o.valorContratado || 0,
    data_inicio: dataOuNulo(o.dataInicio),
    previsao_termino: dataOuNulo(o.previsaoTermino),
    status: o.status || "Em andamento",
    data_encerramento: dataOuNulo(o.dataEncerramento),
    observacoes: o.observacoes || null,
  };
}

function recebimentoParaLinha(obraId, d) {
  return {
    obra_id: obraId,
    valor: d.valor || 0,
    data: d.data,
    descricao: d.descricao,
    forma_pagamento: d.formaPagamento || null,
    observacao: d.observacao || null,
    // Só encosta na foto quando informada (editar sem foto nova preserva)
    ...(d.fotoUrl !== undefined ? { foto_url: d.fotoUrl || null } : {}),
  };
}

function gastoParaLinha(obraId, d) {
  return {
    obra_id: obraId,
    categoria: d.categoria,
    descricao: d.descricao,
    valor: d.valor || 0,
    data: d.data,
    forma_pagamento: d.formaPagamento || null,
    observacao: d.observacao || null,
    mao_obra_id: d.maoObraId || null,
    // Só encosta na foto quando informada (editar sem foto nova preserva)
    ...(d.fotoUrl !== undefined ? { foto_url: d.fotoUrl || null } : {}),
  };
}

function trabalhadorParaLinha(obraId, d) {
  return {
    obra_id: obraId,
    nome: d.nome,
    funcao: d.funcao,
    diaria: d.valorDiaria || 0,
    dias_trabalhados: d.dias || 0,
    data: dataOuNulo(d.data),
  };
}

function parcelaParaLinha(obraId, d) {
  const venc = dataOuNulo(d.vencimento);
  const pag = dataOuNulo(d.dataRecebimento);
  return {
    obra_id: obraId,
    descricao: d.descricao,
    numero_parcela: d.numero || null,
    total_parcelas: d.total || null,
    valor: d.valor || 0,
    vencimento: venc, // espelho legado (compat)
    data_vencimento: venc, // nome oficial do parcelamento mensal
    status: d.status || "pendente",
    data_recebimento: pag, // espelho legado (compat)
    data_pagamento: pag, // nome oficial (data REAL do pagamento)
    recebimento_id: d.recebimentoId || null,
    observacao: d.observacao || null,
  };
}

// ---------- Operações (SELECT / INSERT / UPDATE / DELETE) ----------
const DB = {
  // Carrega TODAS as obras com filhos (1 única consulta com embed).
  // Colunas explícitas = menos bytes no celular (sem owner_id, updated_at etc.)
  async carregarTudo() {
    exigirConexao();
    const { data, error } = await sb
      .from("obras")
      .select("id,nome,cliente,endereco,valor_contratado,data_inicio,previsao_termino,status,data_encerramento,observacoes,created_at," +
        "recebimentos(id,valor,data,descricao,forma_pagamento,observacao,foto_url)," +
        "gastos(id,categoria,descricao,valor,data,forma_pagamento,observacao,mao_obra_id,foto_url)," +
        "trabalhadores(id,nome,funcao,diaria,dias_trabalhados,data,created_at)," +
        "parcelas(id,descricao,numero_parcela,total_parcelas,valor,vencimento,data_vencimento,status,data_recebimento,data_pagamento,recebimento_id,observacao)")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(linhaParaObra);
  },

  // ---- Obras ----
  async criarObra(dados) {
    exigirConexao();
    const { data, error } = await sb.from("obras").insert(obraParaLinha(dados)).select().single();
    if (error) throw error;
    return linhaParaObra({ ...data, recebimentos: [], gastos: [], trabalhadores: [] });
  },

  async atualizarObra(id, dados) {
    exigirConexao();
    const { error } = await sb.from("obras").update(obraParaLinha(dados)).eq("id", id);
    if (error) throw error;
  },

  async excluirObra(id) {
    exigirConexao();
    // O banco apaga recebimentos/gastos/trabalhadores junto (ON DELETE CASCADE)
    const { error } = await sb.from("obras").delete().eq("id", id);
    if (error) throw error;
  },

  // ---- Recebimentos ----
  async inserirRecebimento(obraId, dados) {
    exigirConexao();
    const { data, error } = await sb.from("recebimentos").insert(recebimentoParaLinha(obraId, dados)).select().single();
    if (error) throw error;
    return linhaParaObra({ recebimentos: [data] }).recebimentos[0];
  },

  async atualizarRecebimento(id, dados) {
    exigirConexao();
    const linha = recebimentoParaLinha(dados.obraId || null, dados);
    delete linha.obra_id; // nunca troca a obra de um lançamento
    const { error } = await sb.from("recebimentos").update(linha).eq("id", id);
    if (error) throw error;
  },

  async excluirRecebimento(id) {
    exigirConexao();
    const { error } = await sb.from("recebimentos").delete().eq("id", id);
    if (error) throw error;
  },

  // ---- Gastos ----
  async inserirGasto(obraId, dados) {
    exigirConexao();
    const { data, error } = await sb.from("gastos").insert(gastoParaLinha(obraId, dados)).select().single();
    if (error) throw error;
    return linhaParaObra({ gastos: [data] }).gastos[0];
  },

  async atualizarGasto(id, dados) {
    exigirConexao();
    const linha = gastoParaLinha(dados.obraId || null, dados);
    delete linha.obra_id;
    if (!("mao_obra_id" in dados) && !dados.maoObraId) delete linha.mao_obra_id; // não mexe no elo
    const { error } = await sb.from("gastos").update(linha).eq("id", id);
    if (error) throw error;
  },

  async excluirGasto(id) {
    exigirConexao();
    const { error } = await sb.from("gastos").delete().eq("id", id);
    if (error) throw error;
  },

  // ---- Trabalhadores ----
  async inserirTrabalhador(obraId, dados) {
    exigirConexao();
    const { data, error } = await sb.from("trabalhadores").insert(trabalhadorParaLinha(obraId, dados)).select().single();
    if (error) throw error;
    return linhaParaObra({ trabalhadores: [data] }).equipe[0];
  },

  async atualizarTrabalhador(id, dados) {
    exigirConexao();
    const linha = trabalhadorParaLinha(dados.obraId || null, dados);
    delete linha.obra_id;
    const { error } = await sb.from("trabalhadores").update(linha).eq("id", id);
    if (error) throw error;
  },

  async excluirTrabalhador(id) {
    exigirConexao();
    const { error } = await sb.from("trabalhadores").delete().eq("id", id);
    if (error) throw error;
  },

  // ---- Parcelas (plano de pagamento do cliente) ----
  async inserirParcela(obraId, dados) {
    exigirConexao();
    const { data, error } = await sb.from("parcelas").insert(parcelaParaLinha(obraId, dados)).select().single();
    if (error) throw error;
    return linhaParaObra({ parcelas: [data] }).parcelas[0];
  },

  async atualizarParcela(id, dados) {
    exigirConexao();
    const linha = parcelaParaLinha(dados.obraId || null, dados);
    delete linha.obra_id; // nunca troca a obra de um lançamento
    const { error } = await sb.from("parcelas").update(linha).eq("id", id);
    if (error) throw error;
  },

  async excluirParcela(id) {
    exigirConexao();
    const { error } = await sb.from("parcelas").delete().eq("id", id);
    if (error) throw error;
  },
};
