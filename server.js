const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const QRCode = require('qrcode');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    Browsers, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configurações do Gist e Admin
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const GIST_FILE_NAME = "menu.json";

// Variáveis de controle do WhatsApp Bot
let sock = null;
let currentQrBase64 = null;
let connectionStatus = "offline"; // offline, qr_needed, connecting, online

// ----------------------------------------------------
// INICIALIZAÇÃO DO BOT (BAILEYS)
// ----------------------------------------------------
async function connectToWhatsApp() {
    connectionStatus = "connecting";
    console.log("Iniciando conexão com o WhatsApp...");
    
    // Pasta onde serão salvas as credenciais da sessão
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    try {
        // 1. Busca a versão mais atualizada do WhatsApp Web para não ser rejeitado
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Usando a versão do WhatsApp Web: ${version.join('.')}, isLatest: ${isLatest}`);

        // 2. Inicializa o socket configurando o Navegador (Essencial para rodar no Render)
        sock = makeWASocket({
            auth: state,
            version: version, // <-- Passa a versão atualizada do WhatsApp
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            // <-- Força o bot a se identificar como um Mac Desktop (burlar bloqueio)
            browser: Browsers.macOS('Desktop'), 
            connectTimeoutMs: 60000, // Timeout maior para conexões lentas de servidores
            defaultQueryTimeoutMs: 60000
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                connectionStatus = "qr_needed";
                currentQrBase64 = await QRCode.toDataURL(qr);
                console.log("Novo QR Code gerado e disponível para leitura.");
            }

            if (connection === 'close') {
                currentQrBase64 = null;
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                console.log('Conexão fechada. Motivo:', lastDisconnect?.error?.message);
                connectionStatus = "offline";
                
                if (shouldReconnect) {
                    console.log('Aguardando 5 segundos para tentar reconectar...');
                    setTimeout(connectToWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                console.log('Robô conectado com sucesso no WhatsApp!');
                currentQrBase64 = null;
                connectionStatus = "online";
            }
        });

        // OUVINTE DE MENSAGENS RECEBIDAS (Onde a mágica do BOT acontece)
        // O 'async' antes de '({ messages, type })' garante que o await funcione lá dentro
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            const msg = messages[0];
            if (!msg.key.fromMe && msg.message) {
                const incomingText = msg.message.conversation || 
                                     msg.message.extendedTextMessage?.text || "";
                const fromJid = msg.key.remoteJid;

                // Se for um pedido formatado que veio do nosso site
                if (incomingText.includes("*Novo Pedido -")) {
                    try {
                        // Extrai o nome do cliente usando regex
                        const nomeCliente = incomingText.match(/\*Cliente:\*\s*(.*)/)[1].trim();
                        
                        // Resposta automática do bot confirmando
                        const resposta = `Olá, *${nomeCliente}*! 👋\n\nRecebemos o seu pedido com sucesso!\n\nEle já foi encaminhado para a nossa cozinha e começará a ser preparado agora mesmo. 🍔🛵`;
                        
                        // Envia a mensagem de confirmação de forma assíncrona
                        await sock.sendMessage(fromJid, { text: resposta });
                        console.log(`Resposta automática enviada para ${nomeCliente}.`);
                    } catch (e) {
                        console.error("Erro ao analisar mensagem de pedido:", e);
                    }
                }
            }
        });

    } catch (error) {
        console.error("Erro crítico ao tentar inicializar o WhatsApp:", error);
        connectionStatus = "offline";
        // Tenta iniciar novamente em 10 segundos em caso de erro de inicialização
        setTimeout(connectToWhatsApp, 10000);
    }
}

// Inicializa o processo do bot em background
connectToWhatsApp();

// ----------------------------------------------------
// ROTAS HTTP (API E SERVIÇO DE ARQUIVOS)
// ----------------------------------------------------

// Rota principal: entrega apenas o index.html na raiz (mantendo server.js protegido)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint público para buscar o cardápio no Gist
app.get('/api/menu', async (req, res) => {
    try {
        const response = await axios.get(`https://api.github.com/gists/${GIST_ID}`);
        const fileContent = response.data.files[GIST_FILE_NAME].content;
        res.json(JSON.parse(fileContent));
    } catch (error) {
        console.error("Erro ao buscar cardápio no Gist:", error.message);
        res.status(500).json({ error: "Erro ao carregar o cardápio." });
    }
});

// Endpoint público para ler o QR Code ou status de conexão do Bot
app.get('/api/qr', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: currentQrBase64 // Retorna a string em Base64 ou null se já conectado
    });
});

// Endpoint protegido por senha para salvar as alterações do cardápio
app.post('/api/menu', async (req, res) => {
    const { password, menuData } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Senha incorreta." });
    }

    try {
        await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
            files: {
                [GIST_FILE_NAME]: {
                    content: JSON.stringify(menuData, null, 2)
                }
            }
        }, {
            headers: {
                Authorization: `Bearer ${GITHUB_TOKEN}`,
                Accept: "application/vnd.github+json"
            }
        });

        res.json({ success: true, message: "Cardápio updated com sucesso!" });
    } catch (error) {
        console.error("Erro ao atualizar Gist:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Erro ao salvar as alterações." });
    }
});

// Inicialização do Servidor Express
app.listen(PORT, () => {
    console.log(`Servidor HTTP rodando com sucesso na porta ${PORT}`);
});