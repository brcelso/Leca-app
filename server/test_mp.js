
const token = "APP_USR-1253235899009881-021420-881c35d24b04f32cf875035eeb71fe77-124280008";

async function testMP() {
    console.log("🚀 Iniciando teste do Mercado Pago...");

    try {
        const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                items: [
                    {
                        title: 'Leca Pro - Teste de Validação',
                        quantity: 1,
                        unit_price: 1.00,
                        currency_id: 'BRL'
                    }
                ],
                payer: {
                    email: 'test@leca.app'
                }
            })
        });

        const data = await response.json();

        if (response.ok) {
            console.log("✅ TOKEN VÁLIDO!");
            console.log("🔗 Link de Checkout gerado:", data.init_point);
            console.log("💰 ID da Preferência:", data.id);
        } else {
            console.log("❌ ERRO NA API DO MERCADO PAGO:");
            console.log(JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.log("💥 ERRO DE CONEXÃO:", error.message);
    }
}

testMP();
