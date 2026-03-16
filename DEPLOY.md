# Secure24 ADT Outreach System
## Deployment Guide for Gage Robbins

---

## What's Built

- **Automated daily data pull** — fetches new home closings every morning at 7am
- **Email campaigns** — personalized AI-written emails sent at 8am and 6pm daily
- **Text follow-ups** — automated texts to unreplied leads at 12pm daily
- **Engagement scoring** — tracks email opens, clicks, scores every lead
- **Hot leads view** — realtors who opened emails shown by score
- **Reply detection** — notifies you instantly via text + email when anyone replies
- **Inspector campaign** — separate outreach to home inspectors
- **Partner management** — mark partners, track referrals, log payouts
- **Partner portal** — unique link for each partner to submit referrals
- **CRM suppression** — import from thealarmprogram.com to prevent duplicate outreach
- **Mobile dashboard** — full app accessible from your phone browser

---

## Step 1 — Upload to GitHub (Free)

1. Go to **github.com** → Sign up for free account
2. Click **"New repository"**
3. Name it `secure24-outreach`
4. Click **"Create repository"**
5. On the next screen, click **"uploading an existing file"**
6. Upload ALL the files from this folder
7. Click **"Commit changes"**

---

## Step 2 — Deploy to Railway (5 minutes)

1. Go to **railway.app** → Sign up with your GitHub account
2. Click **"New Project"**
3. Click **"Deploy from GitHub repo"**
4. Select `secure24-outreach`
5. Railway will auto-detect and deploy — takes about 2 minutes
6. Once deployed, click your project → **Settings** → **Domains**
7. Click **"Generate Domain"**
8. You'll get a URL like: `secure24-outreach.up.railway.app`

**That's your app URL. Bookmark it on your phone.**

---

## Step 3 — Add Environment Variables on Railway

In Railway: Click your project → **Variables** → Add each one:

```
REALESTATEAPI_KEY        = (from realestateapi.com)
SENDGRID_API_KEY         = (from sendgrid.com)
FROM_EMAIL               = partnerships@secure24partners.com
FROM_NAME                = Gage Robbins
TWILIO_ACCOUNT_SID       = (from twilio.com)
TWILIO_AUTH_TOKEN        = (from twilio.com)
TWILIO_PHONE_NUMBER      = (your Twilio number)
ANTHROPIC_API_KEY        = (from console.anthropic.com)
NOTIFICATION_PHONE       = +13095324736
NOTIFICATION_EMAIL       = gagerobbins40@yahoo.com
ACTIVE_STATES            = TX,FL
DAILY_EMAIL_LIMIT        = 1000
DAILY_TEXT_LIMIT         = 500
MAX_FOLLOWUPS            = 5
```

After adding variables → Click **"Deploy"** to restart with new keys.

---

## Step 4 — Configure Webhooks

### SendGrid (so replies come back to app)
1. Go to SendGrid → Settings → Inbound Parse
2. Add hostname: your Railway URL
3. Destination URL: `https://YOUR-APP.up.railway.app/api/webhook/email-reply`

### SendGrid (engagement tracking)
1. SendGrid → Settings → Mail Settings → Event Webhook
2. URL: `https://YOUR-APP.up.railway.app/api/webhook/email-events`
3. Check: Opens, Clicks, Unsubscribes, Spam Reports

### Twilio (text replies)
1. Twilio → Phone Numbers → your number → Messaging
2. Webhook URL: `https://YOUR-APP.up.railway.app/api/webhook/text-reply`
3. Method: HTTP POST

---

## Step 5 — Add App to Phone Home Screen

**iPhone:**
1. Open Safari → go to your Railway URL
2. Tap the Share button (box with arrow)
3. Tap "Add to Home Screen"
4. Tap "Add"

Done — it looks and works like a native app.

---

## Step 6 — Import CRM Suppression List

1. Log into crm.thealarmprogram.com
2. Export your contacts as CSV
3. Open your Secure24 app → Campaign tab
4. Tap "Import CRM Suppression List"
5. Select the CSV file

This ensures you never contact existing customers or recent leads.

---

## Daily Operation (What You Do)

**Nothing — it runs itself.**

Every morning at 7:30am you'll receive a text summary:
- How many emails sent
- How many texts sent  
- New hot leads
- New replies

When a realtor replies → you get an instant text + email notification.

Open the app, tap their name, tap Call, close the deal.

---

## Scaling from Texas/Florida to All 48 States

1. Open app → Campaign tab
2. Tap any additional states to activate
3. Increase daily limits in Settings
4. Upgrade SendGrid and Twilio plans as needed

---

## Monthly Costs (Reference)

| Service           | Sample (TX+FL) | National |
|-------------------|----------------|----------|
| RealEstateAPI     | $50-100        | $150-300 |
| SendGrid          | $20-30         | $90      |
| Twilio            | $50-80         | $320     |
| Instantly.ai      | $37            | $37      |
| Anthropic API     | $15-20         | $50-80   |
| Railway hosting   | $10            | $20      |
| **TOTAL**         | **~$200/mo**   | **~$800/mo** |

---

## Support

Built by Claude (Anthropic) for Gage Robbins — Secure24 ADT
Real Estate Partnership Manager
(309) 532-4736 | gagerobbins40@yahoo.com
