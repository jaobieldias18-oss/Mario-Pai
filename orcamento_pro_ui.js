/* =====================================================
   orcamento_pro_ui.js — INTERFACE do modo profissional (aditivo)
   -----------------------------------------------------
   Só interface. NÃO calcula orçamento: monta entrada para o
   MOTOR ÚNICO (calcularOrcamentoGuiado, em orcamento.js) e usa
   os dados/funções de orcamento_pro.js (OrcPro).

   Requer carregado antes: orcamento.js e orcamento_pro.js.
   Nada aqui inventa preço/preço/coeficiente: quando falta dado,
   mostra "sem preço"/"pendente".
   ===================================================== */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  if (typeof window === "undefined" || typeof window.OrcPro === "undefined") return;

  var ORC_PRO_MODO_KEY = "mario_orc_modo_v1";

  // Código do catálogo → chave de preço do orçamento guiado ([data-og-preco]).
  var PRECO_POR_CODIGO = {
    "ALV-01": "bloco", "ALV-02": "bloco", "CIM-01": "cimento", "CIM-02": "argamassa",
    "ACO-01": "aco", "PIS-01": "piso", "TIN-01": "tinta", "TEL-01": "telha",
  };

  function esc(s) { return (typeof proteger === "function") ? proteger(s) : String(s == null ? "" : s); }
  function nz(v) { return (typeof numeroOuZero === "function") ? numeroOuZero(v) : (Number(v) || 0); }
  function tost(msg, ok) { if (typeof mostrarToast === "function") mostrarToast(msg, ok !== false); }

  // ---------- Parser de vãos: "0,80x2,10" ou "0,80x2,10x2" (qtd) separados por ; ----------
  function parseVaosTexto(txt) {
    var out = [];
    var partes = String(txt || "").split(";");
    for (var i = 0; i < partes.length; i++) {
      var p = partes[i].trim();
      if (!p) continue;
      var num = p.replace(/,/g, ".").split(/x|×|\*/i).map(function (s) { return parseFloat(s); });
      if (num.length >= 2 && num[0] > 0 && num[1] > 0) {
        out.push({ tipo: "vao", larg: num[0], alt: num[1], qtd: num.length >= 3 && num[2] > 0 ? num[2] : 1 });
      }
    }
    return out;
  }

  // ---------- Estado de edição (medição em memória, espelhada no OrcPro) ----------
  function lerMedicao() { return OrcPro.lerMedicaoAtual(); }
  function salvarMedicao(m) { return OrcPro.salvarMedicaoAtual(m); }

  function modoAtual() {
    try { return localStorage.getItem(ORC_PRO_MODO_KEY) || "A"; } catch (e) { return "A"; }
  }
  function setModo(m) {
    try { localStorage.setItem(ORC_PRO_MODO_KEY, m); } catch (e) {}
    aplicarModo(m);
  }
  function aplicarModo(m) {
    var box = document.getElementById("pro-medicao-area");
    if (box) box.hidden = (m === "A");
    var aviso = document.getElementById("pro-modo-aviso");
    var txt = {
      A: "Modo rápido: só a área da casa e os cômodos. Alvenaria e cimento usam fator médio (estimativa).",
      B: "Modo medido (recomendado): informe paredes e ambientes para cálculo exato. Cimento/reboco/tinta continuam por coeficiente.",
      C: "Modo detalhado: medidas + catálogo/cotações de preço por fornecedor e cenários. Preços marcados com a origem.",
    };
    if (aviso) aviso.textContent = txt[m] || txt.A;
  }

  // ---------- Render principal ----------
  function render() {
    var box = document.getElementById("orc-pro-panel");
    if (!box) return;
    var m = lerMedicao();
    var med = OrcPro.calcularMedicaoObra(m);
    var modo = modoAtual();
    var h = "";
    h += '<div class="card pro-card">';
    h += '<h3 class="titulo-secao" style="margin-top:0">Modo profissional <span class="texto-suave" style="font-weight:400">(opcional)</span></h3>';
    h += '<p class="texto-suave">Escolha o nível de detalhe. Tudo continua usando o MESMO cálculo — só muda a quantidade de informação que você fornece.</p>';
    h += '<div class="pro-modos">';
    h += radio("A", "Rápido", modo);
    h += radio("B", "Medido (recomendado)", modo);
    h += radio("C", "Detalhado", modo);
    h += '</div>';
    h += '<p class="texto-suave" id="pro-modo-aviso"></p>';
    h += '<div class="pro-escopo">';
    h += '<button class="btn btn-texto" data-pro="novo-orcamento">+ Novo orçamento (limpar dados técnicos)</button>';
    h += '<span class="texto-suave">A medição e a fundação pertencem a UM orçamento. Use este botão ao começar outro.</span>';
    h += '</div>';

    // --- Medição por parede/ambiente ---
    h += '<div id="pro-medicao-area"' + (modo === "A" ? " hidden" : "") + '>';
    h += '<h4 class="pro-sub">Medição por parede e ambiente</h4>';
    h += '<p class="texto-suave">Paredes dão a área exata de alvenaria. Ambientes (largura × comprimento) dão a área de piso para o contrapiso.</p>';
    h += '<div class="pro-tabela"><div class="pro-th">Parede</div><div class="pro-th">Compr. (m)</div><div class="pro-th">Altura (m)</div><div class="pro-th">Faces</div><div class="pro-th">Vãos (larg×alt[×qtd]; ...)</div><div class="pro-th"></div></div>';
    h += '<div id="pro-paredes">';
    for (var i = 0; i < m.paredes.length; i++) h += linhaParede(m.paredes[i], i);
    h += '</div>';
    h += '<button class="btn btn-texto" data-pro="add-parede">+ Adicionar parede</button>';
    h += '<div class="pro-tabela" style="margin-top:10px"><div class="pro-th">Ambiente</div><div class="pro-th">Larg. (m)</div><div class="pro-th">Compr. (m)</div><div class="pro-th">Altura (m)</div><div class="pro-th"></div></div>';
    h += '<div id="pro-ambientes">';
    for (var j = 0; j < m.ambientes.length; j++) h += linhaAmbiente(m.ambientes[j], j);
    h += '</div>';
    h += '<button class="btn btn-texto" data-pro="add-ambiente">+ Adicionar ambiente</button>';
    h += '<div class="pro-resumo" id="pro-resumo">' + resumoMedicao(med) + '</div>';
    h += '<button class="btn btn-primario" data-pro="salvar-medicao">Salvar medição</button> ';
    h += '<button class="btn btn-texto" data-pro="limpar-medicao">Limpar medição</button>';
    h += '</div>';

    // --- Fundação por elemento (Seção 2) ---
    h += '<h4 class="pro-sub">Fundação por elemento (opcional — projeto/medidas)</h4>';
    h += '<p class="texto-suave">Informe comprimento × largura × altura × quantidade de cada elemento. Sem isso, a fundação fica como ESTIMATIVA e é marcada como pendente de dimensionamento. O sistema NÃO dimensiona sozinho.</p>';
    h += '<div class="pro-tabela"><div class="pro-th">Elemento</div><div class="pro-th">Compr. (m)</div><div class="pro-th">Larg. (m)</div><div class="pro-th">Alt. (m)</div><div class="pro-th">Qtd</div><div class="pro-th"></div></div>';
    h += '<div id="pro-fund-lista">' + linhasFundacao() + '</div>';
    h += '<div class="pro-fund-add">';
    h += '<select id="pro-fund-tipo"><option value="sapatas">Sapata</option><option value="baldrames">Baldrame</option><option value="pilares">Pilar</option><option value="vigas">Viga</option></select>';
    h += '<input type="number" id="pro-fund-comp" step="0.01" inputmode="decimal" placeholder="Compr. (m)" />';
    h += '<input type="number" id="pro-fund-larg" step="0.01" inputmode="decimal" placeholder="Larg. (m)" />';
    h += '<input type="number" id="pro-fund-alt" step="0.01" inputmode="decimal" placeholder="Alt. (m)" />';
    h += '<input type="number" id="pro-fund-qtd" step="1" inputmode="numeric" placeholder="Qtd" value="1" />';
    h += '<button class="btn btn-texto" data-pro="add-fund">+ Adicionar</button>';
    h += '</div>';
    h += '<div class="pro-fund-laje"><label class="campo"><span>Laje (m²)</span><input type="number" id="pro-laje-area" step="0.1" inputmode="decimal" /></label>';
    h += '<label class="campo"><span>Espessura (m)</span><input type="number" id="pro-laje-esp" step="0.01" inputmode="decimal" placeholder="Ex: 0,12" /></label>';
    h += '<label class="campo"><span>Aço fundação (kg/m³)</span><input type="number" id="pro-fund-aco" step="1" inputmode="decimal" placeholder="vazio = pendente" /></label></div>';

    // --- Cenários ---
    h += '<h4 class="pro-sub">Cenários (econômico / provável / conservador)</h4>';
    h += '<p class="texto-suave">Fatores explícitos sobre os PREÇOS (não são probabilidades). Ex.: -5% e +15%.</p>';
    h += '<div class="linha-2"><label class="campo"><span>Econômico (% sobre preços)</span><input type="number" id="pro-fator-econ" step="1" inputmode="numeric" placeholder="Ex: -5" /></label>';
    h += '<label class="campo"><span>Conservador (%)</span><input type="number" id="pro-fator-cons" step="1" inputmode="numeric" placeholder="Ex: 15" /></label></div>';
    h += '<button class="btn btn-primario" data-pro="cenarios">Ver cenários do último cálculo</button>';
    h += '<div id="pro-cenarios"></div>';

    // --- Catálogo / cotações ---
    h += '<h4 class="pro-sub">Preços por fornecedor (catálogo & cotações)</h4>';
    h += '<p class="texto-suave">O preço do catálogo começa vazio (não inventamos preço). Registre cotações com fornecedor, valor e tipo.</p>';
    h += '<div class="pro-cot-form">';
    h += '<label class="campo"><span>Material</span><select id="pro-cot-cod"></select></label>';
    h += '<label class="campo"><span>Fornecedor</span><input type="text" id="pro-cot-forn" maxlength="60" placeholder="Ex: Depósito X" /></label>';
    h += '<label class="campo"><span>Preço unit. (R$)</span><input type="number" id="pro-cot-preco" step="0.01" inputmode="decimal" /></label>';
    h += '<label class="campo"><span>Tipo</span><select id="pro-cot-tipo"><option value="confirmado">Preço confirmado</option><option value="historico">Preço histórico</option><option value="estimativa">Estimativa (não confirmada)</option></select></label>';
    h += '<label class="campo"><span>Unidade de compra</span><input type="text" id="pro-cot-un" maxlength="12" placeholder="un / saco / m²" /></label>';
    h += '</div>';
    h += '<button class="btn btn-primario" data-pro="add-cot">Registrar cotação</button> ';
    h += '<button class="btn btn-texto" data-pro="aplicar-cot">Aplicar preço vigente ao orçamento</button>';
    h += '<div id="pro-cot-lista"></div>';

    // --- Obras reais ---
    h += '<h4 class="pro-sub">Obras reais (previsto × comprado × realizado)</h4>';
    h += '<p class="texto-suave">Comparação manual. O sistema NÃO "aprende" sozinho com estes números.</p>';
    h += '<div class="pro-cot-form">';
    h += '<label class="campo"><span>Item/etapa</span><input type="text" id="pro-real-nome" maxlength="60" placeholder="Ex: Bloco de concreto" /></label>';
    h += '<label class="campo"><span>Custo previsto (R$)</span><input type="number" id="pro-real-cp" step="0.01" inputmode="decimal" /></label>';
    h += '<label class="campo"><span>Custo realizado (R$)</span><input type="number" id="pro-real-cr" step="0.01" inputmode="decimal" /></label>';
    h += '</div>';
    h += '<button class="btn btn-primario" data-pro="add-real">Registrar obra real</button>';
    h += '<div id="pro-real-lista"></div>';

    // --- Nuvem (sincronização) ---
    h += '<h4 class="pro-sub">Nuvem (backup e abrir em outro aparelho)</h4>';
    h += '<p class="texto-suave">Preços por fornecedor, cotações, fornecedores e obras reais começam salvos NESTE aparelho (funciona sem internet). O botão copia/baixa esses dados da nuvem quando você estiver logado.</p>';
    h += '<button class="btn btn-primario" data-pro="sincronizar">Sincronizar com a nuvem</button> ';
    h += '<button class="btn btn-texto" data-pro="sincronizar-baixar">Só baixar da nuvem</button>';
    h += '<div class="texto-suave" id="pro-sync-status"></div>';

    h += '<h4 class="pro-sub">Auditoria ampliada</h4>';
    h += '<button class="btn btn-texto" data-pro="auditoria-pro">Ver auditoria com fonte de preço</button>';
    h += '<div id="pro-auditoria"></div>';
    h += '<h4 class="pro-sub">Assistente (IA)</h4>';
    h += '<p class="texto-suave">A IA comenta o último orçamento SALVO usando os números reais. Não altera nada.</p>';
    h += '<button class="btn btn-texto" data-pro="ia-orcamento">Perguntar à IA sobre este orçamento</button>';
    h += '<div id="pro-ia"></div>';
    h += '</div>';

    box.innerHTML = h;
    aplicarModo(modo);
    desenharSelectCatalogo();
    desenharCotacoes();
    desenharObrasReais();
    try { preencherFundacaoInputs(); } catch (e) {}
    try { mostrarSyncStatus(); } catch (e) {}
  }

  function radio(v, label, atual) {
    return '<label class="pro-radio"><input type="radio" name="pro-modo" value="' + v + '"' +
      (atual === v ? " checked" : "") + ' /> ' + esc(label) + "</label>";
  }
  function linhaParede(p, i) {
    return '<div class="pro-tr" data-parede="' + i + '">' +
      '<div class="pro-td" data-l="Parede">' + (i + 1) + '</div>' +
      '<div class="pro-td" data-l="Compr."><input type="number" step="0.01" inputmode="decimal" data-campo="comp" value="' + (p.comp != null ? esc(p.comp) : "") + '" /></div>' +
      '<div class="pro-td" data-l="Altura"><input type="number" step="0.01" inputmode="decimal" data-campo="alt" value="' + (p.alt != null ? esc(p.alt) : "") + '" /></div>' +
      '<div class="pro-td" data-l="Faces"><select data-campo="faces"><option value="1"' + (p.faces === 1 ? " selected" : "") + '>1</option><option value="2"' + (p.faces === 2 ? " selected" : "") + '>2</option></select></div>' +
      '<div class="pro-td" data-l="Vãos"><input type="text" maxlength="120" data-campo="vaos" value="' + esc(vaosParaTexto(p.aberturas)) + '" /></div>' +
      '<div class="pro-td"><button class="btn btn-texto" data-pro="del-parede" data-i="' + i + '">remover</button></div>' +
      '</div>';
  }
  function linhaAmbiente(a, i) {
    return '<div class="pro-tr" data-ambiente="' + i + '">' +
      '<div class="pro-td" data-l="Ambiente"><input type="text" maxlength="40" data-campo="nome" value="' + esc(a.nome || "") + '" /></div>' +
      '<div class="pro-td" data-l="Larg."><input type="number" step="0.01" inputmode="decimal" data-campo="larg" value="' + (a.larg != null ? esc(a.larg) : "") + '" /></div>' +
      '<div class="pro-td" data-l="Compr."><input type="number" step="0.01" inputmode="decimal" data-campo="comp" value="' + (a.comp != null ? esc(a.comp) : "") + '" /></div>' +
      '<div class="pro-td" data-l="Altura"><input type="number" step="0.01" inputmode="decimal" data-campo="alt" value="' + (a.alt != null ? esc(a.alt) : "") + '" /></div>' +
      '<div class="pro-td"><button class="btn btn-texto" data-pro="del-ambiente" data-i="' + i + '">remover</button></div>' +
      '</div>';
  }
  function vaosParaTexto(ab) {
    if (!Array.isArray(ab) || !ab.length) return "";
    return ab.map(function (v) {
      var s = (v.larg || "") + "x" + (v.alt || "");
      if (v.qtd && v.qtd > 1) s += "x" + v.qtd;
      return s;
    }).join(";");
  }
  function resumoMedicao(med) {
    if (!med || !med.temMedidaReal && med.paredes === 0 && !med.pisoTotal) return '<span class="texto-suave">Sem medidas ainda.</span>';
    return '<strong>Área líquida de parede:</strong> ' + med.liquida + ' m² • ' +
      'bruta ' + med.bruta + ' m² • vãos ' + med.aberturas + ' m² • faces p/ revestir ' + med.revestimentoFaces + ' m² • ' +
      'piso ' + med.pisoTotal + ' m²' +
      (med.duplicados.length ? ' • <span class="pro-alerta">' + med.duplicados.length + ' parede(s) duplicada(s) ignorada(s)</span>' : '') +
      (med.aberturasInvalidas ? ' • <span class="pro-alerta">' + med.aberturasInvalidas + ' vão(s) inválido(s)</span>' : '');
  }

  // ---------- Coleta do estado da medição a partir do DOM ----------
  function coletarMedicao() {
    var m = { ambientes: [], paredes: [] };
    var pEls = document.querySelectorAll("#pro-paredes [data-parede]");
    for (var i = 0; i < pEls.length; i++) {
      var el = pEls[i];
      var comp = nz(val(el, "comp")), alt = nz(val(el, "alt"));
      if (!(comp > 0) || !(alt > 0)) continue;
      m.paredes.push({ id: "p" + (i + 1), comp: comp, alt: alt,
        faces: Number(val(el, "faces")) === 2 ? 2 : 1, aberturas: parseVaosTexto(val(el, "vaos")) });
    }
    var aEls = document.querySelectorAll("#pro-ambientes [data-ambiente]");
    for (var j = 0; j < aEls.length; j++) {
      var ae = aEls[j];
      var larg = nz(val(ae, "larg")), compA = nz(val(ae, "comp"));
      if (!(larg > 0) || !(compA > 0)) continue;
      m.ambientes.push({ nome: val(ae, "nome") || ("Ambiente " + (j + 1)), larg: larg, comp: compA,
        alt: nz(val(ae, "alt")) || null, paredes: [] });
    }
    return m;
  }
  function val(el, campo) {
    var i = el.querySelector('[data-campo="' + campo + '"]');
    return i ? i.value : "";
  }

  // ---------- Catálogo / cotações ----------
  function desenharSelectCatalogo() {
    var s = document.getElementById("pro-cot-cod");
    if (!s) return;
    var atual = s.value;
    var itens = OrcPro.buscarCatalogo("");
    var h = "";
    for (var i = 0; i < itens.length; i++) {
      h += '<option value="' + esc(itens[i].codigo) + '">' + esc(itens[i].codigo) + ' — ' + esc(itens[i].nome) + '</option>';
    }
    s.innerHTML = h;
    if (atual) s.value = atual;
  }
  function desenharCotacoes() {
    var box = document.getElementById("pro-cot-lista");
    if (!box) return;
    var cats = OrcPro.lerCatalogo();
    var h = "";
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      var vig = OrcPro.precoVigente(c.codigo);
      if (!vig) continue;
      h += '<p><strong>' + esc(c.codigo) + '</strong> — ' + esc(c.nome) + ': <strong>' +
        (typeof moeda === "function" ? moeda(vig.preco) : ("R$ " + vig.preco)) + '</strong> ' +
        '<span class="texto-suave">(' + esc(vig.fornecedor || "sem fornecedor") + ' • ' +
        esc(OrcPro.ORC_TIPO_PRECO[vig.tipo] || vig.tipo) + ' • ' + esc(vig.data) + ')</span>' +
        (PRECO_POR_CODIGO[c.codigo] ? ' <span class="texto-suave">→ ' + esc(PRECO_POR_CODIGO[c.codigo]) + '</span>' : '') + '</p>';
    }
    box.innerHTML = h || '<p class="texto-suave">Nenhuma cotação registrada ainda.</p>';
  }
  function desenharObrasReais() {
    var box = document.getElementById("pro-real-lista");
    if (!box) return;
    var l = OrcPro.lerObrasReais();
    var h = "";
    for (var i = 0; i < l.length; i++) {
      var d = OrcPro.diffObraReal(l[i]);
      var dif = (d.diferencaReais == null) ? "—" :
        ((typeof moeda === "function" ? moeda(d.diferencaReais) : ("R$ " + d.diferencaReais)) +
          (d.diferencaPerc != null ? " (" + d.diferencaPerc.toFixed(1) + "%)" : ""));
      h += '<p><strong>' + esc(l[i].nome || l[i].codigo || "item") + '</strong>: previsto ' +
        (typeof moeda === "function" ? moeda(d.custoPrevisto) : d.custoPrevisto) + ' • realizado ' +
        (typeof moeda === "function" ? moeda(d.custoRealizado) : d.custoRealizado) +
        ' • <strong>diferença ' + dif + '</strong></p>';
    }
    box.innerHTML = h || '<p class="texto-suave">Nenhum registro de obra real.</p>';
  }

  // ---------- Fundação por elemento (Seção 2) ----------
  function linhasFundacao() {
    var f = OrcPro.lerFundacao();
    var tipos = [["sapatas", "Sapata"], ["baldrames", "Baldrame"], ["pilares", "Pilar"], ["vigas", "Viga"]];
    var h = "";
    for (var t = 0; t < tipos.length; t++) {
      var chave = tipos[t][0], rotulo = tipos[t][1];
      var arr = f[chave] || [];
      for (var i = 0; i < arr.length; i++) {
        var el = arr[i];
        h += '<div class="pro-tr"><div class="pro-td">' + rotulo + '</div>' +
          '<div class="pro-td">' + esc(el.comp) + '</div>' +
          '<div class="pro-td">' + esc(el.larg) + '</div>' +
          '<div class="pro-td">' + esc(el.alt) + '</div>' +
          '<div class="pro-td">' + esc(el.qtd || 1) + '</div>' +
          '<div class="pro-td"><button class="btn btn-texto" data-pro="del-fund" data-tipo="' + chave + '" data-i="' + i + '">remover</button></div></div>';
      }
    }
    return h || '<p class="texto-suave">Nenhum elemento de fundação informado.</p>';
  }
  function fundacaoParaMotor() {
    // Captura o que está na tela (laje/aço) mesmo sem clicar em "Adicionar".
    try {
      if (document.getElementById("pro-laje-area") || document.getElementById("pro-laje-esp") || document.getElementById("pro-fund-aco")) lerFundacaoInputs();
    } catch (e) {}
    var f = OrcPro.lerFundacao();
    var limpo = { sapatas: f.sapatas || [], baldrames: f.baldrames || [], pilares: f.pilares || [], vigas: f.vigas || [] };
    if (f.laje && f.laje.area > 0 && f.laje.espessura > 0) limpo.laje = f.laje;
    if (Number(f.acoKgM3) > 0) limpo.acoKgM3 = Number(f.acoKgM3);
    var tem = (limpo.sapatas.length + limpo.baldrames.length + limpo.pilares.length + limpo.vigas.length) > 0 || !!limpo.laje;
    if (!tem && !(Number(f.acoKgM3) > 0)) return null;
    return limpo;
  }
  function preencherFundacaoInputs() {
    var f = OrcPro.lerFundacao();
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = (v == null ? "" : v); };
    set("pro-laje-area", f.laje && f.laje.area);
    set("pro-laje-esp", f.laje && f.laje.espessura);
    set("pro-fund-aco", f.acoKgM3);
  }
  function lerFundacaoInputs() {
    var f = OrcPro.lerFundacao();
    var na = function (id) { var el = document.getElementById(id); return el ? Number(el.value) : 0; };
    var area = na("pro-laje-area"), esp = na("pro-laje-esp"), aco = na("pro-fund-aco");
    f.laje = (area > 0 && esp > 0) ? { area: area, espessura: esp } : null;
    f.acoKgM3 = aco > 0 ? aco : null;
    OrcPro.salvarFundacao(f);
    return f;
  }
  function addFundacao() {
    lerFundacaoInputs();
    var f = OrcPro.lerFundacao();
    var tipo = ((document.getElementById("pro-fund-tipo") || {}).value || "sapatas");
    var comp = nz((document.getElementById("pro-fund-comp") || {}).value);
    var larg = nz((document.getElementById("pro-fund-larg") || {}).value);
    var alt = nz((document.getElementById("pro-fund-alt") || {}).value);
    var qtd = nz((document.getElementById("pro-fund-qtd") || {}).value) || 1;
    if (!(comp > 0) || !(larg > 0) || !(alt > 0)) { tost("Informe comprimento, largura e altura do elemento.", false); return; }
    f[tipo].push({ comp: comp, larg: larg, alt: alt, qtd: qtd });
    OrcPro.salvarFundacao(f);
    ["pro-fund-comp", "pro-fund-larg", "pro-fund-alt"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
    document.getElementById("pro-fund-lista").innerHTML = linhasFundacao();
    tost("Elemento adicionado.");
  }

  // ---------- Novo orçamento (isola dados técnicos) ----------
  function novoOrcamentoTecnico() {
    if (typeof OrcPro.iniciarNovoEscopo === "function") OrcPro.iniciarNovoEscopo();
    OrcPro.salvarMedicaoAtual(OrcPro.medicaoVazia());
    OrcPro.salvarFundacao(null);
    render();
    tost("Novo orçamento: medição e fundação zeradas.");
  }

  // ---------- Sincronização com a nuvem (offline-first) ----------
  function dadosLocaisPro() {
    return {
      catalogo: OrcPro.lerCatalogo(),
      cotacoes: OrcPro.lerCotacoes(),
      fornecedores: OrcPro.lerFornecedores(),
      obrasReais: OrcPro.lerObrasReais(),
      medicoes: OrcPro.lerMedicoes(),
    };
  }
  function mostrarSyncStatus() {
    var el = document.getElementById("pro-sync-status");
    if (!el) return;
    var quando = (typeof OrcProSync !== "undefined" && OrcProSync.ultima) ? OrcProSync.ultima() : null;
    el.textContent = quando
      ? "Última sincronização: " + new Date(quando).toLocaleString()
      : "Ainda não sincronizado. Os dados estão salvos neste aparelho.";
  }
  async function sincronizarPro(somenteBaixar) {
    if (typeof OrcProSync === "undefined") { tost("Nuvem indisponível nesta versão.", false); return; }
    var btn = document.querySelector('[data-pro="sincronizar"]');
    var btn2 = document.querySelector('[data-pro="sincronizar-baixar"]');
    if (btn) btn.disabled = true;
    if (btn2) btn2.disabled = true;
    try {
      if (!somenteBaixar) {
        var env = await OrcProSync.empurrarTudo(dadosLocaisPro());
        if (!env.ok) { tost(OrcProSync.mensagem(env), false); return; }
      }
      var pux = await OrcProSync.puxarTudo();
      if (!pux.ok) { tost(OrcProSync.mensagem(pux), false); return; }
      var d = pux.dados || {};
      OrcPro.salvarCatalogo(orcMesclarPorId(OrcPro.lerCatalogo(), d.catalogo));
      OrcPro.salvarCotacoes(orcMesclarPorId(OrcPro.lerCotacoes(), d.cotacoes));
      OrcPro.salvarFornecedores(orcMesclarPorId(OrcPro.lerFornecedores(), d.fornecedores));
      OrcPro.salvarObrasReais(orcMesclarPorId(OrcPro.lerObrasReais(), d.obrasReais));
      OrcPro.salvarMedicoes(orcMesclarPorId(OrcPro.lerMedicoes(), d.medicoes));
      render();
      tost("Dados do modo profissional sincronizados com a nuvem!");
    } catch (e) {
      tost("Falha ao sincronizar. Tente novamente.", false);
    } finally {
      if (btn) btn.disabled = false;
      if (btn2) btn2.disabled = false;
    }
  }

  // ---------- Cenários ----------
  function rodarCenarios() {
    var box = document.getElementById("pro-cenarios");
    if (!box) return;
    var base = calcularOrcamentoGuiado(lerEntradaOrcamentoGuiado());
    var fe = nz((document.getElementById("pro-fator-econ") || {}).value) / 100;
    var fc = nz((document.getElementById("pro-fator-cons") || {}).value) / 100;
    var cen = OrcPro.gerarCenarios(base, {
      fatorEcon: fe > 0 && fe !== 1 ? 1 - fe : 0,
      fatorCons: fc > 0 && fc !== 1 ? 1 + fc : 0,
    });
    if (cen.provavel == null) cen.provavel = base.total;
    var m = function (v) { return v == null ? "—" : (typeof moeda === "function" ? moeda(v) : ("R$ " + v)); };
    var h = '<p><strong>Provável (base):</strong> ' + m(base.total) + (base.semPreco ? ' <span class="pro-alerta">(parcial — ' + base.semPreco + ' sem preço)</span>' : '') + '</p>';
    h += '<p><strong>Econômico:</strong> ' + m(cen.economico) + ' • <strong>Conservador:</strong> ' + m(cen.conservador) + '</p>';
    h += '<p class="texto-suave">' + esc(cen.observacao) + '</p>';
    box.innerHTML = h;
  }

  // ---------- Auditoria com fonte de preço ----------
  function auditarPro() {
    var box = document.getElementById("pro-auditoria");
    if (!box) return;
    var base = calcularOrcamentoGuiado(lerEntradaOrcamentoGuiado());
    var cot = {};
    var cats = OrcPro.lerCatalogo();
    for (var i = 0; i < cats.length; i++) {
      var k = PRECO_POR_CODIGO[cats[i].codigo];
      if (!k) continue;
      var vig = OrcPro.precoVigente(cats[i].codigo);
      if (vig) cot[k] = vig;
    }
    var ext = OrcPro.auditoriaEstendida(base, { cotacoes: cot });
    var cst = (typeof resumoCustosOrcamento === "function") ? resumoCustosOrcamento(base, {}) : null;
    var h = "";
    if (cst) {
      var mm = function (v) { return (typeof moeda === "function" ? moeda(v) : ("R$ " + v)); };
      h += '<p><strong>Custo direto conhecido:</strong> ' + mm(cst.diretoConhecido) +
        ' <span class="texto-suave">(informado ' + mm(cst.diretoInformado) + ' + estimado ' + mm(cst.diretoEstimado) + ')</span>' +
        (cst.qtdSemPreco ? ' <span class="pro-alerta">— ' + cst.qtdSemPreco + ' item(ns) sem preço (total parcial)</span>' : '') + '</p>';
      h += '<p class="texto-suave">Com impostos/contingência/BDI informados no orçamento, o PREÇO DE VENDA é maior que este custo direto. Custo direto NÃO é preço final.</p>';
    }
    h += '<table class="aud-tabela"><thead><tr><th>Item</th><th>Preço</th><th>Fonte</th><th>Origem</th><th>Confiança</th></tr></thead><tbody>';
    for (var j = 0; j < ext.linhas.length; j++) {
      var l = ext.linhas[j];
      var cls = l.conf === 1 ? "aud-ok" : l.conf === 2 ? "aud-medio" : "aud-alerta";
      h += '<tr><td>' + esc(l.nome) + '</td><td>' + (l.preco ? (typeof moeda === "function" ? moeda(l.preco) : l.preco) : "sem preço") +
        '</td><td>' + esc(l.fontePreco) + '</td><td>' + esc(l.origem) + '</td><td><span class="aud-chip ' + cls + '">' +
        esc((typeof ORC_CONF !== "undefined" ? ORC_CONF[l.conf] : l.conf)) + '</span></td></tr>';
    }
    h += '</tbody></table>';
    box.innerHTML = h;
  }

  // ---------- Eventos ----------
  function aplicarCotacao() {
    var cod = (document.getElementById("pro-cot-cod") || {}).value;
    var k = PRECO_POR_CODIGO[cod];
    if (!k) { tost("Este material não tem campo de preço no orçamento guiado.", false); return; }
    var vig = OrcPro.precoVigente(cod);
    if (!vig) { tost("Sem cotação registrada para " + cod + ".", false); return; }
    var inp = document.querySelector('[data-og-preco="' + k + '"]');
    if (!inp) { tost("Campo de preço não encontrado.", false); return; }
    inp.value = vig.preco;
    tost("Preço aplicado: " + cod + " → " + k + " (" + OrcPro.ORC_TIPO_PRECO[vig.tipo] + ").");
  }

  function onClick(ev) {
    var t = ev.target.closest ? ev.target.closest("[data-pro]") : null;
    if (!t) return;
    var acao = t.getAttribute("data-pro");
    if (acao === "add-parede") { var m = coletarMedicao(); m.paredes.push({ id: "p" + (m.paredes.length + 1), comp: null, alt: null, faces: 2, aberturas: [] }); salvarMedicao(m); render(); }
    else if (acao === "add-ambiente") { var m2 = coletarMedicao(); m2.ambientes.push({ nome: "Ambiente " + (m2.ambientes.length + 1), larg: null, comp: null, alt: null, paredes: [] }); salvarMedicao(m2); render(); }
    else if (acao === "del-parede") { var m3 = coletarMedicao(); m3.paredes.splice(Number(t.getAttribute("data-i")), 1); salvarMedicao(m3); render(); }
    else if (acao === "del-ambiente") { var m4 = coletarMedicao(); m4.ambientes.splice(Number(t.getAttribute("data-i")), 1); salvarMedicao(m4); render(); }
    else if (acao === "salvar-medicao") { var m5 = coletarMedicao(); salvarMedicao(m5); render(); tost("Medição salva. Agora toque em Calcular."); }
    else if (acao === "limpar-medicao") { salvarMedicao(OrcPro.medicaoVazia()); render(); tost("Medição limpa."); }
    else if (acao === "cenarios") { rodarCenarios(); }
    else if (acao === "add-cot") { addCotacao(); }
    else if (acao === "aplicar-cot") { aplicarCotacao(); }
    else if (acao === "add-real") { addObraReal(); }
    else if (acao === "auditoria-pro") { auditarPro(); }
    else if (acao === "add-fund") { addFundacao(); }
    else if (acao === "novo-orcamento") { novoOrcamentoTecnico(); }
    else if (acao === "sincronizar") { sincronizarPro(false); }
    else if (acao === "sincronizar-baixar") { sincronizarPro(true); }
    else if (acao === "del-fund") {
      lerFundacaoInputs();
      var ff = OrcPro.lerFundacao();
      var tp = t.getAttribute("data-tipo");
      ff[tp].splice(Number(t.getAttribute("data-i")), 1);
      OrcPro.salvarFundacao(ff);
      document.getElementById("pro-fund-lista").innerHTML = linhasFundacao();
      tost("Elemento removido.");
    }
    else if (acao === "ia-orcamento") { if (typeof window.iaOrcamentoPro === "function") window.iaOrcamentoPro(); else tost("IA indisponível.", false); }
  }
  function addCotacao() {
    var g = function (id) { return ((document.getElementById(id) || {}).value || ""); };
    var r = OrcPro.adicionarCotacao({
      codigo: g("pro-cot-cod"), fornecedor: g("pro-cot-forn"), preco: g("pro-cot-preco"),
      unidade: g("pro-cot-un"), tipo: g("pro-cot-tipo"),
    });
    if (!r.ok) { tost(r.motivo, false); return; }
    document.getElementById("pro-cot-preco").value = "";
    document.getElementById("pro-cot-forn").value = "";
    desenharCotacoes();
    tost("Cotação registrada.");
  }
  function addObraReal() {
    var g = function (id) { return ((document.getElementById(id) || {}).value || ""); };
    var r = OrcPro.salvarObraReal({
      nome: g("pro-real-nome"), custoPrevisto: g("pro-real-cp"), custoRealizado: g("pro-real-cr"),
    });
    if (!r.ok) { tost("Informe o item.", false); return; }
    document.getElementById("pro-real-nome").value = "";
    document.getElementById("pro-real-cp").value = "";
    document.getElementById("pro-real-cr").value = "";
    desenharObrasReais();
    tost("Registro de obra real salvo.");
  }

  function onChange(ev) {
    if (ev.target && ev.target.name === "pro-modo") { setModo(ev.target.value); }
  }
  // Atualiza o resumo enquanto digita (sem salvar).
  function onInput(ev) {
    if (!ev.target || !ev.target.closest) return;
    if (ev.target.closest("#pro-paredes") || ev.target.closest("#pro-ambientes")) {
      var box = document.getElementById("pro-resumo");
      if (box) box.innerHTML = resumoMedicao(OrcPro.calcularMedicaoObra(coletarMedicao()));
    }
  }

  function ligar() {
    var box = document.getElementById("orc-pro-panel");
    if (!box || box.dataset.ligado) return;
    box.dataset.ligado = "1";
    box.addEventListener("click", onClick);
    box.addEventListener("change", onChange);
    box.addEventListener("input", onInput);
  }

  function iniciar() {
    if (typeof window.OrcPro === "undefined") return;
    if (!document.getElementById("orc-pro-panel")) {
      // Cria o container logo após os dados da casa, se a tela existir.
      var anchor = document.getElementById("og-preencher-teste");
      var host = anchor ? anchor.closest(".card") : null;
      if (host && host.parentNode) {
        var div = document.createElement("div");
        div.id = "orc-pro-panel";
        host.parentNode.insertBefore(div, host.nextSibling);
      }
    }
    if (document.getElementById("orc-pro-panel")) { render(); ligar(); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
  // Reprocessa ao trocar para a tela de orçamento (se a SPA expõe isso).
  window.addEventListener("hashchange", function () { setTimeout(iniciar, 60); });
  window.OrcProUI = { render: render, iniciar: iniciar, parseVaosTexto: parseVaosTexto, coletarMedicao: coletarMedicao, fundacaoParaMotor: fundacaoParaMotor, sincronizarPro: sincronizarPro, dadosLocaisPro: dadosLocaisPro };
})();
