/** Labels describe the recorded user agent; they are not device fingerprinting. */
export function describeClient(userAgent: string | null | undefined) {
    const ua = userAgent?.trim().slice(0, 2048);
    if (!ua || ua === '—') return { browser: 'Not captured', version: 'Not captured', os: 'Not captured', device: 'Not captured' };
    let browser = 'Unknown', version = 'Not captured';
    const browsers: [string, RegExp][] = [
        ['Bot / automation', /(?:Googlebot|bingbot|DuckDuckBot|YandexBot|crawler|spider|HeadlessChrome)\/([\d.]+)/i],
        ['Opera', /(?:OPR|OPT|OPiOS|Opera Mini|Opera Mobi)\/([\d.]+)/i],
        ['Microsoft Edge', /(?:Edg|EdgA|EdgiOS|Edge)\/([\d.]+)/i],
        ['Samsung Internet', /SamsungBrowser\/([\d.]+)/i],
        ['Vivaldi', /Vivaldi\/([\d.]+)/i],
        ['Yandex Browser', /YaBrowser\/([\d.]+)/i],
        ['DuckDuckGo', /(?:DuckDuckGo|Ddg)\/([\d.]+)/i],
        ['Brave', /Brave\/([\d.]+)/i],
        ['Opera', /Opera\/([\d.]+)/i],
        ['SeaMonkey', /SeaMonkey\/([\d.]+)/i],
        ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/i],
        ['Chromium', /Chromium\/([\d.]+)/i],
        ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/i],
        ['Internet Explorer', /(?:MSIE\s|Trident\/.*rv:)([\d.]+)/i],
        ['API client (Deno)', /Deno\/([\d.]+)/i],
        ['API client (curl)', /curl\/([\d.]+)/i],
        ['API client (Python)', /python-requests\/([\d.]+)/i],
        ['API client (Node.js)', /(?:Node\.js|node-fetch|undici)\/([\d.]+)/i],
    ];
    for (const [name, pattern] of browsers) { const match = ua.match(pattern); if (match) { browser = name; version = match[1]; break; } }
    if (browser === 'Opera' && /Opera\//i.test(ua)) version = ua.match(/Version\/([\d.]+)/i)?.[1] ?? version;
    if (browser === 'Unknown' && /Safari\//i.test(ua) && /Version\//i.test(ua)) { browser = 'Safari'; version = ua.match(/Version\/([\d.]+)/i)?.[1] ?? version; }
    const os = /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /CrOS/i.test(ua) ? 'ChromeOS' : /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS X/i.test(ua) ? 'macOS' : /Linux|X11/i.test(ua) ? 'Linux' : 'Unknown';
    const device = browser === 'Bot / automation' ? 'Bot / automation' : browser.startsWith('API client') ? 'Server / API client' : /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|iPhone|iPod/i.test(ua) ? 'Phone' : ['Windows', 'macOS', 'Linux', 'ChromeOS'].includes(os) ? 'Computer' : 'Unknown';
    return { browser, version, os, device };
}
