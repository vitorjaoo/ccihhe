// ═══════════════════════════════════════════════════════════
//  CCIH · Sistema de Rastreio de Infecção Hospitalar
//  script.js — Lógica SPA completa
// ═══════════════════════════════════════════════════════════

// ── Estado Global ─────────────────────────────────────────
const State = {
  nivel: null,
  setorId: null,
  nomePac: null,
  pacienteId: null,
  pacientes: [],
  setores: [],
  procedimentos: [],
};

// ── Inicialização ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const pageApp = document.getElementById('page-app');
  if (pageApp && !pageApp.classList.contains('hidden')) {
    initApp();
  }
  // Set today on date inputs
  const hoje = new Date().toISOString().split('T')[0];
  const regData = document.getElementById('reg-data');
  if (regData) regData.value = hoje;
  // Enter key on login
  document.getElementById('login-senha')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
});

async function initApp() {
  // Lê dados do servidor via atributos da página (já injetados)
  // Mas vamos buscar via API para garantir dados frescos
  try {
    const res = await fetch('/api/setores');
    State.setores = await res.json();
    const procRes = await fetch('/api/procedimentos/lista');
    State.procedimentos = await procRes.json();
  } catch(e) {}

  // Detecta nível pela presença do elemento
  const navNome = document.getElementById('nav-nome');
  const navSetor = document.getElementById('nav-setor');
  // Pega do cookie/session via meta (vamos checar via uma rota simples)
  await detectUserLevel();
}

async function detectUserLevel() {
  // Faz um request a uma rota que só admin acessa para detectar nível
  try {
    const res = await fetch('/api/dashboard');
    if (res.ok) {
      State.nivel = 'admin';
      setupAdmin();
      return;
    }
  } catch(e) {}
  // Se não é admin, é estagiário
  State.nivel = 'estagiario';
  // Pega setor_id do elemento nav
  setupEstagiario();
}

// ── LOGIN ──────────────────────────────────────────────────
async function doLogin() {
  const nome = document.getElementById('login-nome').value.trim();
  const senha = document.getElementById('login-senha').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  if (!nome || !senha) {
    errEl.textContent = 'Preencha todos os campos.';
    errEl.classList.remove('hidden');
    return;
  }
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({nome, senha})
    });
    const data = await res.json();
    if (res.ok) {
      window.location.reload();
    } else {
      errEl.textContent = data.error || 'Erro ao entrar.';
      errEl.classList.remove('hidden');
    }
  } catch(e) {
    errEl.textContent = 'Erro de conexão.';
    errEl.classList.remove('hidden');
  }
}

async function doLogout() {
  await fetch('/api/logout', {method:'POST'});
  window.location.href = '/';
}

// ── SETUP ADMIN ────────────────────────────────────────────
async function setupAdmin() {
  document.getElementById('view-admin').classList.remove('hidden');
  document.getElementById('view-estagiario').classList.add('hidden');
  document.getElementById('nav-nome').textContent = 'Admin';
  document.getElementById('nav-avatar').textContent = 'A';
  document.getElementById('nav-setor').textContent = 'Administrador';
  await Promise.all([loadDashboard(), loadSetores(), loadUsuarios()]);
}

async function loadDashboard() {
  const res = await fetch('/api/dashboard');
  const data = await res.json();
  document.getElementById('dash-pacientes').textContent = data.total_pacientes;
  document.getElementById('dash-proc').textContent = data.total_proc_ativos;
  document.getElementById('dash-transf').textContent = data.total_transferencias_pendentes;

  const maxVal = Math.max(...data.setores.map(s => s.total), 1);
  document.getElementById('dash-setores').innerHTML = data.setores.map(s => `
    <div class="flex items-center gap-3">
      <span class="text-sm text-slate-600 w-36 truncate">${s.nome}</span>
      <div class="flex-1 bg-slate-100 rounded-full h-2">
        <div class="h-2 rounded-full" style="width:${Math.round((s.total/maxVal)*100)}%;background:var(--c-primary);"></div>
      </div>
      <span class="text-sm font-semibold text-slate-700 w-6 text-right">${s.total}</span>
    </div>
  `).join('');
}

async function loadSetores() {
  const res = await fetch('/api/setores');
  State.setores = await res.json();
  document.getElementById('lista-setores').innerHTML = State.setores.map(s => `
    <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full" style="background:var(--c-primary);"></div>
        <span class="font-medium text-slate-700">${s.nome}</span>
      </div>
      <button onclick="deletarSetor(${s.id})" class="btn btn-danger btn-sm">Remover</button>
    </div>
  `).join('') || '<p class="text-sm text-slate-400">Nenhum setor cadastrado.</p>';

  // Popula selects
  const sel = document.getElementById('m-usr-setor');
  if (sel) {
    sel.innerHTML = State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
  }
}

async function loadUsuarios() {
  const res = await fetch('/api/usuarios');
  const users = await res.json();
  const nivelLabel = {admin:'Administrador', estagiario:'Estagiário'};
  document.getElementById('lista-usuarios').innerHTML = users.map(u => `
    <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
      <div>
        <div class="font-semibold text-slate-700">${u.nome}</div>
        <div class="text-xs text-slate-400">${nivelLabel[u.nivel_acesso] || u.nivel_acesso}${u.setor_nome ? ' · '+u.setor_nome : ''}</div>
      </div>
      <button onclick="deletarUsuario(${u.id})" class="btn btn-danger btn-sm">Remover</button>
    </div>
  `).join('') || '<p class="text-sm text-slate-400">Nenhum usuário.</p>';
}

async function criarSetor() {
  const nome = document.getElementById('m-setor-nome').value.trim();
  if (!nome) { showToast('Informe o nome do setor.', 'error'); return; }
  const res = await fetch('/api/setores', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({nome})
  });
  if (res.ok) {
    showToast('Setor criado!');
    closeModal('modal-setor');
    document.getElementById('m-setor-nome').value = '';
    await Promise.all([loadDashboard(), loadSetores()]);
  } else {
    const d = await res.json();
    showToast(d.error || 'Erro', 'error');
  }
}

async function deletarSetor(id) {
  if (!confirm('Remover este setor?')) return;
  await fetch(`/api/setores/${id}`, {method:'DELETE'});
  showToast('Setor removido.');
  loadSetores(); loadDashboard();
}

async function criarUsuario() {
  const payload = {
    nome: document.getElementById('m-usr-nome').value.trim(),
    nivel_acesso: document.getElementById('m-usr-nivel').value,
    setor_id: document.getElementById('m-usr-setor').value || null,
    senha: document.getElementById('m-usr-senha').value
  };
  if (!payload.nome || !payload.senha) { showToast('Preencha todos os campos.', 'error'); return; }
  const res = await fetch('/api/usuarios', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
  });
  if (res.ok) {
    showToast('Usuário criado!');
    closeModal('modal-usuario');
    loadUsuarios();
  } else {
    showToast('Erro ao criar usuário.', 'error');
  }
}

async function deletarUsuario(id) {
  if (!confirm('Remover este usuário?')) return;
  await fetch(`/api/usuarios/${id}`, {method:'DELETE'});
  showToast('Usuário removido.');
  loadUsuarios();
}

function toggleSetorField() {
  const nivel = document.getElementById('m-usr-nivel').value;
  document.getElementById('m-setor-field').style.display = nivel === 'estagiario' ? 'block' : 'none';
}

// ── SETUP ESTAGIÁRIO ───────────────────────────────────────
async function setupEstagiario() {
  document.getElementById('view-estagiario').classList.remove('hidden');
  document.getElementById('view-admin').classList.add('hidden');

  // Pega info do nav
  const navNome = document.getElementById('nav-nome');
  // Já populado pelo servidor via template (ou busca via session)
  // Detecta setor_id da URL ou session
  await loadUserInfo();
  await loadPacientes();
  await loadTransferenciasEstagiario();
  populateTransfDestino();
}

async function loadUserInfo() {
  // Detecta o setor pelo primeiro paciente ou via endpoint especial
  // Usa o dashboard endpoint para pegar info — mas já temos via template
  // Vamos usar uma abordagem: o setor está na session, enviamos via meta ou outro endpoint
  // Para não complicar, buscamos setores e o nome do nav
  try {
    const res = await fetch('/api/setores');
    State.setores = await res.json();
  } catch(e) {}
}

// ── PACIENTES ──────────────────────────────────────────────
async function loadPacientes() {
  document.getElementById('loading-pacientes').classList.remove('hidden');
  document.getElementById('lista-pacientes').innerHTML = '';
  document.getElementById('empty-pacientes').classList.add('hidden');
  try {
    const res = await fetch('/api/pacientes');
    State.pacientes = await res.json();
    renderPacientes();
    populateGestaoSelect();
    populateTransfPac();
  } catch(e) {
    showToast('Erro ao carregar pacientes.', 'error');
  } finally {
    document.getElementById('loading-pacientes').classList.add('hidden');
  }
}

function renderPacientes() {
  const lista = document.getElementById('lista-pacientes');
  const empty = document.getElementById('empty-pacientes');
  if (!State.pacientes.length) { empty.classList.remove('hidden'); return; }

  const hoje = new Date();
  lista.innerHTML = State.pacientes.map(p => {
    // Calcula alertas de procedimentos
    const alertas = [];
    p.procedimentos_ativos?.forEach(proc => {
      if (proc.data_insercao) {
        const dias = calcDias(proc.data_insercao);
        if (dias >= 7) alertas.push({tipo: proc.tipo_procedimento, dias});
      }
    });

    const temAlerta = alertas.length > 0;
    const sexoLabel = {M:'Masculino', F:'Feminino', O:'Outro'}[p.sexo] || p.sexo;

    return `
    <div class="card pac-card p-4 fade-in ${temAlerta ? 'border-l-4 border-red-400' : ''}" onclick="selecionarPacienteGestao(${p.id})">
      <div class="flex items-start gap-3">
        <div class="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
             style="background: linear-gradient(135deg, ${temAlerta?'#ef4444,#dc2626':'var(--c-primary),#0ea5e9'});">
          ${p.nome.charAt(0).toUpperCase()}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="font-bold text-slate-800 truncate">${p.nome}</h4>
            ${temAlerta ? `<span class="badge badge-red pulse-dot"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg>Alerta</span>` : ''}
          </div>
          <div class="flex flex-wrap gap-2 mt-1.5">
            <span class="badge badge-blue">Leito ${p.leito || '—'}</span>
            <span class="badge badge-green">${p.idade || '—'} anos</span>
            ${p.procedimentos_ativos?.length ? `<span class="badge badge-yellow">${p.procedimentos_ativos.length} procedimento(s)</span>` : ''}
          </div>
          ${alertas.length ? `
          <div class="mt-2 space-y-1">
            ${alertas.map(a => `
              <div class="text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1 border border-red-100 truncate">
                ⚠ ${a.tipo} — ${a.dias} dias de uso
              </div>
            `).join('')}
          </div>` : ''}
        </div>
        <svg class="text-slate-300 flex-shrink-0 mt-1" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
      </div>
    </div>`;
  }).join('');
}

function populateGestaoSelect() {
  const sel = document.getElementById('gestao-pac-select');
  sel.innerHTML = '<option value="">— escolha um paciente —</option>' +
    State.pacientes.map(p => `<option value="${p.id}">${p.nome} (Leito ${p.leito||'—'})</option>`).join('');
}

function populateTransfPac() {
  const sel = document.getElementById('transf-pac');
  sel.innerHTML = '<option value="">— selecione —</option>' +
    State.pacientes.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
}

function selecionarPacienteGestao(pacId) {
  showTab('gestao', document.querySelector('[data-tab="gestao"]'));
  document.getElementById('gestao-pac-select').value = pacId;
  loadGestao(pacId);
}

// ── GESTÃO DO PACIENTE ────────────────────────────────────
async function loadGestao(pacId) {
  if (!pacId) {
    document.getElementById('gestao-content').classList.add('hidden');
    return;
  }
  State.pacienteId = pacId;
  document.getElementById('gestao-content').classList.remove('hidden');

  try {
    const res = await fetch(`/api/pacientes/${pacId}`);
    const pac = await res.json();
    renderGestao(pac);
  } catch(e) {
    showToast('Erro ao carregar paciente.', 'error');
  }
}

function renderGestao(pac) {
  document.getElementById('g-avatar').textContent = pac.nome.charAt(0).toUpperCase();
  document.getElementById('g-nome').textContent = pac.nome;
  document.getElementById('g-leito').textContent = `Leito ${pac.leito || '—'}`;
  document.getElementById('g-idade').textContent = `${pac.idade || '—'} anos`;
  document.getElementById('g-pront').textContent = `Pront. ${pac.prontuario || '—'}`;

  renderProcedimentos(pac.procedimentos || []);
  renderHistoricoTemp(pac.registros || []);
}

// ── PROCEDIMENTOS ──────────────────────────────────────────
function renderProcedimentos(procsSalvos) {
  const lista = document.getElementById('lista-proc');

  lista.innerHTML = State.procedimentos.map(tipoPROC => {
    const saved = procsSalvos.find(p => p.tipo_procedimento === tipoPROC && p.status === 'ativo');
    const isAtivo = !!saved;
    const idToggle = `proc-${tipoPROC.replace(/\s+/g,'_')}`;

    return `
    <div class="proc-row ${isAtivo ? 'active-proc' : ''} pb-3 border-b border-slate-100 last:border-0" id="row-${idToggle}">
      <div class="toggle-wrap">
        <label class="toggle">
          <input type="checkbox" id="${idToggle}" ${isAtivo ? 'checked' : ''}
                 onchange="onProcToggle('${tipoPROC}', '${idToggle}', ${saved ? saved.id : 'null'}, this.checked)"/>
          <span class="toggle-slider"></span>
        </label>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-slate-700 leading-snug">${capitalizeFirst(tipoPROC)}</p>
          ${isAtivo && saved.data_insercao ? `
            <div class="flex items-center gap-2 mt-1">
              <span class="text-xs text-slate-400">Inserção: ${formatDate(saved.data_insercao)}</span>
              <span class="dias-counter text-sm ${getDiasClass(calcDias(saved.data_insercao))}" id="dias-${idToggle}">
                ${calcDias(saved.data_insercao)}d
              </span>
            </div>` : ''}
        </div>
      </div>
      <div id="fields-${idToggle}" class="${isAtivo ? 'hidden' : 'hidden'} mt-3 ml-16 space-y-2">
        <div class="date-insercao ${isAtivo ? 'hidden' : ''}">
          <label class="block text-xs font-medium text-slate-500 mb-1">Data de Inserção</label>
          <input type="date" class="inp" style="font-size:.875rem;padding:.6rem .875rem;"
                 id="date-ins-${idToggle}" max="${new Date().toISOString().split('T')[0]}"
                 oninput="updateDiasDisplay('${idToggle}', this.value)"/>
          <div id="dias-preview-${idToggle}" class="hidden mt-2 p-2 rounded-xl bg-teal-50 border border-teal-100 text-center">
            <span class="text-xs text-teal-600 font-medium">Dias de uso: </span>
            <span class="dias-counter text-lg" id="dias-num-${idToggle}">0</span>
          </div>
          <button onclick="ativarProcedimento('${tipoPROC}', '${idToggle}')" class="btn btn-primary btn-sm mt-2 w-full">Confirmar Inserção</button>
        </div>
        <div class="date-remocao ${isAtivo ? '' : 'hidden'}">
          <label class="block text-xs font-medium text-slate-500 mb-1">Data de Remoção</label>
          <input type="date" class="inp" style="font-size:.875rem;padding:.6rem .875rem;"
                 id="date-rem-${idToggle}" max="${new Date().toISOString().split('T')[0]}"
                 value="${new Date().toISOString().split('T')[0]}"/>
          <button onclick="removerProcedimento(${saved ? saved.id : 'null'}, '${idToggle}')" class="btn btn-danger btn-sm mt-2 w-full">Confirmar Remoção</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Inicia os campos corretos para itens já ativos
  procsSalvos.filter(p => p.status === 'ativo').forEach(saved => {
    const idToggle = `proc-${saved.tipo_procedimento.replace(/\s+/g,'_')}`;
    const fieldsDiv = document.getElementById(`fields-${idToggle}`);
    if (fieldsDiv) {
      fieldsDiv.classList.remove('hidden');
      const ins = fieldsDiv.querySelector('.date-insercao');
      const rem = fieldsDiv.querySelector('.date-remocao');
      if (ins) ins.classList.add('hidden');
      if (rem) rem.classList.remove('hidden');
    }
  });
}

function onProcToggle(tipo, idToggle, savedId, isChecked) {
  const row = document.getElementById(`row-${idToggle}`);
  const fieldsDiv = document.getElementById(`fields-${idToggle}`);
  const insDiv = fieldsDiv?.querySelector('.date-insercao');
  const remDiv = fieldsDiv?.querySelector('.date-remocao');

  if (isChecked) {
    // Ativando: mostra campo de data de inserção
    row.classList.add('active-proc');
    fieldsDiv?.classList.remove('hidden');
    insDiv?.classList.remove('hidden');
    remDiv?.classList.add('hidden');
    // Foca no input de data
    document.getElementById(`date-ins-${idToggle}`)?.focus();
  } else {
    // Desativando: mostra campo de data de remoção (se tinha id)
    row.classList.remove('active-proc');
    if (savedId && savedId !== 'null') {
      fieldsDiv?.classList.remove('hidden');
      insDiv?.classList.add('hidden');
      remDiv?.classList.remove('hidden');
    } else {
      fieldsDiv?.classList.add('hidden');
    }
    document.getElementById(`dias-${idToggle}`)?.remove();
  }
}

function updateDiasDisplay(idToggle, dateVal) {
  if (!dateVal) return;
  const dias = calcDias(dateVal);
  const preview = document.getElementById(`dias-preview-${idToggle}`);
  const diasNum = document.getElementById(`dias-num-${idToggle}`);
  if (preview && diasNum) {
    preview.classList.remove('hidden');
    diasNum.textContent = dias;
    diasNum.className = `dias-counter text-lg ${getDiasClass(dias)}`;
  }
}

async function ativarProcedimento(tipo, idToggle) {
  const dataIns = document.getElementById(`date-ins-${idToggle}`)?.value;
  if (!dataIns) { showToast('Selecione a data de inserção.', 'error'); return; }
  const res = await fetch('/api/procedimentos', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      paciente_id: State.pacienteId,
      tipo_procedimento: tipo,
      data_insercao: dataIns
    })
  });
  if (res.ok) {
    showToast('Procedimento registrado!');
    loadGestao(State.pacienteId);
  } else {
    const d = await res.json();
    showToast(d.error || 'Erro', 'error');
  }
}

async function removerProcedimento(procId, idToggle) {
  if (!procId || procId === 'null') { showToast('Erro: procedimento não encontrado.', 'error'); return; }
  const dataRem = document.getElementById(`date-rem-${idToggle}`)?.value || new Date().toISOString().split('T')[0];
  const res = await fetch(`/api/procedimentos/${procId}/remover`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({data_remocao: dataRem})
  });
  if (res.ok) {
    showToast('Procedimento removido.');
    loadGestao(State.pacienteId);
  } else {
    showToast('Erro ao remover.', 'error');
  }
}

// ── REGISTRO DIÁRIO ────────────────────────────────────────
async function salvarRegistro() {
  const data = document.getElementById('reg-data').value;
  const temp = document.getElementById('reg-temp').value;
  if (!data) { showToast('Informe a data.', 'error'); return; }
  if (!State.pacienteId) { showToast('Selecione um paciente.', 'error'); return; }
  const res = await fetch('/api/registros', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({paciente_id: State.pacienteId, data, temperatura: temp || null})
  });
  if (res.ok) {
    showToast('Registro salvo!');
    document.getElementById('reg-temp').value = '';
    loadGestao(State.pacienteId);
  } else {
    showToast('Erro ao salvar.', 'error');
  }
}

function renderHistoricoTemp(registros) {
  const el = document.getElementById('hist-temp-list');
  const card = document.getElementById('card-historico');
  if (!registros.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  el.innerHTML = registros.map(r => {
    const temp = parseFloat(r.temperatura);
    const isFebre = temp >= 37.8;
    return `
    <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
      <span class="text-sm text-slate-600">${formatDate(r.data)}</span>
      <div class="flex items-center gap-2">
        <span class="font-mono text-sm font-semibold ${isFebre ? 'text-red-500' : 'text-teal-600'}">${temp ? temp.toFixed(1)+'°C' : '—'}</span>
        ${isFebre ? '<span class="badge badge-red text-xs">Febre</span>' : ''}
      </div>
    </div>`;
  }).join('');
}

// ── CADASTRO ───────────────────────────────────────────────
async function cadastrarPaciente() {
  const nome = document.getElementById('cad-nome').value.trim();
  const errEl = document.getElementById('cad-error');
  errEl.classList.add('hidden');
  if (!nome) {
    errEl.textContent = 'Informe o nome do paciente.';
    errEl.classList.remove('hidden');
    return;
  }
  const payload = {
    nome,
    idade: document.getElementById('cad-idade').value || null,
    sexo: document.getElementById('cad-sexo').value || null,
    leito: document.getElementById('cad-leito').value.trim() || null,
    prontuario: document.getElementById('cad-prontuario').value.trim() || null,
    fone: document.getElementById('cad-fone').value.trim() || null,
  };
  const res = await fetch('/api/pacientes', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
  });
  if (res.ok) {
    showToast('Paciente cadastrado!');
    ['cad-nome','cad-idade','cad-sexo','cad-leito','cad-prontuario','cad-fone'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    await loadPacientes();
    showTab('pacientes', document.querySelector('[data-tab="pacientes"]'));
  } else {
    errEl.textContent = 'Erro ao cadastrar.';
    errEl.classList.remove('hidden');
  }
}

// ── ALTA ───────────────────────────────────────────────────
async function darAlta() {
  if (!State.pacienteId) return;
  const pac = State.pacientes.find(p => p.id == State.pacienteId);
  if (!confirm(`Dar alta para ${pac?.nome || 'o paciente'}?`)) return;
  const res = await fetch(`/api/pacientes/${State.pacienteId}/alta`, {method:'POST'});
  if (res.ok) {
    showToast('Alta registrada!');
    document.getElementById('gestao-content').classList.add('hidden');
    document.getElementById('gestao-pac-select').value = '';
    State.pacienteId = null;
    await loadPacientes();
    showTab('pacientes', document.querySelector('[data-tab="pacientes"]'));
  }
}

// ── TRANSFERÊNCIAS ─────────────────────────────────────────
function populateTransfDestino() {
  const sel = document.getElementById('transf-destino');
  sel.innerHTML = '<option value="">— selecione o destino —</option>' +
    State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
}

async function criarTransferencia() {
  const pacId = document.getElementById('transf-pac').value;
  const destId = document.getElementById('transf-destino').value;
  if (!pacId || !destId) { showToast('Selecione paciente e destino.', 'error'); return; }
  const res = await fetch('/api/transferencias', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({paciente_id: parseInt(pacId), setor_destino_id: parseInt(destId)})
  });
  if (res.ok) {
    showToast('Transferência solicitada!');
    document.getElementById('transf-pac').value = '';
    document.getElementById('transf-destino').value = '';
  } else {
    showToast('Erro ao transferir.', 'error');
  }
}

async function loadTransferenciasEstagiario() {
  try {
    const res = await fetch('/api/transferencias/pendentes');
    const lista = await res.json();
    renderTransferenciasPendentes(lista);
    // Notificações
    const navNotif = document.getElementById('nav-notif');
    const notifCount = document.getElementById('notif-count');
    const tabBadge = document.getElementById('tab-notif-badge');
    if (lista.length > 0) {
      navNotif.classList.remove('hidden');
      notifCount.textContent = lista.length;
      tabBadge.textContent = lista.length;
      tabBadge.style.display = 'inline-flex';
    } else {
      navNotif.classList.add('hidden');
      tabBadge.style.display = 'none';
    }
  } catch(e) {}
}

function renderTransferenciasPendentes(lista) {
  const el = document.getElementById('lista-pendentes');
  if (!lista.length) {
    el.innerHTML = '<p class="text-sm text-slate-400 p-3">Nenhuma transferência pendente.</p>';
    return;
  }
  el.innerHTML = lista.map(t => `
    <div class="card p-4 border-l-4 border-amber-400 fade-in">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="font-bold text-slate-800">${t.paciente_nome}</p>
          <p class="text-sm text-slate-500 mt-0.5">
            De: <span class="text-slate-700 font-medium">${t.setor_origem_nome}</span>
          </p>
          <p class="text-xs text-slate-400 mt-1">${formatDate(t.data_solicitacao)}</p>
        </div>
        <button onclick="aceitarTransferencia(${t.id})" class="btn btn-primary btn-sm flex-shrink-0">
          ✓ Aceitar
        </button>
      </div>
    </div>
  `).join('');
}

async function aceitarTransferencia(id) {
  const res = await fetch(`/api/transferencias/${id}/aceitar`, {method:'POST'});
  if (res.ok) {
    showToast('Transferência aceita! Paciente recebido.');
    await loadPacientes();
    await loadTransferenciasEstagiario();
  } else {
    showToast('Erro ao aceitar.', 'error');
  }
}

// ── TABS ───────────────────────────────────────────────────
function showTab(tabName, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  const tab = document.getElementById(`tab-${tabName}`);
  if (tab) tab.classList.add('active');
  if (btn) btn.classList.add('active');
  else {
    const targetBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (targetBtn) targetBtn.classList.add('active');
  }
  if (tabName === 'transferencias') {
    loadTransferenciasEstagiario();
    populateTransfDestino();
    populateTransfPac();
  }
}

// ── MODAIS ─────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
  document.body.style.overflow = '';
}

// ── TOAST ──────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#0d9488';
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── HELPERS ────────────────────────────────────────────────
function calcDias(dateStr) {
  if (!dateStr) return 0;
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  const ins = new Date(dateStr + 'T00:00:00');
  return Math.max(0, Math.floor((hoje - ins) / 86400000));
}

function getDiasClass(dias) {
  if (dias >= 14) return 'dias-danger';
  if (dias >= 7) return 'dias-warning';
  return 'dias-ok';
}

function formatDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
