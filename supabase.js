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
    })),
    gastos: (l.gastos || []).map((g) => ({
      id: g.id,
      categoria: g.categoria,
      descricao: g.descricao,
      valor: Number(g.valor) || 0,
      data: g.data,
      observacao: g.observacao || "",
      maoObraId: g.mao_obra_id || null, // elo com o trabalhador (sem conta dupla)
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
    forma_pagamento: d.formaPagamento || "PIX",
    observacao: d.observacao || null,
  };
}

function gastoParaLinha(obraId, d) {
  return {
    obra_id: obraId,
    categoria: d.categoria,
    descricao: d.descricao,
    valor: d.valor || 0,
    data: d.data,
    observacao: d.observacao || null,
    mao_obra_id: d.maoObraId || null,
  };
}

function trabalhadorParaLinha(obraId, d) {
  return {
    obra_id: obraId,
    nome: d.nome,
    funcao: d.funcao,
    diaria: d.valorDiaria || 0,
    dias_trabalhados: d.dias || 0,
  };
}

// ---------- Operações (SELECT / INSERT / UPDATE / DELETE) ----------
const DB = {
  // Carrega TODAS as obras com filhos (1 consulta com embed)
  async carregarTudo() {
    exigirConexao();
    const { data, error } = await sb
      .from("obras")
      .select("*, recebimentos(*), gastos(*), trabalhadores(*)")
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
};

// ---------- MIGRAÇÃO localStorage -> Supabase (ETAPA 7) ----------
// Lê a chave antiga, insere tudo no banco e marca como migrado.
// O localStorage antigo é MANTIDO como backup (nada é apagado).
// O elo mão-de-obra->gasto é refeito via mapa id antigo -> id novo (UUID).
async function migrarLocalParaSupabase() {
  const locais = BancoLocal.carregar();
  if (!locais.length) throw new Error("nada-para-migrar");

  for (const antiga of locais) {
    const obra = await DB.criarObra({
      nome: antiga.nome || "Sem nome",
      cliente: antiga.cliente || "—",
      endereco: antiga.endereco || "",
      valorContratado: Number(antiga.valorContratado) || 0,
      dataInicio: antiga.dataInicio || "",
      previsaoTermino: antiga.previsaoTermino || "",
      status: antiga.status || "Em andamento",
      dataEncerramento: antiga.dataEncerramento || null,
      observacoes: antiga.observacoes || "",
    });

    // Trabalhadores primeiro (para mapear os elos dos gastos automáticos)
    const mapaEq = {};
    for (const t of antiga.equipe || []) {
      const novo = await DB.inserirTrabalhador(obra.id, {
        nome: t.nome, funcao: t.funcao, valorDiaria: t.valorDiaria, dias: t.dias,
      });
      if (t.id) mapaEq[t.id] = novo.id;
    }

    for (const r of antiga.recebimentos || []) {
      await DB.inserirRecebimento(obra.id, {
        valor: r.valor, data: r.data, descricao: r.descricao,
        formaPagamento: r.formaPagamento, observacao: r.observacao,
      });
    }

    for (const g of antiga.gastos || []) {
      await DB.inserirGasto(obra.id, {
        categoria: g.categoria, descricao: g.descricao, valor: g.valor,
        data: g.data, observacao: g.observacao,
        maoObraId: g.maoObraId ? (mapaEq[g.maoObraId] || null) : null,
      });
    }
  }

  try {
    localStorage.setItem("controle_obras_migrado", "1");
  } catch (e) { /* sem localStorage, segue o jogo */ }
  return locais.length;
}
