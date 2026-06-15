// Vercel serverless function — fetches a dealership page server-side (no CORS).
// Lives at /api/scrape?url=<dealership url>
export default async function handler(req, res) {
  const url = (req.query && req.query.url) ? String(req.query.url) : '';
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'Provide a valid http(s) url.' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    clearTimeout(timer);

    const html = await r.text();
    // cache successful reads at the edge for 10 minutes
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(html);
  } catch (e) {
    clearTimeout(timer);
    res.status(502).json({ error: 'Could not fetch the site: ' + String(e && e.message || e) });
  }
}
