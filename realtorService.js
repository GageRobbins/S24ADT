const axios = require('axios');
const db = require('../database');
require('dotenv').config();

const ACTIVE_STATES = (process.env.ACTIVE_STATES || 'TX,FL').split(',');

// ─── Fetch new closings from RealEstateAPI ────────────────────────────────
async function fetchNewClosings({ states = ACTIVE_STATES, days_back = 7 } = {}) {
  const apiKey = process.env.REALESTATEAPI_KEY;
  if (!apiKey || apiKey === 'your_realestateapi_key_here') {
    console.log('[RealEstateAPI] No API key set - skipping fetch');
    return 0;
  }

  let totalAdded = 0;

  for (const state of states) {
    try {
      console.log(`[RealEstateAPI] Fetching closings for ${state}...`);
      
      const response = await axios.get('https://api.realestateapi.com/v2/PropertySearch', {
        headers: { 'x-api-key': apiKey },
        params: {
          state,
          status: 'sold',
          soldWithin: days_back,
          limit: 500,
          includeAgentInfo: true
        }
      });

      const properties = response.data?.data || response.data?.results || [];
      console.log(`[RealEstateAPI] Found ${properties.length} closings in ${state}`);

      for (const prop of properties) {
        const agent = prop.listingAgent || prop.sellingAgent || prop.agent || {};
        const buyerAgent = prop.buyerAgent || {};

        // Process both listing and buyer agents
        const agents = [agent, buyerAgent].filter(a => a.email || a.phone);

        for (const a of agents) {
          if (!a.email && !a.phone) continue;

          // Check suppression list
          const suppressed = db.prepare(`
            SELECT id FROM suppression_list 
            WHERE email = ? OR phone = ?
          `).get(a.email || '', a.phone || '');
          if (suppressed) continue;

          // Check CRM - skip if sent lead in last 90 days
          const recentCRM = db.prepare(`
            SELECT id FROM crm_import 
            WHERE (email = ? OR phone = ?)
            AND last_lead_date > datetime('now', '-90 days')
          `).get(a.email || '', a.phone || '');
          if (recentCRM) continue;

          // Insert or ignore duplicate
          const result = db.prepare(`
            INSERT OR IGNORE INTO realtors 
            (name, email, phone, brokerage, address, city, state, zip, closing_date, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'realestateapi')
          `).run(
            a.name || a.agentName || 'Realtor',
            a.email || null,
            a.phone || a.phoneNumber || null,
            a.brokerage || a.officeName || null,
            prop.address || prop.streetAddress || null,
            prop.city || null,
            state,
            prop.zip || prop.zipCode || null,
            prop.soldDate || prop.closingDate || new Date().toISOString()
          );

          if (result.changes > 0) totalAdded++;
        }
      }

      db.updateDailyStats('new_realtors', totalAdded);

    } catch (err) {
      console.error(`[RealEstateAPI] Error fetching ${state}:`, err.message);
    }
  }

  console.log(`[RealEstateAPI] Total new realtors added: ${totalAdded}`);
  return totalAdded;
}

// ─── Import from CSV (CRM export fallback) ───────────────────────────────
function importFromCSV(contacts, type = 'realtor') {
  let added = 0;
  const table = type === 'inspector' ? 'inspectors' : 'realtors';

  for (const contact of contacts) {
    if (!contact.email && !contact.phone) continue;

    const result = db.prepare(`
      INSERT OR IGNORE INTO ${table}
      (name, email, phone, brokerage, city, state, source)
      VALUES (?, ?, ?, ?, ?, ?, 'csv_import')
    `).run(
      contact.name || 'Unknown',
      contact.email || null,
      contact.phone || null,
      contact.brokerage || contact.company || null,
      contact.city || null,
      contact.state || null
    );
    if (result.changes > 0) added++;
  }

  return added;
}

// ─── Import CRM suppression list ─────────────────────────────────────────
function importCRMSuppression(contacts) {
  let added = 0;
  for (const contact of contacts) {
    const result = db.prepare(`
      INSERT OR IGNORE INTO crm_import (email, phone, name, last_lead_date)
      VALUES (?, ?, ?, ?)
    `).run(
      contact.email || null,
      contact.phone || null,
      contact.name || null,
      contact.last_lead_date || new Date().toISOString()
    );
    if (result.changes > 0) added++;
  }
  return added;
}

module.exports = { fetchNewClosings, importFromCSV, importCRMSuppression };
