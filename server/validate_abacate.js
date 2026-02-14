// Script de Validação Direta da API do AbacatePay
// Não requer dependências externas em Node v18+

const apiKey = process.env.ABACATE_PAY_API_KEY;

if (!apiKey) {
    console.error('ERRO: Defina a variável de ambiente ABACATE_PAY_API_KEY');
    process.exit(1);
}

async function testCheckout() {
    console.log('--- Iniciando Teste de Checkout AbacatePay ---');

    const payload = {
        frequency: 'ONE_TIME',
        methods: ['PIX'],
        products: [{
            externalId: 'test_validation_' + Date.now(),
            name: 'Teste de Validação - Leca',
            quantity: 1,
            price: 1990
        }],
        returnUrl: 'https://leca.celsosilva.com.br/',
        completionUrl: 'https://leca.celsosilva.com.br/',
        customer: {
            email: 'teste@exemplo.com',
            name: 'Usuario Teste',
            taxId: '36713044808',
            cellphone: '11972509876' // O número que queremos validar
        }
    };

    console.log('Payload sendo enviado:', JSON.stringify(payload, null, 2));

    try {
        const res = await fetch('https://api.abacatepay.com/v1/billing/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        console.log('Status da Resposta:', res.status);
        console.log('Resposta Completa da API:', JSON.stringify(data, null, 2));

        if (data.data && data.data.url) {
            console.log('\n✅ SUCESSO! Link gerado:', data.data.url);
            console.log('Abra o link acima e verifique se o telefone no checkout é 11972509876');
        } else {
            console.log('\n❌ ERRO NA API:', data.error || 'Erro desconhecido');
        }
    } catch (err) {
        console.error('\n❌ ERRO DE CONEXÃO:', err.message);
    }
}

testCheckout();
