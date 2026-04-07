import sqlite3
import os
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date
from functools import wraps

app = Flask(__name__)
app.secret_key = 'ccih-secret-key-2024'
DATABASE = 'ccih.db'

PROCEDIMENTOS = [
    "cateter venoso central punção",
    "cateter venoso central dessecação",
    "cateter swan ganz",
    "cateter nutrição parental",
    "dissecação de veia periférica",
    "entubação",
    "respiração artificial",
    "traqueostomia",
    "sonda gástrica",
    "sonda vesical",
    "cateter arterial",
    "dreno cirurgia Neurológica",
    "dreno mediastino",
    "diálise peritoneal"
]

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript('''
        CREATE TABLE IF NOT EXISTS Setores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS Usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            nivel_acesso TEXT NOT NULL CHECK(nivel_acesso IN ('admin','estagiario')),
            setor_id INTEGER,
            senha TEXT NOT NULL,
            FOREIGN KEY(setor_id) REFERENCES Setores(id)
        );
        CREATE TABLE IF NOT EXISTS Pacientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            idade INTEGER,
            sexo TEXT,
            leito TEXT,
            prontuario TEXT,
            fone TEXT,
            setor_id_atual INTEGER,
            status TEXT DEFAULT 'ativo',
            FOREIGN KEY(setor_id_atual) REFERENCES Setores(id)
        );
        CREATE TABLE IF NOT EXISTS Registros_Diarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paciente_id INTEGER NOT NULL,
            data TEXT NOT NULL,
            temperatura REAL,
            FOREIGN KEY(paciente_id) REFERENCES Pacientes(id)
        );
        CREATE TABLE IF NOT EXISTS Procedimentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paciente_id INTEGER NOT NULL,
            tipo_procedimento TEXT NOT NULL,
            data_insercao TEXT,
            data_remocao TEXT,
            status TEXT DEFAULT 'ativo',
            FOREIGN KEY(paciente_id) REFERENCES Pacientes(id)
        );
        CREATE TABLE IF NOT EXISTS Transferencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paciente_id INTEGER NOT NULL,
            setor_origem_id INTEGER NOT NULL,
            setor_destino_id INTEGER NOT NULL,
            status TEXT DEFAULT 'pendente',
            data_solicitacao TEXT,
            FOREIGN KEY(paciente_id) REFERENCES Pacientes(id),
            FOREIGN KEY(setor_origem_id) REFERENCES Setores(id),
            FOREIGN KEY(setor_destino_id) REFERENCES Setores(id)
        );
    ''')
    # Seed initial data
    c.execute("SELECT COUNT(*) FROM Setores")
    if c.fetchone()[0] == 0:
        setores = ['UTI Adulto', 'UTI Neonatal', 'Clínica Médica', 'Cirurgia Geral', 'Ortopedia', 'Oncologia']
        for s in setores:
            c.execute("INSERT INTO Setores (nome) VALUES (?)", (s,))
        # Admin
        c.execute("INSERT INTO Usuarios (nome, nivel_acesso, setor_id, senha) VALUES (?, ?, ?, ?)",
                  ('Administrador', 'admin', None, generate_password_hash('admin123')))
        # Estagiário demo
        c.execute("INSERT INTO Usuarios (nome, nivel_acesso, setor_id, senha) VALUES (?, ?, ?, ?)",
                  ('Ana Lima', 'estagiario', 1, generate_password_hash('estagio123')))
        # Pacientes demo
        c.execute("INSERT INTO Pacientes (nome, idade, sexo, leito, prontuario, fone, setor_id_atual, status) VALUES (?,?,?,?,?,?,?,?)",
                  ('Carlos Silva', 67, 'M', '01-A', 'PR001234', '82999990001', 1, 'ativo'))
        c.execute("INSERT INTO Pacientes (nome, idade, sexo, leito, prontuario, fone, setor_id_atual, status) VALUES (?,?,?,?,?,?,?,?)",
                  ('Maria Souza', 54, 'F', '02-B', 'PR001235', '82999990002', 1, 'ativo'))
        # Procedimento demo com data antiga
        c.execute("INSERT INTO Procedimentos (paciente_id, tipo_procedimento, data_insercao, status) VALUES (?,?,?,?)",
                  (1, 'cateter venoso central punção', '2024-05-20', 'ativo'))
        c.execute("INSERT INTO Procedimentos (paciente_id, tipo_procedimento, data_insercao, status) VALUES (?,?,?,?)",
                  (1, 'sonda vesical', '2024-06-01', 'ativo'))
    conn.commit()
    conn.close()

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Não autenticado'}), 401
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get('nivel_acesso') != 'admin':
            return jsonify({'error': 'Acesso negado'}), 403
        return f(*args, **kwargs)
    return decorated

# ── ROTAS PRINCIPAIS ──────────────────────────────────────────────────────────

@app.route('/')
def index():
    if 'user_id' not in session:
        return render_template('index.html', page='login')
    return render_template('index.html', page='app',
                           user=session.get('nome'),
                           nivel=session.get('nivel_acesso'),
                           setor_id=session.get('setor_id'))

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    conn = get_db()
    user = conn.execute("SELECT * FROM Usuarios WHERE nome=?", (data.get('nome'),)).fetchone()
    conn.close()
    if user and check_password_hash(user['senha'], data.get('senha', '')):
        session['user_id'] = user['id']
        session['nome'] = user['nome']
        session['nivel_acesso'] = user['nivel_acesso']
        session['setor_id'] = user['setor_id']
        return jsonify({'ok': True, 'nivel': user['nivel_acesso'], 'nome': user['nome'], 'setor_id': user['setor_id']})
    return jsonify({'error': 'Credenciais inválidas'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})

# ── SETORES ───────────────────────────────────────────────────────────────────

@app.route('/api/setores', methods=['GET'])
@login_required
def get_setores():
    conn = get_db()
    rows = conn.execute("SELECT * FROM Setores ORDER BY nome").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/setores', methods=['POST'])
@login_required
@admin_required
def create_setor():
    data = request.get_json()
    conn = get_db()
    try:
        conn.execute("INSERT INTO Setores (nome) VALUES (?)", (data['nome'],))
        conn.commit()
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Setor já existe'}), 409
    finally:
        conn.close()
    return jsonify({'ok': True})

@app.route('/api/setores/<int:sid>', methods=['DELETE'])
@login_required
@admin_required
def delete_setor(sid):
    conn = get_db()
    conn.execute("DELETE FROM Setores WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ── USUÁRIOS ─────────────────────────────────────────────────────────────────

@app.route('/api/usuarios', methods=['GET'])
@login_required
@admin_required
def get_usuarios():
    conn = get_db()
    rows = conn.execute("""
        SELECT u.id, u.nome, u.nivel_acesso, u.setor_id, s.nome as setor_nome
        FROM Usuarios u LEFT JOIN Setores s ON u.setor_id = s.id
        ORDER BY u.nome
    """).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/usuarios', methods=['POST'])
@login_required
@admin_required
def create_usuario():
    data = request.get_json()
    conn = get_db()
    conn.execute("INSERT INTO Usuarios (nome, nivel_acesso, setor_id, senha) VALUES (?,?,?,?)",
                 (data['nome'], data['nivel_acesso'], data.get('setor_id'), generate_password_hash(data['senha'])))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/usuarios/<int:uid>', methods=['DELETE'])
@login_required
@admin_required
def delete_usuario(uid):
    conn = get_db()
    conn.execute("DELETE FROM Usuarios WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ── PACIENTES ─────────────────────────────────────────────────────────────────

@app.route('/api/pacientes', methods=['GET'])
@login_required
def get_pacientes():
    setor_id = request.args.get('setor_id', session.get('setor_id'))
    conn = get_db()
    rows = conn.execute("""
        SELECT p.*, s.nome as setor_nome FROM Pacientes p
        LEFT JOIN Setores s ON p.setor_id_atual = s.id
        WHERE p.setor_id_atual=? AND p.status='ativo'
        ORDER BY p.leito
    """, (setor_id,)).fetchall()
    result = []
    for r in rows:
        pac = dict(r)
        procs = conn.execute("""
            SELECT * FROM Procedimentos WHERE paciente_id=? AND status='ativo'
        """, (r['id'],)).fetchall()
        pac['procedimentos_ativos'] = [dict(p) for p in procs]
        result.append(pac)
    conn.close()
    return jsonify(result)

@app.route('/api/pacientes', methods=['POST'])
@login_required
def create_paciente():
    data = request.get_json()
    setor_id = session.get('setor_id') or data.get('setor_id')
    conn = get_db()
    conn.execute("""INSERT INTO Pacientes (nome, idade, sexo, leito, prontuario, fone, setor_id_atual, status)
                    VALUES (?,?,?,?,?,?,?,?)""",
                 (data['nome'], data.get('idade'), data.get('sexo'), data.get('leito'),
                  data.get('prontuario'), data.get('fone'), setor_id, 'ativo'))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/pacientes/<int:pid>', methods=['GET'])
@login_required
def get_paciente(pid):
    conn = get_db()
    p = conn.execute("SELECT * FROM Pacientes WHERE id=?", (pid,)).fetchone()
    if not p:
        return jsonify({'error': 'Não encontrado'}), 404
    pac = dict(p)
    pac['procedimentos'] = [dict(x) for x in conn.execute(
        "SELECT * FROM Procedimentos WHERE paciente_id=? ORDER BY id", (pid,)).fetchall()]
    pac['registros'] = [dict(x) for x in conn.execute(
        "SELECT * FROM Registros_Diarios WHERE paciente_id=? ORDER BY data DESC LIMIT 10", (pid,)).fetchall()]
    conn.close()
    return jsonify(pac)

@app.route('/api/pacientes/<int:pid>/alta', methods=['POST'])
@login_required
def dar_alta(pid):
    conn = get_db()
    conn.execute("UPDATE Pacientes SET status='alta' WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ── REGISTROS DIÁRIOS ─────────────────────────────────────────────────────────

@app.route('/api/registros', methods=['POST'])
@login_required
def create_registro():
    data = request.get_json()
    conn = get_db()
    conn.execute("INSERT INTO Registros_Diarios (paciente_id, data, temperatura) VALUES (?,?,?)",
                 (data['paciente_id'], data['data'], data.get('temperatura')))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ── PROCEDIMENTOS ─────────────────────────────────────────────────────────────

@app.route('/api/procedimentos', methods=['POST'])
@login_required
def create_procedimento():
    data = request.get_json()
    conn = get_db()
    # Verifica se já existe ativo
    existing = conn.execute("""SELECT id FROM Procedimentos 
        WHERE paciente_id=? AND tipo_procedimento=? AND status='ativo'""",
        (data['paciente_id'], data['tipo_procedimento'])).fetchone()
    if existing:
        conn.close()
        return jsonify({'error': 'Procedimento já ativo'}), 409
    conn.execute("""INSERT INTO Procedimentos (paciente_id, tipo_procedimento, data_insercao, status)
                    VALUES (?,?,?,?)""",
                 (data['paciente_id'], data['tipo_procedimento'], data.get('data_insercao'), 'ativo'))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/procedimentos/<int:proc_id>/remover', methods=['POST'])
@login_required
def remover_procedimento(proc_id):
    data = request.get_json()
    conn = get_db()
    conn.execute("UPDATE Procedimentos SET status='removido', data_remocao=? WHERE id=?",
                 (data.get('data_remocao', str(date.today())), proc_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ── TRANSFERÊNCIAS ────────────────────────────────────────────────────────────

@app.route('/api/transferencias', methods=['POST'])
@login_required
def criar_transferencia():
    data = request.get_json()
    conn = get_db()
    pac = conn.execute("SELECT setor_id_atual FROM Pacientes WHERE id=?", (data['paciente_id'],)).fetchone()
    if not pac:
        conn.close()
        return jsonify({'error': 'Paciente não encontrado'}), 404
    conn.execute("""INSERT INTO Transferencias (paciente_id, setor_origem_id, setor_destino_id, status, data_solicitacao)
                    VALUES (?,?,?,?,?)""",
                 (data['paciente_id'], pac['setor_id_atual'], data['setor_destino_id'],
                  'pendente', str(date.today())))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/transferencias/pendentes', methods=['GET'])
@login_required
def get_transferencias_pendentes():
    setor_id = session.get('setor_id')
    conn = get_db()
    rows = conn.execute("""
        SELECT t.*, p.nome as paciente_nome, p.leito as leito,
               so.nome as setor_origem_nome, sd.nome as setor_destino_nome
        FROM Transferencias t
        JOIN Pacientes p ON t.paciente_id = p.id
        JOIN Setores so ON t.setor_origem_id = so.id
        JOIN Setores sd ON t.setor_destino_id = sd.id
        WHERE t.setor_destino_id=? AND t.status='pendente'
    """, (setor_id,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/transferencias/<int:tid>/aceitar', methods=['POST'])
@login_required
def aceitar_transferencia(tid):
    conn = get_db()
    t = conn.execute("SELECT * FROM Transferencias WHERE id=?", (tid,)).fetchone()
    if not t:
        conn.close()
        return jsonify({'error': 'Não encontrada'}), 404
    conn.execute("UPDATE Transferencias SET status='aceita' WHERE id=?", (tid,))
    conn.execute("UPDATE Pacientes SET setor_id_atual=? WHERE id=?",
                 (t['setor_destino_id'], t['paciente_id']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ── DASHBOARD ADMIN ───────────────────────────────────────────────────────────

@app.route('/api/dashboard', methods=['GET'])
@login_required
@admin_required
def dashboard():
    conn = get_db()
    total_pacientes = conn.execute("SELECT COUNT(*) FROM Pacientes WHERE status='ativo'").fetchone()[0]
    total_proc_ativos = conn.execute("SELECT COUNT(*) FROM Procedimentos WHERE status='ativo'").fetchone()[0]
    total_transferencias = conn.execute("SELECT COUNT(*) FROM Transferencias WHERE status='pendente'").fetchone()[0]
    setores = conn.execute("""
        SELECT s.nome, COUNT(p.id) as total
        FROM Setores s LEFT JOIN Pacientes p ON p.setor_id_atual = s.id AND p.status='ativo'
        GROUP BY s.id ORDER BY total DESC
    """).fetchall()
    conn.close()
    return jsonify({
        'total_pacientes': total_pacientes,
        'total_proc_ativos': total_proc_ativos,
        'total_transferencias_pendentes': total_transferencias,
        'setores': [dict(s) for s in setores]
    })

@app.route('/api/procedimentos/lista', methods=['GET'])
@login_required
def lista_procedimentos():
    return jsonify(PROCEDIMENTOS)

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)
