import './error-guard.js';
import './ui-feedback.js';
import { initFirebase, db, auth, signInWithEmailAndPassword, signOut as fbSignOut, doc, getDoc, setDoc } from './firebase-init.js';
import './firebase-sync.js';
import './empresa-service.js';
import './pwa-install.js';

const AuthService = {
    MASTER_USER: 'admin',
    MASTER_HASH: 'cf3ba79fe53bf2417903fbde744a088e4e0ca0ca877ee76dcd174011ce5a43dd',

    async hashPassword(password) {
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    getUsers() {
        return JSON.parse(localStorage.getItem('usuarios')) || [];
    },

    saveUsers(users) {
        localStorage.setItem('usuarios', JSON.stringify(users));
    },

    async addUser(nome, username, password, permissoes) {
        const users = this.getUsers();
        if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
            throw new Error('Nome de usuário já existe');
        }
        const hash = await this.hashPassword(password);
        users.push({
            id: Date.now().toString(),
            nome,
            username,
            passwordHash: hash,
            permissoes: permissoes
        });
        this.saveUsers(users);
    },

    async updateUser(id, nome, username, password, permissoes) {
        const users = this.getUsers();
        const index = users.findIndex(u => u.id === id);
        if (index === -1) throw new Error('Usuário não encontrado');
        
        if (users.find(u => u.id !== id && u.username.toLowerCase() === username.toLowerCase())) {
            throw new Error('Nome de usuário já existe');
        }
        users[index].nome = nome;
        users[index].username = username;
        users[index].permissoes = permissoes;
        if (password && password.trim() !== '') {
            users[index].passwordHash = await this.hashPassword(password);
        }
        this.saveUsers(users);
    },

    removerUser(id) {
        let users = this.getUsers();
        users = users.filter(u => u.id !== id);
        this.saveUsers(users);
    },

    async login(username, password) {
        const usernameNormalized = username.trim().toLowerCase();
        const hash = await this.hashPassword(password);
        
        // 1. MASTER LOGIN (Local Hash)
        if (usernameNormalized === this.MASTER_USER.toLowerCase() && hash === this.MASTER_HASH) {
            let activeEmpresa = localStorage.getItem('master_active_empresaId');
            if (!activeEmpresa) {
                try {
                    const saved = JSON.parse(localStorage.getItem('empresas_cadastradas') || '[]');
                    activeEmpresa = saved.length > 0 ? saved[0].id : '';
                } catch (e) {
                    activeEmpresa = '';
                }
            }
            const masterData = { 
                id: 'master', 
                nome: 'Administrador Master', 
                username: 'admin', 
                isMaster: true, 
                empresaId: activeEmpresa 
            };
            localStorage.setItem('logged_in_user', JSON.stringify(masterData));
            if (window.FirebaseSync) window.FirebaseSync.start();
            return true;
        }

        // 2. CHECK MULTI-TENANT FIRESTORE USERS
        try {
            if (db) {
                const userDoc = await getDoc(doc(db, 'users', usernameNormalized));
                if (userDoc.exists()) {
                    const fireData = userDoc.data();
                    if (fireData.passwordHash === hash) {
                        const sessionData = {
                            id: usernameNormalized,
                            nome: fireData.nome,
                            username: usernameNormalized,
                            isMaster: false,
                            empresaId: fireData.empresaId,
                            permissoes: fireData.permissoes || []
                        };
                        localStorage.setItem('logged_in_user', JSON.stringify(sessionData));
                        if (window.FirebaseSync) window.FirebaseSync.start();
                        return true;
                    }
                }
            }
        } catch (err) {
            console.warn('Erro ao verificar usuário na nuvem:', err ? (err.message || String(err)) : '');
        }

        // 3. CHECK REGULAR USERS (Stored locally)
        const users = this.getUsers();
        const user = users.find(u => u.username.toLowerCase() === usernameNormalized && u.passwordHash === hash);
        
        if (user) {
            const currentUser = this.getCurrentUser();
            let currentEmpresaId = (currentUser && currentUser.empresaId) ? currentUser.empresaId : '';
            if (!currentEmpresaId) {
                try {
                    const saved = JSON.parse(localStorage.getItem('empresas_cadastradas') || '[]');
                    currentEmpresaId = saved.length > 0 ? saved[0].id : '';
                } catch (e) {
                    currentEmpresaId = '';
                }
            }
            const { passwordHash, ...userData } = user;
            userData.empresaId = user.empresaId || currentEmpresaId;
            localStorage.setItem('logged_in_user', JSON.stringify(userData));
            if (window.FirebaseSync) window.FirebaseSync.start();
            return true;
        }

        return false;
    },

    async logout() {
        localStorage.removeItem('logged_in_user');
        if (window.FirebaseSync) window.FirebaseSync.stop();
        try {
            if (auth) await fbSignOut(auth);
        } catch (e) {
            console.error('Erro ao sair:', e ? (e.message || String(e)) : '');
        }
        window.location.href = 'login.html';
    },

    getCurrentUser() {
        const data = localStorage.getItem('logged_in_user');
        return data ? JSON.parse(data) : null;
    },

    checkAuth() {
        const user = this.getCurrentUser();
        const p = window.location.pathname;
        const isLoginPage = p.endsWith('login.html') || p.endsWith('/login') || p === '/login' || p.endsWith('/login/');
        
        if (!user && !isLoginPage) {
            window.location.href = 'login.html';
            return;
        }
        
        if (user && isLoginPage) {
            window.location.href = 'index.html';
            return;
        }

        if (user && !isLoginPage) {
            if (window.FirebaseSync) window.FirebaseSync.start();
        }

        if (user && !user.isMaster && !isLoginPage) {
            this.applyPermissions(user);
        }
    },

    hasPermission(moduleName) {
        const user = this.getCurrentUser();
        if (!user) return false;
        if (user.isMaster) return true;
        return user.permissoes && user.permissoes.includes(moduleName);
    },

    applyPermissions(user) {
        const path = window.location.pathname;
        let currentModule = '';
        if (path.includes('agendamentos.html')) currentModule = 'agenda';
        if (path.includes('pedidos.html')) currentModule = 'pedidos';
        if (path.includes('caixa.html')) currentModule = 'caixa';
        if (path.includes('estoque.html')) currentModule = 'estoque';
        if (path.includes('fidelidade.html')) currentModule = 'posvenda';
        if (path.includes('clientes.html')) currentModule = 'clientes';
        if (path.includes('servicos.html')) currentModule = 'servicos';
        if (path.includes('configuracoes.html')) currentModule = 'configuracoes';

        if (currentModule && !this.hasPermission(currentModule)) {
            if (window.UI) window.UI.toast('Seu usuário não tem permissão para acessar esta área.', 'error');
            else alert('Seu usuário não tem permissão para acessar esta área.');
            window.location.href = 'index.html';
        }

        document.addEventListener('DOMContentLoaded', () => {
            const navMap = {
                'agenda': 'a[href="agendamentos.html"]',
                'pedidos': 'a[href="pedidos.html"]',
                'caixa': 'a[href="caixa.html"]',
                'estoque': 'a[href="estoque.html"]',
                'posvenda': 'a[href="fidelidade.html"]',
                'clientes': 'a[href="clientes.html"]',
                'servicos': 'a[href="servicos.html"]',
                'configuracoes': '.btn-settings-gear'
            };

            for (const [module, selector] of Object.entries(navMap)) {
                if (!this.hasPermission(module)) {
                    const el = document.querySelector(selector);
                    if (el) el.style.display = 'none';
                }
            }
        });
    }
};

window.AuthService = AuthService;
AuthService.checkAuth();

export default AuthService;
export { AuthService };
