const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
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
    
    // Pasta onde serão salvas as credenciais da sessão para não precisar scanear sempre
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }), // Deixa o console limpo
        printQRInTerminal: false // Vamos exibir na tela administrativa, não no CLI
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionStatus = "qr_needed";
            // Transforma a string do QR do WhatsApp em imagem base64
            currentQrBase64 = await QRCode.toDataURL(qr);
        }

        if (connection === 'close') {
            currentQrBase64 = null;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            
            console.log('Conexão fechada. Motivo:', lastDisconnect?.error?.message);
            connectionStatus = "offline";
            
            if (shouldReconnect) {
                console.log('Tentando reconectar...');
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Robô conectado com sucesso no WhatsApp!');
            currentQrBase64 = null;
            connectionStatus = "online";
        }
    });

    // OUVINTE DE MENSAGENS RECEBIDAS (Onde a mágica do BOT acontece)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        const msg = messages[0];
        if (!msg.key.fromMe && msg.message) {
            const incomingText = msg.message.conversation || 
                                 msg.message.extendedTextMessage?.text || "";
            const fromJid = msg.key.remoteJid;

            // Se for um pedido formatado que veio do nosso site
            if (incomingText.includes("*Novo Pedido -")) {
                try {
                    // Extrai o nome do cliente usando regex simples
                    const nomeCliente = incomingText.match(/\*Cliente:\*\s*(.*)/)[1].trim();
                    
                    // Resposta automática do bot confirmando
                    const resposta = `Olá, *${nomeCliente}*! 👋\n\nRecebemos o seu pedido com sucesso!\n\nEle já foi encaminhado para a nossa cozinha e começará a ser preparado agora mesmo. 🍔🛵`;
                    
                    await sock.sendMessage(fromJid, { text: resposta });
                } catch (e) {
                    console.error("Erro ao analisar mensagem de pedido:", e);
                }
            }
        }
    });
}

// Inicia o processo em background
connectToWhatsApp();

// ----------------------------------------------------
// ROTAS HTTP (API E FRONTEND)
// ----------------------------------------------------

// Serve o index.html na raiz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint público para buscar o cardápio
app.get('/api/menu', async (req, res) => {
    try {
        const response = await axios.get(`https://api.github.com/gists/${GIST_ID}`);
        const fileContent = response.data.files[GIST_FILE_NAME].content;
        res.json(JSON.parse(fileContent));
    } catch (error) {
        res.status(500).json({ error: "Erro ao carregar o cardápio." });
    }
});

// Endpoint público para ler o QR Code ou status do Bot
app.get('/api/qr', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: currentQrBase64 // Retorna a imagem em Base64 ou null
    });
});

// Endpoint protegido para salvar as alterações do cardápio
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

        res.json({ success: true, message: "Cardápio atualizado!" });
    } catch (error) {
        res.status(500).json({ error: "Erro ao salvar alterações no Gist." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
