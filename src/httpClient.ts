export interface HttpResponse {
    statusCode: number;
    body: string;
}

export interface PostJsonArgs {
    baseUrl: string;
    path: string;
    body: string;
    headers?: Record<string, string>;
}

export class HttpClient {
    async postJson(args: PostJsonArgs): Promise<HttpResponse> {
        const url = joinUrl(args.baseUrl, args.path);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(args.headers ?? {}),
            },
            body: args.body,
        });

        const text = await response.text();

        return {
            statusCode: response.status,
            body: text,
        };
    }
}

function joinUrl(baseUrl: string, path: string): string {
    const trimmedBase = baseUrl.replace(/\/+$/, "");
    const trimmedPath = path.startsWith("/") ? path : `/${path}`;
    return `${trimmedBase}${trimmedPath}`;
}