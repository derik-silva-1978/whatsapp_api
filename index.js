import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import express from "express";
import bodyParser from "body-parser";
import qrcode from "qrcode-terminal";
import pino from "pino";
import { readdir, rm } from "fs/promises";
import { existsSync } from "fs";

const logger = pino({ level: "silent" }); // Silenciar logs internos do Baileys

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
const MAX_RECONNECT_ATTEMPTS = 3;
const BASE_RECONNECT_DELAY = 10000; // 10 segundos
let isConnecting = false;
let sessionCorrupted = false;

// Função para calcular delay com backoff exponencial
const getReconnectDelay = (attempt) => {
  return Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), 60000); // Max 60s
};

// Função para limpar sessão corrompida
const clearCorruptedSession = async () => {
  try {
    if (existsSync("./auth_info")) {
      console.log("🗑️ Limpando sessão corrompida...");
      const files = await readdir("./auth_info");
      for (const file of files) {
        await rm(`./auth_info/${file}`, { force: true });
      }
      console.log("✅ Sessão limpa com sucesso");
      sessionCorrupted = false;
    }
  } catch (error) {
    console.error("❌ Erro ao limpar sessão:", error.message);
  }
};

const startWhatsApp = async () => {
  if (isConnecting) {
    console.log("⏳ Conexão já em andamento, aguarde...");
    return;
  }

  try {
    isConnecting = true;
    console.log("🔄 Inicializando WhatsApp...");
    
    // Buscar versão mais recente do Baileys
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📦 Usando versão WA: ${version.join(".")}, isLatest: ${isLatest}`);

    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      browser: ["Ubuntu", "Chrome", "20.0.04"], // User agent mais genérico e real
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
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
        isConnecting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log("❌ Conexão fechada:", {
          statusCode,
          reason: Object.keys(DisconnectReason).find(key => DisconnectReason[key] === statusCode) || "Unknown",
          error: lastDisconnect?.error?.message || "Unknown",
          shouldReconnect,
          attempt: reconnectAttempts + 1
        });

        // Erro 405 geralmente indica problema de autenticação
        if (statusCode === 405) {
          sessionCorrupted = true;
          console.log("⚠️ Erro 405 detectado - Sessão pode estar corrompida");
          if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.log("🗑️ Limpando sessão para forçar novo QR Code...");
            await clearCorruptedSession();
            reconnectAttempts = 0; // Reset após limpar
          }
        }

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = getReconnectDelay(reconnectAttempts);
          reconnectAttempts++;
          console.log(`⏳ Aguardando ${delay/1000}s antes de reconectar (tentativa ${reconnectAttempts})...`);
          setTimeout(() => startWhatsApp(), delay);
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error("🚫 Máximo de tentativas atingido. Use /reset para forçar nova autenticação.");
          reconnectAttempts = 0; // Reset para permitir tentativa manual
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
    isConnecting = false;
    console.error("❌ Erro ao inicializar WhatsApp:", error.message);
    
    // Se erro persistir, pode ser sessão corrompida
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS - 1) {
      console.log("⚠️ Múltiplas falhas detectadas, limpando sessão...");
      await clearCorruptedSession();
      reconnectAttempts = 0;
    }
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = getReconnectDelay(reconnectAttempts);
      reconnectAttempts++;
      console.log(`⏳ Tentando novamente em ${delay/1000}s...`);
      setTimeout(() => startWhatsApp(), delay);
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

// Endpoint para forçar reset da sessão (útil quando erro 405 persistir)
app.post("/reset", async (req, res) => {
  try {
    console.log("🔄 Forçando reset da sessão...");
    
    if (sock) {
      sock.end(undefined);
      sock = null;
    }
    
    await clearCorruptedSession();
    reconnectAttempts = 0;
    
    // Aguardar um pouco antes de reconectar
    setTimeout(() => startWhatsApp(), 2000);
    
    res.json({ 
      status: "OK",
      message: "Sessão resetada. Aguarde o novo QR Code nos logs."
    });
  } catch (error) {
    res.status(500).json({ 
      error: "Erro ao resetar sessão",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API WhatsApp rodando na porta ${PORT}`);
  startWhatsApp(); // Inicia o WhatsApp após o servidor subir
});