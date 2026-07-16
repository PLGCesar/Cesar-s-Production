const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configurações vindas do ambiente do Render
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const GIST_FILE_NAME = "menu.json";

// SERVE APENAS O INDEX.HTML (que agora pode ficar solto na raiz)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint para buscar o cardápio
app.get('/api/menu', async (req, res) => {
    try {
        const response = await axios.get(`https://api.github.com/gists/${GIST_ID}`);
        const fileContent = response.data.files[GIST_FILE_NAME].content;
        res.json(JSON.parse(fileContent));
    } catch (error) {
        console.error("Erro ao buscar Gist:", error.message);
        res.status(500).json({ error: "Erro ao carregar o cardápio." });
    }
});

// Endpoint para salvar o cardápio (Protegido por senha)
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

        res.json({ success: true, message: "Cardápio atualizado com sucesso!" });
    } catch (error) {
        console.error("Erro ao atualizar Gist:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Erro ao salvar as alterações." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
