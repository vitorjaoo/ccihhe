const U = window.USER;
let currentPacienteId = null;
let auxData = { setores: [], procedimentos: [] };

document.addEventListener('DOMContentLoaded', () => {
  if(U && U.nivel) init();
});

async function api(url, method='GET', body=null) {
  const opt = { method, headers: {'Content-Type': 'application/json'} };
  if(body) opt.body = JSON.stringify(body);
  const res = await fetch(url, opt);
  const data = await res.json();
  if(!res.ok) { showToast(data.error || 'Erro', true); throw data; }
  return data;
}

async function init() {
  document.getElementById('nav-user').textContent = `${U.nome} (${U.nivel.toUpperCase()})`;
  
  // Ocultar ações de escrita se for Espectador
  if(U.nivel === 'espectador') {
    document.querySelectorAll('.write-only').forEach(el => el.style.display = 'none');
  }

  // Admin e Espectador iniciam no Dashboard. Estagiario em Pacientes.
  if(U.nivel === 'admin' || U.nivel === 'espectador') {
    document.getElementById('cad-p-setor').classList.remove('hidden');
    mudarAba('dashboard');
  } else {
    document.getElementById('btn-dashboard').style.display = 'none';
    mudarAba('pacientes');
  }

  auxData = await api('/api/auxiliares');
  const selSetores = auxData.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
  document.getElementById('cad-p-setor').innerHTML = selSetores;
  document.getElementById('cad-u-setor').innerHTML = selSetores;
}

function mudarAba(aba) {
  document.querySelectorAll('.aba-conteudo').forEach(e => e.classList.add('hidden'));
  document.getElementById('tela-paciente').classList.add('hidden');
  document.querySelectorAll('.aba-btn').forEach(e => { e.classList.remove('text-teal-600','border-b-2','border-teal-600'); e.classList.add('text-slate-400'); });
  
  document.getElementById(`aba-${aba}`).classList.remove('hidden');
  document.getElementById(`btn-${aba}`).classList.add('text-teal-600','border-b-2','border-teal-600');
  
  if(aba === 'dashboard') loadRelatorios();
  if(aba === 'pacientes') loadPacientes();
}

// ── LÓGICA DASHBOARD & FÓRMULAS ──
async function loadRelatorios() {
  const r = await api('/api/dashboard/relatorios');
  const html = `
    <div class="card bg-slate-800 text-white text-center"><p class="text-xs text-slate-300">Taxa Geral IH</p><h4 class="text-2xl font-bold">${r.taxa_geral}</h4></div>
    <div class="card text-center"><p class="text-xs text-slate-500">Urinário</p><h4 class="text-xl font-bold text-teal-700">${r.taxa_urinario}%</h4></div>
    <div class="card text-center"><p class="text-xs text-slate-500">Sangue/Sepse</p><h4 class="text-xl font-bold text-red-600">${r.taxa_sepse}%</h4></div>
    <div class="card text-center"><p class="text-xs text-slate-500">Pneumonia</p><h4 class="text-xl font-bold text-amber-600">${r.taxa_pneumonia}%</h4></div>
    <div class="card text-center"><p class="text-xs text-slate-500">Cirúrgica</p><h4 class="text-xl font-bold text-teal-700">${r.taxa_cirurgica}%</h4></div>
    <div class="card text-center"><p class="text-xs text-slate-500">Sepse por Cateter</p><h4 class="text-xl font-bold text-red-600">${r.taxa_septicemia_cateter}%</h4></div>
    <div class="card text-center"><p class="text-xs text-slate-500">IH Respiradores</p><h4 class="text-xl font-bold text-amber-600">${r.taxa_ih_respiradores}%</h4></div>
    <div class="card text-center"><p class="text-xs text-slate-500">IH Sonda Vesical</p><h4 class="text-xl font-bold text-teal-700">${r.taxa_sonda_vesical}%</h4></div>
  `;
  document.getElementById('cards-relatorio').innerHTML = html;
}

// ── LÓGICA PACIENTES ──
async function loadPacientes() {
  const pacs = await api('/api/pacientes');
  const lista = document.getElementById('lista-pacientes');
  if(!pacs.length) { lista.innerHTML = '<p class="text-slate-400">Nenhum paciente ativo.</p>'; return; }
  
  lista.innerHTML = pacs.map(p => {
    const isRisco = p.procedimentos_ativos.length > 0 || p.infeccoes.length > 0;
    return `
    <div class="card p-4 flex justify-between items-center cursor-pointer hover:shadow-lg transition border-l-4 ${isRisco ? 'border-red-400' : 'border-teal-400'}" onclick="abrirPaciente(${JSON.stringify(p).split('"').join('&quot;')})">
      <div>
        <h4 class="font-bold text-slate-800">${p.nome}</h4>
        <span class="text-xs text-slate-500">${U.nivel!=='estagiario' ? p.setor_nome + ' · ' : ''}Leito ${p.leito}</span>
      </div>
      <div class="text-right">
        ${p.infeccoes.length > 0 ? `<span class="badge badge-danger bg-red-100 text-red-700 mr-1">Infectado</span>` : ''}
        <span class="badge ${p.procedimentos_ativos.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-teal-100 text-teal-700'}">${p.procedimentos_ativos.length} Procs</span>
      </div>
    </div>
  `}).join('');
}

function abrirPaciente(p) {
  currentPacienteId = p.id;
  document.querySelectorAll('.aba-conteudo').forEach(e => e.classList.add('hidden'));
  document.getElementById('tela-paciente').classList.remove('hidden');
  
  document.getElementById('det-nome').textContent = p.nome;
  document.getElementById('det-info').textContent = `${p.idade} anos · Leito ${p.leito} · Prontuário: ${p.prontuario || 'N/A'}`;
  
  const hoje = new Date();
  document.getElementById('lista-procedimentos').innerHTML = auxData.procedimentos.map(proc => {
    const ativo = p.procedimentos_ativos.find(x => x.tipo_procedimento === proc);
    let diasStr = '';
    if(ativo) {
      const ms = hoje - new Date(ativo.data_insercao + 'T00:00:00');
      const dias = Math.max(0, Math.floor(ms/86400000));
      diasStr = `<span class="text-xs font-bold ${dias >= 7 ? 'text-red-500' : 'text-slate-400'}">(${dias} dias)</span>`;
    }
    const dis = U.nivel === 'espectador' ? 'disabled' : '';
    return `
      <div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
        <span class="text-sm font-medium ${ativo?'text-teal-700 font-bold':'text-slate-600'}">${proc} ${diasStr}</span>
        <label class="toggle"><input type="checkbox" ${ativo?'checked':''} ${dis} onchange="toggleProc('${proc}', this.checked)"><span class="toggle-slider"></span></label>
      </div>
    `;
  }).join('');
}

async function toggleProc(nomeProc, isChecked) {
  const acao = isChecked ? 'inserir' : 'remover';
  const data = new Date().toISOString().split('T')[0];
  await api('/api/procedimentos', 'POST', { paciente_id: currentPacienteId, tipo_procedimento: nomeProc, acao, data });
  showToast('Procedimento atualizado');
  loadPacientes(); // Reload background data
}

async function salvarInfeccao() {
  const tipo = document.getElementById('inf-tipo').value;
  const data = new Date().toISOString().split('T')[0];
  await api('/api/infeccoes', 'POST', { paciente_id: currentPacienteId, tipo_infeccao: tipo, data });
  showToast('Notificação enviada à CCIH!');
}

async function salvarAlta() {
  const motivo = document.getElementById('alta-motivo').value;
  await api(`/api/pacientes/${currentPacienteId}/alta`, 'POST', { motivo });
  document.getElementById('mod-alta').classList.remove('active');
  showToast('Paciente removido do leito ativo.');
  mudarAba('pacientes');
}

// ── CRUD ADMIN ──
async function salvarPaciente() {
  await api('/api/pacientes', 'POST', {
    nome: document.getElementById('cad-p-nome').value,
    idade: document.getElementById('cad-p-idade').value,
    leito: document.getElementById('cad-p-leito').value,
    setor_id: document.getElementById('cad-p-setor').value
  });
  document.getElementById('mod-paciente').classList.remove('active');
  showToast('Paciente cadastrado');
  loadPacientes();
}

async function salvarUser() {
  await api('/api/usuarios', 'POST', {
    nome: document.getElementById('cad-u-nome').value,
    email: document.getElementById('cad-u-email').value,
    senha: document.getElementById('cad-u-senha').value,
    nivel_acesso: document.getElementById('cad-u-nivel').value,
    setor_id: document.getElementById('cad-u-setor').value
  });
  document.getElementById('mod-user').classList.remove('active');
  showToast('Usuário criado!');
}

async function salvarSetor() {
  await api('/api/setores', 'POST', { nome: document.getElementById('cad-s-nome').value });
  document.getElementById('mod-setor').classList.remove('active');
  showToast('Setor criado! Recarregue a página.');
}

async function fazerLogin() {
  await api('/api/login', 'POST', { email: document.getElementById('log-email').value, senha: document.getElementById('log-senha').value });
  window.location.reload();
}
async function sair() { await api('/api/logout', 'POST'); window.location.reload(); }

let tId;
function showToast(msg, isErr=false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.background = isErr ? '#ef4444' : '#0d9488';
  t.classList.remove('hidden'); clearTimeout(tId); tId = setTimeout(() => t.classList.add('hidden'), 3000);
}
