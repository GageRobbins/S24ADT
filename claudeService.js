const axios = require('axios');
require('dotenv').config();

// ─── Generate personalized email for realtor ──────────────────────────────
async function generateRealtorEmail(realtor, emailType = 'initial') {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const followupContext = {
    initial: 'This is the first outreach to this realtor.',
    followup_1: 'This is a first follow-up. They have not replied yet. Keep it brief and friendly.',
    followup_2: 'This is a second follow-up. Still no reply. Try a slightly different angle.',
    followup_3: 'Third follow-up. Reference the value proposition more specifically.',
    followup_4: 'Fourth follow-up. Make it personal and direct.',
    followup_5: 'Final follow-up. Let them know this is the last outreach.'
  };

  const prompt = `You are writing a professional outreach email on behalf of Gage Robbins, Real Estate Partnership Manager at Secure24 ADT.

REALTOR INFO:
- Name: ${realtor.name}
- Brokerage: ${realtor.brokerage || 'their brokerage'}
- Recent closing address: ${realtor.address || 'a recent home sale'}
- City/State: ${realtor.city || ''}, ${realtor.state || ''}

EMAIL TYPE: ${emailType}
CONTEXT: ${followupContext[emailType] || followupContext.initial}

KEY TALKING POINTS TO INCLUDE:
1. We pay $200 per install/referral to the realtor
2. We waive ALL equipment and installation fees for their referred clients (huge value - saves clients $500-1500)
3. Simple referral process - they just send us the new homeowner's info
4. Their clients get a top-rated ADT security system protecting their new home
5. This is a win-win: realtor earns money, their client gets protected, no cost to anyone

TONE: Professional but warm and conversational. Not salesy or pushy.

RULES:
- Keep it under 150 words
- Do NOT use phrases like "I hope this email finds you well"
- Do NOT use excessive exclamation points
- Make it feel personal and genuine
- Reference their recent closing naturally
- Subject line should be compelling and specific

RESPOND IN THIS EXACT JSON FORMAT (no markdown, no extra text):
{
  "subject": "email subject here",
  "body": "full email body here with line breaks as \\n"
}`;

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });

    const text = response.data.content[0].text;
    return JSON.parse(text);
  } catch (err) {
    console.error('[Claude] Email generation failed:', err.message);
    // Fallback template
    return getFallbackEmail(realtor, emailType);
  }
}

// ─── Generate personalized text for realtor ───────────────────────────────
async function generateRealtorText(realtor, textType = 'initial') {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const prompt = `Write a short, professional SMS text message from Gage Robbins at Secure24 ADT to a realtor named ${realtor.name}.

PURPOSE: Introduce a referral partnership program.
KEY POINTS: $200 per install, zero equipment/installation fees for their clients.
TYPE: ${textType === 'initial' ? 'First outreach text' : 'Follow-up text, they haven\'t responded yet'}

RULES:
- Under 160 characters if possible, max 320
- Professional but conversational
- Must include "Reply STOP to opt out"
- No emojis
- End with - Gage, Secure24 ADT

Return ONLY the text message, nothing else.`;

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });

    return response.data.content[0].text.trim();
  } catch (err) {
    console.error('[Claude] Text generation failed:', err.message);
    return getFallbackText(realtor);
  }
}

// ─── Generate inspector email ─────────────────────────────────────────────
async function generateInspectorEmail(inspector, emailType = 'initial') {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const prompt = `Write a professional outreach email from Gage Robbins, Real Estate Partnership Manager at Secure24 ADT, to a home inspector.

INSPECTOR INFO:
- Name: ${inspector.name}
- Company: ${inspector.company || 'their inspection company'}
- State: ${inspector.state || ''}

KEY TALKING POINTS:
1. We pay $200 per install/referral
2. We waive ALL equipment and installation fees for their referred clients
3. Home inspectors are in a perfect position - they meet new homeowners right before move-in
4. Simple referral process
5. Their clients get peace of mind with ADT protection in their new home

TONE: Professional, warm. Acknowledge their unique position in the home buying process.
LENGTH: Under 150 words.
TYPE: ${emailType === 'initial' ? 'First outreach' : 'Follow-up ' + emailType}

RESPOND IN THIS EXACT JSON FORMAT:
{
  "subject": "subject here",
  "body": "body here with \\n for line breaks"
}`;

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });

    const text = response.data.content[0].text;
    return JSON.parse(text);
  } catch (err) {
    return getFallbackInspectorEmail(inspector, emailType);
  }
}

// ─── Partner welcome email ────────────────────────────────────────────────
function getPartnerWelcomeEmail(contact, referralCode) {
  return {
    subject: `Welcome to the Secure24 ADT Partner Program, ${contact.name.split(' ')[0]}!`,
    body: `Hi ${contact.name.split(' ')[0]},

Welcome to the Secure24 ADT Partner Program! We're thrilled to have you on board.

Here's how it works:
• Send us a new homeowner's name, phone, and address
• We waive all equipment and installation fees for them
• Once they install, you receive $200 — simple as that

YOUR UNIQUE REFERRAL CODE: ${referralCode}

To submit a referral, simply reply to this email with the homeowner's info, or call/text me directly.

There's no limit to how many referrals you can send. The more new homeowners you help protect, the more you earn.

Questions? I'm always available.

Best,
Gage Robbins
Real Estate Partnership Manager
Secure24 ADT
(309) 532-4736

To unsubscribe from future emails, reply UNSUBSCRIBE.`
  };
}

// ─── Fallback templates (when Claude API unavailable) ─────────────────────
function getFallbackEmail(realtor, emailType) {
  const firstName = realtor.name ? realtor.name.split(' ')[0] : 'there';
  
  if (emailType === 'initial') {
    return {
      subject: `Partnership Opportunity — $200/Referral + Free Installation for Your Clients`,
      body: `Hi ${firstName},\n\nCongratulations on your recent closing${realtor.address ? ` on ${realtor.address}` : ''}!\n\nI'm reaching out about a simple partnership that pays you $200 for every client you refer who installs an ADT security system — and we waive all equipment and installation fees for them.\n\nNo catch. Your client gets a top-rated security system at no upfront cost, and you earn $200 per install.\n\nWould you be open to a quick 5-minute call to learn more?\n\nBest,\nGage Robbins\nReal Estate Partnership Manager\nSecure24 ADT\n(309) 532-4736\n\nTo unsubscribe, reply UNSUBSCRIBE.`
    };
  }

  return {
    subject: `Following up — ADT Partnership for ${firstName}`,
    body: `Hi ${firstName},\n\nJust following up on my previous email about our realtor partnership program.\n\nQuick recap: $200 per install, zero equipment or installation fees for your clients.\n\nIf you have a few minutes this week, I'd love to connect.\n\nBest,\nGage Robbins\nReal Estate Partnership Manager\nSecure24 ADT\n(309) 532-4736\n\nTo unsubscribe, reply UNSUBSCRIBE.`
  };
}

function getFallbackText(realtor) {
  const firstName = realtor.name ? realtor.name.split(' ')[0] : 'there';
  return `Hi ${firstName}, this is Gage from Secure24 ADT. We pay realtors $200/referral + waive all equipment fees for your clients. Interested in partnering? - Gage, Secure24 ADT. Reply STOP to opt out.`;
}

function getFallbackInspectorEmail(inspector, emailType) {
  const firstName = inspector.name ? inspector.name.split(' ')[0] : 'there';
  return {
    subject: `Partnership for Home Inspectors — $200/Referral + Free ADT Installation`,
    body: `Hi ${firstName},\n\nAs a home inspector, you meet new homeowners at the perfect moment — right before they move in.\n\nWe'd love to partner with you. For every client you refer who installs an ADT system, we pay you $200 and waive all equipment and installation fees for them.\n\nSimple referral, real money, happy clients.\n\nInterested in learning more?\n\nBest,\nGage Robbins\nReal Estate Partnership Manager\nSecure24 ADT\n(309) 532-4736\n\nTo unsubscribe, reply UNSUBSCRIBE.`
  };
}

module.exports = { generateRealtorEmail, generateRealtorText, generateInspectorEmail, getPartnerWelcomeEmail };
