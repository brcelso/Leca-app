// Script de Validação Direta da API do AbacatePay
// Restaurado para a versão de SUCESSO absoluta (ID 1271)

const apiKey = process.env.ABACATE_PAY_API_KEY;

if (!apiKey) {
    console.error('ERRO: Defina a variável de ambiente ABACATE_PAY_API_KEY');
    process.exit(1);
}

async function testCheckout() {
    console.log('--- 🛡️ TESTE DE SUCESSO (ESTILO 1271) ---');

    const payload = {
        frequency: 'ONE_TIME',
        methods: ['PIX'],
        products: [{
            externalId: 'leca_pro_lifetime', // Revertido pro ID original
            name: 'Leca Pro - Acesso Vitalício',
            quantity: 1,
            price: 1990
        }],
        returnUrl: 'https://leca.celsosilva.com.br/',
        completionUrl: 'https://leca.celsosilva.com.br/',
        customer: {
            email: 'celsosilvajunior90@gmail.com',
            name: 'Celso Silva Junior',
            taxId: '36713044808',
            cellphone: '11972509876'
        }
    };

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
        console.log('\nStatus:', res.status);
        console.log('Resposta:', JSON.stringify(data, null, 2));

        if (data.success) {
            console.log('\n✅ SUCESSO!');
            console.log('Link:', data.data.url);
        } else {
            console.log('\n❌ ERRO:', data.error);
        }
    } catch (err) {
        console.error('\n❌ ERRO:', err.message);
    }
}

testCheckout();
