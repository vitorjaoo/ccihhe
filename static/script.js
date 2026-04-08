const NIVEL_LABELS = { admin: '🔑 Administrador', estagiario: '🩺 Estagiário', espectador: '👁 Espectador' };
const INF_COLORS = { 'Trato Urinário': '#3b82f6', 'Sepse': '#ef4444', 'Pneumonia': '#f59e0b', 'Ferida Operatória': '#8b5cf6', 'Outra': '#64748b' };

const State = {
  user: null, pacientes: [], setores: [], motivos: [],
  currentView: 'dashboard', currentPacienteId: null, currentPacienteData: null,
  editingPacienteId: null, pacFilter: 'internado'
};

function today() { return new Date().toISOString().split('T')[0]; }
function currentMonth() { return new Date().toISOString().slice(0, 7); }
function formatDate(str) { if (!str) return '—'; const [y, m, d] = str.split('-'); return `${d}/${m}/${y}`; }
function toast(msg, type = 'success') {
  const el = document.createElement('div'); el.className = `toast toast-${type}`; el.textContent = msg;
  document.getElementById('toast-container').appendChild(el); setTimeout(() => el.remove(), 3500);
}
function showModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

async function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 401) { App.logout(); throw new Error('Sessão expirada'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro no servidor');
  return data;
}

const App = {
  async login() {
    try {
      const email = document.getElementById('login-email').value;
      const senha = document.getElementById('login-senha').value;
      State.user = await api('POST', '/api/auth/login', { email, senha });
      this.initApp();
    } catch (e) { document.getElementById('login-error').textContent = e.message; document.getElementById('login-error').style.display = 'block'; }
  },

  async logout() {
    await api('POST', '/api/auth/logout').catch(()=>{});
    State.user = null; location.reload();
  },

  async checkSession() {
    try { State.user = await api('GET', '/api/auth/me'); this.initApp(); }
    catch { document.getElementById('login-screen').style.display = 'flex'; }
  },

  async initApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'flex';
    document.getElementById('nav-user-nome').textContent = State.user.nome;
    document.getElementById('nav-user-nivel').textContent = NIVEL_LABELS[State.user.nivel_acesso];
    if (State.user.nivel_acesso === 'admin') document.getElementById('nav-admin-group').style.display = 'block';
    await this.loadSetores(); await this.loadMotivos();
    this.navigate('dashboard');
  },

  navigate(view) {
    ['view-dashboard', 'view-pacientes', 'view-setores', 'view-usuarios'].forEach(v => {
      const el = document.getElementById(v); if(el) el.style.display = (v === `view-${view}`) ? 'block' : 'none';
    });
    if (view === 'pacientes') this.loadPacientes();
    if (view === 'dashboard') this.loadDashboard();
  },

  async loadPacientes() {
    try {
      const todos = await api('GET', '/api/pacientes');
      State.pacientes = todos.filter(p => p.status === State.pacFilter);
      this.renderPacientes();
      const pendentes = todos.filter(p => p.setor_id_destino == State.user.setor_id);
      this.renderTransferencias(pendentes);
    } catch (e) { toast(e.message, 'error'); }
  },

  renderPacientes() {
    const c = document.getElementById('lista-pacientes');
    c.innerHTML = State.pacientes.map(p => `
      <div class="card" style="padding:20px;">
        <div style="display:flex;justify-content:space-between;"><span class="badge badge-gray">${p.setor_nome || '—'}</span><b>${p.leito}</b></div>
        <h3 style="margin:10px 0;">${p.nome}</h3>
        <button class="btn btn-ghost btn-sm" onclick="App.verPaciente(${p.id})">Prontuário</button>
      </div>
    `).join('');
  },

  openModalNovoPaciente() {
    const pacSetorContainer = document.getElementById('pac-setor-container');
    const pacSetorSelect = document.getElementById('pac-setor');
    // CORREÇÃO: Mostra seleção de setor para Admin
    if (State.user.nivel_acesso === 'admin') {
      pacSetorContainer.style.display = 'block';
      pacSetorSelect.innerHTML = State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
    } else {
      pacSetorContainer.style.display = 'none';
    }
    showModal('modal-novo-pac');
  },

  async salvarPaciente() {
    const data = {
      nome: document.getElementById('pac-nome').value,
      idade: document.getElementById('pac-idade').value,
      leito: document.getElementById('pac-leito').value,
      prontuario: document.getElementById('pac-pront').value,
      setor_id: document.getElementById('pac-setor').value,
      diagnostico: document.getElementById('pac-diag').value,
      data_internacao: document.getElementById('pac-data-int').value
    };
    try { await api('POST', '/api/pacientes', data); toast('Sucesso!'); closeModal('modal-novo-pac'); this.loadPacientes(); }
    catch (e) { toast(e.message, 'error'); }
  },

  async verPaciente(pid) {
    const data = await api('GET', `/api/pacientes/${pid}/detalhes`);
    State.currentPacienteId = pid; State.currentPacienteData = data.paciente;
    document.getElementById('det-nome').textContent = data.paciente.nome;
    // CORREÇÃO: Exibe botão apagar apenas para Admin
    document.getElementById('btn-delete-paciente').style.display = State.user.nivel_acesso === 'admin' ? 'block' : 'none';
    showModal('modal-detalhes');
  },

  async deletarPaciente() {
    if (!confirm('Excluir permanentemente?')) return;
    try { await api('DELETE', `/api/pacientes/${State.currentPacienteId}`); toast('Apagado'); closeModal('modal-detalhes'); this.loadPacientes(); }
    catch (e) { toast(e.message, 'error'); }
  },

  async loadDashboard() {
    const mes = document.getElementById('filtro-mes').value;
    const data = await api('GET', `/api/dashboard/relatorios?mes=${mes}`);
    document.getElementById('dash-altas-mes').textContent = data.pacientes_alta_geral;
    document.getElementById('dash-inf-mes').textContent = data.total_infeccoes_mes;
  },

  async loadSetores() { State.setores = await api('GET', '/api/setores'); },
  async loadMotivos() { State.motivos = await api('GET', '/api/motivos_saida'); },
  setPacFilter(s) { State.pacFilter = s; this.loadPacientes(); },
  closeModal(id) { closeModal(id); }
};

document.addEventListener('DOMContentLoaded', () => App.checkSession());
