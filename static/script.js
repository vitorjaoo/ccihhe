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
function today() { return new Date().toISOString().split('T')[0]; }
function currentMonth() { return new Date().toISOString().slice(0, 7); }

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

function showModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

/* ─── API ────────────────────────────────────────────── */
async function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro no servidor');
  return data;
}

/* ─── AUTH & APP ─────────────────────────────────────── */
const App = {
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

  async initApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';

    const u = State.user;
    document.getElementById('nav-user-nome').textContent = u.nome;
    document.getElementById('nav-user-nivel').textContent = NIVEL_LABELS[u.nivel_acesso] || u.nivel_acesso;

    if (u.nivel_acesso === 'admin') {
      document.getElementById('nav-admin-group').style.display = 'block';
      document.getElementById('btn-imprimir-relatorio').style.display = 'inline-flex';
    }

    if (u.nivel_acesso === 'espectador') {
      document.getElementById('readonly-badge').style.display = 'flex';
      document.querySelectorAll('.write-only').forEach(el => el.style.display = 'none');
    }

    if (u.nivel_acesso === 'estagiario' && u.setor_id) {
      document.getElementById('topbar-setor').style.display = 'block';
    }

    document.getElementById('filtro-mes').value = currentMonth();
    document.getElementById('reg-data').value = today();
    document.getElementById('inf-data').value = today();

    await this.loadSetores();
    await this.loadMotivos();
    this.navigate('dashboard');
  },

  openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('show');
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
  },

  navigate(view) {
    this.closeSidebar();
    State.currentView = view;
    const titles = { dashboard: 'Dashboard Global', pacientes: 'Pacientes', 'paciente-detail': 'Detalhes do Paciente', setores: 'Setores / Alas', usuarios: 'Usuários' };
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

  /* ── Senha e Relatório ── */
  openModalSenha() {
    document.getElementById('senha-atual').value = '';
    document.getElementById('nova-senha').value = '';
    showModal('modal-senha');
  },
  
  async salvarSenha() {
    const atual = document.getElementById('senha-atual').value;
    const nova = document.getElementById('nova-senha').value;
    if(!atual || !nova) return toast('Preencha as senhas', 'error');
    try {
      await api('PUT', '/api/auth/senha', { senha_atual: atual, nova_senha: nova });
      toast('Senha atualizada com sucesso!');
      closeModal('modal-senha');
    } catch(e) {
      toast(e.message, 'error');
    }
  },

  imprimirRelatorioGeral() {
    const mes = document.getElementById('filtro-mes').value || currentMonth();
    window.open(`/relatorio-impresso?mes=${mes}`, '_blank');
  },

  /* ── Dashboard ── */
  async loadDashboard() {
    const mes = document.getElementById('filtro-mes').value || currentMonth();
    try {
      const data = await api('GET', `/api/dashboard/relatorios?mes=${mes}`);
      this.renderDashboard(data);
    } catch (e) { toast('Erro ao carregar dashboard: ' + e.message, 'error'); }
  },

  renderDashboard(data) {
    const t = data.totais;
    document.getElementById('dash-internados').textContent = t.pacientes_internados;
    document.getElementById('dash-altas').textContent = t.pacientes_alta;
    document.getElementById('dash-infeccoes').textContent = t.infeccoes_mes;

    const taxas = [
      { label: 'IH Geral', key: 'geral', icon: '📊', desc: 'Taxa geral de infecções' },
      { label: 'IH Urinário', key: 'urinario', icon: '💧', desc: 'Proporção de ITU' },
      { label: 'IH Sangue/Sepse', key: 'sepse', icon: '🩸', desc: 'Proporção de Sepse' },
      { label: 'IH Pneumonia', key: 'pneumonia', icon: '🫁', desc: 'Proporção de Pneumonia' },
      { label: 'IH Cirúrgica', key: 'cirurgica', icon: '🔪', desc: 'Proporção de Ferida Op.' }
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
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(val, 100)}%;background:${color}"></div></div>
        </div>`;
    }).join('');

    const disp = [
      { label: 'Septicemia por Cateter', key: 'cateter', icon: '🩹' },
      { label: 'PAV (Respiradores)', key: 'respirador', icon: '💨' },
      { label: 'ITU por Sonda', key: 'sonda_vesical', icon: '🔵' }
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
          <div class="progress-bar" style="margin-top:8px"><div class="progress-fill" style="width:${Math.min(val, 100)}%;background:${color}"></div></div>
        </div>`;
    }).join('');

    const maxSetor = Math.max(...(data.por_setor.map(s => s.total)), 1);
    document.getElementById('por-setor-list').innerHTML = data.por_setor.length
      ? data.por_setor.map(s => `
          <div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
              <span style="font-weight:500">${s.setor}</span><span class="badge badge-teal">${s.total}</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${(s.total/maxSetor*100).toFixed(0)}%;background:#14b8a6"></div></div>
          </div>`).join('')
      : '<p style="color:#94a3b8;font-size:13px">Nenhum internado</p>';

    document.getElementById('por-tipo-list').innerHTML = data.por_tipo.length
      ? data.por_tipo.map(t => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
            <span style="font-size:13px;font-weight:500"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${INF_COLORS[t.tipo_infeccao]||'#64748b'};margin-right:6px"></span>${t.tipo_infeccao}</span>
            <span style="font-weight:700;font-size:13px">${t.total}</span>
          </div>`).join('')
      : '<p style="color:#94a3b8;font-size:13px">Nenhuma infecção no mês</p>';

    document.getElementById('ultimas-inf-body').innerHTML = data.ultimas_infeccoes.length
      ? data.ultimas_infeccoes.map(i => `
          <tr>
            <td style="font-weight:600;color:var(--slate-800)">${i.paciente_nome}</td>
            <td><span class="badge" style="background:${(INF_COLORS[i.tipo_infeccao]||'#000')+'20'};color:${INF_COLORS[i.tipo_infeccao]||'#000'}">${i.tipo_infeccao}</span></td>
            <td>${i.setor_nome || '—'}</td>
            <td style="font-size:12px">${formatDate(i.data_notificacao)}</td>
          </tr>`).join('')
      : '<tr><td colspan="4" style="text-align:center;color:#94a3b8">Nenhum registro recente</td></tr>';
  },

  /* ── Pacientes ── */
  async loadPacientes() {
    try {
      State.pacientes = await api('GET', '/api/pacientes');
      this.renderPacientes();
    } catch(e) { toast('Erro ao carregar pacientes', 'error'); }
  },
  renderPacientes() {
    const term = document.getElementById('pac-search').value.toLowerCase();
    const list = State.pacientes.filter(p => p.nome.toLowerCase().includes(term));
    const html = list.map(p => {
      const hasInf = p.infeccoes && p.infeccoes.length > 0;
      const corBorda = hasInf ? '#ef4444' : '#14b8a6';
      const corFundo = hasInf ? '#fef2f2' : '#f0fdfa';
      return `
        <div class="card" style="padding:16px; border-left: 4px solid ${corBorda}; cursor:pointer; background:${hasInf ? corFundo : '#fff'}" onclick="App.verPaciente(${p.id})">
          <div style="font-weight:700;font-size:15px;margin-bottom:4px;color:var(--slate-800)">${p.nome}</div>
          <div style="font-size:12px;color:var(--slate-500);margin-bottom:12px">
            Prontuário: ${p.prontuario || '—'} • Idade: ${p.idade || '—'}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <span class="badge badge-gray">${p.setor_nome || 'Sem Setor'}</span>
            <span class="badge badge-gray">Leito ${p.leito || '—'}</span>
          </div>
          ${diasBadge(diffDias(p.data_internacao))}
        </div>`;
    }).join('');
    document.getElementById('pacientes-grid').innerHTML = html || '<div style="color:var(--slate-500)">Nenhum paciente encontrado.</div>';
  },
  filterPacientes() { this.renderPacientes(); },

  openModalNovoPaciente() {
    document.getElementById('np-nome').value = '';
    document.getElementById('np-idade').value = '';
    document.getElementById('np-prontuario').value = '';
    document.getElementById('np-leito').value = '';
    const sel = document.getElementById('np-setor');
    sel.innerHTML = '<option value="">Selecione...</option>' + State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
    
    if (State.user.nivel_acesso === 'estagiario') {
      document.getElementById('np-setor-wrap').style.display = 'none';
    } else {
      document.getElementById('np-setor-wrap').style.display = 'block';
    }
    showModal('modal-paciente');
  },
  async salvarPaciente() {
    const body = {
      nome: document.getElementById('np-nome').value,
      idade: document.getElementById('np-idade').value,
      prontuario: document.getElementById('np-prontuario').value,
      leito: document.getElementById('np-leito').value,
      setor_id: document.getElementById('np-setor').value
    };
    try {
      await api('POST', '/api/pacientes', body);
      toast('Paciente internado com sucesso!');
      closeModal('modal-paciente');
      this.loadPacientes();
    } catch(e) { toast(e.message, 'error'); }
  },

  /* ── Paciente Detail ── */
  async verPaciente(id) {
    try {
      const data = await api('GET', `/api/pacientes/${id}`);
      State.currentPacienteId = id;
      State.currentPacienteData = data;
      this.navigate('paciente-detail');
      this.renderPacienteDetail();
    } catch(e) { toast('Erro ao carregar detalhes', 'error'); }
  },
  renderPacienteDetail() {
    const p = State.currentPacienteData;
    document.getElementById('det-nome').textContent = p.nome;
    document.getElementById('det-sub').textContent = `Idade: ${p.idade||'—'} | Setor: ${p.setor_nome||'—'} | Leito: ${p.leito||'—'} | Prontuário: ${p.prontuario||'—'}`;
    
    // Regs
    document.getElementById('regs-list').innerHTML = p.registros.length
      ? p.registros.slice(0,5).map(r => `<span class="badge ${r.temperatura>=37.8?'badge-red':'badge-green'}">${formatDate(r.data)}: ${r.temperatura}°C</span>`).join('')
      : '<span style="font-size:12px;color:var(--slate-400)">Sem registros de temperatura</span>';

    // Procedimentos
    document.getElementById('procedimentos-list').innerHTML = p.procedimentos.length
      ? p.procedimentos.map(pr => {
          const dias = pr.status === 'ativo' ? diffDias(pr.data_insercao) : null;
          return `
            <div class="proc-item">
              <div class="proc-item-left">
                <span style="font-size:16px">${pr.status === 'ativo'?'🔵':'⚪'}</span>
                <div>
                  <div style="font-size:13px;font-weight:600;color:var(--slate-800)">${pr.tipo_procedimento}</div>
                  <div style="font-size:11px;color:var(--slate-400)">Ins: ${formatDate(pr.data_insercao)} ${pr.data_remocao ? '| Rem: '+formatDate(pr.data_remocao) : ''}</div>
                </div>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                ${pr.status==='ativo' ? diasBadge(dias) : '<span class="badge badge-gray">Removido</span>'}
                ${pr.status==='ativo' && State.user.nivel_acesso !== 'espectador' ? `<button class="btn btn-ghost btn-sm write-only" style="padding:2px 6px" onclick="App.openModalRemProc(${pr.id})">Remover</button>` : ''}
              </div>
            </div>`;
        }).join('')
      : '<div style="font-size:13px;color:var(--slate-400)">Nenhum dispositivo registrado.</div>';

    // Infeccoes
    document.getElementById('infeccoes-tbody').innerHTML = p.infeccoes.length
      ? p.infeccoes.map(i => `<tr><td style="font-weight:600">${i.tipo_infeccao}</td><td style="font-size:13px">${formatDate(i.data_notificacao)}</td></tr>`).join('')
      : '<tr><td colspan="2" style="text-align:center;color:#94a3b8">Nenhuma infecção.</td></tr>';
  },

  async addRegistro() {
    const data = document.getElementById('reg-data').value;
    const temp = parseFloat(document.getElementById('reg-temp').value);
    if (!data || !temp) return toast('Preencha os dados', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/registros`, { data, temperatura: temp });
      toast('Temperatura registrada!');
      document.getElementById('reg-temp').value = '';
      this.verPaciente(State.currentPacienteId);
    } catch(e) { toast(e.message, 'error'); }
  },

  openModalProc() {
    const sel = document.getElementById('proc-tipo');
    sel.innerHTML = '<option value="">Selecione...</option>' + PROCEDIMENTOS_LIST.map(p => `<option value="${p}">${p}</option>`).join('');
    document.getElementById('proc-data').value = today();
    showModal('modal-proc');
  },
  async salvarProc() {
    const tipo = document.getElementById('proc-tipo').value;
    const data_ins = document.getElementById('proc-data').value;
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/procedimentos`, { tipo_procedimento: tipo, data_insercao: data_ins });
      toast('Dispositivo inserido!');
      closeModal('modal-proc');
      this.verPaciente(State.currentPacienteId);
    } catch(e) { toast(e.message, 'error'); }
  },

  openModalRemProc(id) {
    State.pendingProcId = id;
    document.getElementById('rem-proc-data').value = today();
    showModal('modal-rem-proc');
  },
  async confirmarRemoverProc() {
    try {
      await api('POST', `/api/procedimentos/${State.pendingProcId}/remover`, { data_remocao: document.getElementById('rem-proc-data').value });
      toast('Dispositivo removido!');
      closeModal('modal-rem-proc');
      this.verPaciente(State.currentPacienteId);
    } catch(e) { toast(e.message, 'error'); }
  },

  openModalInf() { showModal('modal-inf'); },
  async salvarInf() {
    const body = { tipo_infeccao: document.getElementById('inf-tipo').value, data_notificacao: document.getElementById('inf-data').value };
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/infeccoes`, body);
      toast('Infecção notificada com sucesso!');
      closeModal('modal-inf');
      this.verPaciente(State.currentPacienteId);
    } catch(e) { toast(e.message, 'error'); }
  },

  openModalAlta() {
    const sel = document.getElementById('ma-motivo');
    sel.innerHTML = '<option value="">Selecione...</option>' + State.motivos.map(m => `<option value="${m.id}">${m.nome}</option>`).join('');
    showModal('modal-alta');
  },
  async confirmarAlta() {
    const motivo_id = document.getElementById('ma-motivo').value;
    if (!motivo_id) return toast('Selecione um motivo', 'error');
    try {
      await api('POST', `/api/pacientes/${State.currentPacienteId}/alta`, { motivo_saida_id: motivo_id });
      toast('Alta registrada!');
      closeModal('modal-alta');
      this.navigate('pacientes');
    } catch(e) { toast(e.message, 'error'); }
  },

  /* ── Setores e Motivos ── */
  async loadMotivos() { State.motivos = await api('GET', '/api/motivos_saida').catch(()=>[]); },
  async loadSetores() { State.setores = await api('GET', '/api/setores').catch(()=>[]); },
  async loadSetoresView() {
    await this.loadSetores();
    const html = State.setores.map(s => `<tr><td>${s.id}</td><td style="font-weight:600">${s.nome}</td><td class="write-only"><button class="btn btn-ghost btn-sm" onclick="App.deleteSetor(${s.id})">Excluir</button></td></tr>`).join('');
    document.getElementById('setores-tbody').innerHTML = html || '<tr><td colspan="3">Nenhum setor.</td></tr>';
  },
  openModalNovoSetor() { document.getElementById('ns-nome').value = ''; showModal('modal-setor'); },
  async salvarSetor() {
    try {
      await api('POST', '/api/setores', { nome: document.getElementById('ns-nome').value });
      toast('Setor adicionado');
      closeModal('modal-setor');
      this.loadSetoresView();
    } catch(e) { toast(e.message, 'error'); }
  },
  async deleteSetor(id) {
    if(!confirm('Certeza que deseja excluir?')) return;
    try { await api('DELETE', `/api/setores/${id}`); toast('Excluído'); this.loadSetoresView(); } catch(e){ toast(e.message, 'error'); }
  },

  /* ── Usuarios ── */
  async loadUsuarios() {
    try {
      const users = await api('GET', '/api/usuarios');
      document.getElementById('usuarios-tbody').innerHTML = users.map(u => `<tr><td style="font-weight:600">${u.nome}</td><td>${u.email}</td><td><span class="badge badge-gray">${u.nivel_acesso}</span></td><td>${u.setor_nome||'—'}</td><td class="write-only"><button class="btn btn-danger btn-sm" onclick="App.deleteUsuario(${u.id})">Excluir</button></td></tr>`).join('');
    } catch(e) { toast('Erro ao carregar usuários', 'error'); }
  },
  openModalNovoUser() {
    document.getElementById('nu-nome').value = ''; document.getElementById('nu-email').value = ''; document.getElementById('nu-senha').value = ''; document.getElementById('nu-nivel').value = '';
    const sel = document.getElementById('nu-setor');
    sel.innerHTML = '<option value="">Sem restrição</option>' + State.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
    this.onNivelChange();
    showModal('modal-user');
  },
  onNivelChange() { document.getElementById('nu-setor-wrap').style.display = document.getElementById('nu-nivel').value === 'estagiario' ? 'block' : 'none'; },
  async salvarUsuario() {
    const body = { nome: document.getElementById('nu-nome').value, email: document.getElementById('nu-email').value, senha: document.getElementById('nu-senha').value, nivel_acesso: document.getElementById('nu-nivel').value, setor_id: document.getElementById('nu-setor').value };
    try { await api('POST', '/api/usuarios', body); toast('Usuário cadastrado!'); closeModal('modal-user'); this.loadUsuarios(); } catch(e) { toast(e.message, 'error'); }
  },
  async deleteUsuario(id) {
    if(!confirm('Excluir usuário?')) return;
    try { await api('DELETE', `/api/usuarios/${id}`); toast('Excluído'); this.loadUsuarios(); } catch(e) { toast(e.message, 'error'); }
  }
};

document.addEventListener('DOMContentLoaded', () => App.checkSession());
