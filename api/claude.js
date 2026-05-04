// pdf-parse must be imported via its lib path to avoid a startup-time file read
// that fails in Vercel's serverless environment (the test fixture isn't deployed).
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  let body = req.body;

  // Replace any base64-encoded PDF image blocks with extracted plain text,
  // since Anthropic's messages API does not accept PDFs as image content.
  try {
    if (Array.isArray(body?.messages)) {
      const messages = await Promise.all(body.messages.map(async (msg) => {
        if (!Array.isArray(msg.content)) return msg;
        const content = await Promise.all(msg.content.map(async (block) => {
          if (
            block.type === 'image' &&
            block.source?.type === 'base64' &&
            block.source?.media_type === 'application/pdf'
          ) {
            const buf = Buffer.from(block.source.data, 'base64');
            let pageCount = 0;
            const parsed = await pdfParse(buf, {
              max: 0,
              pagerender: function(pageData) {
                pageCount++;
                const num = pageCount;
                return pageData.getTextContent().then(function(tc) {
                  const text = tc.items.map(function(item) { return item.str; }).join(' ');
                  return `\n\n--- PAGE ${num} ---\n${text}`;
                });
              }
            });
            const text = `[PDF — ${pageCount} page(s)]\n${parsed.text}`;
            return { type: 'text', text };
          }
          return block;
        }));
        return { ...msg, content };
      }));
      body = { ...body, messages };
    }
  } catch (err) {
    return res.status(422).json({ error: `PDF parsing failed: ${err.message}` });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return res.status(response.status).json(data);
};
