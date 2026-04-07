// CCIH · Controle de Risco de Infecção
const State = {
  nivel: null, setorId: null, nomePac: null, pacienteId: null, pacientes: [], setores: [], procedimentos: [],
};

document.addEventListener('DOMContentLoaded', () => {
  const pageApp = document.getElementById('page-app');
  if (pageApp && !pageApp.classList.contains('hidden')) initApp();
  const regData = document.getElementById('reg-data');
  if (regData) regData.value = new Date().toISOString().split('T')[0];
  document.getElementById('login-senha')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
});

async function initApp() {
  try {
    const [resSetores, resProc] = await Promise.all([ fetch('/api/setores'), fetch('/api/procedimentos/lista') ]);
    State.setores = await resSetores.json();
    State.procedimentos = await resProc.json();
    
    // Injeta dados de sessão que vieram do HTML original (do Jinja2)
    State.nivel = '{{ nivel }}' !== '' ? '{{ nivel }}' : document.querySelector('.topnav')?.dataset?.nivel || 'admin';
    const usrName = document.getElementById('nav-nome');
    if(usrName) usrName.textContent = 'Logado';
    
    if (State.nivel === 'admin') {
      document.getElementById('view-admin').classList.remove('hidden');
      loadDashboardAdmin();
      loadAdminPacientesGerais();
    } else {
      document.getElementById('view-estagiario').classList.remove('hidden');
      loadPacientes();
      checkNotificacoes();
      setInterval(checkNotificacoes, 30000);
    }
  } catch(e) { console.error('Erro init', e); }
}

// ── LÓGICA DE RISCO MATEMÁTICO DA CCIH ────────────────────────
function calcularRisco(procedimentosAtivos) {
  let maxDias = 0;
  procedimentosAtivos.forEach(p => {
    let dias = calcDias(p.data_insercao);
    if(dias > maxDias) maxDias = dias;
  });
  
  // Fórmula padrão CCIH adaptável:
  if(maxDias >= 7) return { label: 'Risco Alto', badge: 'badge-red' };
  if(maxDias >= 4) return { label: 'Risco Médio', badge: 'badge-yellow' };
  if(procedimentosAtivos.length > 0) return { label: 'Risco Baixo', badge: 'badge-blue' };
  return { label: 'Sem Risco', badge: 'badge-green' };
}
// ─────────────────────────────────────────────────────────────

async function doLogin() {
  const email = document.getElementById('login-email').value;
  const senha = document.getElementById('login-senha').value;
  const err = document.getElementById('login-error');
  if (!email || !senha) return;
  const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email, senha }) });
  const data = await res.json();
  if (data.ok) window.location.reload(); 
  else { err.textContent = data.error; err.classList.remove('hidden'); }
}

async function doLogout() {
  await fetch('/api/logout', { method:'POST' });
  window.location.reload();
}

async function loadAdminPacientesGerais() {
  const res = await fetch('/api/admin/pacientes_todos');
  const pacientes = await res.json();
  const div = document.getElementById('lista-admin-pacientes');
  div.innerHTML = '';
  
  if(pacientes.length === 0) {
    div.innerHTML = '<p class="text-slate-400 text-sm">Nenhum paciente internado no hospital.</p>';
    return;
  }
  pacientes.forEach(p => {
    const risco = calcularRisco(p.procedimentos_ativos || []);
    const card = document.createElement('div');
    card.className = 'card p-4 flex justify-between items-center';
    card.innerHTML = `
      <div>
        <h4 class="font-bold text-slate-800">${p.nome}</h4>
        <div class="text-xs text-slate-500 mt-1">
          <span class="badge badge-blue mr-2">${p.setor_nome || 'S/N'}</span>
          Leito: ${p.leito} | Prontuário: ${p.prontuario}
        </div>
      </div>
      <div class="text-right flex flex-col items-end gap-1">
        <span class="badge ${risco.badge}">${risco.label}</span>
        <span class="text-xs text-slate-400">${p.procedimentos_ativos.length} procedimento(s)</span>
      </div>
    `;
    div.appendChild(card);
  });
}

async function loadDashboardAdmin() {
  const res = await fetch('/api/dashboard');
  const data = await res.json();
  document.getElementById('dash-pacientes').textContent = data.total_pacientes;
  document.getElementById('dash-proc').textContent = data.total_proc_ativos;
  document.getElementById('dash-transf').textContent = data.total_transferencias_pendentes;
  
  const setDiv = document.getElementById('dash-setores');
  setDiv.innerHTML = data.setores.map(s => `<div class="flex justify-between text-sm py-1 border-b border-slate-100 last:border-0"><span class="text-slate-600">${s.nome}</span><span class="font-bold">${s.total} pac.</span></div>`).join('');
  
  const setRes = await fetch('/api/setores');
  const setores = await setRes.json();
  document.getElementById('lista-setores').innerHTML = setores.map(s => `<div class="p-3 bg-slate-50 rounded-xl text-sm font-medium text-slate-700">${s.nome}</div>`).join('');
  
  const usrRes = await fetch('/api/usuarios');
  const usuarios = await usrRes.json();
  document.getElementById('lista-usuarios').innerHTML = usuarios.map(u => `<div class="p-3 bg-slate-50 rounded-xl text-sm flex justify-between"><span class="font-bold text-slate-700">${u.nome}</span><span class="text-slate-400">${u.nivel_acesso === 'admin'?'Admin':u.setor_nome}</span></div>`).join('');
  
  const selSetor = document.getElementById('m-usr-setor');
  selSetor.innerHTML = setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
}

async function loadPacientes() {
  document.getElementById('loading-pacientes').classList.remove('hidden');
  const div = document.getElementById('lista-pacientes');
  div.innerHTML = '';
  const res = await fetch('/api/pacientes');
  State.pacientes = await res.json();
  document.getElementById('loading-pacientes').classList.add('hidden');
  
  if (State.pacientes.length === 0) { document.getElementById('empty-pacientes').classList.remove('hidden'); } 
  else {
    document.getElementById('empty-pacientes').classList.add('hidden');
    State.pacientes.forEach(p => {
      const risco = calcularRisco(p.procedimentos_ativos || []);
      const card = document.createElement('div');
      card.className = 'card p-4 pac-card flex items-center gap-4';
      card.onclick = () => { document.querySelector('[data-tab="gestao"]').click(); loadGestao(p.id); };
      card.innerHTML = `
        <div class="w-12 h-12 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-lg">${p.nome.charAt(0)}</div>
        <div class="flex-1 min-w-0">
          <h3 class="font-bold text-slate-800 truncate">${p.nome}</h3>
          <div class="flex items-center gap-2 mt-1"><span class="badge badge-blue">Leito ${p.leito}</span><span class="badge ${risco.badge}">${risco.label}</span></div>
        </div>
        <svg width="20" height="20" fill="none" stroke="#cbd5e1" stroke-width="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
      `;
      div.appendChild(card);
    });
  }
}

async function cadastrarPaciente() {
  const payload = {
    nome: document.getElementById('cad-nome').value,
    idade: document.getElementById('cad-idade').value,
    sexo: document.getElementById('cad-sexo').value,
    leito: document.getElementById('cad-leito').value,
    prontuario: document.getElementById('cad-prontuario').value,
    fone: document.getElementById('cad-fone').value
  };
  if(!payload.nome) return showToast('Nome é obrigatório', 'error');
  const res = await fetch('/api/pacientes', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
  if(res.ok) {
    showToast('Paciente cadastrado!');
    ['nome','idade','sexo','leito','prontuario','fone'].forEach(id => document.getElementById(`cad-${id}`).value='');
    document.querySelector('[data-tab="pacientes"]').click();
  }
}

async function loadGestao(pacId) {
  const sel = document.getElementById('gestao-pac-select');
  if(!pacId && sel.options.length <= 1) {
    sel.innerHTML = '<option value="">— selecione —</option>' + State.pacientes.map(p => `<option value="${p.id}">${p.nome} (Leito ${p.leito})</option>`).join('');
    document.getElementById('gestao-content').classList.add('hidden');
    return;
  }
  sel.value = pacId;
  const res = await fetch(`/api/pacientes/${pacId}`);
  const pac = await res.json();
  State.pacienteId = pac.id;
  
  document.getElementById('gestao-content').classList.remove('hidden');
  document.getElementById('g-nome').textContent = pac.nome;
  document.getElementById('g-avatar').textContent = pac.nome.charAt(0);
  document.getElementById('g-leito').textContent = `Leito ${pac.leito}`;
  document.getElementById('g-idade').textContent = `${pac.idade} anos`;
  
  const divProc = document.getElementById('lista-proc');
  divProc.innerHTML = State.procedimentos.map((proc, i) => {
    const pAtivo = pac.procedimentos.find(x => x.tipo_procedimento === proc && x.status === 'ativo');
    const checked = pAtivo ? 'checked' : '';
    const dateVal = pAtivo ? pAtivo.data_insercao : new Date().toISOString().split('T')[0];
    const dias = pAtivo ? calcDias(pAtivo.data_insercao) : 0;
    const diasClass = getDiasClass(dias);
    
    return `
      <div class="proc-row ${pAtivo?'active-proc':''} p-3 bg-slate-50 rounded-xl">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-slate-700 w-2/3">${proc}</span>
          <label class="toggle"><input type="checkbox" id="proc-chk-${i}" onchange="toggleProc(${i}, '${proc}', ${pAtivo ? pAtivo.id : null})" ${checked}><span class="toggle-slider"></span></label>
        </div>
        <div id="proc-details-${i}" class="${pAtivo?'mt-3':'hidden'} pt-3 border-t border-slate-200 flex justify-between items-end">
          <div><label class="block text-xs text-slate-500 mb-1">Inserção</label><input type="date" id="proc-date-${i}" value="${dateVal}" class="inp py-1 px-2 text-sm max-w-[140px]" ${pAtivo?'disabled':''}></div>
          <div class="text-right"><div class="text-xs text-slate-500">Dias de uso</div><div class="dias-counter ${diasClass}">${dias}</div></div>
          ${!pAtivo ? `<button onclick="salvarProc(${i}, '${proc}')" class="btn btn-primary btn-sm ml-2">Salvar</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function toggleProc(idx, procName, procId) {
  const chk = document.getElementById(`proc-chk-${idx}`);
  const details = document.getElementById(`proc-details-${idx}`);
  if(chk.checked) { details.classList.remove('hidden'); } 
  else {
    if(procId) { if(confirm('Remover procedimento do paciente?')) removerProc(procId); else chk.checked = true; }
    else details.classList.add('hidden');
  }
}

async function salvarProc(idx, procName) {
  const dt = document.getElementById(`proc-date-${idx}`).value;
  if(!dt) return showToast('Preencha a data', 'error');
  const res = await fetch('/api/procedimentos', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ paciente_id: State.pacienteId, tipo_procedimento: procName, data_insercao: dt }) });
  if(res.ok) { showToast('Procedimento registrado'); loadGestao(State.pacienteId); }
}

async function removerProc(procId) {
  const res = await fetch(`/api/procedimentos/${procId}/remover`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ data_remocao: new Date().toISOString().split('T')[0] }) });
  if(res.ok) { showToast('Procedimento removido'); loadGestao(State.pacienteId); }
}

async function salvarRegistro() {
  const dt = document.getElementById('reg-data').value;
  const tmp = document.getElementById('reg-temp').value;
  if(!dt || !tmp) return showToast('Preencha data e temp', 'error');
  const res = await fetch('/api/registros', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ paciente_id: State.pacienteId, data: dt, temperatura: tmp }) });
  if(res.ok) { showToast('Registro salvo!'); document.getElementById('reg-temp').value = ''; }
}

async function darAlta() {
  if(!confirm('Confirmar ALTA deste paciente?')) return;
  await fetch(`/api/pacientes/${State.pacienteId}/alta`, { method: 'POST' });
  showToast('Alta registrada');
  document.querySelector('[data-tab="pacientes"]').click();
}

async function criarUsuario() {
  const payload = {
    nome: document.getElementById('m-usr-nome').value,
    email: document.getElementById('m-usr-email').value,
    nivel_acesso: document.getElementById('m-usr-nivel').value,
    senha: document.getElementById('m-usr-senha').value,
    setor_id: document.getElementById('m-usr-setor').value || null
  };
  const res = await fetch('/api/usuarios', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
  if(res.ok) { showToast('Usuário criado'); closeModal('modal-usuario'); loadDashboardAdmin(); }
  else showToast('Erro ao criar usuário', 'error');
}

async function criarSetor() {
  const val = document.getElementById('m-setor-nome').value;
  if(!val) return;
  const res = await fetch('/api/setores', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({nome: val}) });
  if(res.ok) { showToast('Setor criado'); closeModal('modal-setor'); loadDashboardAdmin(); }
}

function toggleSetorField() {
  document.getElementById('m-setor-field').style.display = document.getElementById('m-usr-nivel').value === 'admin' ? 'none' : 'block';
}

function calcDias(dateStr) {
  if (!dateStr) return 0;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const ins = new Date(dateStr + 'T00:00:00');
  return Math.max(0, Math.floor((hoje - ins) / 86400000));
}
function getDiasClass(dias) {
  if(dias >= 7) return 'dias-danger text-red-500 font-bold';
  if(dias >= 4) return 'dias-warning text-amber-500 font-bold';
  return 'dias-ok text-teal-600 font-bold';
}

function showTab(tabName, btnEl) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tabName}`)?.classList.add('active');
  if(btnEl) btnEl.classList.add('active');
  if(tabName === 'pacientes') loadPacientes();
  if(tabName === 'gestao') loadGestao();
}

function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#0d9488';
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// Ocultando funções de transferência por limite de espaço visual (deixe as antigas do seu arquivo se usar muito, ou adapte aqui)
async function checkNotificacoes() { }
