import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import express from "express";
import bodyParser from "body-parser";
import qrcode from "qrcode-terminal";

const app = express();
app.use(bodyParser.json());

// Rota de Health Check (para verificar se o servidor está online)
app.get("/", (req, res) => {
  res.send("API WhatsApp está online! 🚀");
});

let sock; // Variável global para armazenar o socket

const startWhatsApp = async () => {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["Educare API", "Chrome", "1.0"],
  });

  // Atualização de credenciais
  sock.ev.on("creds.update", saveCreds);

  // Monitorar conexão
  sock.ev.on("connection.update", (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("WhatsApp conectado com sucesso!");
    }

    if (connection === "close") {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Conexão fechada devido a", lastDisconnect.error, ", reconectando", shouldReconnect);
      if (shouldReconnect) {
        startWhatsApp();
      }
    }
  });

  // Receber mensagens e enviar para o n8n
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.key.fromMe) {
      console.log("Mensagem recebida de:", msg.key.remoteJid);

      // Enviar para o n8n
      const webhookUrl = process.env.N8N_WEBHOOK_URL;
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(msg),
          });
        } catch (error) {
          console.error("Erro ao enviar para n8n:", error);
        }
      }
    }
  });
};

// Endpoint para enviar mensagens
app.post("/sendText", async (req, res) => {
  try {
    if (!sock) {
      return res.status(503).json({ error: "WhatsApp ainda não inicializado" });
    }
    const { numero, mensagem } = req.body;
    await sock.sendMessage(`${numero}@s.whatsapp.net`, { text: mensagem });
    return res.json({ status: "OK" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
});

// Aviso para quem tentar acessar /sendText via GET (navegador)
app.get("/sendText", (req, res) => {
  res.status(405).json({ error: "Método não permitido. Use POST para enviar mensagens." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API WhatsApp rodando na porta ${PORT}`);
  startWhatsApp(); // Inicia o WhatsApp após o servidor subir
});