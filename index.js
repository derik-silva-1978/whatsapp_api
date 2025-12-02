import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const startWhatsApp = async () => {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    browser: ["Educare API", "Chrome", "1.0"],
    // REMOVIDO: printQRInTerminal (não funciona mais)
  });

  // Atualização de credenciais
  sock.ev.on("creds.update", saveCreds);

  // NOVO BLOCO: QR, eventos de conexão, reconexão
  sock.ev.on("connection.update", (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      console.log("QR_CODE_STRING:");
      console.log(qr);  // Você vai transformar esse texto em QR visual
    }

    if (connection === "open") {
      console.log("WhatsApp conectado com sucesso!");
    }

    if (connection === "close") {
      console.log("Conexão fechada:", lastDisconnect?.error);
    }
  });

  // Receber mensagens e enviar ao n8n
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.key.fromMe) {
      console.log("Mensagem recebida de:", msg.key.remoteJid);

      // Exemplo de POST para o n8n
      // await fetch("https://SEU_N8N/webhook/titnauta", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify(msg),
      // });
    }
  });

  // Endpoint para enviar mensagens
  app.post("/sendText", async (req, res) => {
    try {
      const { numero, mensagem } = req.body;
      await sock.sendMessage(`${numero}@s.whatsapp.net`, { text: mensagem });
      return res.json({ status: "OK" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Erro ao enviar mensagem" });
    }
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`API WhatsApp rodando na porta ${PORT}`));
};

startWhatsApp();