import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const startWhatsApp = async () => {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on("creds.update", saveCreds);

  // Receber mensagens e enviar para o n8n
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.key.fromMe) {
      console.log("Mensagem recebida de:", msg.key.remoteJid);

      // Aqui você chama o webhook do n8n
      // exemplo:
      // await fetch("https://SEU_N8N/webhook/titnauta", {...})
    }
  });

  // Endpoint para o n8n enviar mensagens
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