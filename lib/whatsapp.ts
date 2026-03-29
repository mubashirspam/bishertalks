// Meta WhatsApp Cloud API — Free (1000 conversations/month)
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/message-templates

interface WhatsAppMessage {
  phone: string;       // with country code e.g. "919876543210"
  templateName: string;
  parameters: string[];
}

export async function sendWhatsApp({
  phone,
  templateName,
  parameters,
}: WhatsAppMessage): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: phone.replace(/^\+/, ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text })),
        },
      ],
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json();
    console.error("[WhatsApp] Send failed:", JSON.stringify(err));
    // Don't throw — WhatsApp failure must never block the order flow
    return;
  }

  const result = await response.json();
  console.log("[WhatsApp] Sent:", result.messages?.[0]?.id);
}
