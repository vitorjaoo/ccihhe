import os
import json
import hashlib
from datetime import datetime, date
from functools import wraps
from flask import Flask, request, jsonify, render_template, session
import libsql_client
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'ccih_secret_2024_xK9mP')

# ---------------------------------------------------------------------------
# DATABASE SETUP (Turso Cloud Database Adapter)
# ---------------------------------------------------------------------------
TURSO_URL = os.environ.get('libsql://cchi-vitorrastrep.aws-us-east-2.turso.io')
TURSO_TOKEN = os.environ.get('eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU2MDUxNDMsImlkIjoiMDE5ZDY4MmYtMDAwMS03N2IxLThhYjQtZmEyMGZlOTg4NTg5IiwicmlkIjoiOWNmYzg2YmEtMGRmOC00YzVhLWI3MTQtYzVmYmMzNGYxYWE1In0.tpWLgFLeSPFZwn65LYV9pWzwASNdyfgfdOVBUjWc8rW1OZg4_rHMjbgMIETPoKSlen4_-1_UobSY3wDxa2NrDA')

if not TURSO_URL or not TURSO_TOKEN:
    raise RuntimeError("[CCIH] ERRO CRÍTICO: TURSO_URL e TURSO_TOKEN são obrigatórios! Defina as variáveis de ambiente.")

print(f"[CCIH] Conectando ao banco: {TURSO_URL}")


class TursoCursor:
    def __init__(self, rs=None):
        if rs:
            self.rows = [dict(zip(rs.columns, row)) for row in rs.rows]
            self.tuples = [tuple(row) for row in rs.rows]
            self.lastrowid = rs.last_insert_rowid
        else:
            self.rows = []
            self.tuples = []
            self.lastrowid = None

    def fetchone(self):
        if not self.rows:
            return None
        class RowDict(dict):
            def __init__(self, d, t):
                super().__init__(d)
                self.t = t
            def __getitem__(self, key):
                if isinstance(key, int):
                    return self.t[key]
                return super().__getitem__(key)
        return RowDict(self.rows[0], self.tuples[0])

    def fetchall(self):
        return self.rows


class TursoAdapter:
    def __init__(self):
        print(f"[DB] URL={TURSO_URL[:40]}... TOKEN={'sim' if TURSO_TOKEN else 'NAO'}")
        if TURSO_URL.startswith("file:"):
            self.client = libsql_client.create_client_sync(url=TURSO_URL)
        else:
            if not TURSO_TOKEN:
                raise Exception("TURSO_TOKEN não configurado!")
            self.client = libsql_client.create_client_sync(url=TURSO_URL, auth_token=TURSO_TOKEN)

    def cursor(self):
        return self

    def execute(self, sql, params=()):
        if not isinstance(params, (tuple, list)):
            params = (params,)
        rs = self.client.execute(sql, params)
        return TursoCursor(rs)

    def executescript(self, sql_script):
        statements = [s.strip() for s in sql_script.split(';') if s.strip()]
        if statements:
            self.client.batch(statements)

    def commit(self):
        pass

    def close(self):
        self.client.close()


def get_db():
    return TursoAdapter()


def hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def init_db():
    try:
        conn = get_db()
        c = conn.cursor()
        c.executescript("""
        CREATE TABLE IF NOT EXISTS setores ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE );
        CREATE TABLE IF NOT EXISTS usuarios ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, senha TEXT NOT NULL, nivel_acesso TEXT NOT NULL CHECK(nivel_acesso IN ('admin','estagiario','espectador')), setor_id INTEGER REFERENCES setores(id) );
        CREATE TABLE IF NOT EXISTS motivos_saida ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE );
        CREATE TABLE IF NOT EXISTS pacientes ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, idade INTEGER, leito TEXT, prontuario TEXT, fone TEXT, setor_id_atual INTEGER REFERENCES setores(id), status TEXT NOT NULL DEFAULT 'internado' CHECK(status IN ('internado','alta')), motivo_saida_id INTEGER REFERENCES motivos_saida(id), data_internacao TEXT DEFAULT (date('now')) );
        CREATE TABLE IF NOT EXISTS registros_diarios ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), data TEXT NOT NULL DEFAULT (date('now')), temperatura REAL );
        CREATE TABLE IF NOT EXISTS procedimentos ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), tipo_procedimento TEXT NOT NULL, data_insercao TEXT NOT NULL, data_remocao TEXT, status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','removido')) );
        CREATE TABLE IF NOT EXISTS infeccoes_notificadas ( id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER NOT NULL REFERENCES pacientes(id), tipo_infeccao TEXT NOT NULL, data_notificacao TEXT NOT NULL DEFAULT (date('now')) )
        """)
        motivos = ['Alta Médica', 'Óbito', 'Transferência para outro hospital']
        for m in motivos:
            c.execute("INSERT OR IGNORE INTO motivos_saida(nome) VALUES(?)", (m,))
        c.execute("INSERT OR IGNORE INTO setores(nome) VALUES('UTI Geral')")
        c.execute("INSERT OR IGNORE INTO setores(nome) VALUES('Clínica Cirúrgica')")
        c.execute("INSERT OR IGNORE INTO setores(nome) VALUES('Clínica Médica')")

        admin_check = c.execute("SELECT * FROM usuarios WHERE email='admin@ccih.com'").fetchone()
        if not admin_check:
            c.execute(
                "INSERT INTO usuarios(nome, email, senha, nivel_acesso, setor_id) VALUES('Administrador', 'admin@ccih.com', ?, 'admin', NULL)",
                (hash_password('admin123'),)
            )
        conn.commit()
        conn.close()
        print("[CCIH] Banco Inicializado.")
    except Exception as e:
        print(f"[CCIH] ERRO CRÍTICO no init_db: {e}")
        raise


# ---------------------------------------------------------------------------
# AUTH HELPERS & ROUTES
# ---------------------------------------------------------------------------
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Não autenticado'}), 401
        return f(*args, **kwargs)
    return decorated


def not_readonly(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get('nivel_acesso') == 'espectador':
            return jsonify({'error': 'Acesso somente leitura'}), 403
        return f(*args, **kwargs)
    return decorated


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json or {}
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '')
    if not email or not senha:
        return jsonify({'error': 'Campos obrigatórios'}), 400
    conn = get_db()
    user = conn.execute("SELECT * FROM usuarios WHERE email=?", (email,)).fetchone()
    conn.close()
    if not user or user['senha'] != hash_password(senha):
        return jsonify({'error': 'Credenciais inválidas'}), 401
    session['user_id'] = user['id']
    session['nivel_acesso'] = user['nivel_acesso']
    session['setor_id'] = user['setor_id']
    session['nome'] = user['nome']
    return jsonify({'id': user['id'], 'nome': user['nome'], 'nivel_acesso': user['nivel_acesso'], 'setor_id': user['setor_id']})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/auth/me', methods=['GET'])
@login_required
def me():
    return jsonify({'id': session['user_id'], 'nome': session['nome'], 'nivel_acesso': session['nivel_acesso'], 'setor_id': session['setor_id']})


@app.route('/api/auth/senha', methods=['PUT'])
@login_required
def change_password():
    data = request.json or {}
    senha_atual = data.get('senha_atual', '')
    nova_senha = data.get('nova_senha', '')
    conn = get_db()
    user = conn.execute("SELECT senha FROM usuarios WHERE id=?", (session['user_id'],)).fetchone()
    if hash_password(senha_atual) != user['senha']:
        conn.close()
        return jsonify({'error': 'A senha atual está incorreta'}), 401
    if len(nova_senha) < 6:
        conn.close()
        return jsonify({'error': 'A nova senha deve ter no mínimo 6 caracteres'}), 400
    conn.execute("UPDATE usuarios SET senha=? WHERE id=?", (hash_password(nova_senha), session['user_id']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# API ROUTES (Setores, Usuarios, Pacientes...)
# ---------------------------------------------------------------------------
@app.route('/api/setores', methods=['GET'])
@login_required
def get_setores():
    conn = get_db()
    rows = conn.execute("SELECT * FROM setores ORDER BY nome").fetchall()
    conn.close()
    return jsonify(rows)


@app.route('/api/setores', methods=['POST'])
@login_required
@not_readonly
def create_setor():
    if session['nivel_acesso'] != 'admin':
        return jsonify({'error': 'Apenas admin'}), 403
    nome = (request.json or {}).get('nome', '').strip()
    if not nome:
        return jsonify({'error': 'Nome obrigatório'}), 400
    conn = get_db()
    try:
        conn.execute("INSERT INTO setores(nome) VALUES(?)", (nome,))
        conn.commit()
        setor = conn.execute("SELECT * FROM setores WHERE nome=?", (nome,)).fetchone()
    except:
        conn.close()
        return jsonify({'error': 'Setor já existe'}), 409
    conn.close()
    return jsonify(setor), 201


@app.route('/api/setores/<int:sid>', methods=['DELETE'])
@login_required
@not_readonly
def delete_setor(sid):
    if session['nivel_acesso'] != 'admin':
        return jsonify({'error': 'Apenas admin'}), 403
    conn = get_db()
    conn.execute("DELETE FROM setores WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/usuarios', methods=['GET'])
@login_required
def get_usuarios():
    if session['nivel_acesso'] not in ('admin', 'espectador'):
        return jsonify({'error': 'Sem permissão'}), 403
    conn = get_db()
    rows = conn.execute(
        "SELECT u.id, u.nome, u.email, u.nivel_acesso, u.setor_id, s.nome as setor_nome FROM usuarios u LEFT JOIN setores s ON s.id=u.setor_id ORDER BY u.nome"
    ).fetchall()
    conn.close()
    return jsonify(rows)


@app.route('/api/usuarios', methods=['POST'])
@login_required
@not_readonly
def create_usuario():
    if session['nivel_acesso'] != 'admin':
        return jsonify({'error': 'Apenas admin'}), 403
    data = request.json or {}
    nome = data.get('nome', '').strip()
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '').strip()
    nivel = data.get('nivel_acesso', '')
    setor_id = data.get('setor_id') or None
    if not all([nome, email, senha, nivel]) or nivel not in ('admin', 'estagiario', 'espectador'):
        return jsonify({'error': 'Dados inválidos'}), 400
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO usuarios(nome,email,senha,nivel_acesso,setor_id) VALUES(?,?,?,?,?)",
            (nome, email, hash_password(senha), nivel, setor_id)
        )
        conn.commit()
        u = conn.execute("SELECT id,nome,email,nivel_acesso,setor_id FROM usuarios WHERE email=?", (email,)).fetchone()
    except:
        conn.close()
        return jsonify({'error': 'Email já cadastrado'}), 409
    conn.close()
    return jsonify(u), 201


@app.route('/api/usuarios/<int:uid>', methods=['DELETE'])
@login_required
@not_readonly
def delete_usuario(uid):
    if session['nivel_acesso'] != 'admin':
        return jsonify({'error': 'Apenas admin'}), 403
    if uid == session['user_id']:
        return jsonify({'error': 'Não pode excluir a si mesmo'}), 400
    conn = get_db()
    conn.execute("DELETE FROM usuarios WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/pacientes', methods=['GET'])
@login_required
def get_pacientes():
    nivel = session['nivel_acesso']
    setor_id = session['setor_id']
    conn = get_db()
    try:
        if nivel == 'estagiario' and setor_id:
            rows = conn.execute(
                "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id = p.setor_id_atual WHERE p.setor_id_atual=? AND p.status='internado' ORDER BY p.nome",
                (setor_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id = p.setor_id_atual WHERE p.status='internado' ORDER BY s.nome, p.nome"
            ).fetchall()
        for p in rows:
            p['procedimentos'] = conn.execute(
                "SELECT * FROM procedimentos WHERE paciente_id=? AND status='ativo'", (p['id'],)
            ).fetchall()
            p['infeccoes'] = conn.execute(
                "SELECT * FROM infeccoes_notificadas WHERE paciente_id=?", (p['id'],)
            ).fetchall()
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500
    conn.close()
    return jsonify(rows)


@app.route('/api/pacientes', methods=['POST'])
@login_required
@not_readonly
def create_paciente():
    if session['nivel_acesso'] == 'espectador':
        return jsonify({'error': 'Sem permissão'}), 403
    data = request.json or {}
    nome = data.get('nome', '').strip()
    if not nome:
        return jsonify({'error': 'Nome obrigatório'}), 400
    setor_id = data.get('setor_id')
    idade = data.get('idade')
    if not setor_id or str(setor_id).strip() == '':
        setor_id = None
    if not idade or str(idade).strip() == '':
        idade = None
    if session['nivel_acesso'] == 'estagiario':
        setor_id = session['setor_id']
    conn = get_db()
    try:
        cursor = conn.execute(
            "INSERT INTO pacientes(nome, idade, leito, prontuario, fone, setor_id_atual, status) VALUES(?,?,?,?,?,?,'internado')",
            (nome, idade, data.get('leito', '').strip(), data.get('prontuario', '').strip(), data.get('fone', '').strip(), setor_id)
        )
        conn.commit()
        pac = conn.execute(
            "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?",
            (cursor.lastrowid,)
        ).fetchone()
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500
    conn.close()
    return jsonify(pac), 201


@app.route('/api/pacientes/<int:pid>', methods=['GET'])
@login_required
def get_paciente(pid):
    conn = get_db()
    pac = conn.execute(
        "SELECT p.*, s.nome as setor_nome FROM pacientes p LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE p.id=?",
        (pid,)
    ).fetchone()
    if not pac:
        conn.close()
        return jsonify({'error': 'Não encontrado'}), 404
    if session['nivel_acesso'] == 'estagiario' and pac['setor_id_atual'] != session['setor_id']:
        conn.close()
        return jsonify({'error': 'Sem permissão'}), 403
    pac['registros'] = conn.execute(
        "SELECT * FROM registros_diarios WHERE paciente_id=? ORDER BY data DESC", (pid,)
    ).fetchall()
    pac['procedimentos'] = conn.execute(
        "SELECT * FROM procedimentos WHERE paciente_id=? ORDER BY data_insercao DESC", (pid,)
    ).fetchall()
    pac['infeccoes'] = conn.execute(
        "SELECT * FROM infeccoes_notificadas WHERE paciente_id=? ORDER BY data_notificacao DESC", (pid,)
    ).fetchall()
    conn.close()
    return jsonify(pac)


@app.route('/api/pacientes/<int:pid>/alta', methods=['POST'])
@login_required
@not_readonly
def dar_alta(pid):
    motivo_id = (request.json or {}).get('motivo_saida_id')
    if not motivo_id:
        return jsonify({'error': 'Motivo obrigatório'}), 400
    conn = get_db()
    pac = conn.execute("SELECT * FROM pacientes WHERE id=?", (pid,)).fetchone()
    if not pac:
        conn.close()
        return jsonify({'error': 'Não encontrado'}), 404
    if session['nivel_acesso'] == 'estagiario' and pac['setor_id_atual'] != session['setor_id']:
        conn.close()
        return jsonify({'error': 'Sem permissão'}), 403
    conn.execute("UPDATE pacientes SET status='alta', motivo_saida_id=? WHERE id=?", (motivo_id, pid))
    conn.execute("UPDATE procedimentos SET status='removido', data_remocao=date('now') WHERE paciente_id=? AND status='ativo'", (pid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/pacientes/<int:pid>/registros', methods=['POST'])
@login_required
@not_readonly
def add_registro(pid):
    data = request.json or {}
    conn = get_db()
    conn.execute(
        "INSERT INTO registros_diarios(paciente_id, data, temperatura) VALUES(?,?,?)",
        (pid, data.get('data') or date.today().isoformat(), data.get('temperatura'))
    )
    conn.commit()
    reg = conn.execute(
        "SELECT * FROM registros_diarios WHERE paciente_id=? ORDER BY id DESC LIMIT 1", (pid,)
    ).fetchone()
    conn.close()
    return jsonify(reg), 201


@app.route('/api/pacientes/<int:pid>/procedimentos', methods=['POST'])
@login_required
@not_readonly
def add_procedimento(pid):
    data = request.json or {}
    tipo = data.get('tipo_procedimento', '').strip()
    data_ins = data.get('data_insercao', '').strip()
    if not tipo or not data_ins:
        return jsonify({'error': 'Dados obrigatórios'}), 400
    conn = get_db()
    conn.execute(
        "INSERT INTO procedimentos(paciente_id, tipo_procedimento, data_insercao, status) VALUES(?,?,?,'ativo')",
        (pid, tipo, data_ins)
    )
    conn.commit()
    proc = conn.execute(
        "SELECT * FROM procedimentos WHERE paciente_id=? ORDER BY id DESC LIMIT 1", (pid,)
    ).fetchone()
    conn.close()
    return jsonify(proc), 201


@app.route('/api/procedimentos/<int:proc_id>/remover', methods=['POST'])
@login_required
@not_readonly
def remover_procedimento(proc_id):
    data_rem = (request.json or {}).get('data_remocao') or date.today().isoformat()
    conn = get_db()
    conn.execute("UPDATE procedimentos SET status='removido', data_remocao=? WHERE id=?", (data_rem, proc_id))
    conn.commit()
    proc = conn.execute("SELECT * FROM procedimentos WHERE id=?", (proc_id,)).fetchone()
    conn.close()
    return jsonify(proc)


TIPOS_INFECCAO = ['Trato Urinário', 'Sepse', 'Pneumonia', 'Ferida Operatória', 'Outra']


@app.route('/api/pacientes/<int:pid>/infeccoes', methods=['POST'])
@login_required
@not_readonly
def add_infeccao(pid):
    data = request.json or {}
    tipo = data.get('tipo_infeccao', '').strip()
    if tipo not in TIPOS_INFECCAO:
        return jsonify({'error': 'Tipo inválido'}), 400
    conn = get_db()
    conn.execute(
        "INSERT INTO infeccoes_notificadas(paciente_id, tipo_infeccao, data_notificacao) VALUES(?,?,?)",
        (pid, tipo, data.get('data_notificacao') or date.today().isoformat())
    )
    conn.commit()
    inf = conn.execute(
        "SELECT * FROM infeccoes_notificadas WHERE paciente_id=? ORDER BY id DESC LIMIT 1", (pid,)
    ).fetchone()
    conn.close()
    return jsonify(inf), 201


@app.route('/api/motivos_saida', methods=['GET'])
@login_required
def get_motivos():
    conn = get_db()
    rows = conn.execute("SELECT * FROM motivos_saida ORDER BY nome").fetchall()
    conn.close()
    return jsonify(rows)


# ---------------------------------------------------------------------------
# DASHBOARD
# ---------------------------------------------------------------------------
@app.route('/api/dashboard/relatorios', methods=['GET'])
@login_required
def relatorios():
    mes = request.args.get('mes') or date.today().strftime('%Y-%m')
    ano_mes = mes[:7]
    nivel = session['nivel_acesso']

    filtro_setor = session.get('setor_id') if nivel == 'estagiario' else None
    wp = " AND p.setor_id_atual = ?" if filtro_setor else ""
    params = [filtro_setor] if filtro_setor else []

    conn = get_db()
    try:
        pac_alta_row = conn.execute(
            f"SELECT COUNT(DISTINCT p.id) as total FROM pacientes p WHERE p.status='alta' {wp}", params
        ).fetchone()
        pacientes_alta = int(pac_alta_row['total']) if pac_alta_row else 0

        inf_mes_row = conn.execute(
            f"SELECT COUNT(i.id) as total FROM infeccoes_notificadas i JOIN pacientes p ON p.id = i.paciente_id WHERE strftime('%Y-%m', i.data_notificacao)=? {wp}",
            [ano_mes] + params
        ).fetchone()
        total_inf = int(inf_mes_row['total']) if inf_mes_row else 0

        por_tipo = conn.execute(
            f"SELECT i.tipo_infeccao, COUNT(i.id) as total FROM infeccoes_notificadas i JOIN pacientes p ON p.id = i.paciente_id WHERE strftime('%Y-%m', i.data_notificacao)=? {wp} GROUP BY i.tipo_infeccao",
            [ano_mes] + params
        ).fetchall()

        def get_inf(tipo):
            for item in por_tipo:
                if item['tipo_infeccao'] == tipo:
                    return int(item['total'])
            return 0

        taxa_geral = round((total_inf / pacientes_alta * 100) if pacientes_alta > 0 else 0, 2)

        def taxa_prop(n):
            return round((n / total_inf * 100) if total_inf > 0 else 0, 2)

        cateteres = ('cateter venoso central punção', 'cateter venoso central dessecação', 'cateter swan ganz')
        tot_cat = conn.execute(
            f"SELECT COUNT(DISTINCT pr.paciente_id) as total FROM procedimentos pr JOIN pacientes p ON p.id = pr.paciente_id WHERE lower(pr.tipo_procedimento) IN (?, ?, ?) {wp}",
            cateteres + tuple(params)
        ).fetchone()
        tot_cateter = int(tot_cat['total']) if tot_cat else 0

        sepse_cat = conn.execute(
            f"SELECT COUNT(DISTINCT i.paciente_id) as total FROM infeccoes_notificadas i JOIN procedimentos pr ON i.paciente_id = pr.paciente_id JOIN pacientes p ON p.id = i.paciente_id WHERE i.tipo_infeccao = 'Sepse' AND lower(pr.tipo_procedimento) IN (?, ?, ?) AND strftime('%Y-%m', i.data_notificacao) = ? {wp}",
            cateteres + (ano_mes,) + tuple(params)
        ).fetchone()
        pac_sepse_cateter = int(sepse_cat['total']) if sepse_cat else 0
        taxa_cateter = round((pac_sepse_cateter / tot_cateter * 100) if tot_cateter > 0 else 0, 2)

        resps = ('respiração artificial', 'entubação')
        tot_resp = conn.execute(
            f"SELECT COUNT(DISTINCT pr.paciente_id) as total FROM procedimentos pr JOIN pacientes p ON p.id = pr.paciente_id WHERE lower(pr.tipo_procedimento) IN (?, ?) {wp}",
            resps + tuple(params)
        ).fetchone()
        tot_resp_int = int(tot_resp['total']) if tot_resp else 0

        pneu_resp = conn.execute(
            f"SELECT COUNT(DISTINCT i.paciente_id) as total FROM infeccoes_notificadas i JOIN procedimentos pr ON i.paciente_id = pr.paciente_id JOIN pacientes p ON p.id = i.paciente_id WHERE i.tipo_infeccao = 'Pneumonia' AND lower(pr.tipo_procedimento) IN (?, ?) AND strftime('%Y-%m', i.data_notificacao) = ? {wp}",
            resps + (ano_mes,) + tuple(params)
        ).fetchone()
        pac_pneumonia_resp = int(pneu_resp['total']) if pneu_resp else 0
        taxa_respirador = round((pac_pneumonia_resp / tot_resp_int * 100) if tot_resp_int > 0 else 0, 2)

        tot_sonda = conn.execute(
            f"SELECT COUNT(DISTINCT pr.paciente_id) as total FROM procedimentos pr JOIN pacientes p ON p.id = pr.paciente_id WHERE lower(pr.tipo_procedimento) = 'sonda vesical' {wp}",
            tuple(params)
        ).fetchone()
        tot_sonda_int = int(tot_sonda['total']) if tot_sonda else 0

        uri_sonda = conn.execute(
            f"SELECT COUNT(DISTINCT i.paciente_id) as total FROM infeccoes_notificadas i JOIN procedimentos pr ON i.paciente_id = pr.paciente_id JOIN pacientes p ON p.id = i.paciente_id WHERE i.tipo_infeccao = 'Trato Urinário' AND lower(pr.tipo_procedimento) = 'sonda vesical' AND strftime('%Y-%m', i.data_notificacao) = ? {wp}",
            (ano_mes,) + tuple(params)
        ).fetchone()
        pac_urinario_sonda = int(uri_sonda['total']) if uri_sonda else 0
        taxa_sonda = round((pac_urinario_sonda / tot_sonda_int * 100) if tot_sonda_int > 0 else 0, 2)

        por_setor = conn.execute(
            f"SELECT s.nome as setor, COUNT(p.id) as total FROM pacientes p JOIN setores s ON s.id=p.setor_id_atual WHERE p.status='internado' {wp} GROUP BY s.id ORDER BY s.nome",
            tuple(params)
        ).fetchall()
        ultimas_inf = conn.execute(
            f"SELECT i.*, p.nome as paciente_nome, s.nome as setor_nome FROM infeccoes_notificadas i JOIN pacientes p ON p.id=i.paciente_id LEFT JOIN setores s ON s.id=p.setor_id_atual WHERE 1=1 {wp} ORDER BY i.id DESC LIMIT 10",
            tuple(params)
        ).fetchall()

    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500

    conn.close()
    return jsonify({
        'mes': ano_mes,
        'taxas': {
            'geral': taxa_geral,
            'urinario': taxa_prop(get_inf('Trato Urinário')),
            'sepse': taxa_prop(get_inf('Sepse')),
            'pneumonia': taxa_prop(get_inf('Pneumonia')),
            'cirurgica': taxa_prop(get_inf('Ferida Operatória')),
            'cateter': taxa_cateter,
            'respirador': taxa_respirador,
            'sonda_vesical': taxa_sonda,
        },
        'totais': {
            'pacientes_alta': pacientes_alta,
            'infeccoes_mes': total_inf,
            'pacientes_internados': sum(int(s['total']) for s in por_setor),
        },
        'por_setor': por_setor,
        'por_tipo': por_tipo,
        'ultimas_infeccoes': ultimas_inf,
    })


# ---------------------------------------------------------------------------
# RELATÓRIO IMPRESSO
# ---------------------------------------------------------------------------
@app.route('/relatorio-impresso', methods=['GET'])
@login_required
def relatorio_impresso():
    if session.get('nivel_acesso') != 'admin':
        return "Acesso restrito. Apenas administradores podem gerar este relatório.", 403

    mes = request.args.get('mes') or date.today().strftime('%Y-%m')
    ano_mes = mes[:7]
    conn = get_db()

    setores = conn.execute("SELECT * FROM setores ORDER BY nome").fetchall()

    html = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>Relatório Mensal CCIH - {ano_mes}</title>
        <style>
            body {{ font-family: Arial, sans-serif; color: #333; margin: 40px; }}
            h1, h2, h3 {{ color: #0d9488; }}
            table {{ width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px; }}
            th, td {{ border: 1px solid #ddd; padding: 10px; text-align: left; }}
            th {{ background-color: #f8fafc; font-weight: bold; }}
            .header {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0d9488; padding-bottom: 10px; margin-bottom: 30px; }}
            .btn-print {{ background: #0d9488; color: white; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; border: none; }}
            .disclaimer {{ margin-top: 40px; padding: 15px; background-color: #fffbeb; border: 1px solid #fef08a; border-radius: 8px; font-size: 13px; color: #854d0e; }}
            @media print {{ .no-print {{ display: none; }} }}
        </style>
    </head>
    <body>
        <div class="no-print" style="text-align: right; margin-bottom: 20px;">
            <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
        </div>
        <div class="header">
            <div style="display: flex; align-items: center; gap: 15px;">
                <img src="/static/logoufal.png" alt="Logo UFAL" style="height: 60px; object-fit: contain;">
                <div>
                    <h1 style="margin:0;">Hospital / Clínica</h1>
                    <p style="margin:5px 0 0 0;">Relatório Geral de Controle de Infecção Hospitalar (CCIH)</p>
                </div>
            </div>
            <div style="text-align:right;">
                <h2>Mês de Referência: {ano_mes}</h2>
                <p>Gerado em: {date.today().strftime('%d/%m/%Y')}</p>
            </div>
        </div>
    """

    def compute_stats(setor_id=None):
        wp = " AND p.setor_id_atual = ?" if setor_id else ""
        params = [setor_id] if setor_id else []

        ir = conn.execute(f"SELECT COUNT(p.id) as total FROM pacientes p WHERE p.status='internado'{wp}", params).fetchone()
        internados = int(ir['total']) if ir else 0

        ar = conn.execute(f"SELECT COUNT(DISTINCT p.id) as total FROM pacientes p WHERE p.status='alta'{wp}", params).fetchone()
        altas = int(ar['total']) if ar else 0

        ifr = conn.execute(
            f"SELECT COUNT(i.id) as total FROM infeccoes_notificadas i JOIN pacientes p ON p.id=i.paciente_id WHERE strftime('%Y-%m', i.data_notificacao)=?{wp}",
            [ano_mes] + params
        ).fetchone()
        infeccoes = int(ifr['total']) if ifr else 0

        taxa_geral = round((infeccoes / altas * 100) if altas > 0 else 0, 2)

        cat = ('cateter venoso central punção', 'cateter venoso central dessecação', 'cateter swan ganz')
        tc = int(conn.execute(f"SELECT COUNT(DISTINCT pr.paciente_id) as total FROM procedimentos pr JOIN pacientes p ON p.id=pr.paciente_id WHERE lower(pr.tipo_procedimento) IN (?,?,?) {wp}", cat + tuple(params)).fetchone()['total'])
        sc = int(conn.execute(f"SELECT COUNT(DISTINCT i.paciente_id) as total FROM infeccoes_notificadas i JOIN procedimentos pr ON i.paciente_id=pr.paciente_id JOIN pacientes p ON p.id=i.paciente_id WHERE i.tipo_infeccao='Sepse' AND lower(pr.tipo_procedimento) IN (?,?,?) AND strftime('%Y-%m', i.data_notificacao)=? {wp}", cat + (ano_mes,) + tuple(params)).fetchone()['total'])
        taxa_cat = round((sc / tc * 100) if tc > 0 else 0, 2)

        rp = ('respiração artificial', 'entubação')
        tr = int(conn.execute(f"SELECT COUNT(DISTINCT pr.paciente_id) as total FROM procedimentos pr JOIN pacientes p ON p.id=pr.paciente_id WHERE lower(pr.tipo_procedimento) IN (?,?) {wp}", rp + tuple(params)).fetchone()['total'])
        pr = int(conn.execute(f"SELECT COUNT(DISTINCT i.paciente_id) as total FROM infeccoes_notificadas i JOIN procedimentos pr ON i.paciente_id=pr.paciente_id JOIN pacientes p ON p.id=i.paciente_id WHERE i.tipo_infeccao='Pneumonia' AND lower(pr.tipo_procedimento) IN (?,?) AND strftime('%Y-%m', i.data_notificacao)=? {wp}", rp + (ano_mes,) + tuple(params)).fetchone()['total'])
        taxa_resp = round((pr / tr * 100) if tr > 0 else 0, 2)

        ts = int(conn.execute(f"SELECT COUNT(DISTINCT pr.paciente_id) as total FROM procedimentos pr JOIN pacientes p ON p.id=pr.paciente_id WHERE lower(pr.tipo_procedimento)='sonda vesical' {wp}", tuple(params)).fetchone()['total'])
        us = int(conn.execute(f"SELECT COUNT(DISTINCT i.paciente_id) as total FROM infeccoes_notificadas i JOIN procedimentos pr ON i.paciente_id=pr.paciente_id JOIN pacientes p ON p.id=i.paciente_id WHERE i.tipo_infeccao='Trato Urinário' AND lower(pr.tipo_procedimento)='sonda vesical' AND strftime('%Y-%m', i.data_notificacao)=? {wp}", (ano_mes,) + tuple(params)).fetchone()['total'])
        taxa_sonda = round((us / ts * 100) if ts > 0 else 0, 2)

        return {"internados": internados, "altas": altas, "infeccoes": infeccoes, "taxa_geral": taxa_geral, "taxa_cat": taxa_cat, "taxa_resp": taxa_resp, "taxa_sonda": taxa_sonda}

    g = compute_stats(None)
    html += f"""
    <h3>Visão Global do Hospital</h3>
    <table>
        <tr>
            <th>Internados Agora</th><th>Total de Altas</th><th>Infecções (Mês)</th><th>Taxa IH Geral</th>
            <th>Sepse / Cateter</th><th>PAV / Respirador</th><th>ITU / Sonda</th>
        </tr>
        <tr>
            <td>{g['internados']}</td><td>{g['altas']}</td><td>{g['infeccoes']}</td>
            <td><strong>{g['taxa_geral']}%</strong></td>
            <td>{g['taxa_cat']}%</td><td>{g['taxa_resp']}%</td><td>{g['taxa_sonda']}%</td>
        </tr>
    </table>
    <h3>Detalhamento por Setor Hospitalar</h3>
    <table>
        <tr>
            <th>Setor</th><th>Internados</th><th>Altas</th><th>Infecções</th><th>Taxa Geral</th>
            <th>Sepse/Cat.</th><th>PAV/Resp.</th><th>ITU/Sonda</th>
        </tr>
    """

    for s in setores:
        ds = compute_stats(s['id'])
        html += f"""
        <tr>
            <td><strong>{s['nome']}</strong></td>
            <td>{ds['internados']}</td><td>{ds['altas']}</td><td>{ds['infeccoes']}</td>
            <td><strong>{ds['taxa_geral']}%</strong></td>
            <td>{ds['taxa_cat']}%</td><td>{ds['taxa_resp']}%</td><td>{ds['taxa_sonda']}%</td>
        </tr>
        """

    html += """
    </table>
    <div class="disclaimer">
        <strong>Aviso Legal:</strong> Os dados aqui apresentados são estritamente para fins de exemplo da funcionalidade do sistema (projeto académico). Não representam 100% de um rastreio clínico real do hospital.
    </div>
    <div style="margin-top: 60px; text-align: center;">
        <p>_________________________________________________</p>
        <p><strong>Assinatura / Carimbo do Responsável CCIH</strong></p>
    </div>
    </body></html>
    """

    conn.close()
    return html


# ---------------------------------------------------------------------------
# START
# ---------------------------------------------------------------------------
init_db()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV', 'production') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
