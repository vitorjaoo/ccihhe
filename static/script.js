/* =========================================================
   CCIH — Sistema de Rastreio de Infecção Hospitalar
   script.js — SPA Controller
   ========================================================= */

const PROCEDIMENTOS_LIST = [
  'cateter venoso central punção',
  'cateter venoso central dessecação',
  'cateter swan ganz',
  'cateter nutrição parental',
  'dissecação de veia periférica',
  'entubação',
  'respiração artificial',
  'traqueostomia',
  'sonda gástrica',
  'sonda vesical',
  'cateter arterial',
  'dreno cirurgia Neurológica',
  'dreno mediastino',
  'diálise peritoneal',
];

const NIVEL_LABELS = {
  admin: '🔑 Administrador',
  estagiario: '🩺 Estagiário',
  espectador: '👁 Espectador',
};

const INF_COLORS = {
  'Trato Urinário': '#3b82f6',
  'Sepse': '#ef4444',
  'Pneumonia': '#f59e0b',
  'Ferida Operatória': '#8b5cf6',
  'Outra': '#64748b',
};

/* ─── STATE ─────────────────────────────────────────── */
const State = {
  user: null,
  pacientes: [],
  setores: [],
  motivos: [],
  currentView: 'dashboard',
  currentPacienteId: null,
  currentPacienteData: null,
  pacFilter: 'internado',
  pendingProcId: null,
  pendingAltaPacId: null,
};

/* ─── UTILS ─────────────────────────────────────────── */
function today() {
  return new Date().toISOString().split('T')[0];
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function diffDias(dataStr) {
  if (!dataStr) return null;
  const d = new Date(dataStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - d) / 86400000);
}

function formatDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function diasBadge(dias) {
  if (dias === null) return '';
  let cls = 'dias-ok';
  if (dias >= 7 && dias < 14) cls = 'dias-warn';
  if (dias >= 14) cls = 'dias-danger';
  return `<span class="dias-badge ${cls}">⏱ ${dias}d</span>`;
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showModal(id) {
  document.getElementById(id).classList.add('show');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

/* ─── API ────────────────────────────────────────────── */
async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro no servidor');
  return data;
}

/* ─── AUTH ───────────────────────────────────────────── */
const App = {
  /* ── Login ── */
  async login() {
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    try {
      const user = await api('POST', '/api/auth/login', { email, senha });
      State.user = user;
      this.initApp();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  },

  async logout() {
    await api('POST', '/api/auth/logout');
    State.user = null;
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('login-email').value = '';
    document.getElementById('login-senha').value = '';
  },

  async checkSession() {
    try {
      const user = await api('GET', '/api/auth/me');
      State.user = user;
      this.initApp();
    } catch {
      document.getElementById('login-screen').style.display = 'flex';
    }
  },

  /* ── Init ── */
  async initApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';

    const u = State.user;
    document.getElementById('nav-user-nome').textContent = u.nome;
    document.getElementById('nav-user-nivel').textContent = NIVEL_LABELS[u.nivel_acesso] || u.nivel_acesso;

    // Admin-only nav
    if (u.nivel_acesso === 'admin') {
      document.getElementById('nav-admin-group').style.display = 'block';
    }

    // Espectador
    if (u.nivel_acesso === 'espectador') {
      document.getElementById('readonly-badge').style.display = 'flex';
      document.querySelectorAll('.write-only').forEach(el => el.style.display = 'none');
    }

    // Estagiário: mostrar setor
    if (u.nivel_acesso === 'estagiario' && u.setor_id) {
      document.getElementById('topbar-setor').style.display = 'block';
    }

    // Filtro mês atual
    document.getElementById('filtro-mes').value = currentMonth();
    document.getElementById('reg-data').value = today();
    document.getElementById('inf-data').value = today();

    // Carregar dados globais
    await this.loadSetores();
    await this.loadMotivos();
    this.navigate('dashboard');
  },

  /* ── Sidebar ── */
  openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('show');
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
  },

  /* ── Navigate ── */
  navigate(view) {
    this.closeSidebar();
    State.currentView = view;
    const titles = {
      dashboard: 'Dashboard Global',
      pacientes: 'Pacientes',
      'paciente-detail': 'Detalhes do Paciente',
      setores: 'Setores / Alas',
      usuarios: 'Usuários',
    };
    document.getElementById('topbar-title').textContent = titles[view] || view;
    document.querySelectorAll('[id^="view-"]').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const el = document.getElementById(`view-${view}`);
    if (el) el.style.display = 'block';
    const navEl = document.querySelector(`[data-view="${view}"]`);
    if (navEl) navEl.classList.add('active');

    if (view === 'dashboard') this.loadDashboard();
    if (view === 'pacientes') this.loadPacientes();
    if (view === 'setores') this.loadSetoresView();
    if (view === 'usuarios') this.loadUsuarios();
  },

  closeModal,

  /* ─────────────────────────────────────────────────────
     DASHBOARD
  ───────────────────────────────────────────────────── */
  async loadDashboard() {
    const mes = document.getElementById('filtro-mes').value || currentMonth();
    try {
      const data = await api('GET', `/api/dashboard/relatorios?mes=${mes}`);
      this.renderDashboard(data);
    } catch (e) {
      toast('Erro ao carregar dashboard: ' + e.message, 'error');
    }
  },

  renderDashboard(data) {
    const t = data.totais;
    document.getElementById('dash-internados').textContent = t.pacientes_internados;
    document.getElementById('dash-altas').textContent = t.pacientes_alta;
    document.getElementById('dash-infeccoes').textContent = t.infeccoes_mes;

    // Taxas principais
    const taxas = [
      { label: 'IH Geral', key: 'geral', icon: '📊', desc: 'Taxa geral de infecções' },
      { label: 'IH Urinário', key: 'urinario', icon: '💧', desc: 'Proporção de ITU' },
      { label: 'IH Sangue/Sepse', key: 'sepse', icon: '🩸', desc: 'Proporção de Sepse' },
      { label: 'IH Pneumonia', key: 'pneumonia', icon: '🫁', desc: 'Proporção de Pneumonia' },
      { label: 'IH Cirúrgica', key: 'cirurgica', icon: '🔪', desc: 'Proporção de Ferida Op.' },
    ];

    document.getElementById('taxas-grid').innerHTML = taxas.map(tx => {
      const val = data.taxas[tx.key] || 0;
      const color = val > 20 ? '#ef4444' : val > 10 ? '#f59e0b' : '#14b8a6';
      return `
        <div style="background:#f8fafc;border-radius:12px;padding:16px;border:1px solid #e2e8f0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:20px">${tx.icon}</span>
            <div>
              <div style="font-size:13px;font-weight:700;color:#0f172a">${tx.label}</div>
              <div style="font-size:11px;color:#94a3b8">${tx.desc}</div>
            </div>
          </div>
          <div style="font-size:28px;font-weight:700;color:${color};margin-bottom:8px">${val.toFixed(1)}%</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${Math.min(val, 100)}%;background:${color}"></div>
          </div>
        </div>`;
    }).join('');

    // Dispositivos
    const disp = [
      { label: 'Septicemia por Cateter', key: 'cateter', icon: '🩹' },
      { label: 'PAV (Respiradores)', key: 'respirador', icon: '💨' },
      { label: 'ITU por Sonda', key: 'sonda_vesical', icon: '🔵' },
    ];
    document.getElementById('dispositivos-grid').innerHTML = disp.map(d => {
      const val = data.taxas[d.key] || 0;
      const color = val > 20 ? '#ef4444' : val > 10 ? '#f59e0b' : '#14b8a6';
      return `
        <div style="background:#f8fafc;border-radius:12px;padding:16px;border:1px solid #e2e8f0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:20px">${d.icon}</span>
            <div style="font-size:13px;font-weight:700;color:#0f172a">${d.label}</div>
          </div>
          <div style="font-size:28px;font-weight:700;color:${color}">${val.toFixed(1)}%</div>
          <div class="progress-bar" style="margin-top:8px">
            <div class="progress-fill" style="width:${Math.min(val, 100)}%;background:${color}"></div>
          </div>
        </div>`;
    }).join('');

    // Por setor
    const maxSetor = Math.max(...(data.por_setor.map(s => s.total)), 1);
    document.getElementById('por-setor-list').innerHTML = data.por_setor.length
      ? data.por_setor.map(s => `
          <div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
              <span style="font-weight:500">${s.setor}</span>
              <span class="badge badge-teal">${s.total}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${(s.total/maxSetor*100).toFixed(0)}%;background:#14b8a6"></div>
            </div>
          </div>`).join('')
      : '<p style="color:#94a3b8;font-size:13px">Nenhum paciente internado</p>';

    // Por tipo infecção
    document.getElementById('por-tipo-list').innerHTML = data.por_tipo.length
      ? data.por_tipo.map(t => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
            <span style="font-size:13px;font-weight:500">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${INF_COLORS[t.tipo_infeccao]||'#64748b'};margin-right:6px;vertical-align:middle"></span>
              ${t.tipo_infeccao}
            </span>
            <span class="badge badge-red">${t.total}</span>
          </div>`).join('')
      : '<p style="color:#94a3b8;font-size:13px">Sem infecções no mês</p>';

    // Últimas infecções
    document.getElementById('ultimas-inf-body').innerHTML = data.ultimas_infeccoes.length
      ? data.ultimas_infeccoes.map(i => `
          <tr>
            <td style="font-weight:500">${i.paciente_nome}</td>
            <td><span class="badge" style="background:${INF_COLORS[i.tipo_infeccao]||'#64748b'}20;color:${INF_COLORS[i.tipo_infeccao]||'#64748b'}">${i.tipo_infeccao}</span></td>
            <td><span style="font-size:12px;color:#64748b">${i.setor_nome || '—'}</span></td>
            <td><span style="font-size:12px;color:#64748b">${formatDate(i.data_notificacao)}</span></td>
          </tr>`)
          .join('')
      : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:24px">Nenhuma notificação recente</td></tr>';
  },

  /* ─────────────────────────────────────────────────────
     SETORES
  ───────────────────────────────────────────────────── */
  async loadSetores() {
    try {
      State.setores = await api('GET', '/api/setores');
      // Popular selects
      const opts = State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
      const optsBlank = '<option value="">Selecione o setor...</option>' + opts;
      document.getElementById('np-setor').innerHTML = optsBlank;
      document.getElementById('nu-setor').innerHTML = '<option value="">Sem setor específico</option>' + opts;
      // Setor do estagiário no topbar
      if (State.user.nivel_acesso === 'estagiario' && State.user.setor_id) {
        const s = State.setores.find(x => x.id === State.user.setor_id);
        if (s) document.getElementById('topbar-setor').textContent = '🏗 ' + s.nome;
      }
    } catch (e) {
      console.error(e);
    }
  },

  async loadSetoresView() {
    await this.loadSetores();
    const tbody = document.getElementById('setores-tbody');
    tbody.innerHTML = State.setores.map(s => `
      <tr>
        <td style="font-weight:500">${s.nome}</td>
        <td>
          ${State.user.nivel_acesso === 'admin' && State.user.nivel_acesso !== 'espectador'
            ? `<button class="btn btn-ghost btn-sm" onclick="App.deleteSetor(${s.id})" style="color:#ef4444;border-color:#fee2e2">🗑</button>`
            : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="2" style="text-align:center;color:#94a3b8">Nenhum setor cadastrado</td></tr>';
  },

  openModalNovoSetor() { document.getElementById('ns-nome').value = ''; showModal('modal-novo-setor'); },
  async salvarNovoSetor() {
    const nome = document.getElementById('ns-nome').value.trim();
    if (!nome) return toast('Informe o nome do setor', 'error');
    try {
      await api('POST', '/api/setores', { nome });
      closeModal('modal-novo-setor');
      toast('Setor criado com sucesso!');
      this.loadSetoresView();
    } catch (e) { toast(e.message, 'error'); }
  },

  async deleteSetor(id) {
    if (!confirm('Excluir este setor?')) return;
    try {
      await api('DELETE', `/api/setores/${id}`);
      toast('Setor excluído');
      this.loadSetoresView();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─────────────────────────────────────────────────────
     USUÁRIOS
  ───────────────────────────────────────────────────── */
  async loadUsuarios() {
    try {
      const users = await api('GET', '/api/usuarios');
      const isAdmin = State.user.nivel_acesso === 'admin';
      document.getElementById('usuarios-tbody').innerHTML = users.map(u => `
        <tr>
          <td style="font-weight:500">${u.nome}</td>
          <td style="font-size:13px;color:#64748b">${u.email}</td>
          <td><span class="badge badge-teal" style="font-size:11px">${NIVEL_LABELS[u.nivel_acesso] || u.nivel_acesso}</span></td>
          <td class="hide-mobile" style="font-size:13px;color:#64748b">${u.setor_nome || '—'}</td>
          <td>
            ${isAdmin && u.id !== State.user.id
              ? `<button class="btn btn-ghost btn-sm" onclick="App.deleteUsuario(${u.id})" style="color:#ef4444;border-color:#fee2e2">🗑</button>`
              : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">Nenhum usuário</td></tr>';
    } catch (e) { toast(e.message, 'error'); }
  },

  openModalNovoUsuario() {
    ['nu-nome','nu-email','nu-senha'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('nu-nivel').value = '';
    showModal('modal-novo-usuario');
  },

  onNivelChange() {
    const nivel = document.getElementById('nu-nivel').value;
    document.getElementById('nu-setor-wrap').style.display = nivel === 'estagiario' ? 'block' : 'none';
  },

  async salvarNovoUsuario() {
    const nome = document.getElementById('nu-nome').value.trim();
    const email = document.getElementById('nu-email').value.trim();
    const senha = document.getElementById('nu-senha').value;
    const nivel_acesso = document.getElementById('nu-nivel').value;
    const setor_id = document.getElementById('nu-setor').value || null;
    if (!nome || !email || !senha || !nivel_acesso) return toast('Preencha todos os campos obrigatórios', 'error');
    try {
      await api('POST', '/api/usuarios', { nome, email, senha, nivel_acesso, setor_id: setor_id ? parseInt(setor_id) : null });
      closeModal('modal-novo-usuario');
      toast('Usuário criado!');
      this.loadUsuarios();
    } catch (e) { toast(e.message, 'error'); }
  },

  async deleteUsuario(id) {
    if (!confirm('Excluir este usuário?')) return;
    try {
      await api('DELETE', `/api/usuarios/${id}`);
      toast('Usuário excluído');
      this.loadUsuarios();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─────────────────────────────────────────────────────
     PACIENTES
  ───────────────────────────────────────────────────── */
  async loadPacientes() {
    try {
      State.pacientes = await api('GET', '/api/pacientes');
      this.renderPacientes();
      // Sub-label do setor para estagiário
      if (State.user.nivel_acesso === 'estagiario') {
        const s = State.setores.find(x => x.id === State.user.setor_id);
        document.getElementById('pac-setor-sub').textContent = s ? `Ala: ${s.nome}` : 'Minha Ala';
      }
    } catch (e) { toast(e.message, 'error'); }
  },

  setPacFilter(f) {
    State.pacFilter = f;
    ['internado','alta','todos'].forEach(k => {
      const el = document.getElementById(`fil-${k}`);
      if (el) {
        el.className = k === f ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
      }
    });
    this.renderPacientes();
  },

  filterPacientes() { this.renderPacientes(); },

  renderPacientes() {
    const search = (document.getElementById('pac-search').value || '').toLowerCase();
    let list = State.pacientes;
    if (State.pacFilter !== 'todos') list = list.filter(p => p.status === State.pacFilter);
    if (search) list = list.filter(p =>
      p.nome.toLowerCase().includes(search) ||
      (p.leito || '').toLowerCase().includes(search) ||
      (p.prontuario || '').toLowerCase().includes(search)
    );

    const container = document.getElementById('pac-list');
    if (!list.length) {
      container.innerHTML = `<div class="card" style="padding:40px;text-align:center;color:#94a3b8">
        <div style="font-size:36px;margin-bottom:12px">🛏️</div>
        <div>Nenhum paciente encontrado</div>
      </div>`;
      return;
    }

    container.innerHTML = list.map(p => {
      const statusBadge = p.status === 'internado'
        ? '<span class="badge badge-green">✅ Internado</span>'
        : '<span class="badge badge-gray">🚪 Alta</span>';

      return `
        <div class="card" style="padding:16px 20px;cursor:pointer;transition:all .2s" onclick="App.openPaciente(${p.id})"
          onmouseenter="this.style.boxShadow='0 8px 24px rgba(15,23,42,.1)';this.style.transform='translateY(-1px)'"
          onmouseleave="this.style.boxShadow='';this.style.transform=''">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:12px;min-width:0">
              <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#0d9488,#134e4a);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;flex-shrink:0">
                ${p.nome.charAt(0).toUpperCase()}
              </div>
              <div style="min-width:0">
                <div style="font-weight:700;color:#0f172a;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nome}</div>
                <div style="font-size:12px;color:#64748b;margin-top:2px">
                  ${p.idade ? p.idade + ' anos' : '—'} 
                  ${p.leito ? ' · Leito ' + p.leito : ''}
                  ${p.prontuario ? ' · Pron. ' + p.prontuario : ''}
                </div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
              <span style="font-size:11px;color:#94a3b8;background:#f8fafc;padding:3px 10px;border-radius:8px">${p.setor_nome || 'Sem setor'}</span>
              ${statusBadge}
              <span style="color:#94a3b8;font-size:18px">›</span>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  /* ── Novo Paciente ── */
  openModalNovoPaciente() {
    ['np-nome','np-leito','np-prontuario','np-fone'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('np-idade').value = '';
    // Para estagiário, ocultar select de setor
    if (State.user.nivel_acesso === 'estagiario') {
      document.getElementById('np-setor-wrap').style.display = 'none';
    } else {
      document.getElementById('np-setor-wrap').style.display = 'block';
    }
    showModal('modal-novo-paciente');
  },

  async salvarNovoPaciente() {
    const nome = document.getElementById('np-nome').value.trim();
    if (!nome) return toast('Nome é obrigatório', 'error');
    const body = {
      nome,
      idade: document.getElementById('np-idade').value || null,
      leito: document.getElementById('np-leito').value.trim(),
      prontuario: document.getElementById('np-prontuario').value.trim(),
      fone: document.getElementById('np-fone').value.trim(),
      setor_id: document.getElementById('np-setor').value || null,
    };
    try {
      await api('POST', '/api/pacientes', body);
      closeModal('modal-novo-paciente');
      toast('Paciente cadastrado!');
      this.loadPacientes();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* ─────────────────────────────────────────────────────
     PACIENTE DETAIL
  ───────────────────────────────────────────────────── */
  async openPaciente(id) {
    State.currentPacienteId = id;
    this.navigate('paciente-detail');
    await this.loadPacienteDetail();
    this.switchDetailTab('registros');
  },

  async loadPacienteDetail() {
    try {
      const p = await api('GET', `/api/pacientes/${State.currentPacienteId}`);
      State.currentPacienteData = p;
      this.renderPacienteDetail(p);
    } catch (e) { toast(e.message, 'error'); }
  },

  renderPacienteDetail(p) {
    document.getElementById('detail-nome').textContent = p.nome;
    document.getElementById('detail-info').textContent =
      `${p.idade ? p.idade + ' anos' : ''} ${p.leito ? '· Leito ' + p.leito : ''} ${p.prontuario ? '· Pron. ' + p.prontuario : ''} · ${p.setor_nome || 'Sem setor'}`;

    const statusBadge = document.getElementById('detail-status-badge');
    const btnAlta = document.getElementById('btn-dar-alta');
    if (p.status === 'internado') {
      statusBadge.innerHTML = '<span class="badge badge-green">✅ Internado</span>';
      if (State.user.nivel_acesso !== 'espectador') btnAlta.style.display = 'inline-flex';
    } else {
      statusBadge.innerHTML = '<span class="badge badge-gray">🚪 Alta</span>';
      btnAlta.style.display = 'none';
    }

    // Ocultar formulários para alta/espectador
    const formsVisible = p.status === 'internado' && State.user.nivel_acesso !== 'espectador';
    ['form-registro-wrap','form-proc-wrap','form-inf-wrap'].forEach(id => {
      document.getElementById(id).style.display = formsVisible ? 'block' : 'none';
    });

    // Registros
    document.getElementById('registros-tbody').innerHTML = p.registros.length
      ? p.registros.map(r => `
          <tr>
            <td>${formatDate(r.data)}</td>
            <td>${r.temperatura != null ? `<span style="font-family:'DM Mono',monospace;font-weight:600">${r.temperatura}°C</span>
              ${r.temperatura >= 37.8 ? '<span class="badge badge-red" style="margin-left:6px;font-size:10px">Febre</span>' : ''}` : '—'}</td>
          </tr>`).join('')
      : '<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:24px">Nenhum registro</td></tr>';

    // Procedimentos
    this.renderProcedimentos(p.procedimentos, p.status === 'internado');

    // Infecções
    document.getElementById('infeccoes-tbody').innerHTML = p.infeccoes.length
      ? p.infeccoes.map(i => `
          <tr>
            <td><span class="badge" style="background:${INF_COLORS[i.tipo_infeccao] || '#64748b'}20;color:${INF_COLORS[i.tipo_infeccao] || '#64748b'}">${i.tipo_infeccao}</span></td>
            <td>${formatDate(i.data_notificacao)}</td>
          </tr>`).join('')
      : '<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:24px">Nenhuma infecção notificada</td></tr>';
  },

  renderProcedimentos(procedimentos, isInternado) {
    const container = document.getElementById('toggles-procedimentos');
    const ativo = procedimentos.filter(p => p.status === 'ativo').map(p => p.tipo_procedimento.toLowerCase());
    const canWrite = isInternado && State.user.nivel_acesso !== 'espectador';

    container.innerHTML = PROCEDIMENTOS_LIST.map(tipo => {
      const isOn = ativo.includes(tipo.toLowerCase());
      const proc = procedimentos.find(p => p.tipo_procedimento.toLowerCase() === tipo.toLowerCase() && p.status === 'ativo');
      const dias = proc ? diffDias(proc.data_insercao) : null;

      return `
        <div style="background:white;border:1.5px solid ${isOn ? '#99f6e4' : '#e2e8f0'};border-radius:12px;padding:12px 14px;transition:all .2s">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <label class="toggle-wrap" style="flex:1;min-width:0;${canWrite ? 'cursor:pointer' : 'cursor:default'}">
              <div class="toggle">
                <input type="checkbox" ${isOn ? 'checked' : ''} ${!canWrite ? 'disabled' : ''}
                  onchange="App.onToggleProc(this, '${tipo.replace(/'/g,"\\'")}')"/>
                <span class="toggle-slider"></span>
              </div>
              <span style="font-size:13.5px;font-weight:${isOn ? '600' : '400'};color:${isOn ? '#0d9488' : '#475569'};text-transform:capitalize;word-break:break-word">${tipo}</span>
            </label>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
              ${proc ? diasBadge(dias) : ''}
              ${proc && canWrite ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444;border-color:#fee2e2;font-size:11px"
                onclick="App.openRemoverProc(${proc.id}, '${tipo.replace(/'/g,"\\'")}')" title="Registrar retirada">✂ Retirar</button>` : ''}
            </div>
          </div>
          ${proc ? `
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid #f1f5f9;display:flex;gap:16px;font-size:12px;color:#64748b">
              <span>📅 Inserção: <strong>${formatDate(proc.data_insercao)}</strong></span>
              ${dias !== null ? `<span>⏱ Em uso há <strong style="color:${dias>=14?'#ef4444':dias>=7?'#f59e0b':'#14b8a6'}">${dias} dias</strong></span>` : ''}
            </div>` : ''}
        </div>`;
    }).join('');

    // Histórico procedimentos removidos
    const removidos = procedimentos.filter(p => p.status === 'removido');
    const histEl = document.getElementById('proc-historico');
    if (removidos.length) {
      histEl.innerHTML = removidos.map(p => `
        <div class="proc-item" style="opacity:.7">
          <div class="proc-item-left">
            <span style="font-size:18px">🗄</span>
            <div>
              <div style="font-size:13px;font-weight:600;text-transform:capitalize">${p.tipo_procedimento}</div>
              <div style="font-size:11px;color:#64748b">
                ${formatDate(p.data_insercao)} → ${formatDate(p.data_remocao)}
                ${p.data_insercao && p.data_remocao ? ` (${diffDias(p.data_insercao) - diffDias(p.data_remocao)} dias)` : ''}
              </div>
            </div>
          </div>
          <span class="badge badge-gray">Removido</span>
        </div>`).join('');
    } else {
      histEl.innerHTML = '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px 0">Nenhum procedimento encerrado</p>';
    }
  },

  /* Toggle procedimento — abre modal de data inserção */
  onToggleProc(checkbox, tipo) {
    if (!checkbox.checked) return; // remoção via botão
    // Mostrar mini-modal inline via prompt simples
    const data = prompt(`📅 Data de inserção para:\n"${tipo}"\n\nFormato: AAAA-MM-DD`, today());
    if (!data) {
      checkbox.checked = false;
      return;
    }
    // Validação básica de data
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      toast('Formato de data inválido. Use AAAA-MM-DD', 'error');
      checkbox.checked = false;
      return;
    }
    this.addProcedimento(tipo, data);
  },

  async addProcedimento(tipo, data_insercao) {
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/procedimentos`, {
        tipo_procedimento: tipo,
        data_insercao,
      });
      toast('Procedimento registrado!');
      await this.loadPacienteDetail();
      this.switchDetailTab('procedimentos');
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  openRemoverProc(procId, tipo) {
    State.pendingProcId = procId;
    document.getElementById('remproc-nome').textContent = tipo;
    document.getElementById('remproc-data').value = today();
    showModal('modal-remover-proc');
  },

  async confirmarRemoverProc() {
    const data_remocao = document.getElementById('remproc-data').value;
    if (!data_remocao) return toast('Informe a data de retirada', 'error');
    try {
      await api('POST', `/api/procedimentos/${State.pendingProcId}/remover`, { data_remocao });
      closeModal('modal-remover-proc');
      toast('Procedimento encerrado!');
      await this.loadPacienteDetail();
      this.switchDetailTab('procedimentos');
    } catch (e) { toast(e.message, 'error'); }
  },

  /* Sub-tabs do detail */
  switchDetailTab(tab) {
    ['registros','procedimentos','infeccoes'].forEach(t => {
      document.getElementById(`dtab-${t}`).style.display = t === tab ? 'block' : 'none';
      const btn = document.getElementById(`stab-${t}`);
      btn.className = t === tab ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
    });
  },

  /* Registros Diários */
  async salvarRegistro() {
    const temperatura = document.getElementById('reg-temp').value;
    const data = document.getElementById('reg-data').value;
    if (!temperatura) return toast('Informe a temperatura', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/registros`, { temperatura: parseFloat(temperatura), data });
      document.getElementById('reg-temp').value = '';
      toast('Registro salvo!');
      await this.loadPacienteDetail();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* Infecções */
  async salvarInfeccao() {
    const tipo_infeccao = document.getElementById('inf-tipo').value;
    const data_notificacao = document.getElementById('inf-data').value;
    if (!tipo_infeccao) return toast('Selecione o tipo de infecção', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/infeccoes`, { tipo_infeccao, data_notificacao });
      document.getElementById('inf-tipo').value = '';
      toast('Infecção notificada!', 'success');
      await this.loadPacienteDetail();
      this.switchDetailTab('infeccoes');
    } catch (e) { toast(e.message, 'error'); }
  },

  /* Alta */
  async loadMotivos() {
    try {
      State.motivos = await api('GET', '/api/motivos_saida');
      const sel = document.getElementById('alta-motivo');
      sel.innerHTML = '<option value="">Selecione...</option>' +
        State.motivos.map(m => `<option value="${m.id}">${m.nome}</option>`).join('');
    } catch (e) { console.error(e); }
  },

  openModalAlta() {
    document.getElementById('alta-motivo').value = '';
    showModal('modal-alta');
  },

  async confirmarAlta() {
    const motivo_saida_id = document.getElementById('alta-motivo').value;
    if (!motivo_saida_id) return toast('Selecione o motivo', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/alta`, { motivo_saida_id: parseInt(motivo_saida_id) });
      closeModal('modal-alta');
      toast('Alta registrada com sucesso!');
      await this.loadPacienteDetail();
    } catch (e) { toast(e.message, 'error'); }
  },
};

/* ─── Enter para login ─── */
document.getElementById('login-senha').addEventListener('keydown', e => {
  if (e.key === 'Enter') App.login();
});
document.getElementById('login-email').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('login-senha').focus();
});

/* ─── Fechar modais clicando no overlay ─── */
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
});

/* ─── Responsividade sidebar ─── */
window.addEventListener('resize', () => {
  if (window.innerWidth >= 1024) App.closeSidebar();
});

/* ─── Iniciar ─── */
App.checkSession();
