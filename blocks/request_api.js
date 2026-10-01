function toCookieHeader(value) {
    if (value == null || value === '') return '';
    if (Array.isArray(value)) return value.map(cookie => String(cookie).split(';', 1)[0].trim()).filter(Boolean).join('; ');
    if (typeof value === 'object') return Object.entries(value).map(([name, cookie]) => `${name}=${String(cookie)}`).join('; ');
    return String(value).trim();
}
function mergeSessionHeaders(headers, session) {
    const result = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers && typeof headers === 'object' && !Array.isArray(headers) ? { ...headers } : {};
    const sessionHeader = toCookieHeader(session);
    if (!sessionHeader) return result;
    const cookieName = Object.keys(result).find(name => name.toLowerCase() === 'cookie');
    if (cookieName && result[cookieName]) result[cookieName] = `${result[cookieName]}; ${sessionHeader}`;
    else result.Cookie = sessionHeader;
    return result;
}
function readResponseSession(headers) {
    let cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    if (!cookies.length) {
        const combined = headers.get('set-cookie');
        if (combined) cookies = combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/);
    }
    return cookies.map(cookie => String(cookie).split(';', 1)[0].trim()).filter(Boolean).join('; ');
}
function readSessionToken(headers, data) {
    for (const name of ['x-session-token', 'session-token', 'x-auth-token']) {
        const value = headers.get(name);
        if (value) return value;
    }
    const authorization = headers.get('authorization');
    if (authorization) return authorization.replace(/^Bearer\s+/i, '');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
    for (const key of ['session_token', 'sessionToken', 'access_token', 'accessToken', 'token']) {
        if (data[key] !== undefined && data[key] !== null) return String(data[key]);
    }
    const session = data.session;
    if (session && typeof session === 'object') {
        for (const key of ['token', 'id', 'session_token', 'sessionToken']) {
            if (session[key] !== undefined && session[key] !== null) return String(session[key]);
        }
    }
    return typeof session === 'string' ? session : '';
}

module.exports = {
    name: "Request API",

    description: "Makes an API request.",

    category: "Internet Stuff",

    inputs: [
        {
            "id": "action",
            "name": "Action",
            "description": "Acceptable Types: Action\n\nDescription: Executes this block.",
            "types": ["action"]
        },
        {
            "id": "url",
            "name": "API URL",
            "description": "Acceptable Types: Text, Unspecified\n\nDescription: The URL of API.",
            "types": ["text", "unspecified"],
            "required": true
        },
        {
            "id": "headers",
            "name": "Headers",
            "description": "Acceptable Types: Object, Unspecified\n\nDescription: The headers to send to API. (OPTIONAL)",
            "types": ["object", "unspecified"]
        },
        {
            "id": "session",
            "name": "Session",
            "description": "Acceptable Types: Text, Object, List, Unspecified\n\nDescription: Session cookies to send, as a raw Cookie header, cookie object, or list. (OPTIONAL)",
            "types": ["text", "object", "list", "unspecified"]
        },
        {
            "id": "body",
            "name": "Body",
            "description": "Acceptable Types: Text, Object, Unspecified\n\nDescription: The body to send to API. (OPTIONAL)",
            "types": ["text", "object", "unspecified"]
        }
    ],

    options: [
        {
            "id": "method_type",
            "name": "Method Type",
            "description": "Description: The type of method for API request.",
            "type": "SELECT",
            "options": {
                "get": "Get",
                "post": "Post",
                "put": "Put",
                "delete": "Delete"
            }
        },
        {
            "id": "data_type",
            "name": "Data Type",
            "description": "Description: The type of data to obtain from API request.",
            "type": "SELECT",
            "options": {
                "text": "Text",
                "json": "Object (JSON)",
				"buffer": "Image (Buffer)"
            }
        }
    ],

    outputs: [
        {
            "id": "action",
            "name": "Action",
            "description": "Type: Action\n\nDescription: Executes the following blocks when this block finishes its task.",
            "types": ["action"]
        },
        {
            "id": "data",
            "name": "API Data",
            "description": "Type: Object\n\nDescription: The API data obtained if possible.",
            "types": ["object", "unspecified"]
        },
        {
            "id": "session",
            "name": "Session Cookies",
            "description": "Type: Text\n\nDescription: Reusable session cookie pairs returned through Set-Cookie.",
            "types": ["text"]
        },
        {
            "id": "session_token",
            "name": "Session Token",
            "description": "Type: Text\n\nDescription: A session or access token returned in a recognized response header or JSON field.",
            "types": ["text"]
        }
    ],

    async code(cache) {
        const url = this.GetInputValue("url", cache) + "";
        const headers = this.GetInputValue("headers", cache);
        const session = this.GetInputValue("session", cache);
        const body = this.GetInputValue("body", cache);
        const method = this.GetOptionValue("method_type", cache) + "";
        const data_type = this.GetOptionValue("data_type", cache) + "";

        const fetch = await this.require("node-fetch");
        let options = {};
        options.method = method;
        if (body) options.body = typeof body == "object" ? JSON.stringify(body) : body + "";
        options.headers = mergeSessionHeaders(headers, session);
        options.timeout == 7000
        const res = await fetch(url, options).catch(err => console.error(err));

        var data = data_type == "json" ? await res.json() : data_type == "buffer" ? await res.buffer() : await res.text();
        this.StoreOutputValue(data, "data", cache);
        this.StoreOutputValue(readResponseSession(res.headers), "session", cache);
        this.StoreOutputValue(readSessionToken(res.headers, data), "session_token", cache);
        this.RunNextBlock("action", cache);
    },
    toCookieHeader,
    mergeSessionHeaders,
    readResponseSession,
    readSessionToken
};
