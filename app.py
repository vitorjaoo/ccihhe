import os
import libsql_client
from flask import Flask, render_template, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps

app = Flask(__name__)
app.secret_key = 'ccih-secret-key-2024'

# Turso Config
URL = os.getenv("libsql://cchi-vitorrastrep.aws-us-east-2.turso.io", "file:ccih.db")
TOKEN = os.getenv("eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU1Njk0NTksImlkIjoiMDE5ZDY4MmYtMDAwMS03N2IxLThhYjQtZmEyMGZlOTg4NTg5IiwicmlkIjoiOWNmYzg2YmEtMGRmOC00YzVhLWI3MTQtYzVmYmMzNGYxYWE1In0.C8J9OK0Q3hcWTDdmQIs1EDFnnjVoYlA5rM7npQ7B-coRuOTOI7HWCOnKhQkzd1cNCcrE0uzmjidIfuXbhL84DA", "")

def get_db():
    if URL.startswith("file:"):
        return libsql_client.create_client_sync(url=URL)
    return libsql_client.create_client_sync(url=URL, auth_token=TOKEN)

def query(sql, params=()):
    with get_db() as db:
        res = db.execute(sql, params)
        return [dict(zip(res.columns, row)) for row in res.rows]

def execute(sql, params=()):
    with get_db() as db:
        return db.execute(sql, params)

def init_db():
    with get_db() as db:
        db.batch([
            "CREATE TABLE IF NOT EXISTS Setores (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT UNIQUE)",
            "CREATE TABLE IF NOT EXISTS Usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, email TEXT UNIQUE, nivel_acesso TEXT, setor_id INTEGER, senha TEXT)",
            "CREATE TABLE IF NOT EXISTS Pacientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, idade INTEGER, leito TEXT, setor_id_atual INTEGER, status TEXT DEFAULT 'ativo')",
            "CREATE TABLE IF NOT EXISTS Procedimentos (id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER, tipo_procedimento TEXT, status TEXT DEFAULT 'ativo')"
        ])
        if not query("SELECT * FROM Setores"):
            for s in ['UTI Geral', 'Pediatria', 'Isolamento']:
                execute("INSERT INTO Setores (nome) VALUES (?)", (s,))
        if not query("SELECT * FROM Usuarios WHERE email='admin@ccih.com'"):
            execute("INSERT INTO Usuarios (nome, email, nivel_acesso, senha) VALUES (?,?,?,?)",
                    ('Admin Geral', 'admin@ccih.com', 'admin', generate_password_hash('admin123')))

@app.route('/')
def index():
    page = 'app' if 'user_id' in session else 'login'
    return render_template('index.html', page=page, 
                           user=session.get('nome',''), 
                           nivel=session.get('nivel_acesso',''), 
                           setor_id=session.get('setor_id',''))

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = query("SELECT * FROM Usuarios WHERE email=?", (data['email'],))
    if user and check_password_hash(user[0]['senha'], data['senha']):
        session.update({'user_id': user[0]['id'], 'nome': user[0]['nome'], 'nivel_acesso': user[0]['nivel_acesso'], 'setor_id': user[0]['setor_id']})
        return jsonify({'ok': True})
    return jsonify({'error': 'Falha no login'}), 401

@app.route('/api/pacientes', methods=['GET', 'POST'])
def handle_pacientes():
    if request.method == 'POST':
        data = request.json
        execute("INSERT INTO Pacientes (nome, idade, leito, setor_id_atual) VALUES (?,?,?,?)",
                (data['nome'], data['idade'], data['leito'], data['setor_id']))
        return jsonify({'ok': True})
    
    sid = request.args.get('setor_id') or session.get('setor_id')
    pacs = query("SELECT * FROM Pacientes WHERE setor_id_atual=? AND status='ativo'", (sid,))
    for p in pacs:
        p['procedimentos_ativos'] = query("SELECT * FROM Procedimentos WHERE paciente_id=? AND status='ativo'", (p['id'],))
    return jsonify(pacs)

@app.route('/api/admin/pacientes_todos')
def todos_pacs():
    pacs = query("SELECT p.*, s.nome as setor_nome FROM Pacientes p JOIN Setores s ON p.setor_id_atual = s.id WHERE p.status='ativo'")
    for p in pacs:
        p['procedimentos_ativos'] = query("SELECT * FROM Procedimentos WHERE paciente_id=? AND status='ativo'", (p['id'],))
    return jsonify(pacs)

@app.route('/api/setores')
def get_setores(): return jsonify(query("SELECT * FROM Setores"))

@app.route('/api/usuarios', methods=['GET', 'POST'])
def users():
    if request.method == 'POST':
        d = request.json
        execute("INSERT INTO Usuarios (nome, email, nivel_acesso, setor_id, senha) VALUES (?,?,?,?,?)",
                (d['nome'], d['email'], d['nivel_acesso'], d.get('setor_id'), generate_password_hash(d['senha'])))
        return jsonify({'ok': True})
    return jsonify(query("SELECT u.*, s.nome as setor_nome FROM Usuarios u LEFT JOIN Setores s ON u.setor_id = s.id"))

@app.route('/api/dashboard')
def dash():
    p_total = query("SELECT COUNT(*) as c FROM Pacientes WHERE status='ativo'")[0]['c']
    proc_total = query("SELECT COUNT(*) as c FROM Procedimentos WHERE status='ativo'")[0]['c']
    sets = query("SELECT s.nome, COUNT(p.id) as total FROM Setores s LEFT JOIN Pacientes p ON p.setor_id_atual = s.id AND p.status='ativo' GROUP BY s.id")
    return jsonify({'total_pacientes': p_total, 'total_proc_ativos': proc_total, 'total_transferencias_pendentes': 0, 'setores': sets})

@app.route('/api/logout', methods=['POST'])
def logout(): session.clear(); return jsonify({'ok': True})

init_db()
if __name__ == '__main__':
    app.run(debug=True)
