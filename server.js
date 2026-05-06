require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');

const app = express();
app.use(express.json());
const fs = require('fs');
const path = require('path');

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// In-memory storage
let newsletters = [];

// Fetch top markets from Polymarket
async function fetchMarkets() {
  const url = 'https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume&ascending=false&limit=20';
  const res = await fetch(url);
  const markets = await res.json();

  return markets.slice(0, 10).map(m => {
    let yesPrice = null;
    try {
      const prices = JSON.parse(m.outcomePrices);
      yesPrice = Math.round(parseFloat(prices[0]) * 100);
    } catch {}

    const volume = parseFloat(m.volume || 0);
    const volume24h = parseFloat(m.volume24hr || m.oneDayVolume || 0);
    const priceChange = m.oneDayPriceChange ? (parseFloat(m.oneDayPriceChange) * 100).toFixed(1) : null;

    return {
      question: m.question,
      slug: m.slug,
      category: m.category || 'General',
      yesPrice,
      volume,
      volume24h,
      priceChange,
      timestamp: new Date().toISOString()
    };
  });
}

// Generate newsletter with Claude
async function generateNewsletter(markets) {
  const formatVolume = (v) => {
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(0);
  };

  const marketSummary = markets.map((m, i) => {
    return `${i + 1}. "${m.question}"
   - YES price: ${m.yesPrice}¢ ${m.priceChange ? `(${m.priceChange > 0 ? '+' : ''}${m.priceChange}% today)` : ''}
   - Total Volume: ${formatVolume(m.volume)}
   - 24h Volume: ${formatVolume(m.volume24h)}
   - Category: ${m.category}`;
  }).join('\n\n');

  const prompt = `You are a witty, sharp financial newsletter writer in the style of Morning Brew. 
Your job is to write a daily Polymarket digest that is:
- Punchy and engaging, not dry
- Uses light humor where appropriate
- Highlights the most interesting signals and surprises
- Explains what price movements mean in plain English
- Has a clear structure: hook intro, market-by-market highlights, and a closing take
- Written for a smart audience that is curious but not necessarily crypto-native

Here is today's Polymarket data:

${marketSummary}

Write the newsletter now. Use this structure:
1. A catchy subject line (prefix with "SUBJECT: ")
2. A hook opening paragraph (2-3 sentences, make it interesting)
3. TOP MARKETS section - highlight the 5 most interesting markets with insight
4. BIGGEST MOVER - call out the most interesting price or volume change
5. THE BOTTOM LINE - one punchy closing paragraph with your overall take on what the markets are signaling

Keep it under 500 words. Make it something people actually want to read.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const result = await response.json();
  return result.content[0].text;
}

// API Routes
app.get('/api/markets', async (req, res) => {
  try {
    const markets = await fetchMarkets();
    res.json({ success: true, markets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const markets = await fetchMarkets();
    const newsletter = await generateNewsletter(markets);
    const entry = { date: new Date().toISOString(), newsletter, markets };
    newsletters.unshift(entry);
    if (newsletters.length > 30) newsletters.pop();
    res.json({ success: true, newsletter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/newsletters', (req, res) => {
  res.json({ success: true, newsletters });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;