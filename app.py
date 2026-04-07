import os
import libsql_client
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date
from functools import wraps

load_dotenv()

app = Flask(__name__)
app.secret_key = 'ccih-secret-key-2024'

# Conexão com o Turso (ou SQLite local se a URL não estiver no .env)
TURSO_URL = os.getenv("libsql://cchi-vitorrastrep.aws-us-east-2.turso.io", "file:ccih.db")
TURSO_TOKEN = os.getenv("libsql://cchi-vitorrastrep.aws-us-east-2.turso.io", "")

PROCEDIMENTOS = [
    "cateter venoso central punção", "cateter venoso central dessecação",
    "cateter swan ganz", "cateter nutrição parental", "dissecação de veia periférica",
    "entubação", "respiração artificial", "traqueostomia", "sonda gástrica",
    "sonda vesical", "cateter arterial", "dreno cirurgia Neurológica",
    "dreno mediastino", "diálise peritoneal"
]

def get_client():
    if TURSO_URL.startswith("file:"):
        return libsql_client.create_client_sync(url=TURSO_URL)
    return libsql_client.create_client_sync(url=TURSO_URL, auth_token=TURSO_TOKEN)

def query_db(sql, params=()):
    client = get_client()
    try:
        rs = client.execute(sql, params)
        cols = rs.columns
        return [dict(zip(cols, row)) for row in rs.rows]
    finally:
        client.close()

def execute_db(sql, params=()):
    client = get_client()
    try:
        rs = client.execute(sql, params)
        return rs.last_insert_rowid
    finally:
        client.close()

def init_db():
    client = get_client()
    try:
        client.batch([
            '''CREATE TABLE IF NOT EXISTS Setores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL UNIQUE
            );''',
            '''CREATE TABLE IF NOT EXISTS Usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                nivel_acesso TEXT NOT NULL CHECK(nivel_acesso IN ('admin','estagiario')),
                setor_id INTEGER,
                senha TEXT NOT NULL,
                FOREIGN KEY(setor_id) REFERENCES Setores(id)
            );''',
            '''CREATE TABLE IF NOT EXISTS Pacientes (
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
            );''',
            '''CREATE TABLE IF NOT EXISTS Registros_Diarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                paciente_id INTEGER NOT NULL,
                data TEXT NOT NULL,
                temperatura REAL,
                FOREIGN KEY(paciente_id) REFERENCES Pacientes(id)
            );''',
            '''CREATE TABLE IF NOT EXISTS Procedimentos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                paciente_id INTEGER NOT NULL,
                tipo_procedimento TEXT NOT NULL,
                data_insercao TEXT,
                data_remocao TEXT,
                status TEXT DEFAULT 'ativo',
                FOREIGN KEY(paciente_id) REFERENCES Pacientes(id)
            );''',
            '''CREATE TABLE IF NOT EXISTS Transferencias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                paciente_id INTEGER NOT NULL,
                setor_origem_id INTEGER NOT NULL,
                setor_destino_id INTEGER NOT NULL,
                status TEXT DEFAULT 'pendente',
                data_solicitacao TEXT,
                FOREIGN KEY(paciente_id) REFERENCES Pacientes(id),
                FOREIGN KEY(setor_origem_id) REFERENCES Setores(id),
                FOREIGN KEY(setor_destino_id) REFERENCES Setores(id)
            );'''
        ])
        
        # Criação de dados iniciais caso o banco esteja vazio
        setores = query_db("SELECT COUNT(*) as c FROM Setores")
        if setores[0]['c'] == 0:
            for s in ['UTI Adulto', 'UTI Neonatal', 'Clínica Médica']:
                execute_db("INSERT INTO Setores (nome) VALUES (?)", (s,))
            
            execute_db("INSERT INTO Usuarios (nome, email, nivel_acesso, setor_id, senha) VALUES (?, ?, ?, ?, ?)",
                      ('Administrador', 'admin@ccih.com', 'admin', None, generate_password_hash('admin123')))
            execute_db("INSERT INTO Usuarios (nome, email, nivel_acesso, setor_id, senha) VALUES (?, ?, ?, ?, ?)",
                      ('Ana Lima', 'ana@ccih.com', 'estagiario', 1, generate_password_hash('estagio123')))
    finally:
        client.close()

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
    users = query_db("SELECT * FROM Usuarios WHERE email=?", (data.get('email'),))
    if users and check_password_hash(users[0]['senha'], data.get('senha', '')):
        user = users[0]
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

@app.route('/api/setores', methods=['GET'])
@login_required
def get_setores():
    return jsonify(query_db("SELECT * FROM Setores ORDER BY nome"))

@app.route('/api/setores', methods=['POST'])
@login_required
@admin_required
def create_setor():
    data = request.get_json()
    try:
        execute_db("INSERT INTO Setores (nome) VALUES (?)", (data['nome'],))
        return jsonify({'ok': True})
    except Exception:
        return jsonify({'error': 'Erro ao criar setor'}), 409

@app.route('/api/usuarios', methods=['GET'])
@login_required
@admin_required
def get_usuarios():
    rows = query_db("""
        SELECT u.id, u.nome, u.email, u.nivel_acesso, u.setor_id, s.nome as setor_nome
        FROM Usuarios u LEFT JOIN Setores s ON u.setor_id = s.id ORDER BY u.nome
    """)
    return jsonify(rows)

@app.route('/api/usuarios', methods=['POST'])
@login_required
@admin_required
def create_usuario():
    data = request.get_json()
    try:
        execute_db("INSERT INTO Usuarios (nome, email, nivel_acesso, setor_id, senha) VALUES (?,?,?,?,?)",
                  (data['nome'], data['email'], data['nivel_acesso'], data.get('setor_id'), generate_password_hash(data['senha'])))
        return jsonify({'ok': True})
    except Exception:
        return jsonify({'error': 'Email já cadastrado ou erro no banco'}), 409

@app.route('/api/pacientes', methods=['GET'])
@login_required
def get_pacientes():
    setor_id = request.args.get('setor_id', session.get('setor_id'))
    pacientes = query_db("SELECT p.*, s.nome as setor_nome FROM Pacientes p LEFT JOIN Setores s ON p.setor_id_atual = s.id WHERE p.setor_id_atual=? AND p.status='ativo' ORDER BY p.leito", (setor_id,))
    for p in pacientes:
        p['procedimentos_ativos'] = query_db("SELECT * FROM Procedimentos WHERE paciente_id=? AND status='ativo'", (p['id'],))
    return jsonify(pacientes)

@app.route('/api/admin/pacientes_todos', methods=['GET'])
@login_required
@admin_required
def get_todos_pacientes():
    pacientes = query_db("""
        SELECT p.*, s.nome as setor_nome 
        FROM Pacientes p 
        LEFT JOIN Setores s ON p.setor_id_atual = s.id 
        WHERE p.status='ativo' 
        ORDER BY s.nome, p.leito
    """)
    for p in pacientes:
        p['procedimentos_ativos'] = query_db("SELECT * FROM Procedimentos WHERE paciente_id=? AND status='ativo'", (p['id'],))
    return jsonify(pacientes)

@app.route('/api/pacientes', methods=['POST'])
@login_required
def create_paciente():
    data = request.get_json()
    setor_id = session.get('setor_id') or data.get('setor_id')
    execute_db("""INSERT INTO Pacientes (nome, idade, sexo, leito, prontuario, fone, setor_id_atual, status) VALUES (?,?,?,?,?,?,?,?)""",
              (data['nome'], data.get('idade'), data.get('sexo'), data.get('leito'), data.get('prontuario'), data.get('fone'), setor_id, 'ativo'))
    return jsonify({'ok': True})

@app.route('/api/pacientes/<int:pid>', methods=['GET'])
@login_required
def get_paciente(pid):
    p = query_db("SELECT p.*, s.nome as setor_nome FROM Pacientes p LEFT JOIN Setores s ON p.setor_id_atual = s.id WHERE p.id=?", (pid,))
    if not p: return jsonify({'error': 'Não encontrado'}), 404
    pac = p[0]
    pac['procedimentos'] = query_db("SELECT * FROM Procedimentos WHERE paciente_id=? ORDER BY id", (pid,))
    pac['registros'] = query_db("SELECT * FROM Registros_Diarios WHERE paciente_id=? ORDER BY data DESC LIMIT 10", (pid,))
    return jsonify(pac)

@app.route('/api/pacientes/<int:pid>/alta', methods=['POST'])
@login_required
def dar_alta(pid):
    execute_db("UPDATE Pacientes SET status='alta' WHERE id=?", (pid,))
    return jsonify({'ok': True})

@app.route('/api/registros', methods=['POST'])
@login_required
def create_registro():
    data = request.get_json()
    execute_db("INSERT INTO Registros_Diarios (paciente_id, data, temperatura) VALUES (?,?,?)", (data['paciente_id'], data['data'], data.get('temperatura')))
    return jsonify({'ok': True})

@app.route('/api/procedimentos', methods=['POST'])
@login_required
def create_procedimento():
    data = request.get_json()
    existing = query_db("SELECT id FROM Procedimentos WHERE paciente_id=? AND tipo_procedimento=? AND status='ativo'", (data['paciente_id'], data['tipo_procedimento']))
    if existing: return jsonify({'error': 'Procedimento já ativo'}), 409
    execute_db("INSERT INTO Procedimentos (paciente_id, tipo_procedimento, data_insercao, status) VALUES (?,?,?,?)", (data['paciente_id'], data['tipo_procedimento'], data.get('data_insercao'), 'ativo'))
    return jsonify({'ok': True})

@app.route('/api/procedimentos/<int:proc_id>/remover', methods=['POST'])
@login_required
def remover_procedimento(proc_id):
    data = request.get_json()
    execute_db("UPDATE Procedimentos SET status='removido', data_remocao=? WHERE id=?", (data.get('data_remocao', str(date.today())), proc_id))
    return jsonify({'ok': True})

@app.route('/api/transferencias', methods=['POST'])
@login_required
def criar_transferencia():
    data = request.get_json()
    pac = query_db("SELECT setor_id_atual FROM Pacientes WHERE id=?", (data['paciente_id'],))
    if not pac: return jsonify({'error': 'Paciente não encontrado'}), 404
    execute_db("""INSERT INTO Transferencias (paciente_id, setor_origem_id, setor_destino_id, status, data_solicitacao)
                  VALUES (?,?,?,?,?)""", (data['paciente_id'], pac[0]['setor_id_atual'], data['setor_destino_id'], 'pendente', str(date.today())))
    return jsonify({'ok': True})

@app.route('/api/transferencias/pendentes', methods=['GET'])
@login_required
def get_transferencias_pendentes():
    setor_id = session.get('setor_id')
    return jsonify(query_db("""
        SELECT t.*, p.nome as paciente_nome, p.leito as leito, so.nome as setor_origem_nome, sd.nome as setor_destino_nome
        FROM Transferencias t JOIN Pacientes p ON t.paciente_id = p.id JOIN Setores so ON t.setor_origem_id = so.id JOIN Setores sd ON t.setor_destino_id = sd.id
        WHERE t.setor_destino_id=? AND t.status='pendente'
    """, (setor_id,)))

@app.route('/api/transferencias/<int:tid>/aceitar', methods=['POST'])
@login_required
def aceitar_transferencia(tid):
    t = query_db("SELECT * FROM Transferencias WHERE id=?", (tid,))
    if not t: return jsonify({'error': 'Não encontrada'}), 404
    execute_db("UPDATE Transferencias SET status='aceita' WHERE id=?", (tid,))
    execute_db("UPDATE Pacientes SET setor_id_atual=? WHERE id=?", (t[0]['setor_destino_id'], t[0]['paciente_id']))
    return jsonify({'ok': True})

@app.route('/api/dashboard', methods=['GET'])
@login_required
@admin_required
def dashboard():
    total_pacientes = query_db("SELECT COUNT(*) as c FROM Pacientes WHERE status='ativo'")[0]['c']
    total_proc_ativos = query_db("SELECT COUNT(*) as c FROM Procedimentos WHERE status='ativo'")[0]['c']
    total_transferencias = query_db("SELECT COUNT(*) as c FROM Transferencias WHERE status='pendente'")[0]['c']
    setores = query_db("SELECT s.nome, COUNT(p.id) as total FROM Setores s LEFT JOIN Pacientes p ON p.setor_id_atual = s.id AND p.status='ativo' GROUP BY s.id ORDER BY total DESC")
    return jsonify({'total_pacientes': total_pacientes, 'total_proc_ativos': total_proc_ativos, 'total_transferencias_pendentes': total_transferencias, 'setores': setores})

@app.route('/api/procedimentos/lista', methods=['GET'])
@login_required
def lista_procedimentos():
    return jsonify(PROCEDIMENTOS)

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)
