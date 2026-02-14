// Script para testar o Webhook do Leca diretamente
// Não requer dependências em Node 18+
async function testWebhook() {
    const url = 'https://leca-server.celsosilvajunior90.workers.dev/api/webhook/abacate';

    const mockPayload = {
        event: 'billing.paid',
        data: {
            customer: {
                email: 'celsosilvajunior90@gmail.com'
            }
        }
    };

    console.log('Testando Webhook em:', url);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mockPayload)
        });

        const text = await res.text();
        console.log('Status do Webhook:', res.status);
        console.log('Resposta do Webhook:', text);

        if (res.status === 200 && text === 'OK') {
            console.log('✅ Webhook respondeu corretamente!');
        } else {
            console.log('❌ Falha no Webhook.');
        }
    } catch (err) {
        console.log('🔥 Erro de conexão:', err.message);
    }
}

testWebhook();
