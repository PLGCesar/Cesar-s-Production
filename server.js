const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configurações do Gist e Admin
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const GIST_FILE_NAME = "menu.json";

// CACHE EM MEMÓRIA RAM (In-Memory Cache)
let cachedMenu = null;

// Função para buscar o cardápio do Gist e atualizar o Cache na RAM
async function loadMenuCache() {
    try {
        console.log("Buscando cardápio no Gist para atualizar o Cache local...");
        const response = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
            headers: {
                Authorization: `Bearer ${GITHUB_TOKEN}`,
                Accept: "application/vnd.github+json"
            }
        });
        const fileContent = response.data.files[GIST_FILE_NAME].content;
        cachedMenu = JSON.parse(fileContent);
        console.log("Cache do cardápio carregado com sucesso na memória RAM!");
    } catch (error) {
        console.error("Erro crítico ao carregar cache inicial do Gist:", error.response ? error.response.data : error.message);
    }
}

// Inicializa o cache assim que o servidor inicia
loadMenuCache();

// Entrega o index.html na raiz de forma segura
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint público para buscar o cardápio (Agilizado pelo Cache na RAM)
app.get('/api/menu', async (req, res) => {
    // Se por acaso o cache estiver vazio (ex: erro na primeira inicialização), tenta buscar do Gist na hora
    if (!cachedMenu) {
        await loadMenuCache();
    }

    if (cachedMenu) {
        // Retorna instantaneamente da memória RAM do servidor
        return res.json(cachedMenu);
    } else {
        return res.status(500).json({ error: "Erro ao carregar o cardápio da memória." });
    }
});

// Endpoint protegido para salvar as alterações do cardápio
app.post('/api/menu', async (req, res) => {
    const { password, menuData } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Senha incorreta." });
    }

    try {
        // 1. Atualiza fisicamente o arquivo JSON lá no Gist do GitHub
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

        // 2. ATUALIZAÇÃO IMEDIATA DO CACHE NA RAM:
        // Evita termos que fazer uma nova requisição GET para o GitHub.
        cachedMenu = menuData;
        console.log("Cache na memória RAM atualizado após edição do Admin!");

        res.json({ success: true, message: "Cardápio atualizado com sucesso!" });
    } catch (error) {
        console.error("Erro ao atualizar Gist:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Erro ao salvar as alterações." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando com sucesso na porta ${PORT}`);
});