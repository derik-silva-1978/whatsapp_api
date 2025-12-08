# WhatsApp API - Configuração Railway

## 🚀 Deploy Rápido

### 1. Variáveis de Ambiente

Configure no Railway (Settings → Variables):

```env
PORT=3000
N8N_WEBHOOK_URL=https://seu-n8n.com/webhook/whatsapp
NODE_ENV=production
```

### 2. Volume Persistente (CRÍTICO)

**Sem o volume, você precisará escanear o QR Code a cada restart!**

1. Vá em **Settings → Volumes**
2. Clique em **"New Volume"**
3. Configure:
   - **Mount Path**: `/app/auth_info`
   - **Size**: 1GB

### 3. Health Check (Recomendado)

Configure em **Settings → Health Check**:
- **Path**: `/health`
- **Port**: Use o mesmo da variável PORT (3000)
- **Interval**: 60 segundos

Isso permite que o Railway monitore automaticamente a saúde do serviço.

---

## 🔧 Melhorias Aplicadas (v2.0)

### ✅ Correções Críticas

1. **Memory Leak Resolvido**
   - Listeners são removidos antes de cada reconexão
   - Previne travamentos após múltiplas reconexões

2. **Race Condition Eliminada**
   - Sistema de reconexão com timer único
   - Evita múltiplas tentativas simultâneas

3. **Validações Robustas**
   - Timeout de 30s para envio de mensagens
   - Sanitização de números telefônicos
   - Validação de tipos de dados

4. **Graceful Shutdown**
   - Cleanup adequado ao receber SIGTERM/SIGINT
   - Recovery automático de erros não capturados

---

## 📊 Monitoramento

### Endpoints de Status

**Health Check Simples:**
```bash
GET https://seu-projeto.up.railway.app/
```

**Health Check Detalhado:**
```bash
GET https://seu-projeto.up.railway.app/health
```

Retorna:
- Uptime do processo
- Status da conexão WhatsApp
- Número de tentativas de reconexão
- Uso de memória

### Logs Importantes

Fique atento a estes logs:

- `✅ WhatsApp conectado com sucesso!` - Tudo ok
- `🗑️ Erro 405 persistente - Limpando sessão...` - Auto-recovery em ação
- `🚫 Máximo de tentativas atingido` - Pode precisar de reset manual
- `🧹 Limpando socket anterior...` - Prevenção de memory leak funcionando

---

## 🔄 Reconexão Automática

O sistema agora implementa:

- **Backoff Exponencial**: 10s → 20s → 40s (com jitter aleatório)
- **Máximo de 5 tentativas** antes de parar
- **Limpeza automática** de sessão após 2 falhas com erro 405
- **Timer único** para prevenir reconexões simultâneas

---

## ⚠️ Solução de Problemas

### Erro 405 Persistente

O sistema trata automaticamente:
1. Após 2 tentativas com erro 405, limpa a sessão
2. Gera novo QR Code automaticamente
3. Se persistir, use: `POST /reset`

### WhatsApp Desconecta Frequentemente

Verifique:
- ✅ Volume está configurado corretamente
- ✅ Health check está ativo
- ✅ Memória suficiente (mínimo 512MB recomendado)

### Reset Manual

Se necessário, force um reset:

```bash
curl -X POST https://seu-projeto.up.railway.app/reset
```

---

## 🌐 Acessar QR Code

Após o deploy:

1. **URL do QR Code**: `https://seu-projeto.up.railway.app/qr`
2. Acesse no navegador
3. Escaneie com WhatsApp → Aparelhos conectados
4. Pronto!

---

## 📝 Endpoints Disponíveis

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/` | Health check simples |
| GET | `/health` | Health check detalhado |
| GET | `/qr` | Exibir QR Code visual |
| POST | `/sendText` | Enviar mensagem |
| POST | `/reset` | Resetar sessão |

### Exemplo de Envio

```bash
curl -X POST https://seu-projeto.up.railway.app/sendText \
  -H "Content-Type: application/json" \
  -d '{
    "numero": "5511999999999",
    "mensagem": "Olá do Railway!"
  }'
```

---

## 🎯 Checklist de Deploy

- [ ] Variáveis de ambiente configuradas
- [ ] Volume `/app/auth_info` criado
- [ ] Health check em `/health` configurado
- [ ] Deploy realizado com sucesso
- [ ] QR Code escaneado
- [ ] Teste de envio realizado
- [ ] Webhook N8N configurado (opcional)

---

## 📞 Suporte

Em caso de problemas:

1. Verifique os logs do Railway
2. Acesse `/health` para diagnóstico
3. Use `/reset` se necessário
4. Consulte o README.md para documentação completa
