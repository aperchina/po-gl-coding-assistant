module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  let body = req.body;

  // Convert PDF image blocks to Anthropic's native document type.
  // The client sends PDFs as {type:"image", media_type:"application/pdf"};
  // the API requires {type:"document"} for PDF content.
  if (Array.isArray(body?.messages)) {
    body = {
      ...body,
      messages: body.messages.map((msg) => {
        if (!Array.isArray(msg.content)) return msg;
        return {
          ...msg,
          content: msg.content.map((block) => {
            if (
              block.type === 'image' &&
              block.source?.type === 'base64' &&
              block.source?.media_type === 'application/pdf'
            ) {
              return {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: block.source.data,
                },
              };
            }
            return block;
          }),
        };
      }),
    };
  }

  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
    .then((r) => r.json().then((data) => res.status(r.status).json(data)));
};
