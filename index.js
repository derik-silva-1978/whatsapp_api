import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import express from "express";
import bodyParser from "body-parser";
import QRCode from "qrcode";
import pino from "pino";
import { readdir, rm } from "fs/promises";
import { existsSync } from "fs";

const logger = pino({ level: "silent" });

const app = express();

// Configurações de segurança e parsing
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// CORS básico
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Estado global do WhatsApp
let sock = null;
let qrCodeDataURL = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let isConnecting = false;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 10000;

// Função para calcular delay com backoff exponencial e jitter
const getReconnectDelay = (attempt) => {
  const baseDelay = BASE_RECONNECT_DELAY * Math.pow(2, attempt);
  const jitter = Math.random() * 2000;
  return Math.min(baseDelay + jitter, 60000);
};

// Função para limpar sessão corrompida
const clearCorruptedSession = async () => {
  try {
    if (existsSync("./auth_info")) {
      console.log("🗑️ Limpando sessão corrompida...");
      const files = await readdir("./auth_info");
      await Promise.all(files.map(file => rm(`./auth_info/${file}`, { force: true })));
      console.log("✅ Sessão limpa com sucesso");
    }
  } catch (error) {
    console.error("❌ Erro ao limpar sessão:", error.message);
  }
};

// Função para limpar socket anterior (previne memory leak)
const cleanupSocket = () => {
  if (sock) {
    try {
      console.log("🧹 Limpando socket anterior...");
      sock.ev.removeAllListeners("connection.update");
      sock.ev.removeAllListeners("creds.update");
      sock.ev.removeAllListeners("messages.upsert");
      sock.ws.close();
      sock = null;
    } catch (error) {
      console.error("⚠️ Erro ao limpar socket:", error.message);
    }
  }
  
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

// Função para agendar reconexão (previne race condition)
const scheduleReconnect = (delay) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWhatsApp();
  }, delay);
  
  console.log(`⏳ Reconexão agendada em ${(delay/1000).toFixed(1)}s`);
};

const startWhatsApp = async () => {
  if (isConnecting) {
    console.log("⏳ Conexão já em andamento, aguarde...");
    return;
  }

  try {
    isConnecting = true;
    console.log("🔄 Inicializando WhatsApp...");
    
    // Limpar socket anterior antes de criar novo
    cleanupSocket();
    
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📦 Versão WA: ${version.join(".")}, Latest: ${isLatest}`);

    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      browser: ["Ubuntu", "Chrome", "20.0.04"],
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      getMessage: async () => ({ conversation: "Mensagem não disponível" }),
    });

    // Atualização de credenciais
    sock.ev.on("creds.update", saveCreds);

    // Monitorar conexão
    sock.ev.on("connection.update", async (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr) {
        console.log("\n📱 Gerando QR Code...");
        try {
          qrCodeDataURL = await QRCode.toDataURL(qr);
          console.log("✅ QR Code disponível em: /qr");
        } catch (err) {
          console.error("❌ Erro ao gerar QR Code:", err.message);
        }
      }

      if (connection === "open") {
        console.log("✅ WhatsApp conectado com sucesso!");
        qrCodeDataURL = null;
        reconnectAttempts = 0;
        isConnecting = false;
      }

      if (connection === "close") {
        isConnecting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log("❌ Conexão fechada:", {
          statusCode,
          reason: Object.keys(DisconnectReason).find(key => DisconnectReason[key] === statusCode) || "Unknown",
          shouldReconnect,
          attempt: reconnectAttempts + 1
        });

        // Tratamento específico de erro 405
        if (statusCode === 405 && reconnectAttempts >= 2) {
          console.log("🗑️ Erro 405 persistente - Limpando sessão...");
          await clearCorruptedSession();
          reconnectAttempts = 0;
        }

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = getReconnectDelay(reconnectAttempts - 1);
          scheduleReconnect(delay);
        } else if (!shouldReconnect) {
          console.log("🚪 Logout detectado - Não reconectará automaticamente");
        } else {
          console.error("🚫 Máximo de tentativas atingido");
          reconnectAttempts = 0;
        }
      }

      if (connection === "connecting") {
        console.log("🔌 Conectando ao WhatsApp...");
      }
    });

    // Receber mensagens e enviar para o n8n
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        for (const msg of messages) {
          if (!msg || msg.key.fromMe || !msg.message) continue;
          
          const messageType = Object.keys(msg.message)[0];
          console.log(`📩 Mensagem recebida de ${msg.key.remoteJid} - Tipo: ${messageType}`);

          // Extrair texto de diferentes tipos de mensagem
          let messageText = '';
          if (msg.message.conversation) {
            messageText = msg.message.conversation;
          } else if (msg.message.extendedTextMessage?.text) {
            messageText = msg.message.extendedTextMessage.text;
          }

          const webhookUrl = process.env.N8N_WEBHOOK_URL;
          if (webhookUrl) {
            try {
              const payload = {
                from: msg.key.remoteJid,
                messageType,
                text: messageText,
                timestamp: msg.messageTimestamp,
                fullMessage: msg,
              };

              const response = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10000),
              });

              if (response.ok) {
                console.log("✅ Mensagem enviada para n8n");
              } else {
                console.error(`⚠️ N8N retornou ${response.status}`);
              }
            } catch (error) {
              console.error("❌ Erro ao enviar para n8n:", error.message);
            }
          }
        }
      } catch (error) {
        console.error("❌ Erro ao processar mensagens:", error);
      }
    });

    console.log("✅ WhatsApp inicializado");
    isConnecting = false;

  } catch (error) {
    isConnecting = false;
    console.error("❌ Erro ao inicializar WhatsApp:", error.message);
    
    if (reconnectAttempts >= 2) {
      await clearCorruptedSession();
      reconnectAttempts = 0;
    }
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = getReconnectDelay(reconnectAttempts - 1);
      scheduleReconnect(delay);
    }
  }
};

// Rota de Health Check
app.get("/", (req, res) => {
  const status = sock ? "conectado" : "aguardando conexão";
  const qrStatus = qrCodeDataURL ? "disponível em /qr" : "não disponível";
  res.json({ 
    status: "online", 
    whatsapp: status,
    qrCode: qrStatus,
    reconnectAttempts,
    timestamp: new Date().toISOString()
  });
});

// Health check detalhado
app.get("/health", (req, res) => {
  const healthCheck = {
    uptime: process.uptime(),
    message: "OK",
    timestamp: Date.now(),
    whatsapp: sock ? "connected" : "disconnected",
    reconnectAttempts,
    memoryUsage: process.memoryUsage(),
  };
  
  try {
    res.send(healthCheck);
  } catch (error) {
    healthCheck.message = error.message;
    res.status(503).send();
  }
});

// Endpoint para enviar mensagens
app.post("/sendText", async (req, res) => {
  console.log(`📨 POST /sendText recebido de ${req.ip}`);
  console.log(`📋 Body:`, JSON.stringify(req.body, null, 2));
  
  try {
    if (!sock) {
      return res.status(503).json({ 
        error: "WhatsApp não inicializado",
        message: "Aguarde a conexão ser estabelecida",
        reconnectAttempts
      });
    }
    
    const { numero, mensagem } = req.body;
    
    // Validações robustas
    if (!numero || typeof numero !== 'string' || numero.trim().length < 10) {
      return res.status(400).json({ 
        error: "Número inválido",
        message: "Informe um número válido (DDI + DDD + número)"
      });
    }
    
    if (!mensagem || typeof mensagem !== 'string' || mensagem.trim().length === 0) {
      return res.status(400).json({ 
        error: "Mensagem inválida",
        message: "Informe uma mensagem não vazia"
      });
    }
    
    // Sanitizar número
    const numeroLimpo = numero.replace(/\D/g, '');
    const jid = `${numeroLimpo}@s.whatsapp.net`;
    
    console.log(`📤 Enviando para ${numeroLimpo}`);
    
    // Timeout na operação
    const sendPromise = sock.sendMessage(jid, { text: mensagem.trim() });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout ao enviar mensagem')), 30000)
    );
    
    await Promise.race([sendPromise, timeoutPromise]);
    
    console.log("✅ Mensagem enviada");
    
    return res.json({ 
      status: "OK",
      message: "Mensagem enviada com sucesso",
      to: numeroLimpo,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ Erro ao enviar:", err.message);
    return res.status(500).json({ 
      error: "Erro ao enviar mensagem",
      details: err.message
    });
  }
});

// Endpoint para exibir QR Code escaneável
app.get("/qr", (req, res) => {
  if (qrCodeDataURL) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp QR Code</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }
          .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 500px;
          }
          h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 24px;
          }
          p {
            color: #666;
            margin-bottom: 30px;
          }
          img {
            width: 300px;
            height: 300px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          }
          .refresh-btn {
            margin-top: 20px;
            padding: 12px 24px;
            background: #25D366;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 600;
            transition: background 0.3s;
          }
          .refresh-btn:hover {
            background: #1fb855;
          }
          .instructions {
            margin-top: 20px;
            font-size: 14px;
            color: #999;
            line-height: 1.6;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚀 WhatsApp API</h1>
          <p>Escaneie o QR Code abaixo com seu WhatsApp</p>
          <img src="${qrCodeDataURL}" alt="QR Code" />
          <div class="instructions">
            <p><strong>Como conectar:</strong></p>
            <p>1. Abra o WhatsApp no seu celular</p>
            <p>2. Toque em Aparelhos conectados</p>
            <p>3. Toque em Conectar um aparelho</p>
            <p>4. Aponte a câmera para este QR Code</p>
          </div>
          <button class="refresh-btn" onclick="location.reload()">🔄 Atualizar</button>
        </div>
      </body>
      </html>
    `);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp QR Code</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="refresh" content="5">
        <style>
          body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
          }
          h1 { color: #333; }
          p { color: #666; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ WhatsApp Conectado</h1>
          <p>O QR Code não está mais disponível pois a conexão já foi estabelecida.</p>
          <p style="font-size: 14px; color: #999;">Esta página atualiza automaticamente a cada 5 segundos.</p>
        </div>
      </body>
      </html>
    `);
  }
});

app.get("/sendText", (req, res) => {
  res.status(405).json({ error: "Use POST para enviar mensagens" });
});

// Endpoint de reset melhorado
app.post("/reset", async (req, res) => {
  try {
    console.log("🔄 Reset solicitado");
    
    cleanupSocket();
    await clearCorruptedSession();
    reconnectAttempts = 0;
    isConnecting = false;
    
    setTimeout(() => startWhatsApp(), 2000);
    
    res.json({ 
      status: "OK",
      message: "Sessão resetada - Aguarde novo QR Code"
    });
  } catch (error) {
    res.status(500).json({ 
      error: "Erro ao resetar",
      details: error.message
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM recebido, desligando graciosamente...');
  cleanupSocket();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT recebido, desligando graciosamente...');
  cleanupSocket();
  process.exit(0);
});

// Handler de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  cleanupSocket();
  setTimeout(() => startWhatsApp(), 5000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API WhatsApp rodando na porta ${PORT}`);
  startWhatsApp();
});