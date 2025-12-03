import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import express from "express";
import bodyParser from "body-parser";
import qrcode from "qrcode-terminal";

const app = express();
app.use(bodyParser.json());

// Rota de Health Check (para verificar se o servidor está online)
app.get("/", (req, res) => {
  const status = sock ? "conectado" : "aguardando conexão";
  res.json({ 
    status: "online", 
    whatsapp: status,
    timestamp: new Date().toISOString()
  });
});

let sock; // Variável global para armazenar o socket
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5 segundos

const startWhatsApp = async () => {
  try {
    console.log("Inicializando WhatsApp...");
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      defaultQueryTimeoutMs: undefined,
    });

    // Atualização de credenciais
    sock.ev.on("creds.update", saveCreds);

    // Monitorar conexão
    sock.ev.on("connection.update", async (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr) {
        console.log("\n📱 QR Code gerado:");
        qrcode.generate(qr, { small: true });
        console.log("\nEscaneie o QR Code acima com o WhatsApp\n");
      }

      if (connection === "open") {
        console.log("✅ WhatsApp conectado com sucesso!");
        reconnectAttempts = 0; // Reset contador de tentativas
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log("❌ Conexão fechada:", {
          statusCode,
          error: lastDisconnect?.error?.message || "Unknown",
          shouldReconnect,
          attempt: reconnectAttempts + 1
        });

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(`⏳ Aguardando ${RECONNECT_DELAY/1000}s antes de reconectar...`);
          await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
          startWhatsApp();
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error("🚫 Máximo de tentativas de reconexão atingido. Verifique os logs.");
        }
      }
    });

    // Receber mensagens e enviar para o n8n
    sock.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];
      if (!msg.key.fromMe && msg.message) {
        console.log("📩 Mensagem recebida de:", msg.key.remoteJid);

        // Enviar para o n8n
        const webhookUrl = process.env.N8N_WEBHOOK_URL;
        if (webhookUrl) {
          try {
            const response = await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(msg),
            });
            if (response.ok) {
              console.log("✅ Mensagem enviada para n8n");
            } else {
              console.error("⚠️ Erro ao enviar para n8n:", response.status);
            }
          } catch (error) {
            console.error("❌ Erro ao enviar para n8n:", error.message);
          }
        }
      }
    });

    console.log("✅ WhatsApp inicializado com sucesso");
  } catch (error) {
    console.error("❌ Erro ao inicializar WhatsApp:", error);
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`⏳ Tentando novamente em ${RECONNECT_DELAY/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
      startWhatsApp();
    }
  }
};

// Endpoint para enviar mensagens
app.post("/sendText", async (req, res) => {
  try {
    if (!sock) {
      return res.status(503).json({ 
        error: "WhatsApp ainda não inicializado",
        message: "Aguarde a conexão ser estabelecida"
      });
    }
    
    const { numero, mensagem } = req.body;
    
    if (!numero || !mensagem) {
      return res.status(400).json({ 
        error: "Parâmetros inválidos",
        message: "Informe 'numero' e 'mensagem'"
      });
    }
    
    console.log(`📤 Enviando mensagem para ${numero}`);
    await sock.sendMessage(`${numero}@s.whatsapp.net`, { text: mensagem });
    console.log("✅ Mensagem enviada com sucesso");
    
    return res.json({ 
      status: "OK",
      message: "Mensagem enviada com sucesso",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ Erro ao enviar mensagem:", err.message);
    return res.status(500).json({ 
      error: "Erro ao enviar mensagem",
      details: err.message
    });
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