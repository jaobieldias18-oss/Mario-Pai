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
function prepararFoto(arquivo, maxDim) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const desenhar = (fonte, w, h) => {
      URL.revokeObjectURL(url);
      const MAX = maxDim || 1280;
      let dw = w, dh = h;
      if (Math.max(dw, dh) > MAX) {
        const k = MAX / Math.max(dw, dh);
        dw = Math.round(dw * k); dh = Math.round(dh * k);
      }
      const cv = document.createElement("canvas");
      cv.width = dw; cv.height = dh;
      cv.getContext("2d").drawImage(fonte, 0, 0, dw, dh);
      if (fonte.close) { try { fonte.close(); } catch (e) {} }
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("foto"))), "image/jpeg", 0.8);
    };
    // Caminho moderno: respeita a orientação EXIF (foto de celular não sai girada)
    if (typeof createImageBitmap === "function") {
      createImageBitmap(arquivo, { imageOrientation: "fromImage" }).then(
        (bmp) => desenhar(bmp, bmp.width, bmp.height),
        () => fallbackImg()
      );
    } else fallbackImg();
    function fallbackImg() {
      const img = new Image();
      img.onload = () => desenhar(img, img.width, img.height);
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("foto")); };
      img.src = url;
    }
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
    areaM2: Number(l.area_m2) || 0,
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
    area_m2: o.areaM2 || 0,
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
      .select("id,nome,cliente,endereco,valor_contratado,area_m2,data_inicio,previsao_termino,status,data_encerramento,observacoes,created_at," +
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

// ---------- Sincronização orçamentos/materiais ----------
// Estratégia segura p/ usuário único: local manda sempre; servidor
// recebe cópia (melhor esforço) e completa o que falta no aparelho.
// Se as tabelas ainda não existirem, tudo falha em silêncio e o app
// segue 100% local. Nada quebra, nada duplica (elo: local_id).
const SyncOrc = {
  async puxarMateriais() {
    try {
      if (!sb) return [];
      const { data, error } = await sb.from("materiais").select("*");
      if (error || !data) return [];
      const out = [];
      for (const r of data) {
        const m = {
          id: r.local_id || r.id, _supa: r.id, nome: r.nome,
          categoria: r.categoria || "Outros", marca: r.marca || "",
          unidade: r.unidade || "un", preco: r.preco == null ? null : Number(r.preco),
          dataPreco: r.data_preco || null, fonte: r.fonte || "",
          perda: r.perda == null ? 0.05 : Number(r.perda),
          consumo: r.consumo == null ? null : Number(r.consumo),
          consumoObs: r.consumo_obs || "", obs: r.obs || "",
          ativo: r.ativo !== false, historico: [],
        };
        try {
          const { data: h } = await sb.from("materiais_precos")
            .select("preco,data,fonte").eq("material_id", r.id).order("data", { ascending: true });
          m.historico = (h || []).map((x) => ({ preco: Number(x.preco), data: x.data, fonte: x.fonte || "" }));
        } catch (e) {}
        out.push(m);
      }
      return out;
    } catch (e) { return []; }
  },
  linhaMat(l) {
    return {
      local_id: l.id, nome: l.nome, categoria: l.categoria || "Outros",
      marca: l.marca || null, unidade: l.unidade || "un",
      preco: l.preco || null, data_preco: l.dataPreco || null,
      fonte: l.fonte || null, perda: l.perda ?? 0.05,
      consumo: l.consumo ?? null, consumo_obs: l.consumoObs || null,
      obs: l.obs || null, ativo: l.ativo !== false,
    };
  },
  async empurrarMaterial(m) {
    try {
      if (!sb) return false;
      if (!m._supa) {
        const { data } = await sb.from("materiais").select("id").eq("local_id", m.id).limit(1);
        if (data && data[0]) m._supa = data[0].id;
      }
      let rid = m._supa || null;
      if (rid) {
        const { error } = await sb.from("materiais").update(SyncOrc.linhaMat(m)).eq("id", rid);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("materiais").insert(SyncOrc.linhaMat(m)).select().single();
        if (error) throw error;
        rid = data.id; m._supa = rid;
      }
      await sb.from("materiais_precos").delete().eq("material_id", rid);
      const hist = (m.historico || []).filter((x) => x.preco > 0)
        .map((x) => ({ material_id: rid, preco: x.preco, data: x.data || null, fonte: x.fonte || null }));
      if (hist.length) {
        const { error } = await sb.from("materiais_precos").insert(hist);
        if (error) throw error;
      }
      return true;
    } catch (e) { return false; }
  },
  async puxarOrcamentos() {
    try {
      if (!sb) return [];
      const { data, error } = await sb.from("orcamentos").select("*").order("created_at", { ascending: false }).limit(30);
      if (error || !data) return [];
      const out = [];
      for (const r of data) {
        let itens = [];
        try {
          const { data: li } = await sb.from("orcamento_itens").select("*").eq("orcamento_id", r.id);
          itens = (li || []).map((x) => ({ nome: x.nome, qtd: x.quantidade == null ? null : Number(x.quantidade), unidade: x.unidade, preco: x.preco == null ? null : Number(x.preco), total: x.total == null ? null : Number(x.total) }));
        } catch (e) {}
        out.push({
          id: r.local_id || r.id, _supa: r.id, data: r.data,
          obraId: r.obra_id || null, area: Number(r.area) || 0,
          alvenaria: r.alvenaria || "bloco", total: Number(r.total) || 0, itens,
        });
      }
      return out;
    } catch (e) { return []; }
  },
  async empurrarOrcamento(o) {
    try {
      if (!sb) return false;
      if (!o._supa) {
        const { data } = await sb.from("orcamentos").select("id").eq("local_id", o.id).limit(1);
        if (data && data[0]) o._supa = data[0].id;
      }
      const linha = {
        local_id: o.id, obra_id: o.obraId || null, area: o.area || 0,
        alvenaria: o.alvenaria || "bloco", total: o.total || 0, data: o.data || null,
      };
      let rid = o._supa || null;
      if (rid) {
        const { error } = await sb.from("orcamentos").update(linha).eq("id", rid);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("orcamentos").insert(linha).select().single();
        if (error) throw error;
        rid = data.id; o._supa = rid;
      }
      await sb.from("orcamento_itens").delete().eq("orcamento_id", rid);
      const itens = (o.itens || []).map((it) => ({
        orcamento_id: rid, nome: it.nome,
        quantidade: it.qtd == null ? null : it.qtd, unidade: it.unidade || null,
        preco: it.preco == null ? null : it.preco,
        total: it.total == null ? null : it.total, detalhe: null,
      }));
      if (itens.length) {
        const { error } = await sb.from("orcamento_itens").insert(itens);
        if (error) throw error;
      }
      return true;
    } catch (e) { return false; }
  },
  async apagarOrcamentoRemoto(o) {
    try {
      if (sb && o && o._supa) await sb.from("orcamentos").delete().eq("id", o._supa);
    } catch (e) {}
  },
};
