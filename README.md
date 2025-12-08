# WhatsApp API - Railway

API para integração do WhatsApp com automações N8N e outras plataformas.

## 📋 Índice

- [Instalação](#instalação)
- [Endpoints](#endpoints)
- [Configuração N8N](#configuração-n8n)
- [Exemplos de Uso](#exemplos-de-uso)

## 🚀 Instalação

Deploy automático no Railway conectando este repositório.

### Variáveis de Ambiente

Configure no Railway:

```env
PORT=3000
N8N_WEBHOOK_URL=https://seu-n8n.com/webhook/whatsapp
```

### Volume Persistente

**IMPORTANTE**: Configure um volume para manter a sessão do WhatsApp:

- **Mount Path**: `/app/auth_info`
- **Size**: 1GB

## 🔌 Endpoints

### 1. Health Check

**GET** `/`

Verifica se a API está online e o status da conexão do WhatsApp.

**Resposta de Sucesso (200 OK):**
```json
{
  "status": "online",
  "whatsapp": "conectado",
  "qrCode": "não disponível",
  "timestamp": "2025-12-08T12:00:00.000Z"
}
```

---

### 2. QR Code

**GET** `/qr`

Exibe o QR Code para autenticação do WhatsApp em uma interface web.

**URL Exemplo:**
```
https://seu-projeto.up.railway.app/qr
```

**Uso:**
1. Acesse a URL no navegador
2. Escaneie o QR Code com o WhatsApp
3. A página atualiza automaticamente quando conectado

---

### 3. Enviar Mensagem de Texto

**POST** `/sendText`

Envia uma mensagem de texto para um número do WhatsApp.

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "numero": "5511999999999",
  "mensagem": "Olá! Esta é uma mensagem automática."
}
```

**Parâmetros:**
- `numero` (string, obrigatório): Número com DDI e DDD (apenas números)
- `mensagem` (string, obrigatório): Texto da mensagem

**Resposta de Sucesso (200 OK):**
```json
{
  "status": "OK",
  "message": "Mensagem enviada com sucesso",
  "timestamp": "2025-12-08T12:00:00.000Z"
}
```

**Erros Possíveis:**

- **400 Bad Request** - Parâmetros inválidos
```json
{
  "error": "Parâmetros inválidos",
  "message": "Informe 'numero' e 'mensagem'"
}
```

- **503 Service Unavailable** - WhatsApp não conectado
```json
{
  "error": "WhatsApp ainda não inicializado",
  "message": "Aguarde a conexão ser estabelecida"
}
```

- **500 Internal Server Error** - Erro ao enviar
```json
{
  "error": "Erro ao enviar mensagem",
  "details": "mensagem de erro detalhada"
}
```

---

### 4. Webhook de Recebimento (Configurado via N8N_WEBHOOK_URL)

A API envia automaticamente as mensagens recebidas para a URL configurada em `N8N_WEBHOOK_URL`.

**Método:** POST

**Body (exemplo):**
```json
{
  "key": {
    "remoteJid": "5511999999999@s.whatsapp.net",
    "fromMe": false,
    "id": "3EB0XXXXX"
  },
  "message": {
    "conversation": "Texto da mensagem recebida"
  },
  "messageTimestamp": "1733659200"
}
```

---

### 5. Reset de Sessão

**POST** `/reset`

Força o reset da sessão do WhatsApp (útil quando há problemas de conexão).

**Resposta de Sucesso (200 OK):**
```json
{
  "status": "OK",
  "message": "Sessão resetada. Aguarde o novo QR Code nos logs."
}
```

## 🔧 Configuração N8N

### Fluxo 1: Receber Mensagens do WhatsApp

1. **Adicione um nó "Webhook"**
   - Método: POST
   - Caminho: `/webhook/whatsapp`
   - Copie a URL gerada

2. **Configure a variável no Railway**
   ```
   N8N_WEBHOOK_URL=https://seu-n8n.com/webhook/whatsapp
   ```

3. **Processe os dados recebidos**
   - Acesse: `{{ $json.message.conversation }}` para o texto
   - Acesse: `{{ $json.key.remoteJid }}` para o número

### Fluxo 2: Enviar Mensagens pelo WhatsApp

1. **Adicione um nó "HTTP Request"**
   - Método: POST
   - URL: `https://seu-projeto.up.railway.app/sendText`
   - Headers: `Content-Type: application/json`
   
2. **Configure o Body:**
   ```json
   {
     "numero": "{{ $json.telefone }}",
     "mensagem": "{{ $json.texto }}"
   }
   ```

## 📝 Exemplos de Uso

### Exemplo 1: cURL

```bash
curl -X POST https://seu-projeto.up.railway.app/sendText \
  -H "Content-Type: application/json" \
  -d '{
    "numero": "5511999999999",
    "mensagem": "Olá do cURL!"
  }'
```

### Exemplo 2: JavaScript (Node.js)

```javascript
const response = await fetch('https://seu-projeto.up.railway.app/sendText', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    numero: '5511999999999',
    mensagem: 'Olá do JavaScript!'
  })
});

const result = await response.json();
console.log(result);
```

### Exemplo 3: Python

```python
import requests

url = 'https://seu-projeto.up.railway.app/sendText'
data = {
    'numero': '5511999999999',
    'mensagem': 'Olá do Python!'
}

response = requests.post(url, json=data)
print(response.json())
```

## 🔍 Monitoramento

### Verificar Status
```bash
curl https://seu-projeto.up.railway.app/
```

### Ver QR Code
Acesse: `https://seu-projeto.up.railway.app/qr`

### Logs do Railway
Acompanhe em tempo real no painel do Railway → Deploy Logs

## ⚠️ Observações Importantes

1. **Formato do Número**: Sempre use DDI + DDD + Número (apenas números)
   - ✅ Correto: `5511999999999`
   - ❌ Errado: `+55 11 99999-9999`

2. **Timeout do QR Code**: O QR Code expira em ~60 segundos. Se não escanear a tempo, acesse `/qr` novamente.

3. **Persistência**: Sem o volume configurado, você precisará escanear o QR Code a cada restart.

4. **Rate Limiting**: O WhatsApp pode bloquear temporariamente se enviar muitas mensagens em pouco tempo.

## 🛠️ Tecnologias

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [Express](https://expressjs.com/) - Framework web
- [QRCode](https://www.npmjs.com/package/qrcode) - Geração de QR Code
- [Pino](https://getpino.io/) - Logger

## 📄 Licença

MIT

