const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
require('dotenv').config();

// ─── Notify Gage when a realtor/inspector replies ─────────────────────────
async function notifyReply({ contact, contactType, channel, replyText, subject }) {
  const name = contact.name || 'Unknown';
  const brokerage = contact.brokerage || contact.company || '';
  const state = contact.state || '';
  const score = contact.engagement_score || 0;

  const message = `
🔔 NEW REPLY — ${contactType.toUpperCase()}

👤 ${name}${brokerage ? ` — ${brokerage}` : ''}
📍 ${state}
📊 Engagement Score: ${score}
📱 Channel: ${channel.toUpperCase()}
${subject ? `📧 Re: ${subject}\n` : ''}
💬 "${replyText?.substring(0, 200)}${replyText?.length > 200 ? '...' : ''}"

📞 ${contact.phone || 'No phone'}
✉️  ${contact.email || 'No email'}

👉 Open your Secure24 dashboard to respond and mark as partner.
  `.trim();

  // Send SMS to Gage
  await sendSMSNotification(message);

  // Send email to Gage  
  await sendEmailNotification({
    subject: `🔔 New Reply: ${name} (${contactType}) via ${channel}`,
    body: message,
    contact,
    contactType,
    replyText
  });

  console.log(`[Notify] Gage alerted about reply from ${name}`);
}

// ─── Daily morning summary to Gage ───────────────────────────────────────
async function sendDailySummary(stats) {
  const message = `
📊 SECURE24 DAILY SUMMARY

📧 Emails sent: ${stats.emails_sent || 0}
💬 Texts sent: ${stats.texts_sent || 0}
🔥 New hot leads: ${stats.hot_leads || 0}
💬 New replies: ${stats.replies || 0}
🤝 New partners: ${stats.new_partners || 0}
📋 New referrals: ${stats.new_referrals || 0}

Total partners to date: ${stats.total_partners || 0}
Total referrals to date: ${stats.total_referrals || 0}
  `.trim();

  await sendSMSNotification(message);
  await sendEmailNotification({
    subject: `📊 Secure24 Daily Summary — ${new Date().toLocaleDateString()}`,
    body: message
  });
}

// ─── Send SMS via Twilio ──────────────────────────────────────────────────
async function sendSMSNotification(message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const to = process.env.NOTIFICATION_PHONE;

  if (!sid || sid === 'your_twilio_account_sid_here' || !to) {
    console.log('[Notify SMS] Would send:', message.substring(0, 100));
    return;
  }

  try {
    const client = twilio(sid, token);
    // Split long messages
    const chunks = message.match(/.{1,1600}/gs) || [message];
    for (const chunk of chunks) {
      await client.messages.create({ body: chunk, from, to });
    }
  } catch (err) {
    console.error('[Notify SMS] Failed:', err.message);
  }
}

// ─── Send email via SendGrid ──────────────────────────────────────────────
async function sendEmailNotification({ subject, body, contact, contactType, replyText }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const to = process.env.NOTIFICATION_EMAIL;

  if (!apiKey || apiKey === 'your_sendgrid_api_key_here' || !to) {
    console.log('[Notify Email] Would send:', subject);
    return;
  }

  sgMail.setApiKey(apiKey);

  const htmlBody = body.replace(/\n/g, '<br>');

  try {
    await sgMail.send({
      to,
      from: {
        email: process.env.FROM_EMAIL || 'partnerships@secure24partners.com',
        name: 'Secure24 Outreach System'
      },
      subject,
      text: body,
      html: `
        <div style="font-family: monospace; background: #0a0a0a; color: #00ff88; padding: 30px; border-radius: 8px; max-width: 600px;">
          <h2 style="color: #00ff88; border-bottom: 1px solid #333; padding-bottom: 10px;">
            ${subject}
          </h2>
          <pre style="white-space: pre-wrap; color: #ccc; font-size: 14px; line-height: 1.6;">${body}</pre>
          ${contact ? `
            <div style="margin-top: 20px; padding: 15px; background: #1a1a1a; border-radius: 6px;">
              <a href="tel:${contact.phone}" style="background: #00ff88; color: #000; padding: 10px 20px; border-radius: 4px; text-decoration: none; font-weight: bold; margin-right: 10px;">
                📞 Call Now
              </a>
            </div>
          ` : ''}
        </div>
      `
    });
  } catch (err) {
    console.error('[Notify Email] Failed:', err.message);
  }
}

module.exports = { notifyReply, sendDailySummary };
